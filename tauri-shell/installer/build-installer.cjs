const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const shell = path.resolve(__dirname, '..');
const project = path.dirname(shell);
const stage = path.join(__dirname, 'payload');
const generated = path.join(__dirname, 'generated');
const downloads = path.join(project, 'artifacts');
const version = JSON.parse(fs.readFileSync(path.join(shell, 'tauri.conf.json'), 'utf8')).version;
const output = path.join(downloads, `LlamaCpp-Router-${version}-Windows-x64-Setup.exe`);
const repack = process.argv.includes('--repack');
const nsis = process.env.ROUTER_MAKENSIS || path.join(process.env.LOCALAPPDATA, 'tauri/NSIS/makensis.exe');

function requireFile(file) {
	if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`Missing installer input: ${file}`);
}
function copy(source, destination) {
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	fs.copyFileSync(source, destination);
}
function walk(directory, prefix = '') {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (!/^[a-zA-Z0-9_./ +@()=-]+$/.test(relative) || relative.split('/').includes('..')) throw new Error(`Unsafe package path: ${relative}`);
		if (entry.isSymbolicLink()) throw new Error(`Symlink in package: ${relative}`);
		return entry.isDirectory() ? walk(path.join(directory, entry.name), relative) : [relative];
	}).sort();
}

requireFile(nsis);
for (const executable of ['llama-webui.exe', 'llama-engine-manager.exe']) requireFile(path.join(shell, 'target/release', executable));
requireFile(path.join(project, 'tools/ui/dist/index.html'));
// A staging folder must start empty; never sweep a computed parent directory.
if (fs.existsSync(stage) && !repack) throw new Error(`Staging folder already exists: ${stage}. Rename it before rebuilding, or use --repack for unchanged payloads.`);
if (repack) {
	const previous = JSON.parse(fs.readFileSync(path.join(generated, 'payload-manifest.json'), 'utf8'));
	if (previous.version !== version) throw new Error('Staged version does not match this release.');
	for (const file of previous.files) {
		if (crypto.createHash('sha256').update(fs.readFileSync(path.join(stage, file.name))).digest('hex') !== file.sha256) throw new Error(`Staging changed: ${file.name}`);
	}
} else {
fs.mkdirSync(stage, { recursive: true });
fs.mkdirSync(generated, { recursive: true });
fs.mkdirSync(downloads, { recursive: true });
for (const executable of ['llama-webui.exe', 'llama-engine-manager.exe']) copy(path.join(shell, 'target/release', executable), path.join(stage, executable));
const runtime = path.join(shell, 'dist/Llama-WebUI/portable-data/bin');
for (const name of fs.readdirSync(runtime)) {
	if (!/\.(exe|dll)$/i.test(name) && !/^LICENSE/.test(name)) continue;
	copy(path.join(runtime, name), path.join(stage, 'portable-data/bin', name));
}
fs.cpSync(path.join(project, 'tools/ui/dist'), path.join(stage, 'portable-data/ui'), { recursive: true });
// Microsoft VC runtime files are redistributable, app-local dependencies.
// Include the current x64 CRT for the shell and bundled engine, so a fresh
// Windows installation does not require a developer-tools setup step.
const crt = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'msvcp140_atomic_wait.dll', 'msvcp140_codecvt_ids.dll', 'concrt140.dll'];
for (const name of crt) {
	const source = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', name);
	requireFile(source);
	copy(source, path.join(stage, name));
	copy(source, path.join(stage, 'portable-data/bin', name));
}
copy(path.join(project, 'LICENSE'), path.join(stage, 'LICENSE.llama.cpp'));
copy(path.join(__dirname, 'README.md'), path.join(stage, 'INSTALLER-README.md'));
for (const name of ['llama-cpp-release.txt', 'cuda-version.txt']) copy(path.join(shell, name), path.join(stage, name));
}

const files = walk(stage);
if (files.some((name) => /^portable-data\/(config|models|cache|logs)\//.test(name))) throw new Error('Mutable data cannot be an installer-owned file.');
const install = [];
let previous = '';
const windowsPath = (name) => name.replaceAll('/', '\\');
for (const relative of files) {
	const directory = path.posix.dirname(relative);
	if (directory !== previous) {
		install.push(`SetOutPath "$INSTDIR${directory === '.' ? '' : '\\' + windowsPath(directory)}"`);
		previous = directory;
	}
	install.push(`File "${windowsPath(path.join(stage, relative))}"`);
}
const directories = [...new Set(files.flatMap((name) => {
	const dirs = [];
	let dir = path.posix.dirname(name);
	while (dir !== '.') { dirs.push(dir); dir = path.posix.dirname(dir); }
	return dirs;
}))].sort((a, b) => b.split('/').length - a.split('/').length || b.localeCompare(a));
const uninstall = files.map((relative) => `Delete "$INSTDIR\\${windowsPath(relative)}"`);
uninstall.push(...directories.map((relative) => `RMDir "$INSTDIR\\${windowsPath(relative)}"`));
fs.writeFileSync(path.join(generated, 'install-files.nsh'), install.join('\r\n') + '\r\n');
fs.writeFileSync(path.join(generated, 'uninstall-files.nsh'), uninstall.join('\r\n') + '\r\n');
const manifest = { version, files: files.map((name) => ({ name, bytes: fs.statSync(path.join(stage, name)).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(stage, name))).digest('hex') })) };
fs.writeFileSync(path.join(generated, 'payload-manifest.json'), JSON.stringify(manifest, null, 2));
const result = spawnSync(nsis, ['/V3', `/DVERSION=${version}`, `/DOUTPUT=${output}`, `/DMANIFEST=${generated}`, 'router.nsi'], { cwd: __dirname, windowsHide: true, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const hash = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
fs.writeFileSync(`${output}.sha256`, `${hash}  ${path.basename(output)}\n`);
console.log(`Installer: ${output}\nSHA256: ${hash}`);
