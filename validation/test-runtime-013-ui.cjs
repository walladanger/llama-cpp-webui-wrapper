const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../tools/ui/node_modules/playwright');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'tools/ui/dist');let browser;
const server=http.createServer(async(req,res)=>{let name=decodeURIComponent(req.url.split('?')[0]);try{const full=path.resolve(dist,'.'+name);if(!full.startsWith(dist))throw Error('path');let file=full;if(!path.extname(name))file=path.join(dist,'index.html');const type={'.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};res.setHeader('Content-Type',type[path.extname(file)]||'text/html');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const base='http://127.0.0.1:'+server.address().port;
 async function prepare(scenario){const page=await browser.newPage({viewport:{width:1160,height:900},serviceWorkers:'block'});page.setDefaultTimeout(8000);await page.route('**/props',r=>r.fulfill({json:{default_generation_settings:{params:{}},build_info:'fixture',modalities:{vision:false,audio:false}}}));await page.route('**/v1/models',r=>r.fulfill({json:{data:[]}}));await page.addInitScript(scenario=>{
 window.fixture={scenario,calls:[],installed:scenario==='repair',running:false,config:{distro:scenario==='select'?'Missing':'Ubuntu',executable:'trtllm-serve',model:'TinyLlama/TinyLlama-1.1B-Chat-v1.0',port:8001,cuda_visible_devices:''},job:{state:'idle',step:0,message:'',log:'',kind:'runtime'}};
 window.__TAURI__={core:{invoke:async(command,args)=>{const f=window.fixture;f.calls.push({command,args});
 if(command==='read_engine_config')return structuredClone(f.config);
 if(command==='save_engine_config'){f.config=structuredClone(args.config);return;}
 if(command==='manager_call'){
 switch(args.action){
 case 'installed':if(!f.installed)throw 'TensorRT-LLM is not installed in WSL2';return 'installed';
 case 'status':return f.running?'ActiveState=active\nHTTP health: ready\nRunning model: '+f.config.model:'ActiveState=inactive\nHTTP health: unavailable\nRunning model: unavailable';
 case 'setup-check': {
 const distributions=[{name:'Ubuntu',version:2},{name:'Ubuntu-22.04',version:2},{name:'Ubuntu-24.04',version:2},{name:'docker-desktop',version:2}];
 if(f.scenario==='access')return JSON.stringify({ready:false,distributions:[],checks:[{key:'wsl_access',state:'blocked',detail:'Windows could not inspect WSL. Existing installations have not been assumed missing.'}]});
 if(f.scenario==='select'&&f.config.distro==='Missing')return JSON.stringify({ready:false,distributions,checks:[{key:'wsl_select',state:'blocked',detail:'Choose an existing Linux installation.'}]});
 return JSON.stringify(f.scenario==='missing'?{ready:false,distributions:[],checks:[{key:'wsl_install',state:'blocked',detail:'Install WSL / Ubuntu and finish first launch.'}]}:{ready:true,distributions,checks:[{key:'wsl',state:'pass',detail:'WSL 2 ready'},{key:'gpu',state:'pass',detail:'NVIDIA GeForce RTX 3090'},{key:'docker',state:'pass',detail:'Docker Desktop will be reused'}]}); }
 case 'install-status':return JSON.stringify(f.job);
 case 'install':f.job={state:'running',step:3,message:'Downloading TensorRT-LLM 1.2.0',log:'ROUTER_STEP:3:Downloading\nlayer progress...',kind:'runtime'};return JSON.stringify(f.job);
 case 'install-cancel':f.job={...f.job,state:'cancelled',message:'Installation stopped. You can retry.'};return JSON.stringify(f.job);
 case 'install-wsl':f.job={state:'running',step:0,message:'Accept the Windows administrator prompt.',log:'',kind:'wsl'};return JSON.stringify(f.job);
 case 'open-ubuntu':return 'Ubuntu opened';
 case 'start':f.running=true;return 'started';
 case 'stop':f.running=false;return 'stopped';
 default:return '';
 }
 }return [];
 }}};
 },scenario);page.on('pageerror',e=>console.log('PAGEERROR',e.message));await page.goto(base+'/#/tensorrt-llm');return page;}
 const page=await prepare('ready');const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'Install automatically',exact:true}).waitFor().catch(async e=>{console.log('INITIAL PAGE',await page.locator('body').innerText());console.log('CALLS',await page.evaluate(()=>window.fixture));await page.screenshot({path:path.join(__dirname,'trt-debug.png')});throw e;});
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Install automatically')?.disabled);
 assert.equal(await page.getByRole('button',{name:'Start',exact:true}).isEnabled(),false,'Start is gated before install');
 assert.equal(await page.getByLabel('Executable in WSL',{exact:true}).isVisible(),false,'Technical paths begin collapsed');
 await page.getByText('Advanced settings',{exact:true}).click();await page.getByLabel('WSL distro',{exact:true}).fill('Ubuntu-22.04');
 assert.equal(await page.getByRole('button',{name:'Install automatically',exact:true}).isEnabled(),false,'Changed settings require another check');
 await page.getByRole('button',{name:'Check again',exact:true}).click();await page.getByRole('button',{name:'Install automatically',exact:true}).click();
 await page.getByRole('progressbar',{name:'Installation steps completed'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Start',exact:true}).isEnabled(),false);
 assert.equal(await page.getByLabel('Model',{exact:true}).isEnabled(),false,'Settings lock while setup runs');
 await page.getByRole('button',{name:'Cancel installation',exact:true}).click();await page.getByRole('button',{name:'Retry installation',exact:true}).click();
 await page.evaluate(()=>{window.fixture.job={...window.fixture.job,state:'error',message:'Setup could not finish. Review the details.',log:'Download failed: network interrupted'};});
 await page.getByText('Setup could not finish. Review the details.',{exact:true}).waitFor();await page.getByText('Installation details',{exact:true}).click();assert.match(await page.locator('pre').first().innerText(),/network interrupted/);
 await page.getByRole('button',{name:'Retry installation',exact:true}).click();
 await page.evaluate(()=>{const f=window.fixture;f.installed=true;f.config.executable='/opt/llama-router/trtllm/bin/trtllm-serve';f.job={state:'complete',step:6,message:'TensorRT-LLM installed. Choose Start.',log:'ROUTER_STEP:6:Complete',kind:'runtime'};});
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Start')?.disabled===false);
 await page.getByLabel('Model',{exact:true}).fill('user/chosen-model');await page.getByRole('button',{name:'Start',exact:true}).click();
 await page.waitForFunction(()=>window.fixture.running);
 const calls=await page.evaluate(()=>window.fixture.calls);const start=calls.findIndex(c=>c.command==='manager_call'&&c.args.action==='start');assert.equal(calls[start-1].command,'save_engine_config');assert.equal(calls[start-1].args.config.model,'user/chosen-model');
 await page.getByRole('button',{name:'Stop',exact:true}).waitFor();
 await page.screenshot({path:path.join(__dirname,'trt-installed-desktop.png'),fullPage:true});
 await page.setViewportSize({width:640,height:820});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Narrow layout has no horizontal overflow');
 await page.close();
 const missing=await prepare('missing');await missing.getByRole('button',{name:'Install WSL + Ubuntu',exact:true}).waitFor();assert.equal(await missing.getByRole('button',{name:'Start',exact:true}).isEnabled(),false);await missing.getByRole('button',{name:'Install WSL + Ubuntu',exact:true}).click();assert.equal(await missing.evaluate(()=>window.fixture.config.distro),'Ubuntu-24.04');
 await missing.evaluate(()=>{window.fixture.job={...window.fixture.job,state:'complete',message:'Restart if requested and finish Ubuntu first launch.'};});await missing.getByRole('button',{name:'Open Ubuntu to finish setup',exact:true}).waitFor();await missing.getByRole('button',{name:'Open Ubuntu to finish setup',exact:true}).click();assert(await missing.evaluate(()=>window.fixture.calls.some(c=>c.args?.action==='open-ubuntu')));await missing.close();

 const selected=await prepare('select');await selected.getByLabel('Existing Linux installation',{exact:false}).waitFor();
 assert.equal(await selected.getByRole('button',{name:'Install automatically',exact:true}).isEnabled(),false);
 assert.equal(await selected.getByRole('option',{name:/docker-desktop/}).count(),0,'Internal Docker distribution is not a setup target');
 await selected.getByLabel('Existing Linux installation',{exact:false}).selectOption('Ubuntu-24.04');
 await selected.waitForFunction(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Install automatically')?.disabled===false);
 assert.equal(await selected.evaluate(()=>window.fixture.config.distro),'Ubuntu-24.04');
 assert.equal(await selected.evaluate(()=>window.fixture.calls.some(c=>c.args?.action==='install-wsl')),false,'Selecting an existing distro never installs another one');await selected.close();
 const access=await prepare('access');await access.getByText(/Windows could not inspect WSL/).waitFor();
 assert.equal(await access.getByRole('button',{name:'Install WSL + Ubuntu',exact:true}).count(),0,'A failed inspection is not reported as a missing installation');
 assert.equal(await access.getByRole('button',{name:'Install automatically',exact:true}).isEnabled(),false);await access.close();
 const repair=await prepare('repair');await repair.getByRole('button',{name:'Verify and repair',exact:true}).waitFor();
 assert.equal(await repair.getByRole('button',{name:'Verify and repair',exact:true}).isEnabled(),false);
 await repair.getByRole('button',{name:'Check again',exact:true}).click();await repair.getByRole('button',{name:'Verify and repair',exact:true}).click();
 await repair.getByRole('progressbar').waitFor();assert(await repair.evaluate(()=>window.fixture.calls.some(c=>c.args?.action==='install')));await repair.close();
 assert.deepEqual(errors,[]);
 console.log('PASS: existing WSL picker, no duplicate installs, inspection errors, repair path, production route, install gating, advanced defaults, config recheck, progress, cancellation, failure details, retry, completion, auto-save before start, narrow viewport, WSL bootstrap and first-launch recovery. Native install calls are mocked; this test installs no Linux packages.');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
