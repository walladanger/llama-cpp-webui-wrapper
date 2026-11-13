"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArgs } = require('../src/runtimes/server-args.js');
const { DEFAULTS } = require('../src/runtimes/server-settings.js');
const fixtures = require('./fixtures/gpu-contract.json');
for (const fixture of fixtures) {
  test(fixture.name, () => {
    const run = () => buildArgs({ ...DEFAULTS, ...fixture.settings }, { port: 8080, modelsDir: 'm' });
    if (fixture.error) return assert.throws(run, error => error.message.includes(fixture.error));
    const args = run();
    for (const [flag, value] of Object.entries(fixture.flags)) {
      assert.ok(args.includes(flag), flag + ' missing');
      assert.equal(args[args.indexOf(flag) + 1], value);
    }
  });
}

test('quoted values and Windows paths remain literal', () => {
  const { splitArgs } = require('../src/runtimes/server-args.js');
  assert.deepEqual(splitArgs('--alias="my model"'), ['--alias=my model']);
  assert.deepEqual(splitArgs('--alias ""'), ['--alias', '']);
  assert.deepEqual(splitArgs(String.raw`--model "C:\models\my model.gguf"`), ['--model', String.raw`C:\models\my model.gguf`]);
});
