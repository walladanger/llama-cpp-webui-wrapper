const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const dist = process.env.ROUTER_TEST_UI_DIR || path.join(root, 'dist');
const GiB = 1024 ** 3;
const models = [
	{ id: 'test/Alpha-9B-GGUF', downloads: 12345, likes: 42, lastModified: '2026-11-05T00:00:00Z', gated: false },
	{ id: 'test/Beta-27B-GGUF', downloads: 6789, likes: 17, lastModified: '2026-11-04T00:00:00Z', gated: 'manual' }
];

async function main() {
	let browser;
	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url, 'http://local');
		res.setHeader('Content-Type', 'application/json');
		if (url.pathname === '/props') return res.end(JSON.stringify({ role: 'router', total_slots: 1, default_generation_settings: { params: {} } }));
		if (url.pathname === '/models' || url.pathname === '/v1/models') return res.end('{"data":[]}');
		try {
			let file = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
			if (!file.startsWith(`${dist}${path.sep}`) && file !== dist) { res.statusCode = 403; return res.end(); }
			if (!path.extname(file)) file = path.join(dist, 'index.html');
			res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/html');
			res.end(await fs.readFile(file));
		} catch { res.statusCode = 404; res.end(); }
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	try {
		browser = await chromium.launch({ headless: true, executablePath: process.env.ROUTER_TEST_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
		const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' });
		await page.emulateMedia({ colorScheme: 'dark' });
		const errors = [], requests = [];
		let failDetails = false;
		page.on('pageerror', (error) => errors.push(error.message));
		// Serve the production files through interception so this check works on
		// hosts whose browser process cannot access loopback networking.
		await page.route('http://127.0.0.1:*/**', async (route) => {
			const url = new URL(route.request().url());
			if (url.pathname === '/props') return route.fulfill({ json: { role: 'router', total_slots: 1, default_generation_settings: { params: {} } } });
			if (url.pathname === '/models' || url.pathname === '/v1/models') return route.fulfill({ json: { data: [] } });
			let file = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
			if (!file.startsWith(`${dist}${path.sep}`) && file !== dist) return route.fulfill({ status: 403, body: '' });
			if (!path.extname(file)) file = path.join(dist, 'index.html');
			try { return route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/html' }); }
			catch { return route.fulfill({ status: 404, body: '' }); }
		});
		await page.route('https://huggingface.co/api/models**', async (route) => {
			const url = new URL(route.request().url());
			requests.push(url);
			if (url.pathname === '/api/models') {
				if (url.searchParams.get('search') === 'error') return route.fulfill({ status: 429, body: '{}' });
				if (url.searchParams.get('search') === 'slow') await new Promise((resolve) => setTimeout(resolve, 500));
				let data = url.searchParams.has('cursor') ? [{ id: 'test/More-GGUF', downloads: 1 }] : models;
				if (url.searchParams.get('gated') === 'false') data = data.filter((model) => !model.gated);
				if (url.searchParams.get('search') === 'slow') data = [{ id: 'test/Stale-GGUF' }];
				return route.fulfill({ json: data, headers: url.searchParams.has('cursor') ? {} : { 'Access-Control-Expose-Headers': 'Link', Link: '<https://huggingface.co/api/models?cursor=next>; rel="next"' } });
			}
			if (failDetails) return route.fulfill({ status: 503, body: '{}' });
			const siblings = url.pathname.includes('Alpha') ? [
				{ rfilename: 'Alpha-Q4_K_M.gguf', size: 4 * GiB },
				{ rfilename: 'Alpha-Q8_0-00001-of-00002.gguf', size: 4 * GiB },
				{ rfilename: 'Alpha-Q8_0-00002-of-00002.gguf', size: 4 * GiB }
			] : [{ rfilename: 'Beta-Q4_K_M.gguf', size: 12 * GiB }, { rfilename: 'Beta-BF16.gguf' }];
			return route.fulfill({ json: { siblings } });
		});
		await page.goto(`http://127.0.0.1:${server.address().port}/#/models`);
		await page.getByRole('button', { name: 'Browse models', exact: true }).click();
		await page.getByText('4.00 GiB – 8.00 GiB', { exact: true }).waitFor();
		assert.equal(requests[0].searchParams.has('search'), false, 'Browse works without a search term');
		assert.equal(await page.getByRole('list', { name: 'Hugging Face model results', exact: true }).locator(':scope > li').count(), 2);
		const panel = page.locator('[data-help-key="hf-browser"]');
		await panel.scrollIntoViewIfNeeded();
		await page.screenshot({ path: path.resolve(root, '../../validation/model-browser-desktop.png'), fullPage: true });
		await page.getByLabel('Quantization', { exact: true }).selectOption('Q8_0');
		await page.getByLabel('Maximum download size', { exact: true }).selectOption('4');
		await page.getByText('No loaded files match these filters.', { exact: false }).waitFor();
		await page.getByLabel('Maximum download size', { exact: true }).selectOption('8');
		await page.getByText('View 1 file variants & choose quant', { exact: true }).click();
		await page.getByText(/8\.00 GiB\s*·\s*2 parts/).waitFor();
		await page.getByRole('button', { name: 'Use Q8_0 from test/Alpha-9B-GGUF', exact: true }).click();
		assert.equal(await page.getByLabel('Hugging Face repository', { exact: true }).inputValue(), 'test/Alpha-9B-GGUF:Q8_0');
		await page.getByLabel('Quantization', { exact: true }).selectOption('');
		await page.getByLabel('Maximum download size', { exact: true }).selectOption('');
		await page.getByRole('button', { name: 'Load more repositories', exact: true }).click();
		await page.getByRole('heading', { name: 'test/More-GGUF', exact: true }).waitFor();
		await page.getByLabel('Sort repositories', { exact: true }).selectOption('likes');
		await page.getByText('4.00 GiB – 8.00 GiB', { exact: true }).waitFor();
		assert(requests.some((url) => url.searchParams.get('sort') === 'likes'));
		await page.getByLabel('Publisher', { exact: true }).fill('test');
		await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
		await page.getByText('4.00 GiB – 8.00 GiB', { exact: true }).waitFor();
		assert(requests.some((url) => url.searchParams.get('author') === 'test'));
		await page.getByText('Hide gated models', { exact: true }).click();
		assert.equal(await page.getByLabel('Hide gated models', { exact: true }).isChecked(), true);
		await page.getByRole('heading', { name: 'test/Beta-27B-GGUF', exact: true }).waitFor({ state: 'hidden' });
		await page.getByText('4.00 GiB – 8.00 GiB', { exact: true }).waitFor();
		await page.setViewportSize({ width: 500, height: 850 });
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		await page.screenshot({ path: path.resolve(root, '../../validation/model-browser-narrow.png'), fullPage: true });
		await page.getByLabel('Search Hugging Face', { exact: true }).fill('error');
		await page.getByRole('button', { name: 'Browse Hub', exact: true }).click();
		await page.getByRole('alert').filter({ hasText: 'rate limit' }).waitFor();
		await page.getByLabel('Search Hugging Face', { exact: true }).fill('slow');
		await page.getByRole('button', { name: 'Browse Hub', exact: true }).click();
		await page.getByLabel('Search Hugging Face', { exact: true }).fill('latest');
		await page.getByLabel('Sort repositories', { exact: true }).selectOption('downloads');
		await page.getByText('4.00 GiB – 8.00 GiB', { exact: true }).waitFor();
		await page.waitForTimeout(650);
		assert.equal(await page.getByRole('heading', { name: 'test/Stale-GGUF', exact: true }).count(), 0);
		// A new mount clears the metadata cache and exercises partial failure/retry.
		failDetails = true;
		await page.reload();
		await page.getByRole('button', { name: 'Browse models', exact: true }).click();
		await page.getByRole('button', { name: 'Retry file details', exact: true }).waitFor();
		await page.getByText('Size unknown', { exact: true }).first().waitFor();
		failDetails = false;
		await page.getByRole('button', { name: 'Retry file details', exact: true }).click();
		await page.getByText('4.00 GiB – 8.00 GiB', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Search', exact: true }).click();
		await page.getByLabel('Search Hugging Face', { exact: true }).fill('uncensored');
		await page.getByRole('button', { name: 'Search Hub', exact: true }).click();
		await page.getByText('4.00 GiB – 8.00 GiB', { exact: true }).waitFor();
		assert(requests.some((url) => url.searchParams.get('search') === 'uncensored'));
		assert.deepEqual(errors, []);
		console.log('PASS: browse without query; real metadata rendering; split totals; combined filters; quant selection; pagination; sort/publisher/access; narrow layout; rate limit; stale-request cancellation; metadata retry. Network responses are deterministic fixtures.');
	} finally {
		if (browser) await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
