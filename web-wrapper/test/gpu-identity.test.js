'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const gpu=require('../src/runtimes/gpu.js');
const inventory='GPU-a, NVIDIA GeForce RTX 3090, 24576, 20000, 616.92, 00000000:01:00.0\nGPU-b, NVIDIA GeForce RTX 3090, 24576, 18000, 616.92, 00000000:03:00.0';
test('UUID selection survives inventory reordering and duplicate model names',()=>{
 const cards=gpu.parseNvidiaInventory(inventory);const result=gpu.resolveUuidSelection(['GPU-b','GPU-a'],cards.reverse(),{});
 assert.equal(result.CUDA_VISIBLE_DEVICES,'GPU-b,GPU-a');assert.equal(result.CUDA_DEVICE_ORDER,'PCI_BUS_ID');
});
test('missing card and duplicate UUIDs never silently substitute a GPU',()=>{
 const cards=gpu.parseNvidiaInventory(inventory);
 assert.throws(()=>gpu.resolveUuidSelection(['GPU-4070'],cards,{}),/unavailable/);
 assert.throws(()=>gpu.resolveUuidSelection(['GPU-a','GPU-a'],cards,{}),/Duplicate/);
});
test('UUID selection refuses conflicting inherited device visibility',()=>{
 assert.throws(()=>gpu.resolveUuidSelection(['GPU-a'],gpu.parseNvidiaInventory(inventory),{CUDA_VISIBLE_DEVICES:'GPU-b'}),/visibility/);
});
test('invalid telemetry is unavailable, not zero free memory',()=>{
 const cards=gpu.parseNvidiaInventory('GPU-a, RTX 3090, 24576, N/A, 616.92, 01:00.0');
 assert.equal(cards[0].free,null);
});

test('NVIDIA identity fallback reads the bounded companion CUDA probe',async t=>{
 const cp=require('node:child_process');
 t.mock.method(cp,'execFile',(exe,args,options,done)=>{
  assert.equal(options.timeout,5000);assert.equal(options.windowsHide,true);
  if(exe==='nvidia-smi')return done({code:255},'Failed to initialize NVML: Unknown Error','');
  assert.equal(exe,'helper.exe');assert.deepEqual(args,['cuda-inventory']);
  done(null,JSON.stringify([{uuid:'GPU-a',name:'RTX 3090',total:24575,free:null,source:'cuda-driver'}]),'');
 });
 assert.equal((await gpu.nvidiaInventory(5000,'helper.exe'))[0].uuid,'GPU-a');
});
