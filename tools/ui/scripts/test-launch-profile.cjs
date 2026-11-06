/* eslint @typescript-eslint/no-require-imports: "off" -- CommonJS script entry point. */
const assert = require('node:assert/strict'),
	fs = require('node:fs/promises'),
	http = require('node:http'),
	path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'),
	dist = path.join(root, 'dist');

async function main() {
	let browser;

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url, 'http://local');

		if (url.pathname === '/props') {
			res.setHeader('Content-Type', 'application/json');

			return res.end(
				JSON.stringify({
					default_generation_settings: { params: {} },
					role: 'router',
					total_slots: 1
				})
			);
		}

		if (
			(url.pathname === '/models' && !req.headers.accept?.includes('text/html')) ||
			url.pathname === '/v1/models'
		) {
			res.setHeader('Content-Type', 'application/json');

			return res.end('{"data":[]}');
		}

		try {
			let file = path.join(dist, url.pathname);

			if (!path.extname(file)) file = path.join(dist, 'index.html');

			const content = await fs.readFile(file);

			res.setHeader(
				'Content-Type',
				file.endsWith('.js')
					? 'application/javascript'
					: file.endsWith('.css')
						? 'text/css'
						: file.endsWith('.json')
							? 'application/json'
							: 'text/html'
			);
			res.end(content);
		} catch {
			res.statusCode = 404;
			res.end();
		}
	});

	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	try {
		browser = await chromium.launch({
			executablePath:
				process.env.ROUTER_TEST_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
			headless: true
		});
		const page = await browser.newPage({ viewport: { height: 1000, width: 1440 } });
		const errors = [];

		page.on('pageerror', (e) => errors.push(e.message));
		const defaults = JSON.parse(
			await fs.readFile(path.join(root, '../../tauri-shell/llama-server.default.json'), 'utf8')
		);

		await page.addInitScript((defaults) => {
			window.savedProfile = {
				id: 'default',
				name: 'Default',
				revision: 2,
				schemaVersion: 1,
				settings: defaults
			};
			window.calls = [];
			window.__TAURI__ = {
				core: {
					invoke: async (command, args) => {
						window.calls.push({ args, command });

						if (command === 'read_engine_config') return structuredClone(window.savedProfile);

						if (command === 'save_engine_config') {
							window.savedProfile = structuredClone(args.config);
							window.savedProfile.revision++;

							return;
						}

						if (command === 'get_app_paths')
							return { cache_folder: null, logs_folder: null, model_folders: [] };

						if (command === 'manager_call') {
							if (args.action === 'inventory') throw new Error('NVIDIA GPU inventory unavailable');

							if (args.action === 'plan')
								return JSON.stringify({
									requested: window.savedProfile.settings,
									restartRequired: true
								});

							if (args.action === 'capabilities')
								return '{"features":{"tensor":{"state":"unknown"}}}';
						}

						return null;
					}
				}
			};
		}, defaults);
		await page.goto('http://127.0.0.1:' + server.address().port + '/#/models');
		await page
			.getByText('llama.cpp GPU and launch profile', { exact: true })
			.click({ timeout: 10000 })
			.catch(async (e) => {
				console.log(
					'State:',
					await page.locator('body').innerText(),
					errors,
					await page.evaluate(() => window.calls)
				);

				throw e;
			});
		const context = page.getByLabel('Context tokens (0 = model default)');

		await context.fill('4096');
		await page.getByRole('button', { exact: true, name: 'Save launch profile' }).click();
		await page
			.getByText('Profile saved. Restart the app to apply launch changes to the server.', {
				exact: true
			})
			.waitFor();
		assert.equal(await page.evaluate(() => window.savedProfile.settings.ctx_size), 4096);
		assert.equal(await page.evaluate(() => window.savedProfile.revision), 3);
		await page.getByRole('button', { exact: true, name: 'Preview saved launch' }).click();
		await page.getByText('"restartRequired":true', { exact: false }).waitFor();
		await page.getByRole('button', { exact: true, name: 'Detect GPU identities' }).click();
		await page.getByText('NVIDIA GPU inventory unavailable', { exact: false }).waitFor();
		await context.focus();
		await page.keyboard.press('F1');
		await page.locator('#router-help-document[open]').waitFor();
		await page.keyboard.press('Escape');
		await page.setViewportSize({ height: 850, width: 500 });
		assert.equal(
			await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
			true
		);
		assert.deepEqual(errors, []);
		console.log(
			'PASS: existing Models page, editable profile, revision refresh, saved launch preview, unavailable GPU inventory, field help, narrow viewport.'
		);
	} finally {
		if (browser) await browser.close();

		await new Promise((r) => server.close(r));
	}
}
main().catch((e) => {
	console.error(e);
	process.exitCode = 1;
});
