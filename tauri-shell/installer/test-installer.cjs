const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const project = path.resolve(__dirname, '../..');
const version = require('../tauri.conf.json').version;
const installer = path.join(project, `artifacts/LlamaCpp-Router-${version}-Windows-x64-Setup.exe`);
const destination = path.join('C:/workspace', `RouterInstallerValidation-${Date.now()}`);
const manifest = require('./generated/payload-manifest.json');
const invoke = (exe, args) => run(exe, args, { windowsHide: true, timeout: 180000, maxBuffer: 200000 });
async function digest(file) { return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'); }

async function main() {
	assert(destination.startsWith('C:\\workspace\\') || destination.startsWith('C:/workspace/'));
	await fs.mkdir(destination, { recursive: true });
	console.log('Installing to isolated validation folder...');
	await invoke(installer, ['/S', '/VALIDATE', `/D=${destination}`]);
	for (const file of manifest.files) assert.equal(await digest(path.join(destination, file.name)), file.sha256, file.name);
	for (const name of ['llama-server.json', 'vllm.json', 'trtllm.json']) JSON.parse(await fs.readFile(path.join(destination, 'portable-data/config', name), 'utf8'));
	const runtime = await invoke(path.join(destination, 'portable-data/bin/llama-server.exe'), ['--version']);
	assert.match(runtime.stdout + runtime.stderr, /12125|7d516e25e/);
	const sentinels = ['portable-data/config/llama-server.json', 'portable-data/config/app-paths.json', 'portable-data/models/preserve.gguf', 'portable-data/cache/preserve.txt', 'portable-data/logs/preserve.log'];
	for (const name of sentinels) await fs.writeFile(path.join(destination, name), `preserve: ${name}`);
	console.log('Checking upgrade preservation...');
	await invoke(installer, ['/S', '/VALIDATE', `/D=${destination}`]);
	for (const name of sentinels) assert.equal(await fs.readFile(path.join(destination, name), 'utf8'), `preserve: ${name}`);
	for (const file of manifest.files) assert.equal(await digest(path.join(destination, file.name)), file.sha256, `upgraded ${file.name}`);
	console.log('Checking uninstall preservation...');
	// _?= runs the uninstaller in place, allowing its process exit to be observed.
	await invoke(path.join(destination, 'Uninstall.exe'), ['/S', '/VALIDATE', `_?=${destination}`]);
	for (const name of sentinels) assert.equal(await fs.readFile(path.join(destination, name), 'utf8'), `preserve: ${name}`);
	await assert.rejects(fs.access(path.join(destination, 'llama-webui.exe')));
	await assert.rejects(fs.access(path.join(destination, 'portable-data/ui/index.html')));
	const result = { version, destination, fileCount: manifest.files.length, freshInstall: 'passed', installedPayloadHashes: 'passed', installedRuntimeVersion: 'passed', upgrade: 'passed', configurationModelsCacheLogsPreserved: 'passed', uninstall: 'passed', scope: 'Production setup, silent /VALIDATE mode: identical payload and config handling, skips external registry/shortcut/prerequisite side effects. Interactive setup and clean-machine prerequisite download are not covered.' };
	await fs.writeFile(path.join(project, 'validation/installer-validation.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
