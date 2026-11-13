const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const shell=path.resolve(__dirname,'..'),root=path.dirname(shell),version=require('../tauri.conf.json').version;
const tag=process.env.ROUTER_UPDATE_TAG||'';
if(tag && !/^[a-zA-Z0-9-]+$/.test(tag))throw Error('Invalid update tag');
const generated=path.join(__dirname,'generated',version+(tag?'-'+tag:'')),stage=path.join(generated,'payload');
const output=path.join(root,'artifacts',`LlamaCpp-Router-${version}${tag?'-'+tag:''}-Windows-x64-Update.exe`);
const nsis=process.env.ROUTER_MAKENSIS||path.join(process.env.LOCALAPPDATA,'tauri/NSIS/makensis.exe');
if(!generated.startsWith(root+path.sep))throw Error('Invalid staging location');
fs.mkdirSync(stage,{recursive:true});
for(const name of ['llama-webui.exe','llama-engine-manager.exe'])fs.copyFileSync(path.join(shell,'target/release',name),path.join(stage,name));
fs.cpSync(path.join(root,'tools/ui/dist'),path.join(stage,'portable-data/ui'),{recursive:true});
function walk(dir,prefix=''){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const rel=prefix?prefix+'/'+e.name:e.name;if(e.isSymbolicLink()||!/^[a-zA-Z0-9_./ +@()=-]+$/.test(rel))throw Error('Unsafe payload path');return e.isDirectory()?walk(path.join(dir,e.name),rel):[rel];}).sort();}
const files=walk(stage);if(files.some(f=>/^portable-data\/(config|models|cache|logs|bin)\//.test(f)))throw Error('Update cannot own user data or runtime files');
const legacy=require('../installer/generated/payload-manifest.json').files.map(f=>f.name);
const owned=[...new Set([...legacy,...files])].sort();if(owned.some(f=>f.includes('..')||! /^[a-zA-Z0-9_./ +@()=-]+$/.test(f)||/^portable-data\/(config|models|cache|logs)\//.test(f)))throw Error('Unsafe owned path');
const win=p=>p.replaceAll('/','\\');let previous='';const install=[];
for(const file of files){const dir=path.posix.dirname(file);if(dir!==previous){install.push(`SetOutPath "$INSTDIR${dir==='.'?'':'\\'+win(dir)}"`);previous=dir;}install.push(`File "${win(path.join(stage,file))}"`);}
fs.writeFileSync(path.join(generated,'install-files.nsh'),install.join('\r\n')+'\r\n');
const directories=[...new Set(owned.flatMap(f=>{const dirs=[];let d=path.posix.dirname(f);while(d!=='.'){dirs.push(d);d=path.posix.dirname(d);}return dirs;}))].sort((a,b)=>b.split('/').length-a.split('/').length||b.localeCompare(a));
fs.writeFileSync(path.join(generated,'uninstall-files.nsh'),[...owned.map(f=>`Delete "$INSTDIR\\${win(f)}"`),...directories.map(d=>`RMDir "$INSTDIR\\${win(d)}"`)].join('\r\n')+'\r\n');
const manifest={version,requiresExistingRouter:true,files:files.map(name=>({name,bytes:fs.statSync(path.join(stage,name)).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(stage,name))).digest('hex')})),uninstallOwned:owned};
fs.writeFileSync(path.join(generated,'update-manifest.json'),JSON.stringify(manifest,null,2));
const result=spawnSync(nsis,['/V3',`/DVERSION=${version}`,`/DOUTPUT=${output}`,`/DMANIFEST=${generated}`,'update.nsi'],{cwd:__dirname,windowsHide:true,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
const hash=crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');fs.writeFileSync(output+'.sha256',hash+'  '+path.basename(output)+'\n');console.log(JSON.stringify({output,bytes:fs.statSync(output).size,sha256:hash}));
