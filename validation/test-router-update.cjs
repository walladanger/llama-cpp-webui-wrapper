const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFile}=require('node:child_process');
const root=path.resolve(__dirname,'..'),version=require('../tauri-shell/tauri.conf.json').version;
const tag=process.env.ROUTER_UPDATE_TAG||'';
if(tag && !/^[a-zA-Z0-9-]+$/.test(tag))throw Error('Invalid update tag');
const exe=path.join(root,'artifacts',`LlamaCpp-Router-${version}${tag?'-'+tag:''}-Windows-x64-Update.exe`),manifest=require(`../tauri-shell/updater/generated/${version}${tag?'-'+tag:''}/update-manifest.json`);
const run=(file,args)=>new Promise((resolve,reject)=>execFile(file,args,{windowsHide:true,timeout:90000,maxBuffer:100000},(e,stdout,stderr)=>e?reject(e):resolve({stdout,stderr})));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
 const dir=path.join('C:/workspace',`RouterUpdateValidation-${Date.now()}`);assert(path.resolve(dir).startsWith(path.resolve('C:/workspace')+path.sep));await fs.mkdir(dir,{recursive:true});
 const invalid=path.join(dir,'not-installed');await fs.mkdir(invalid);await assert.rejects(run(exe,['/S','/VALIDATE','/D='+invalid]));await assert.rejects(fs.access(path.join(invalid,'llama-webui.exe')));
 const app=path.join(dir,'existing-app');await fs.mkdir(path.join(app,'portable-data/bin'),{recursive:true});await fs.writeFile(path.join(app,'llama-webui.exe'),'old shell');
 const preserve={'portable-data/bin/llama-server.exe':'unchanged runtime','portable-data/config/llama-server.json':'{"schema_version":1,"custom":true}','portable-data/config/trtllm.json':'{"distro":"Ubuntu","model":"user/custom","port":9010}','portable-data/models/preserve.gguf':'user model','portable-data/cache/preserve.txt':'user cache','portable-data/logs/preserve.log':'user logs'};
 for(const [file,content] of Object.entries(preserve)){await fs.mkdir(path.dirname(path.join(app,file)),{recursive:true});await fs.writeFile(path.join(app,file),content);}
 for(let attempt=0;attempt<2;attempt++){
  await run(exe,['/S','/VALIDATE','/D='+app]);
  for(const [file,content] of Object.entries(preserve))assert.equal(await fs.readFile(path.join(app,file),'utf8'),content,file);
  for(const file of manifest.files)assert.equal(hash(await fs.readFile(path.join(app,file.name))),file.sha256,file.name);
 }
 await run(path.join(app,'Uninstall.exe'),['/S','/VALIDATE','_?='+app]);
 for(const [file,content] of Object.entries(preserve)){if(file.includes('/bin/'))continue;assert.equal(await fs.readFile(path.join(app,file),'utf8'),content,file);}
 await assert.rejects(fs.access(path.join(app,'llama-webui.exe')));await assert.rejects(fs.access(path.join(app,'portable-data/ui/index.html')));
 const result={version,files:manifest.files.length,missingInstallationRejected:true,payloadHashesVerified:true,runtimePreservedDuringUpdate:true,modelsSettingsCacheLogsPreserved:true,repeatedUpgradePassed:true,uninstallPreservationPassed:true,scope:'Isolated silent validation. Does not change the running installed app, registry, or shortcuts. Actual WSL package download and first model inference remain untested.'};
 await fs.writeFile(path.join(__dirname,`router-update${tag?'-'+tag:''}-validation.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
