import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from './index.mjs';
import { createSessionManager } from './sessions.mjs';
import { ServiceError, safeError } from './mcp.mjs';

const tokens = { a: 'fake_account_alpha', b: 'fake_account_beta', bad: 'fake_invalid_token' };
const nutrition = '[1]{productName,nutritionDescription,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:\n'
  + '  板烧鸡腿堡,null,1638,391,23,17,35,1041,93';
const context = { storeCode: '1450226', orderType: 1, beType: 1 };
function fakeService() {
  const calls = [];
  let holdAddresses = null, holdOrders = null;
  const service = {
    calls,
    holdAddresses(promise) { holdAddresses = promise; },
    holdOrders(promise) { holdOrders = promise; },
    makeMcd(token) {
      let closed = false;
      return {
        close() { closed = true; },
        async callMcd(name, args) {
          if (closed) throw new ServiceError('连接已关闭', 401);
          calls.push({ token, name, args });
          if (token === tokens.bad) throw new ServiceError(`无效 token：${token}`);
          const account = token === tokens.a ? '甲' : '乙';
          switch (name) {
            case 'list-nutrition-foods': return nutrition;
            case 'delivery-query-addresses':
              if (holdAddresses) await holdAddresses;
              return { addresses: [{ addressId: account, fullAddress: `${account}的配送地址` }] };
            case 'query-nearby-stores': return { stores: [{ storeCode: '1450226', storeName: `${account}收藏的门店` }] };
            case 'query-store-coupons': return { coupons: [{ title: `${account}的优惠券` }] };
            case 'query-meals': return { categories: [], meals: { main: { name: '板烧鸡腿堡', currentPrice: 20 } } };
            case 'query-meal-detail': return { name: '板烧鸡腿堡', rounds: [] };
            case 'calculate-price': return { price: token === tokens.a ? 1490 : 2000,
              productList: [{ productCode: 'main', productName: '板烧鸡腿堡', quantity: 1, subtotal: 1490 }],
              takeWayList: [{ code: 'takeout', title: '外带' }] };
            case 'create-order':
              if (holdOrders) await holdOrders;
              return { orderId: `fake-order-${account}`, orderDetail: { storeName: `${account}的门店` } };
            default: throw new Error(`Unexpected fake tool: ${name}`);
          }
        },
      };
    },
  };
  return service;
}

async function setup(t) {
  await mkdir(resolve('.local/test'), { recursive: true });
  const directory = await mkdtemp(resolve('.local/test/sessions-'));
  const fake = fakeService();
  let app, server, url;
  const stop = async () => {
    app.locals.sessions.close();
    await new Promise(resolve => server.close(resolve));
  };
  const start = async () => {
    app = await createApp({ directory, makeMcd: fake.makeMcd });
    server = app.listen(0, 'localhost');
    await new Promise(resolve => server.once('listening', resolve));
    url = `http://localhost:${server.address().port}`;
  };
  await start();
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  function browser() {
    let cookie = '', key = '';
    return {
      get cookie() { return cookie; },
      get key() { return key; },
      async request(path, body, method = body === undefined ? 'GET' : 'POST', extra = {}) {
        const response = await fetch(`${url}/api${path}`, {
          method, headers: { 'Content-Type': 'application/json', 'X-Mai-Request': '1',
            ...(cookie ? { Cookie: cookie } : {}), ...(key ? { 'X-Mai-Session': key } : {}), ...extra },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const data = await response.json();
        if (data.session?.key) key = data.session.key;
        return { status: response.status, data, setCookie };
      },
      connect(token) { return this.request('/connection', { token }, 'PUT'); },
      async quote() {
        const menu = await this.request(`/menu?${new URLSearchParams(context)}`);
        assert.equal(menu.status, 200);
        return this.request('/quote', { context, selections: [{ id: menu.data.foods[0].id, quantity: 1 }], needTableware: false });
      },
    };
  }
  return { fake, browser, directory, restart: async () => { await stop(); await start(); } };
}

test('new sessions require their own token, ignore global config and reject forged/expired cookies', async t => {
  const previous = process.env.MCD_MCP_TOKEN;
  process.env.MCD_MCP_TOKEN = tokens.a;
  t.after(() => { if (previous === undefined) delete process.env.MCD_MCP_TOKEN; else process.env.MCD_MCP_TOKEN = previous; });
  const h = await setup(t);
  const a = h.browser(), b = h.browser();
  const [aa, bb] = await Promise.all([a.request('/bootstrap'), b.request('/bootstrap')]);
  assert.equal(aa.data.connection.configured, false);
  assert.equal(aa.data.connection.error, null);
  assert.notEqual(a.cookie, b.cookie);
  assert.match(aa.setCookie, /HttpOnly; SameSite=Strict/);
  assert.equal(aa.data.preferences.budget, bb.data.preferences.budget);
  assert.equal(h.fake.calls.length, 0);
  assert.equal((await a.request('/addresses')).status, 401);
  assert.equal((await a.connect(tokens.a)).status, 200);
  assert.equal((await b.request('/bootstrap')).data.connection.configured, false);
  const forged = await b.request('/history', undefined, 'GET', { Cookie: `mai_session=${'f'.repeat(64)}` });
  assert.equal(forged.status, 401);
  assert.equal(forged.setCookie, null);
  await a.request('/preferences', { ...aa.data.preferences, budget: 35 }, 'PUT');
  await b.connect(tokens.a);
  assert.equal((await b.request('/bootstrap')).data.preferences.budget, bb.data.preferences.budget);
  assert.equal((await a.request('/bootstrap')).data.preferences.budget, 35);
});

test('two concurrent accounts isolate preferences, addresses, coupons, recommendations, quotes and history', async t => {
  const h = await setup(t);
  const a = h.browser(), b = h.browser();
  const [aa, bb] = await Promise.all([a.request('/bootstrap'), b.request('/bootstrap')]);
  await Promise.all([a.connect(tokens.a), b.connect(tokens.b)]);
  await a.request('/preferences', { ...aa.data.preferences, budget: 18, proteinMin: 0, weatherEnabled: false }, 'PUT');
  await b.request('/preferences', { ...bb.data.preferences, budget: 45, proteinMin: 0, weatherEnabled: false }, 'PUT');
  assert.equal((await a.request('/bootstrap')).data.preferences.budget, 18);
  assert.equal((await b.request('/bootstrap')).data.preferences.budget, 45);
  const [addressA, addressB] = await Promise.all([a.request('/addresses'), b.request('/addresses')]);
  assert.equal(addressA.data.addresses[0].addressId, '甲');
  assert.equal(addressB.data.addresses[0].addressId, '乙');
  assert.equal((await a.request('/addresses')).data.addresses[0].addressId, '甲');
  const [couponA, couponB] = await Promise.all([
    a.request(`/coupons?${new URLSearchParams(context)}`), b.request(`/coupons?${new URLSearchParams(context)}`),
  ]);
  assert.equal(couponA.data.data.coupons[0].title, '甲的优惠券');
  assert.equal(couponB.data.data.coupons[0].title, '乙的优惠券');
  const [planA, planB] = await Promise.all([a.request('/recommend', { context }), b.request('/recommend', { context })]);
  assert.equal(planA.data.plans[0].price, 14.9);
  assert.equal(planB.data.plans[0].price, 20);
  const [quoteA, quoteB] = await Promise.all([a.quote(), b.quote()]);
  assert.equal(quoteA.data.price.price, 1490);
  assert.equal(quoteB.data.price.price, 2000);
  assert.equal((await b.request('/orders', { quoteId: quoteA.data.id, takeWayCode: 'takeout', confirmed: true })).status, 409);
  assert.equal(h.fake.calls.filter(c => c.name === 'create-order').length, 0);
  // Fake-only submission checks the real HTTP state machine without creating a McDonald's order.
  const submit = { quoteId: quoteA.data.id, takeWayCode: 'takeout', confirmed: true };
  const results = await Promise.all([a.request('/orders', submit), a.request('/orders', submit)]);
  assert.ok(results.some(r => r.status === 200));
  assert.equal(h.fake.calls.filter(c => c.name === 'create-order').length, 1);
  assert.equal((await a.request('/history')).data.orders[0].order.orderId, 'fake-order-甲');
  assert.equal((await b.request('/history')).data.orders.length, 0);
  const snapshot = JSON.stringify([aa, bb, addressA, addressB, quoteA, quoteB, planA, planB]);
  assert.ok(Object.values(tokens).every(token => !snapshot.includes(token)));
});

test('failed token verification preserves connection; switches invalidate old quotes and same-browser stale tabs', async t => {
  const h = await setup(t), a = h.browser(), b = h.browser();
  await Promise.all([a.request('/bootstrap'), b.request('/bootstrap')]);
  await Promise.all([a.connect(tokens.a), b.connect(tokens.b)]);
  const quote = await a.quote(), oldKey = a.key;
  const invalid = await a.connect(tokens.bad);
  assert.equal(invalid.status, 502);
  assert.ok(!JSON.stringify(invalid.data).includes(tokens.bad));
  assert.equal(a.key, oldKey);
  assert.equal((await a.request('/addresses')).data.addresses[0].addressId, '甲');
  await a.connect(tokens.b);
  assert.notEqual(a.key, oldKey);
  assert.equal((await a.request('/addresses')).data.addresses[0].addressId, '乙');
  assert.equal((await a.request('/orders', { quoteId: quote.data.id, takeWayCode: 'takeout', confirmed: true })).status, 409);
  assert.equal((await a.request('/addresses', undefined, 'GET', { 'X-Mai-Session': oldKey })).status, 401);
  assert.equal((await b.request('/addresses')).data.addresses[0].addressId, '乙');
  await a.connect(tokens.a); // Even returning to the old credential cannot restore an old quote.
  assert.equal((await a.request('/orders', { quoteId: quote.data.id, takeWayCode: 'takeout', confirmed: true })).status, 409);
});

test('restart keeps session data but never credentials or usable old quotes; disconnect deletes only its session', async t => {
  const h = await setup(t), a = h.browser(), b = h.browser();
  const initial = await a.request('/bootstrap');
  await b.request('/bootstrap');
  await Promise.all([a.connect(tokens.a), b.connect(tokens.b)]);
  await a.request('/preferences', { ...initial.data.preferences, budget: 33 }, 'PUT');
  const quote = await a.quote();
  await h.restart();
  const restored = await a.request('/bootstrap');
  assert.equal(restored.data.preferences.budget, 33);
  assert.equal(restored.data.connection.configured, false);
  await a.connect(tokens.a);
  assert.equal((await a.request('/bootstrap')).data.preferences.budget, 33);
  assert.equal((await a.request('/orders', { quoteId: quote.data.id, takeWayCode: 'takeout', confirmed: true })).status, 409);
  await b.request('/bootstrap'); await b.connect(tokens.b);
  const previousCookie = a.cookie;
  const disconnected = await a.request('/connection', undefined, 'DELETE');
  assert.equal(disconnected.status, 200);
  assert.match(disconnected.setCookie, /Max-Age=0/);
  assert.equal((await a.request('/history', undefined, 'GET', { Cookie: previousCookie })).status, 401);
  assert.equal((await b.request('/addresses')).data.addresses[0].addressId, '乙');
  assert.equal((await a.request('/bootstrap')).data.preferences.budget, initial.data.preferences.budget);
  async function files(path) {
    return (await Promise.all((await readdir(path, { withFileTypes: true })).map(async entry => {
      const child = resolve(path, entry.name);
      return entry.isDirectory() ? files(child) : readFile(child, 'utf8');
    }))).flat().join('\n');
  }
  const persisted = await files(h.directory);
  assert.ok(Object.values(tokens).every(token => !persisted.includes(token)));
});

test('a response in flight cannot leak old account data after switching; an order blocks switching until finished', async t => {
  const h = await setup(t), a = h.browser();
  await a.request('/bootstrap'); await a.connect(tokens.a);
  let releaseAddress;
  h.fake.holdAddresses(new Promise(resolve => { releaseAddress = resolve; }));
  const pending = a.request('/addresses');
  while (!h.fake.calls.some(c => c.name === 'delivery-query-addresses')) await new Promise(resolve => setImmediate(resolve));
  await a.connect(tokens.b);
  releaseAddress();
  const result = await pending;
  assert.equal(result.status, 401);
  assert.ok(!JSON.stringify(result.data).includes('甲的配送地址'));
  h.fake.holdAddresses(null);
  const quote = await a.quote();
  let releaseOrder;
  h.fake.holdOrders(new Promise(resolve => { releaseOrder = resolve; }));
  const order = a.request('/orders', { quoteId: quote.data.id, takeWayCode: 'takeout', confirmed: true });
  while (!h.fake.calls.some(c => c.name === 'create-order')) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await a.connect(tokens.a)).status, 409);
  assert.equal((await a.request('/connection', undefined, 'DELETE')).status, 409);
  releaseOrder();
  assert.equal((await order).status, 200);
});

test('writes reject cross-origin and missing request headers; only one failed account is rate limited', async t => {
  const h = await setup(t), a = h.browser(), b = h.browser();
  await Promise.all([a.request('/bootstrap'), b.request('/bootstrap')]);
  assert.equal((await a.request('/connection', { token: tokens.a }, 'PUT', { Origin: 'https://example.com' })).status, 403);
  assert.equal((await a.request('/connection', { token: tokens.a }, 'PUT', { 'X-Mai-Request': '' })).status, 403);
  for (let i = 0; i < 5; i++) assert.equal((await a.connect(tokens.bad)).status, 502);
  assert.equal((await a.connect(tokens.a)).status, 429);
  assert.equal((await b.connect(tokens.b)).status, 200);
  assert.equal(safeError(new ServiceError(`Bearer ${tokens.a}; ${tokens.a}`), tokens.a).includes(tokens.a), false);
  assert.match(safeError(Object.assign(new Error('当前鉴权码不存在或已失效!'), { code: 401 })), /token 无效/);
  assert.match(safeError(Object.assign(new Error('upstream refused'), { code: 429 })), /限流/);
});

test('expired sessions and malformed orphan records are removed; expired cookie never revives an account', async t => {
  await mkdir(resolve('.local/test'), { recursive: true });
  const directory = await mkdtemp(resolve('.local/test/expiry-'));
  const orphan = 'a'.repeat(64);
  await mkdir(resolve(directory, orphan));
  await writeFile(resolve(directory, orphan, 'session.json'), '{}');
  let clock = Date.now();
  const manager = await createSessionManager({ directory, now: () => clock, ttl: 100, maxSessions: 1,
    secureCookie: true, cookieName: 'mai_skill_3011' });
  t.after(async () => { manager.close(); await rm(directory, { recursive: true, force: true }); });
  assert.equal((await readdir(directory)).length, 0);
  let setCookie = '';
  const response = { setHeader(name, value) { setCookie = value; } };
  const session = await manager.acquire({ headers: {} }, response, true);
  assert.match(setCookie, /; Secure$/);
  assert.match(setCookie, /^mai_skill_3011=/);
  await assert.rejects(manager.acquire({ headers: {} }, response, true), /上限/);
  const req = { headers: { cookie: setCookie.split(';')[0] } };
  clock += 101;
  assert.equal(await manager.acquire(req, response), null);
  await manager.cleanup();
  assert.equal((await readdir(directory)).length, 0);
  assert.equal(session.scope.active, false);
  const fresh = await manager.acquire(req, response, true);
  assert.notEqual(fresh.id, session.id);
  assert.equal(fresh.scope.configured, false);
});
