const fs = require('node:fs');
const path = require('node:path');
// One authored source; Tauri's local loading/manager pages use the same assets.
const source = path.resolve(__dirname, '../static');
const desktop = path.resolve(__dirname, '../../../tauri-shell/ui');
for (const name of ['context-help.js', 'context-help.css', 'context-help-catalog.js']) {
	fs.copyFileSync(path.join(source, name), path.join(desktop, name));
}
