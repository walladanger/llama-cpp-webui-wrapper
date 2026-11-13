const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const dist = process.env.ROUTER_TEST_UI_DIR || path.resolve(root, '../../validation/model-loading-ui');
const origin = 'http://router-preview.test';
const first = 'Qwen3-8B-Q4_K_M';
const second = 'Qwen3-0.6B-Q8_0';

async function main() {
	const browser = await chromium.launch({ headless: true, executablePath: process.env.ROUTER_TEST_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' });
		await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.addInitScript(({ first, second }) => {
			const row = (id, status) => ({ id, object: 'model', owned_by: 'llamacpp', created: 0, in_cache: false, path: '', status: { value: status, args: ['--parallel', '4', '--ctx-size=8192'] }, architecture: { input_modalities: ['text'] }, meta: { 'general.architecture': 'qwen3' } });
			window.__catalog = [row(first, 'unloaded'), row(second, 'loaded')];
			window.__calls = []; window.__feeds = []; window.__feedAborts = 0; window.__acceptLoads = {};
			window.__noSse = false; window.__failLoad = false; window.__listFailure = false;
			const encoder = new TextEncoder();
			window.__status = (id, status, progress) => {
				window.__catalog.find((model) => model.id === id).status.value = status;
				for (const feed of window.__feeds) feed.enqueue(encoder.encode(`data: ${JSON.stringify({ model: id, event: 'status_update', data: { status, progress } })}\n\n`));
			};
			window.__dropFeeds = () => { for (const feed of window.__feeds) feed.close(); window.__feeds = []; };
			const response = (json, status = 200) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
			const realFetch = window.fetch.bind(window);
			window.fetch = async (input, init = {}) => {
				const url = new URL(typeof input === 'string' ? input : input.url, location.href);
				if (url.pathname === '/models/sse') {
					if (window.__noSse) return response({}, 404);
					return new Response(new ReadableStream({ start(controller) {
						window.__feeds.push(controller);
						init.signal?.addEventListener('abort', () => { window.__feedAborts++; window.__feeds = window.__feeds.filter((feed) => feed !== controller); try { controller.close(); } catch {} }, { once: true });
					} }), { headers: { 'content-type': 'text/event-stream' } });
				}
				if (url.pathname === '/v1/models' || (url.pathname === '/models' && (!init.method || init.method === 'GET'))) return window.__listFailure ? response({ error: { message: 'fixture offline' } }, 503) : response({ data: window.__catalog });
				if (url.pathname === '/props') return response({ role: 'router', total_slots: 4, default_generation_settings: { params: {} } });
				if (url.pathname === '/models/load' || url.pathname === '/models/unload') {
					const body = JSON.parse(init.body); window.__calls.push({ route: url.pathname, id: body.model });
					if (url.pathname.endsWith('/load')) {
						if (window.__failLoad) return response({ error: { message: 'Model rejected by fixture engine' } }, 500);
						return new Promise((resolve) => window.__acceptLoads[body.model] = () => { window.__status(body.model, 'loading'); resolve(response({ success: true })); });
					}
					return response({ success: true });
				}
				return realFetch(input, init);
			};
			const details = window.__catalog.map((model, i) => ({ id: model.id, file_name: `${model.id}.gguf`, path: `D:\\MODELS\\Llama.cpp\\${model.id}.gguf`, quantization: i ? 'Q8_0' : 'Q4_K_M', bytes: Math.round((i ? .69 : 4.68) * 1024 ** 3) }));
			window.__TAURI__ = { core: { invoke: async (command) => {
				if (command === 'get_app_paths') return { model_folders: ['D:\\MODELS\\Llama.cpp'], cache_folder: null, logs_folder: null };
				if (command === 'list_model_details') return details;
				return null;
			} } };
		}, { first, second });
		await page.route(`${origin}/**`, async (route) => {
			const url = new URL(route.request().url());
			let file = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
			if (!file.startsWith(`${dist}${path.sep}`) && file !== dist) return route.fulfill({ status: 403, body: '' });
			if (!path.extname(file)) file = path.join(dist, 'index.html');
			try { return route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/html' }); }
			catch { return route.fulfill({ status: 404, body: '' }); }
		});
		await page.goto(`${origin}/#/models`);
		const workspace = page.getByRole('region', { name: 'Model loading workspace', exact: true });
		await workspace.getByText('1 ready', { exact: true }).waitFor();
		const cards = page.getByLabel('Model loading cards', { exact: true });
		const firstCard = cards.getByRole('article', { name: `${first} model card`, exact: true });
		await page.getByRole('button', { name: '+ Load model', exact: true }).click();
		assert.equal(await page.evaluate(() => document.activeElement.id), 'available-models');
		await page.locator('#available-models').getByRole('button', { name: 'Load', exact: true }).click();
		await firstCard.getByText('Starting', { exact: true }).waitFor();
		await firstCard.getByRole('button', { name: `Cancel loading ${first}`, exact: true }).click();
		await firstCard.getByText('Cancelling', { exact: true }).waitFor();
		assert.equal(await page.evaluate(() => window.__calls.filter((call) => call.route === '/models/unload').length), 0);
		await page.evaluate((id) => window.__acceptLoads[id](), first);
		await page.waitForFunction(() => window.__calls.some((call) => call.route === '/models/unload'));
		await firstCard.getByText('Cancelling', { exact: true }).waitFor();
		await page.evaluate((id) => window.__status(id, 'unloaded'), first);
		await firstCard.getByText('Cancelled', { exact: true }).waitFor();
		await firstCard.getByRole('button', { name: `Retry loading ${first}`, exact: true }).click();
		await page.waitForFunction((id) => !!window.__acceptLoads[id], first);
		await page.evaluate((id) => window.__acceptLoads[id](), first);
		await page.evaluate((id) => window.__status(id, 'loading', { stages: ['text_model', 'spec_model', 'mmproj_model'], current: 'text_model', value: .8741 }), first);
		await firstCard.getByText('87.41%', { exact: true }).waitFor();
		assert.equal(await firstCard.getByRole('progressbar').getAttribute('aria-valuenow'), '87.41');
		await firstCard.getByRole('button', { name: `Show information for ${first}`, exact: true }).click();
		const info = page.getByRole('complementary', { name: 'Model information', exact: true });
		await info.getByText('4.68 GiB', { exact: true }).waitFor();
		await info.getByText('Q4_K_M', { exact: true }).waitFor();
		await info.getByText('qwen3', { exact: true }).waitFor();
		await page.mouse.move(1400, 20);
		await workspace.screenshot({ path: path.resolve(root, '../../validation/model-loading-desktop.png') });
		await page.setViewportSize({ width: 700, height: 1000 });
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		await workspace.screenshot({ path: path.resolve(root, '../../validation/model-loading-narrow.png') });
		await page.evaluate((id) => window.__status(id, 'loading', { stages: ['text_model', 'spec_model', 'mmproj_model'], current: 'spec_model', value: .2 }), first);
		await firstCard.getByText('20.00%', { exact: true }).waitFor();
		await firstCard.getByText('Loading draft model · Stage 2 of 3', { exact: true }).waitFor();
		await page.evaluate((id) => window.__status(id, 'loading', { stages: ['text_model'], current: 'text_model', value: 1 }), first);
		await firstCard.getByText('100.00%', { exact: true }).waitFor();
		assert.equal(await firstCard.getByText('Ready', { exact: true }).count(), 0);
		await page.evaluate(() => { window.__noSse = true; window.__dropFeeds(); });
		await page.waitForFunction(() => !document.querySelector('[aria-label^="Loading progress"]')?.hasAttribute('aria-valuenow'));
		await page.evaluate((id) => { window.__catalog.find((model) => model.id === id).status.value = 'loaded'; }, first);
		await firstCard.getByText('Ready', { exact: true }).waitFor({ timeout: 7000 });
		await firstCard.getByRole('button', { name: `Unload ${first}`, exact: true }).click();
		await firstCard.getByText('Unloading', { exact: true }).waitFor();
		await page.evaluate((id) => { window.__catalog.find((model) => model.id === id).status.value = 'unloaded'; }, first);
		await firstCard.getByText('Unloaded', { exact: true }).waitFor({ timeout: 7000 });
		await page.evaluate(() => window.__failLoad = true);
		await firstCard.getByRole('button', { name: `Retry loading ${first}`, exact: true }).click();
		await firstCard.getByRole('alert').filter({ hasText: 'Model rejected by fixture engine' }).waitFor();
		const stops = await page.evaluate(() => window.__calls.filter((call) => call.route === '/models/unload').length);
		const aborts = await page.evaluate(() => window.__feedAborts);
		await page.evaluate(() => { window.__noSse = false; });
		await page.waitForFunction(() => window.__feeds.length > 0);
		await page.evaluate(() => location.hash = '/settings');
		await workspace.waitFor({ state: 'hidden' });
		await page.waitForFunction((previous) => window.__feedAborts > previous, aborts);
		assert.equal(await page.evaluate(() => window.__calls.filter((call) => call.route === '/models/unload').length), stops);
		assert.deepEqual(errors, []);
		console.log('PASS: ready cards, load picker focus, queued cancellation, engine-confirmed cancellation, live stage percentages, metadata panel, responsive layout, stage transition, 100% awaiting ready, SSE outage fallback, unload, failed load and unmount cleanup. Fixture engine; no user runtime was changed.');
	} finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
