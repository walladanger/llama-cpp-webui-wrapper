const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'),
	dist = path.join(root, 'dist');
const fixtures = [
	['qwen3 4B Q4_K - Medium', '8497.25 ± 420.69', '211.52 ± 1.15', 'Very fast output'],
	['qwen35 27B Q4_K - Medium', '1533.64 ± 11.85', '42.05 ± 0.08', 'Fluid output']
];
async function main() {
	const browser = await chromium.launch({ headless: true, channel: 'chrome' });
	try {
		const page = await browser.newPage({
			viewport: { width: 1440, height: 1000 },
			serviceWorkers: 'block'
		});
		await page.emulateMedia({ colorScheme: 'dark' });
		const errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.route('http://127.0.0.1:5199/**', async (route) => {
			const url = new URL(route.request().url());
			if (url.pathname === '/props')
				return route.fulfill({
					json: { role: 'router', total_slots: 1, default_generation_settings: { params: {} } }
				});
			if (['/models', '/v1/models'].includes(url.pathname))
				return route.fulfill({ json: { data: [] } });
			let file = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
			if (!file.startsWith(dist + path.sep) && file !== dist)
				return route.fulfill({ status: 403, body: '' });
			if (!path.extname(file)) file = path.join(dist, 'index.html');
			try {
				return route.fulfill({
					body: await fs.readFile(file),
					contentType: file.endsWith('.js')
						? 'application/javascript'
						: file.endsWith('.css')
							? 'text/css'
							: file.endsWith('.json')
								? 'application/json'
								: 'text/html'
				});
			} catch {
				return route.fulfill({ status: 404, body: '' });
			}
		});
		await page.goto('http://127.0.0.1:5199/#/llama-bench');
		await page.getByRole('heading', { name: 'Performance & advice', exact: true }).waitFor();
		assert.equal(
			await page.getByRole('button', { name: 'Run benchmark', exact: true }).isDisabled(),
			true
		);
		await page.getByText('Explain an existing result', { exact: true }).click();
		for (const [model, pp, tg, title] of fixtures) {
			await page
				.getByLabel('Benchmark output', { exact: true })
				.fill(
					`| model | size | params | backend | ngl | test | t/s |\n| --- | --- | --- | --- | --- | --- | --- |\n| ${model} | 2 GiB | 4 B | CUDA | -1 | pp512 | ${pp} |\n| ${model} | 2 GiB | 4 B | CUDA | -1 | tg128 | ${tg} |`
				);
			await page.getByRole('button', { name: 'Explain result', exact: true }).click();
			await page.getByRole('heading', { name: title, exact: true }).waitFor();
		}
		assert.match(await page.locator('main').innerText(), /3\.04 s/);
		assert.match(await page.locator('main').innerText(), /Global ranking: unavailable/);
		assert.match(await page.locator('main').innerText(), /limited metadata/);
		await page.screenshot({
			path: path.resolve(root, '../../validation/benchmark-desktop.png'),
			fullPage: true
		});
		await page.setViewportSize({ width: 500, height: 850 });
		assert.equal(
			await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
			true
		);
		await page.screenshot({
			path: path.resolve(root, '../../validation/benchmark-narrow.png'),
			fullPage: true
		});
		await page.getByLabel('Benchmark output', { exact: true }).fill('{broken');
		await page.getByRole('button', { name: 'Explain result', exact: true }).click();
		await page.getByRole('alert').filter({ hasText: 'invalid' }).waitFor();
		await page.addInitScript(() => {
			const report = {schemaVersion:1,id:'fixture',createdAt:1,model:'fixture.gguf',mode:'quick',status:'complete',error:null,
				modelFiles:[],runtimeFiles:[],environment:{},repetitions:5,
				results:[{label:'One device · short prompt',rows:[{model_type:'Fixture model',n_prompt:0,n_gen:128,n_depth:0,avg_ts:42,stddev_ts:.1}]}]};
			let running = false, finish;
			window.__benchmarkCalls = [];
			window.__TAURI__ = {core:{invoke:async (command,args) => {
				window.__benchmarkCalls.push({command,args});
				if(command==='list_models') return ['fixture.gguf'];
				if(command==='manager_call') return 'installed';
				if(command==='benchmark_inspect' && args.action==='history') return [report];
				if(command==='benchmark_inspect') return {system:{cpu:'Fixture CPU',ramBytes:64*1024**3},cards:[{uuid:'GPU-fixture',name:'Fixture GPU',total:24576,free:null}],devices:[{id:'CUDA0',description:'Fixture GPU'},{id:'CUDA1',description:'Fixture GPU'}],telemetry:null,supportsDeep:true,issues:[],capturedAt:1};
				if(command==='benchmark_run') {running=true;return new Promise(resolve=>{finish=resolve;});}
				if(command==='benchmark_control') {
					if(args.action==='cancel') {running=false;report.status='cancelled';report.error='Benchmark cancelled fixture';finish(report);}
					return {running,stage:'Test 1 / 5'};
				}
			}}};
		});
		await page.reload();
		await page.getByRole('heading',{name:'Fluid output',exact:true}).waitFor();
		await page.locator('select[data-help-key="bench-model"]').selectOption('fixture.gguf');
		await page.getByRole('combobox').nth(2).selectOption('deep');
		await page.getByRole('checkbox',{name:/Compare the baseline GPU/}).check();
		await page.getByRole('button',{name:'Run benchmark',exact:true}).click();
		await page.getByRole('button',{name:'Cancel benchmark',exact:true}).click();
		await page.getByRole('status').filter({hasText:'Benchmark cancelled fixture'}).waitFor();
		const calls = await page.evaluate(()=>window.__benchmarkCalls);
		const start = calls.find(c=>c.command==='benchmark_run');
		assert.deepEqual(start.args,{model:'fixture.gguf',device:'CUDA0',mode:'deep',compare:true});
		assert(calls.some(c=>c.command==='benchmark_control' && c.args.action==='cancel'));
		assert.deepEqual(errors, []);
		console.log(
			'PASS: production UI; both supplied examples; honest ranking state; offline controls; malformed import; desktop and narrow layouts; mocked native scan/history/deep-run/cancel arguments.'
		);
	} finally {
		await browser.close();
	}
}
main().catch((e) => {
	console.error(e);
	process.exitCode = 1;
});
