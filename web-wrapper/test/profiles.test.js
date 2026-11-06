'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const settings = require('../src/runtimes/server-settings.js');
const { childEnvironment } = require('../src/runtimes/server-args.js');
const { prepareLaunch } = require('../src/runtimes/launch.js');
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-profile-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'settings.json');
}
test('legacy settings migrate without changing the source or losing extension data', t => {
  const file = temporary(t);
  const raw = JSON.stringify({ ctx_size: '8192', extension: { user: 'kept' } });
  fs.writeFileSync(file, raw);
  const p = settings.loadProfile(file);
  assert.equal(p.schemaVersion, 1); assert.equal(p.revision, 0);
  assert.equal(p.settings.ctx_size, '8192'); assert.deepEqual(p.settings.extension, { user: 'kept' });
  assert.equal(fs.readFileSync(file, 'utf8'), raw);
});
test('durable profiles round trip and reject stale revision saves', t => {
  const file = temporary(t);
  const p = settings.loadProfile(file); p.name = 'Main model'; p.settings.ctx_size = 4096;
  const saved = settings.saveProfile(file, p, 0);
  assert.equal(saved.revision, 1); assert.equal(settings.load(file).ctx_size, 4096);
  assert.equal(settings.loadProfile(file).name, 'Main model');
  assert.throws(() => settings.saveProfile(file, p, 0), /changed/);
  assert.equal(settings.loadProfile(file).revision, 1);
});
test('invalid profile save leaves last known good file untouched', t => {
  const file = temporary(t); const saved = settings.saveProfile(file, settings.loadProfile(file), 0);
  const before = fs.readFileSync(file, 'utf8'); saved.settings.ctx_size = 1.5;
  assert.throws(() => settings.saveProfile(file, saved, 1), /Invalid ctx_size/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
test('unknown schema versions and nonobject documents fail closed', t => {
  const file = temporary(t);
  for (const value of [[], null, { schemaVersion: 2, settings: {} }, { schemaVersion: 1, revision: 0, settings: [] }]) {
    fs.writeFileSync(file, JSON.stringify(value)); assert.throws(() => settings.load(file), /profile|object|schema/i);
  }
});
test('launch environments remove inherited managed options and disabled P2P', () => {
  const env = childEnvironment({llamacpp_env:'cuda_visible_devices=GPU-a'}, { CUDA_VISIBLE_DEVICES:'GPU-b', LLAMA_ARG_CTX_SIZE:'100', ggml_cuda_p2p:'0', PATH:'test' });
  assert.deepEqual(env, {PATH:'test', cuda_visible_devices:'GPU-a'});
});
test('enabled P2P is explicit and duplicate environment keys are rejected', () => {
  assert.equal(childEnvironment({p2p:true}).GGML_CUDA_P2P,'1');
  assert.throws(() => childEnvironment({llamacpp_env:'A=1;a=2'}), /Duplicate/);
});
test('requested settings survive automatic placement and diagnostics exclude inherited secrets', async t => {
  const file = temporary(t);
  fs.writeFileSync(file, JSON.stringify({ctx_size:4096}));
  const p = await prepareLaunch({settingsFile:file,port:8080,modelsDir:'m'});
  assert.equal(p.requested.ctx_size,4096); assert.equal(p.effective.ctx_size,4096);
  assert.equal(p.diagnostics.restartRequired,true);
  assert.ok(!JSON.stringify(p.diagnostics).includes('PATH='));
});

test('launch diagnostics redact expert argument credentials',async t=>{
 const file=temporary(t);fs.writeFileSync(file,JSON.stringify({extra_args:'--api-key secret-value --alias "My Model"'}));
 const launch=await prepareLaunch({settingsFile:file,port:8080,modelsDir:'m'});
 assert.equal(launch.args[launch.args.indexOf('--api-key')+1],'secret-value');
 assert.ok(!JSON.stringify({requested:launch.requested,effective:launch.effective,diagnostics:launch.diagnostics}).includes('secret-value'));
});
