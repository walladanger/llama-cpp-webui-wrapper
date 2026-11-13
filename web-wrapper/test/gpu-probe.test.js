"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { listDevices } = require('../src/runtimes/gpu.js');
const device = 'CUDA0: NVIDIA GeForce RTX 3090 (24576 MiB, 23000 MiB free)';
test('device probe receives the child visibility environment and reads stderr', async t => {
  const env = { CUDA_VISIBLE_DEVICES: 'GPU-test' };
  t.mock.method(childProcess, 'execFile', (exe, args, options, done) => {
    assert.equal(exe, 'llama-server');
    assert.deepEqual(args, ['--list-devices']);
    assert.equal(options.env, env);
    assert.equal(options.windowsHide, true);
    assert.equal(options.timeout, 15000);
    done({ code: 1 }, '', device);
  });
  assert.equal((await listDevices('llama-server', 15000, env))[0].id, 'CUDA0');
});
test('timed-out probes do not treat partial device output as a complete inventory', async t => {
  t.mock.method(childProcess, 'execFile', (exe, args, options, done) => done({ killed: true }, device, ''));
  assert.deepEqual(await listDevices('llama-server'), []);
});
test('launch and device probe use the same resolved environment', async t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { prepareLaunch } = require('../src/runtimes/launch.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-probe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settingsFile = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ gpu_placement: 'single', llamacpp_env: 'CUDA_VISIBLE_DEVICES=GPU-test' }));
  let probeEnv;
  t.mock.method(childProcess, 'execFile', (exe, args, options, done) => {
    probeEnv = options.env;
    done(null, device, '');
  });
  const plan = await prepareLaunch({ executable: 'llama-server', settingsFile, port: 8080, modelsDir: 'm' });
  assert.equal(plan.env, probeEnv);
  assert.equal(plan.env.CUDA_VISIBLE_DEVICES, 'GPU-test');
  assert.equal(plan.args[plan.args.indexOf('--device') + 1], 'CUDA0');
});

test('managed cache path is resolved before probing and remains the launch cache',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {prepareLaunch}=require('../src/runtimes/launch.js');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-cache-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'settings.json');fs.writeFileSync(file,JSON.stringify({gpu_placement:'single'}));
 let probeCache;t.mock.method(childProcess,'execFile',(exe,args,options,done)=>{probeCache=options.env.LLAMA_CACHE;done(null,device,'');});
 const launch=await prepareLaunch({executable:'llama-server',settingsFile:file,port:8080,modelsDir:'m',cacheDir:'managed-cache'});
 assert.equal(probeCache,'managed-cache');assert.equal(launch.env.LLAMA_CACHE,probeCache);
});
