const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root=path.resolve(__dirname,'..');
const dir=path.join(__dirname,'trt-launcher-fixture');
fs.mkdirSync(dir,{recursive:true});
const bash='C:/Program Files/Git/bin/bash.exe';
const script=fs.readFileSync(path.join(root,'tauri-shell/src/trt-install.sh'),'utf8');
let wrapper=script.split("cat <<'LAUNCHER'\n")[1].split('\nLAUNCHER')[0];
const docker=path.join(dir,'docker-mock.sh').replaceAll('\\','/');
fs.writeFileSync(docker,'#!/bin/bash\nprintf \'%s\\0\' "$@" > "$ROUTER_TEST_OUTPUT"\n');
wrapper='#!/bin/bash\nimage=nvcr.io/nvidia/tensorrt-llm/release@sha256:fixture\nuse_group=1\n'+wrapper.replaceAll('/usr/bin/sg docker','/usr/bin/bash').replaceAll('/usr/bin/docker',JSON.stringify(docker));
const launcher=path.join(dir,'serve.sh');fs.writeFileSync(launcher,wrapper);
const output=path.join(dir,'args.bin');
function run(args,gpus='') {
 const result=spawnSync(bash,[launcher,...args],{env:{...process.env,ROUTER_TEST_OUTPUT:output.replaceAll('\\','/'),CUDA_VISIBLE_DEVICES:gpus},encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);
 return fs.readFileSync(output,'utf8').split('\0').slice(0,-1);
}
let args=run(['org/model','--host','127.0.0.1','--port','8001']);
assert.deepEqual(args.slice(-5),['org/model','--host','0.0.0.0','--port','8001']);
assert.equal(args[args.indexOf('--gpus')+1],'all');
assert.equal(args[args.indexOf('-p')+1],'127.0.0.1:8001:8001');assert.ok(!args.includes('--network'));
assert.ok(args.some(a=>a.endsWith(':/root/.cache')));
args=run(['org/model with spaces; echo should-stay-an-argument','--port','8001'],'2,1');
assert.equal(args[args.indexOf('--gpus')+1],'"device=2,1"');
assert.ok(args.includes('org/model with spaces; echo should-stay-an-argument'));
args=run(['--router-stop']);
assert.deepEqual(args.slice(0,2),['rm','-f']);assert.match(args[2],/^llama-router-trtllm-\d+$/);
// Desktop's already-accessible Docker socket must also work without group switching.
fs.writeFileSync(launcher,wrapper.replace('use_group=1','use_group=0'));
args=run(['org/desktop-model','--port','8001']);
assert.ok(args.includes('org/desktop-model'));assert.equal(args[args.indexOf('-p')+1],'127.0.0.1:8001:8001');
args=run(['org/model','--port','9010']);assert.equal(args[args.indexOf('-p')+1],'127.0.0.1:9010:9010');
console.log('Managed launcher: default GPUs, ordered selected GPUs, cache persistence, argument escaping, and scoped stop passed.');
