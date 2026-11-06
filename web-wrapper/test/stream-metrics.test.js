'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {StreamTiming}=require('../src/runtimes/stream-metrics.js');
test('TTFT ignores role-only empty and heartbeat events and separates reasoning from content',()=>{
 const timer=new StreamTiming(100);timer.observe({choices:[{delta:{role:'assistant',content:''}}]},120);timer.observe({},130);
 timer.observe({choices:[{delta:{reasoning_content:'thinking'}}]},160);timer.observe({choices:[{delta:{content:'answer'}}]},190);
 assert.equal(timer.result(250).ttftMs,60);assert.equal(timer.result(250).contentTtftMs,90);assert.equal(timer.result(250).totalMs,150);
});
test('tool output establishes TTFT and absent content remains null',()=>{
 const timer=new StreamTiming(10);timer.observe({choices:[{delta:{tool_calls:[{function:{arguments:'{}'}}]}}]},40);
 assert.equal(timer.result(70).ttftMs,30);assert.equal(timer.result(70).contentTtftMs,null);
});
test('no generation never appears as zero-latency success',()=>{
 const timer=new StreamTiming(0);timer.observe({choices:[{delta:{role:'assistant'}}]},4);
 assert.equal(timer.result(10).ttftMs,null);assert.equal(timer.result(10).tokensPerSecond,null);
});
