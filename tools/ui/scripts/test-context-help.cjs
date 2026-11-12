const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const desktop = path.resolve(root, '../../tauri-shell/ui');
async function main() {
	let browser;
	const server = http.createServer(async (req, res) => {
		const name = req.url.split('?')[0];
		try {
			const file = path.join(desktop, name === '/' ? 'index.html' : name);
			res.setHeader(
				'Content-Type',
				file.endsWith('.js')
					? 'application/javascript'
					: file.endsWith('.css')
						? 'text/css'
						: 'text/html'
			);
			res.end(await fs.readFile(file));
		} catch {
			res.statusCode = 404;
			res.end();
		}
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = 'http://127.0.0.1:' + server.address().port;
	try {
		const configured = process.env.ROUTER_TEST_BROWSER;
		const candidates = [
			configured,
			'C:/Program Files/Google/Chrome/Application/chrome.exe',
			'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
		].filter(Boolean);
		let executablePath;
		for (const candidate of candidates) {
			if (
				await fs
					.stat(candidate)
					.then(() => true)
					.catch(() => false)
			) {
				executablePath = candidate;
				break;
			}
		}
		browser = await chromium.launch({
			headless: true,
			...(executablePath ? { executablePath } : {})
		});
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
		page.setDefaultTimeout(5000);
		console.log('Browser ready');
		const errors = [];
		page.on('pageerror', (error) => { errors.push(error.message); console.log('PAGE ERROR',error.message); });
		await page.addInitScript(() => {
			window.engineCalls = [];
			window.__TAURI__ = {
				core: {
					invoke: async (command, args) => {
						window.engineCalls.push({ command, args });
						if (command === 'read_engine_config')
							return {
								distro: 'Ubuntu',
								executable: 'vllm',
								model: 'test/model',
								port: 8000,
								gpu_memory_utilization: 0.7
							};
						if (command === 'list_models') return ['test.gguf'];
						return 'ActiveState=active\nHTTP health: ready\nRunning model: test/model';
					}
				}
			};
		});
		await page.goto(address);
		console.log('Dashboard loaded');
		assert.equal(
			await page.locator('#router-help-trigger').count(),
			0,
			'No question-mark button should be created'
		);
		await page.locator('[data-engine="vllm"][data-action="start"]').hover();
		await page.locator('#router-help-preview').waitFor({ state: 'visible' });
		assert.match(
			await page.locator('#router-help-preview').innerText(),
			/configured inference service/
		);
		console.log('Action preview shown');
		const callsBefore = await page.evaluate(() => window.engineCalls.length);
		assert.equal(
			await page.locator('#router-help-trigger').count(),
			0,
			'Hover must not create a question-mark button'
		);
		await page.keyboard.press('F1');
		assert.equal(await page.locator('#router-help-title').innerText(), 'Start engine');
		assert.equal(
			await page.evaluate(() => window.engineCalls.length),
			callsBefore,
			'Help must not start a service'
		);
		const large = await page.locator('#router-help-document').boundingBox();
		assert(large.width > 1300 && large.height > 850, 'Documentation should be almost full screen');
		await page.keyboard.press('Escape');
		console.log('Checking input recommendations');
		await page.locator('#vllm-gpu_memory_utilization').hover();
		await page.locator('#router-help-preview').waitFor({ state: 'visible' });
		assert.match(await page.locator('#router-help-preview').innerText(), /0.5/);
		assert.equal(
			await page.locator('#router-help-trigger').count(),
			0,
			'Hover must not create a question-mark button'
		);
		await page.keyboard.press('F1');
		assert.match(await page.locator('#router-help-document table').innerText(), /0.9/);
		assert.equal(
			await page.locator('#vllm-gpu_memory_utilization').inputValue(),
			'0.7',
			'Help must never apply suggested values'
		);
		const oldHash = new URL(page.url()).hash;
		await page.getByRole('link', { name: 'Troubleshooting', exact: true }).click();
		assert.equal(
			new URL(page.url()).hash,
			oldHash,
			'Documentation navigation must not navigate the app'
		);
		await page.keyboard.press('Escape');
		assert.equal(
			await page
				.locator('#vllm-gpu_memory_utilization')
				.evaluate((el) => el === document.activeElement),
			true
		);
		await page.locator('#vllm-port').focus();
		await page.keyboard.press('F1');
		assert.equal(await page.locator('#router-help-title').innerText(), 'API port');
		await page.keyboard.press('Tab');
		assert.equal(
			await page
				.locator('#router-help-document')
				.evaluate((el) => el.contains(document.activeElement)),
			true,
			'Keyboard focus stays in help'
		);
		await page.keyboard.press('Escape');
		console.log('Checking dynamic controls');
		await page.evaluate(() => {
			const field = document.createElement('div');
			field.id = 'test-field';
			field.dataset.helpKey = 'top_p';
			field.dataset.helpTitle = 'Top P';
			field.dataset.helpSummary = 'Dynamic setting explanation';
			const input = document.createElement('input');
			input.id = 'dynamic-input';
			input.setAttribute('aria-describedby', 'existing-description');
			const desc = document.createElement('span');
			desc.id = 'existing-description';
			desc.textContent = 'Existing description';
			field.append(input, desc);
			document.querySelector('main').prepend(field);
		});
		await page.locator('#dynamic-input').focus();
		assert.match(
			await page.locator('#router-help-preview').innerText(),
			/Dynamic setting explanation/
		);
		assert.match(
			await page.locator('#dynamic-input').getAttribute('aria-describedby'),
			/existing-description/
		);
		await page.keyboard.press('F1');
		assert.match(await page.locator('#router-help-document table').innerText(), /0.95/);
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
		assert.equal(
			await page.locator('#dynamic-input').getAttribute('aria-describedby'),
			'existing-description'
		);
		// Keep the pointer off controls: removing the focused field can otherwise reveal a different hovered panel.
		await page.mouse.move(1, 1);
		await page.locator('#dynamic-input').focus();
		await page.evaluate(() => document.querySelector('#test-field').remove());
		await page
			.waitForFunction(() => document.querySelector('#router-help-host').hidden)
			.catch(async (error) => {
				console.log(
					'Removal state:',
					await page.evaluate(() => ({
						focused: document.activeElement?.outerHTML.slice(0, 400),
						trigger: document.querySelector('#router-help-trigger')?.outerHTML,
						host: document.querySelector('#router-help-host')?.hidden,
						preview: document.querySelector('#router-help-preview')?.textContent
					}))
				);
				throw error;
			});
		await page.evaluate(() => {
			const input = document.createElement('input');
			input.type = 'password';
			input.id = 'secret-test';
			input.value = 'private-key-should-not-appear';
			input.setAttribute('aria-label', 'API key');
			document.querySelector('main').prepend(input);
		});
		await page.locator('#secret-test').focus();
		await page.keyboard.press('F1');
		assert.doesNotMatch(
			await page.locator('#router-help-document').innerText(),
			/private-key-should-not-appear/
		);
		await page.keyboard.press('Escape');
		await page.locator('#bench-run').click();
		assert(
			await page.evaluate(() =>
				window.engineCalls.some((c) => c.command === 'manager_call' && c.args.action === 'run')
			),
			'Original action remains usable'
		);
		await page.setViewportSize({ width: 390, height: 700 });
		await page.locator('#vllm-port').focus();
		await page.keyboard.press('F1');
		const small = await page.locator('#router-help-document').boundingBox();
		assert(
			small.x >= 0 && small.x + small.width <= 391 && small.y >= 0 && small.y + small.height <= 701,
			'Help stays within mobile viewport'
		);
		assert.equal(
			await page
				.locator('#router-help-document')
				.evaluate((el) => el.scrollWidth <= el.clientWidth),
			true
		);
		assert.deepEqual(errors, []);
		for (const name of ['context-help.js', 'context-help-catalog.js', 'context-help.css'])
			assert.equal(
				await fs.readFile(path.join(desktop, name), 'utf8'),
				await fs.readFile(path.join(root, 'static', name), 'utf8'),
				'Desktop assets stay synchronized'
			);
		console.log(
			'PASS: no circled question-mark buttons, hover, action isolation, recommendations, unchanged values, documentation navigation, keyboard focus, F1, Escape, dynamic fields, descriptions, removal cleanup, secret redaction, original actions, narrow viewport, shared assets.'
		);
	} finally {
		if (browser) await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
