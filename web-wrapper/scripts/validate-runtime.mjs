import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {buildArgs,childEnvironment}=require('../src/runtimes/server-args.js');
const {inspectRuntime,assertArguments}=require('../src/runtimes/runtime-capabilities.js');
const {StreamTiming}=require('../src/runtimes/stream-metrics.js');
const argv=process.argv.slice(2);const option=(key,fallback)=>{const i=argv.indexOf(key);return i<0?fallback:argv[i+1];};
const executable=path.resolve(option('--executable',''));const model=path.resolve(option('--model',''));const output=path.resolve(option('--output','runtime-validation.json'));
if(!argv.includes('--executable')||!argv.includes('--model'))throw new Error('Provide --executable and --model');
const settings={fit:false,ctx_size:2048,n_gpu_layers:99,device:option('--device','none'),split_mode:option('--split-mode','layer'),tensor_split:option('--tensor-split',''),flash_attn:'on',expose_metrics:true,parallel:1};
const uuids=option('--gpu-uuids','');
let resolved=null,env=childEnvironment(settings);
if(uuids){settings.selected_gpu_uuids=uuids.split(',');const settingsFile=output+'.profile.tmp.json';await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(settingsFile,JSON.stringify(settings));try{resolved=await require('../src/runtimes/launch.js').prepareLaunch({executable,settingsFile,port:8080,helperExecutable:option('--helper',null)});env=resolved.env;}finally{await fs.unlink(settingsFile);}}
const evidence=await inspectRuntime(executable,{env});
const hash=createHash('sha256');for await(const chunk of createReadStream(model))hash.update(chunk);const modelHash=hash.digest('hex');
const listener=net.createServer();await new Promise((resolve,reject)=>listener.once('error',reject).listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const args=[...(resolved ? [...resolved.args.slice(0,3),String(port),...resolved.args.slice(4)] : buildArgs(settings,{port})),'--model',model,'--verbosity','4'];assertArguments(evidence,args);
const started=performance.now();const child=spawn(executable,args,{env,cwd:path.dirname(executable),windowsHide:true,stdio:['ignore','pipe','pipe']});let log='',processError=null,exited=false;
child.on('error',e=>processError=e);child.on('exit',()=>exited=true);const capture=bytes=>{log=(log+bytes.toString()).slice(-2*1024*1024);};child.stdout.on('data',capture);child.stderr.on('data',capture);
let result={runtime:evidence,model:{path:model,sha256:modelHash},settings,effective:resolved?.effective||settings,port,correctnessPassed:false};
try{
 let ready=false;const deadline=performance.now()+90000;
 while(performance.now()<deadline){if(processError)throw processError;if(exited)throw new Error('Canary worker exited before health readiness');try{const r=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}
 if(!ready)throw new Error('Canary health timed out');result.loadMs=performance.now()-started;
 const timer=new StreamTiming();const response=await fetch('http://127.0.0.1:'+port+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Reply with only the word READY.'}],max_tokens:24,temperature:0,stream:true,stream_options:{include_usage:true}}),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw new Error('Canary request failed: '+response.status+' '+await response.text());
 let pending='',content='',reasoning='',finishReason=null;const decoder=new TextDecoder();
 const consume=frame=>{const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data||data==='[DONE]')return;const event=JSON.parse(data);timer.observe(event);for(const choice of event.choices||[]){content+=choice.delta?.content||'';reasoning+=choice.delta?.reasoning_content||'';if(choice.finish_reason)finishReason=choice.finish_reason;}};
 for await(const chunk of response.body){pending+=decoder.decode(chunk,{stream:true});let match;while((match=/\r?\n\r?\n/.exec(pending))){consume(pending.slice(0,match.index));pending=pending.slice(match.index+match[0].length);}}
 pending+=decoder.decode();if(pending.trim())consume(pending);
 result={...result,...timer.result(),content,reasoning,finishReason,correctnessPassed:/\bREADY\b/.test(content)};
 if(!result.correctnessPassed)throw new Error('Correctness check did not return READY');
 console.log(JSON.stringify({correctnessPassed:result.correctnessPassed,device:result.effective.device,ttftMs:result.ttftMs,content:result.content},null,2));
}catch(error){result.error=error.message;process.exitCode=1;console.error(error.message);}
finally{
 if(!exited){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);}
 await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify({...result,log},null,2)+'\n');
}
