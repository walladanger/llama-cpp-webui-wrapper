'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
async function packageFingerprint(executable) {
 const dir=path.dirname(executable),hash=crypto.createHash('sha256');
 const names=fs.readdirSync(dir).filter(name=>/\.(dll|exe)$/i.test(name)&&fs.statSync(path.join(dir,name)).isFile()).sort();
 for(const name of names){hash.update(name+'\0');for await(const bytes of fs.createReadStream(path.join(dir,name)))hash.update(bytes);hash.update('\0');}
 return hash.digest('hex');
}
function parseCapabilities(version,help,identity={}) {
 const flags=[...new Set(help.match(/--[a-z][a-z0-9-]*/g)||[])].sort();
 const tensorLine=help.split(/\r?\n/).find(line=>line.includes('--split-mode'))||'';
 const features={};
 for(const [name,advertised] of Object.entries({tensor:/\btensor\b/.test(tensorLine),flashAttention:flags.includes('--flash-attn'),deviceSelection:flags.includes('--device')}))features[name]={state:advertised?'unknown':'unsupported',advertised,verified:false};
 const evidenceKey=crypto.createHash('sha256').update(JSON.stringify({identity,version,help})).digest('hex');
 return {adapterVersion:1,version:version.trim(),...identity,evidenceKey,flags,features,observedAt:new Date().toISOString()};
}
function assertArguments(evidence,args) {
 for(const arg of args)if(arg.startsWith('--')&&!evidence.flags.includes(arg.split('=')[0]))throw new Error('Runtime package does not advertise required option: '+arg.split('=')[0]);
}
function probe(executable,flag,env,timeoutMs){return new Promise((resolve,reject)=>cp.execFile(executable,[flag],{env,windowsHide:true,timeout:timeoutMs,maxBuffer:1024*1024},(error,stdout,stderr)=>{if(error)return reject(new Error('Runtime '+flag+' probe failed or timed out'));resolve((stdout||'')+'\n'+(stderr||''));}));}
async function inspectRuntime(executable,{env=process.env,timeoutMs=5000,driverIdentity=null,modelIdentity=null}={}) {
 const [version,help,packageHash]=await Promise.all([probe(executable,'--version',env,timeoutMs),probe(executable,'--help',env,timeoutMs),packageFingerprint(executable)]);
 return parseCapabilities(version,help,{packageHash,driverIdentity,modelIdentity,visibility:Object.entries(env).filter(([key])=>['CUDA_VISIBLE_DEVICES','CUDA_DEVICE_ORDER'].includes(key.toUpperCase())).sort()});
}
module.exports={packageFingerprint,parseCapabilities,assertArguments,inspectRuntime};
