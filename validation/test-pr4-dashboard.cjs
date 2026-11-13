const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('../tools/ui/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'tools/ui/dist');
const server = http.createServer(async (req, res) => {
    try {
        const name = decodeURIComponent(req.url.split('?')[0]);
        let file = name === '/__legacy' ? path.join(root, 'tauri-shell/ui/index.html') : path.resolve(dist, '.' + name);
        if (name !== '/__legacy' && !file.startsWith(dist + path.sep) && file !== dist) throw Error('Invalid path');
        if (name !== '/__legacy' && !path.extname(name)) file = path.join(dist, 'index.html');
        res.setHeader('Content-Type', { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }[path.extname(file)] || 'text/html');
        res.end(await fs.readFile(file));
    } catch { res.statusCode = 404; res.end(); }
});
let browser;
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        browser = await chromium.launch({ headless: true, executablePath: process.env.ROUTER_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
        const base = 'http://127.0.0.1:' + server.address().port;
        const errors = [];
        async function pageFor(route) {
            const page = await browser.newPage({ serviceWorkers: 'block' });
            page.on('pageerror', e => errors.push(e.message));
            page.setDefaultTimeout(10000);
            await page.route('**/props', r => r.fulfill({ json: { default_generation_settings: { params: {} }, build_info: 'fixture', modalities: { vision: false, audio: false } } }));
            await page.route('**/v1/models', r => r.fulfill({ json: { data: [] } }));
            await page.addInitScript(() => {
                window.review = { repaired: false, running: true, calls: [] };
                window.__TAURI__ = { core: { invoke: async (command, args) => {
                    const state = window.review;
                    state.calls.push({ command, args });
                    if (command === 'read_engine_config') {
                        if (args.engine === 'vllm' && !state.repaired) throw 'invalid settings JSON';
                        return { distro: 'Ubuntu', executable: args.engine === 'trtllm' ? 'trtllm-serve' : 'vllm', model: args.engine === 'trtllm' ? '/models/tiny/' : 'org/model', port: args.engine === 'trtllm' ? 8001 : 8000, cuda_visible_devices: '', max_model_len: 2048, gpu_memory_utilization: 0.8, cuda_home: '', flashinfer_sampler: false };
                    }
                    if (command === 'save_engine_config') return;
                    if (command === 'manager_call') {
                        if (args.action === 'installed') return 'installed';
                        if (args.action === 'setup-check') return JSON.stringify({ ready: true, distributions: [{ name: 'Ubuntu', version: 2 }], checks: [] });
                        if (args.action === 'install-status') return JSON.stringify({ state: 'idle', step: 0, message: '', log: '' });
                        if (args.action === 'status') return state.running ? 'ActiveState=active\nHTTP health: ready\nRunning model: ' + (args.engine === 'trtllm' ? 'tiny' : 'org/model') : 'ActiveState=inactive\nHTTP health: unavailable\nRunning model: unavailable';
                        return '';
                    }
                    return [];
                } } };
            });
            await page.goto(base + route);
            return page;
        }
        const legacy = await pageFor('/__legacy');
        await legacy.locator('#vllm-output').filter({ hasText: 'Could not read settings' }).waitFor();
        await legacy.locator('[data-save="vllm"]').click();
        assert.match(await legacy.locator('#vllm-output').innerText(), /not loaded.*Refresh status/);
        await legacy.evaluate(() => { window.review.repaired = true; });
        await legacy.locator('#refresh-all').click();
        await legacy.waitForFunction(() => document.getElementById('vllm-distro').value === 'Ubuntu');
        assert.equal(await legacy.locator('#trtllm-badge').innerText(), 'Ready', 'Local TensorRT basename must match');
        await legacy.evaluate(() => { window.review.running = false; });
        await legacy.locator('[data-engine="vllm"][data-action="status"]').click();
        await legacy.waitForFunction(() => document.getElementById('vllm-badge').textContent === 'Stopped');
        await legacy.close();
        const current = await pageFor('/#/vllm');
        await current.getByText(/Could not read settings:.*Repair the file/).waitFor();
        assert.equal(await current.getByRole('button', { name: 'Save settings', exact: true }).isEnabled(), false);
        await current.evaluate(() => { window.review.repaired = true; });
        await current.getByRole('button', { name: 'Refresh status', exact: true }).click();
        await current.waitForFunction(() => Array.from(document.querySelectorAll('input')).some(i => i.value === 'Ubuntu'));
        assert.equal(await current.getByRole('button', { name: 'Save settings', exact: true }).isEnabled(), true);
        await current.evaluate(() => { window.review.running = false; });
        await current.getByRole('button', { name: 'Refresh status', exact: true }).click();
        await current.locator('main[data-engine="vllm"] span[aria-live="polite"]').filter({ hasText: 'Stopped' }).waitFor();
        await current.close();
        const trt = await pageFor('/#/tensorrt-llm');
        await trt.locator('main[data-engine="trtllm"] span[aria-live="polite"]').filter({ hasText: 'Ready' }).waitFor();
        await trt.close();
        assert.deepEqual(errors, []);
        console.log('Browser regressions passed: both dashboards recover settings and refresh status; local TensorRT IDs match.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
