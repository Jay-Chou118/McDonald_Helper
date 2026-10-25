import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skill = resolve(root, '.trae/skills/mai-pick');
const runtime = resolve(skill, 'assets/runtime');

async function run(binary, args, cwd) {
  await new Promise((accept, reject) => {
    const child = spawn(binary, args, { cwd, stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? accept() : reject(new Error(`${binary} 失败（${code}）。`)));
  });
}
const backend = ['index.mjs', 'mcp.mjs', 'sessions.mjs', 'data.mjs', 'planner.mjs', 'value.mjs', 'offers.mjs', 'savings.mjs'];
const projectLock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const pin = names => Object.fromEntries(names.map(name => [name, projectLock.packages[`node_modules/${name}`].version]));
const dependencies = pin(['@modelcontextprotocol/sdk', 'express', 'zod', 'react', 'react-dom', 'lucide-react']);
const devDependencies = pin(['vite', '@vitejs/plugin-react']);
const previousManifest = await readFile(resolve(runtime, 'package.json'), 'utf8').catch(() => null);
const manifest = `${JSON.stringify({ name: 'mai-pick-skill-runtime', version: '1.0.0', private: true,
  type: 'module', scripts: { build: 'vite build' }, dependencies, devDependencies,
  engines: { node: '^20.19.0 || >=22.12.0' } }, null, 2)}\n`;
await mkdir(resolve(runtime, 'server'), { recursive: true });
for (const name of backend) await cp(resolve(root, 'server', name), resolve(runtime, 'server', name));
await mkdir(resolve(runtime, 'src'), { recursive: true });
for (const name of ['App.jsx', 'Economy.jsx', 'main.jsx', 'styles.css']) await cp(resolve(root, 'src', name), resolve(runtime, 'src', name));
await mkdir(resolve(runtime, 'public'), { recursive: true });
await cp(resolve(root, 'public/favicon.svg'), resolve(runtime, 'public/favicon.svg'));
for (const name of ['index.html', 'vite.config.mjs', '.gitignore']) await cp(resolve(root, name), resolve(runtime, name));
// Remove the old prebuilt page. New users build only in their own private runtime directory.
await rm(resolve(runtime, 'dist'), { recursive: true, force: true });
await writeFile(resolve(runtime, 'package.json'), manifest);
if (previousManifest !== manifest) {
  await run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--registry', 'https://registry.npmjs.org/'], runtime);
}

const frontmatter = await readFile(resolve(skill, 'SKILL.md'), 'utf8');
if (!frontmatter.startsWith('---\nname: mai-pick\n')
  || !/description: [^\n]+/.test(frontmatter) || !frontmatter.includes('\n---\n\n')) throw new Error('Skill 格式无效。');
const entries = await readdir(runtime);
if (entries.some(name => ['node_modules', 'dist', '__pycache__', '.local'].includes(name) || name.startsWith('.env'))) throw new Error('运行包包含未授权文件。');

// One Skill directory per ZIP. Include directory entries for readers that enumerate folders.
const zipCode = `
import sys, pathlib, zipfile, json, re, ipaddress
skill=pathlib.Path(sys.argv[1])
target=pathlib.Path(sys.argv[2])
paths=sorted(skill.rglob('*'))
if any(p.is_symlink() for p in paths): raise SystemExit('发布包不能包含符号链接')
files=[p for p in paths if p.is_file()]
for p in paths:
    if any(x in {'node_modules','dist','.local','.git','__pycache__'} or x.startswith('.env') for x in p.relative_to(skill).parts):
        raise SystemExit('发布包包含构建产物或禁止路径')
for p in files:
    rel=p.relative_to(skill)
    data=p.read_bytes()
    if re.search(rb'Bearer\\s+[A-Za-z0-9_-]{10,}',data):
        raise SystemExit('发布包包含可能的硬编码凭证')
    for match in re.findall(rb'(?<![0-9.])(?:[0-9]{1,3}\\.){3}[0-9]{1,3}(?![0-9.])',data):
        try: ipaddress.ip_address(match.decode())
        except ValueError: continue
        raise SystemExit('发布包包含原始 IP 地址')
    if b'::1' in data: raise SystemExit('发布包包含原始 IP 地址')
entry=(skill/'SKILL.md').read_text(encoding='utf-8')
match=re.fullmatch(r'---\\n(.*?)\\n---\\n(.+)',entry,re.DOTALL)
if not match: raise SystemExit('Skill frontmatter 或正文无效')
fields=dict(line.split(': ',1) for line in match.group(1).splitlines())
if fields.get('name')!=skill.name or not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?',fields['name']):
    raise SystemExit('Skill 名称无效')
description=fields.get('description','')
if not 0<len(description)<=1024: raise SystemExit('Skill 描述长度无效')
for ref in re.findall(r'\\]\\(([^)]+)\\)',match.group(2)):
    if '://' not in ref and not (skill/ref).is_file(): raise SystemExit('Skill 引用文件缺失')
prefix=skill.name+'/'
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr(prefix,b'')
    for p in paths:
        if p.is_dir(): z.write(p,prefix+p.relative_to(skill).as_posix()+'/')
    for p in files:
        z.write(p,prefix+p.relative_to(skill).as_posix())
with zipfile.ZipFile(target) as z:
    if z.testzip() is not None: raise SystemExit('ZIP 完整性检查失败')
    if len([n for n in z.namelist() if n.endswith('/SKILL.md')]) != 1: raise SystemExit('Skill 入口数量无效')
    if prefix+'SKILL.md' not in z.namelist(): raise SystemExit('Skill 入口层级无效')
print(json.dumps({'zip':str(target),'files':len(files),'bytes':target.stat().st_size,'credentialsBundled':False}))
`;
await run('python3', ['-c', zipCode, skill, resolve(root, 'mai-pick-skill.zip')], root);
