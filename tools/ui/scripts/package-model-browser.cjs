// Package the tested UI plus the corresponding source changes, without model data.
const fs = require('node:fs');
const path = require('node:path');
const { zipSync } = require('fflate');
const project = path.resolve(__dirname, '../../..');
const output = path.join(project, 'artifacts');
const files = {};
function addTree(directory, prefix) {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const local = path.join(directory, entry.name);
		const name = `${prefix}/${entry.name}`;
		if (entry.isDirectory()) addTree(local, name);
		else files[name] = new Uint8Array(fs.readFileSync(local));
	}
}
addTree(path.join(project, 'tools/ui/dist'), 'portable-data/ui');
for (const name of [
	'tools/ui/src/routes/models/+page.svelte',
	'tools/ui/src/lib/components/app/models/HubModelBrowser.svelte',
	'tools/ui/src/lib/services/huggingface-browser.ts',
	'tools/ui/static/context-help-catalog.js',
	'tools/ui/tests/unit/huggingface-browser.test.ts',
	'tools/ui/scripts/test-model-browser.cjs',
	'tools/ui/scripts/package-model-browser.cjs',
	'validation/MODEL_BROWSER_UPDATE.md'
]) files[`source/${name}`] = new Uint8Array(fs.readFileSync(path.join(project, name)));
files['README.txt'] = new TextEncoder().encode(
	'llama.cpp Router - Model browser UI update - November 6, 2026\n\n' +
	'Adds quantization and file-size summaries, per-variant GGUF sizes, Browse models, publisher/quant/size/access filters, popularity/recent-update sorting, and pagination.\n\n' +
	'To apply to an existing portable app: close the app, then copy this archive\'s portable-data/ui folder into the app\'s portable-data/ui folder, replacing matching UI files. Reopen the app. Your models, cache and config are in separate folders. This archive is a UI update, not a complete installer; it contains no engine executables.\n\n' +
	'The source folder contains the corresponding source files and validation notes. File sizes are disk usage, not VRAM requirements. Size and quant filters operate on loaded repositories; use Load more to extend results. Unknown sizes remain unknown.\n'
);
fs.mkdirSync(output, { recursive: true });
const filename = path.join(output, 'Router_Model_Browser_Update.zip');
fs.writeFileSync(filename, zipSync(files, { level: 6 }));
// Refresh the existing portable build in this checkout.
fs.cpSync(path.join(project, 'tools/ui/dist'), path.join(project, 'tauri-shell/dist/Llama-WebUI/portable-data/ui'), { recursive: true });
console.log(filename);
console.log(`Packaged ${Object.keys(files).length} files (${fs.statSync(filename).size} bytes).`);
