'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const cap=require('../src/runtimes/runtime-capabilities.js');
test('help advertises support without claiming successful model inference',()=>{
 const result=cap.parseCapabilities('build 12125','--split-mode {none,layer,tensor}\n-fa, --flash-attn [on|off|auto]\n--device <dev>',{packageHash:'abc',driverIdentity:'driverA'});
 assert.equal(result.features.tensor.state,'unknown');assert.equal(result.features.tensor.advertised,true);
 assert.equal(result.features.tensor.verified,false);assert.equal(result.flags.includes('--flash-attn'),true);
 assert.throws(()=>cap.assertArguments(result,['--missing','1']),/missing/);
});
test('package changes and driver changes invalidate capability identity',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-cap-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const exe=path.join(dir,'llama-server.exe');fs.writeFileSync(exe,'exe');fs.writeFileSync(path.join(dir,'ggml-cuda.dll'),'first');
 const before=await cap.packageFingerprint(exe);fs.writeFileSync(path.join(dir,'ggml-cuda.dll'),'second');const after=await cap.packageFingerprint(exe);
 assert.notEqual(before,after);
 const a=cap.parseCapabilities('v','--device',{packageHash:after,driverIdentity:'A'});
 const b=cap.parseCapabilities('v','--device',{packageHash:after,driverIdentity:'B'});assert.notEqual(a.evidenceKey,b.evidenceKey);
});
