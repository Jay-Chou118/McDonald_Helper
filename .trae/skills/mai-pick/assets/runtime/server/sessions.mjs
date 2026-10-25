import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createMcd, ServiceError } from './mcp.mjs';
import { createData } from './data.mjs';

const lifetime = 90 * 86400000;
const hash = value => createHash('sha256').update(value).digest('hex');

export async function createSessionManager({ directory = resolve('.local/sessions'), makeMcd = createMcd,
  now = Date.now, ttl = lifetime, maxSessions = 200, secureCookie = false, cookieName = 'mai_session' } = {}) {
  if (!/^[a-zA-Z0-9_]+$/.test(cookieName)) throw new Error('会话 Cookie 名称无效。');
  const sessions = new Map();
  await mkdir(directory, { recursive: true, mode: 0o700 });

  function makeScope(session, token = '', fingerprint = session.fingerprint) {
    const scope = { key: randomUUID(), identity: fingerprint, active: true, configured: Boolean(token),
      connected: false, ordersBusy: 0 };
    scope.assertActive = () => {
      if (!scope.active || (session.expiresAt <= now() && !scope.ordersBusy)) throw new ServiceError('会话已变化或过期，请重新连接。', 401);
    };
    const mcd = token ? makeMcd(token) : null;
    scope.callMcd = async (...args) => {
      scope.assertActive();
      if (!mcd) throw new ServiceError('请先连接你自己的麦当劳账号。', 401);
      const result = await mcd.callMcd(...args);
      scope.assertActive();
      return result;
    };
    scope.data = createData({ directory: resolve(directory, session.id, fingerprint ?? 'guest'),
      callMcd: scope.callMcd, assertActive: scope.assertActive });
    scope.close = () => { scope.active = false; scope.data.clearCache(); mcd?.close(); };
    return scope;
  }
  async function save(session) {
    const path = resolve(directory, session.id);
    await mkdir(path, { recursive: true, mode: 0o700 });
    await writeFile(resolve(path, 'session.json.tmp'), JSON.stringify({
      expiresAt: session.expiresAt, fingerprint: session.fingerprint ?? null,
    }), { mode: 0o600 });
    await rename(resolve(path, 'session.json.tmp'), resolve(path, 'session.json'));
  }
  // Only server-created, persisted records can restore a cookie. Raw cookie values are never paths.
  for (const id of await readdir(directory)) {
    if (!/^[a-f0-9]{64}$/.test(id)) continue;
    const record = await readFile(resolve(directory, id, 'session.json'), 'utf8')
      .then(JSON.parse).catch(() => null);
    if (!record || !Number.isFinite(record.expiresAt) || record.expiresAt <= now()
      || (record.fingerprint !== null && !/^[a-f0-9]{64}$/.test(record.fingerprint))
      || sessions.size >= maxSessions) {
      await rm(resolve(directory, id), { recursive: true, force: true });
      continue;
    }
    const session = { id, ...record, changing: false, attempts: [] };
    session.scope = makeScope(session);
    sessions.set(id, session);
  }
  async function cleanup() {
    for (const [id, session] of sessions) {
      if (session.expiresAt > now() || session.changing || session.scope.ordersBusy) continue;
      session.scope.close();
      sessions.delete(id);
      await session.scope.data.drain();
      await rm(resolve(directory, id), { recursive: true, force: true });
    }
  }
  const timer = setInterval(() => { cleanup().catch(() => {}); }, 60000);
  timer.unref();

  function find(req) {
    const raw = (req.headers.cookie ?? '').split(';').map(c => c.trim())
      .find(c => c.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
    const session = sessions.get(hash(raw));
    return session && session.expiresAt > now() ? session : null;
  }
  function cookie(res, value, maxAge) {
    res.setHeader('Set-Cookie', `${cookieName}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`);
  }
  return {
    async acquire(req, res, create = false) {
      let session = find(req);
      if (session || !create) return session;
      await cleanup();
      if (sessions.size >= maxSessions) throw new ServiceError('会话数量已达上限，请稍后重试。', 503);
      const secret = randomBytes(32).toString('hex');
      session = { id: hash(secret), expiresAt: now() + ttl, fingerprint: null, changing: false, attempts: [] };
      session.scope = makeScope(session);
      sessions.set(session.id, session);
      try { await save(session); }
      catch (error) { sessions.delete(session.id); throw error; }
      cookie(res, secret, Math.floor(ttl / 1000));
      return session;
    },
    async connect(session, token) {
      if (session.changing || session.scope.ordersBusy) throw new ServiceError('当前连接正在处理请求，请完成后再切换。', 409);
      session.attempts = session.attempts.filter(t => t > now() - 60000);
      if (session.attempts.length >= 5) throw new ServiceError('连接尝试过于频繁，请一分钟后重试。', 429);
      session.attempts.push(now());
      session.changing = true;
      const fingerprint = hash(`${session.id}:${token}`);
      const candidate = makeScope(session, token, fingerprint);
      try {
        const count = (await candidate.data.getNutrition()).length;
        await session.scope.data.drain();
        candidate.assertActive();
        const previousFingerprint = session.fingerprint;
        session.fingerprint = fingerprint;
        try { await save(session); }
        catch (error) { session.fingerprint = previousFingerprint; throw error; }
        session.scope.close();
        candidate.connected = true;
        session.scope = candidate;
        return { scope: candidate, nutritionCount: count };
      } catch (error) { candidate.close(); throw error; }
      finally { session.changing = false; }
    },
    async remove(session, res) {
      if (session.changing || session.scope.ordersBusy) throw new ServiceError('正在处理请求，请完成后再断开连接。', 409);
      session.changing = true;
      try {
        await session.scope.data.drain();
        session.scope.close();
        sessions.delete(session.id);
        await rm(resolve(directory, session.id), { recursive: true, force: true });
        cookie(res, '', 0);
      } finally { session.changing = false; }
    },
    cleanup,
    close() { clearInterval(timer); for (const session of sessions.values()) session.scope.close(); },
  };
}
