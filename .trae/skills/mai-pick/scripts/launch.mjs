import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, cp, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(skillRoot, 'assets/runtime');
const argv = process.argv.slice(2);
const commands = ['--check', '--setup', '--serve'];
const command = argv[0];
const port = argv[1] === '--port' ? Number(argv[2]) : 3011;

function output(value) { console.log(JSON.stringify(value)); }
function fail(message) { throw new Error(message); }
function nodeVersionSupported() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major === 20 && minor >= 19 || major === 22 && minor >= 12 || major > 22;
}
async function files(path) {
  const result = [];
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) fail('运行包不能含符号链接。');
    const file = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await files(file));
    else if (entry.isFile()) result.push(file);
  }
  return result;
}
async function runNpm(cwd) {
  const windows = process.platform === 'win32';
  const binary = windows ? process.env.ComSpec ?? 'cmd.exe' : 'npm';
  const args = windows
    ? ['/d', '/s', '/c', 'npm ci --include=dev --ignore-scripts --registry https://registry.npmjs.org/']
    : ['ci', '--include=dev', '--ignore-scripts', '--registry', 'https://registry.npmjs.org/'];
  await new Promise((accept, reject) => {
    const child = spawn(binary, args, { cwd, stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? accept() : reject(new Error('依赖安装失败，请检查 npm 和网络连接。')));
  });
}
async function buildWeb(cwd) {
  await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [resolve(cwd, 'node_modules/vite/bin/vite.js'), 'build'], {
      cwd, stdio: 'inherit', shell: false,
    });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? accept() : reject(new Error('本机网页构建失败，未将运行环境标记为可用。')));
  });
}

try {
  if (!commands.includes(command) || (argv.length !== 1 && !(argv.length === 3 && argv[1] === '--port'))) {
    fail('用法：node scripts/launch.mjs --check|--setup|--serve [--port 3011]');
  }
  if (!nodeVersionSupported()) fail('需要 Node.js 20.19+ 或 22.12+（也支持更高主版本）。');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('端口应是 1024–65535 的整数。');
  const digest = createHash('sha256');
  for (const file of await files(source)) {
    digest.update(relative(source, file)); digest.update('\0'); digest.update(await readFile(file)); digest.update('\0');
  }
  const version = digest.digest('hex').slice(0, 20);
  const root = resolve(process.env.MAI_PICK_DATA_DIR ?? resolve(homedir(), '.mai-pick'));
  const runtime = resolve(root, 'runtimes', version);
  const directory = resolve(root, 'sessions', String(port));
  const marker = resolve(runtime, '.runtime-ready');
  const ready = await stat(marker).then(s => s.isFile()).catch(() => false)
    && await stat(resolve(runtime, 'dist/index.html')).then(s => s.isFile()).catch(() => false);
  if (command === '--check') {
    output({ node: process.versions.node, runtimeReady: ready, runtime, url: `http://localhost:${port}`,
      tokenBundled: false, connection: '由使用者在本人本机浏览器自行连接' });
  } else if (command === '--setup') {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await mkdir(resolve(root, 'runtimes'), { recursive: true, mode: 0o700 });
    if (ready) {
      output({ ready: true, runtime, reused: true });
    } else {
      const lock = resolve(root, 'setup.lock');
      await mkdir(lock, { mode: 0o700 }).catch(() => fail('另一次依赖安装正在运行，或上次安装中断。确认没有安装进程后清理本人 .mai-pick/setup.lock 再试。'));
      try {
        await mkdir(runtime, { recursive: true, mode: 0o700 });
        await cp(source, runtime, { recursive: true });
        await runNpm(runtime);
        await buildWeb(runtime);
        await writeFile(marker, version, { mode: 0o600 });
        output({ ready: true, runtime, builtLocally: true, tokenBundled: false });
      } finally { await rm(lock, { recursive: true, force: true }); }
    }
  } else {
    if (!ready) fail('尚未安装依赖，请先运行 node scripts/launch.mjs --setup。');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    process.chdir(runtime);
    const { createApp } = await import(pathToFileURL(resolve(runtime, 'server/index.mjs')).href);
    const app = await createApp({ directory, port, cookieName: `mai_skill_${port}` });
    const server = app.listen(port, 'localhost');
    server.once('listening', () => output({ running: true, url: `http://localhost:${port}`,
      auth: '请在本人浏览器的首次连接页面填写本人的 token，勿在聊天中发送' }));
    server.once('error', error => {
      app.locals.sessions.close();
      console.error(error.code === 'EADDRINUSE' ? '端口已占用；保持原程序运行，使用 --port 指定另一个端口。' : '本机服务启动失败。');
      process.exitCode = 1;
    });
    const stop = () => { server.close(); app.locals.sessions.close(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }
} catch (error) {
  console.error(error.message ?? '运行失败。');
  process.exitCode = 1;
}
