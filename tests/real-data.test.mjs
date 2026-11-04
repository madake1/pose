import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,createReadStream,statSync} from 'node:fs';
import {Readable} from 'node:stream';
import {build} from 'esbuild';
import vm from 'node:vm';
import {parseClock,logCoverage} from '../src/core.js';

const path='data/20260826-125222-0000267045-AI.txt';
test('real first log: worker streams all records and detects session reset', {skip:!existsSync(path)},async()=>{
  const output=await build({entryPoints:['src/parser.worker.js'],bundle:true,format:'iife',write:false});
  let result;
  const self={postMessage(value){if(value.kind==='done'||value.kind==='error')result=value;}};
  const context=vm.createContext({self,TextDecoder,Float64Array,AbortController,console});
  vm.runInContext(output.outputFiles[0].text,context);
  await self.onmessage({data:{file:{size:statSync(path).size,stream:()=>Readable.toWeb(createReadStream(path))}}});
  assert.equal(result.kind,'done');assert.equal(result.count,12240);assert.equal(result.bad,0);assert.equal(result.segments.length,2);assert.equal(result.segments[0].end,12216);assert.equal(result.segments[1].start,12217);assert.equal(result.data[1],267045);assert.equal(result.data[18],3590);
  assert.equal(result.recommendations.length,2);assert.equal(result.recommendations[0].available,true);assert.equal(result.recommendations[0].column,true);assert.equal(result.recommendations[1].available,false);
});
test('multiple real logs share absolute time and bracket the supplied video start', {skip:!existsSync('data/20260826-182358-0000004354-AI.txt')},async()=>{
  const output=await build({entryPoints:['src/parser.worker.js'],bundle:true,format:'iife',write:false});let result;
  const self={postMessage(value){if(value.kind==='done'||value.kind==='error')result=value;}};
  vm.runInContext(output.outputFiles[0].text,vm.createContext({self,TextDecoder,Float64Array,AbortController,console}));
  const paths=[path,'data/20260826-182358-0000004354-AI.txt'];
  await self.onmessage({data:{files:paths.map(p=>({size:statSync(p).size,name:p.split('/').pop(),stream:()=>Readable.toWeb(createReadStream(p))}))}});
  assert.equal(result.kind,'done');assert.equal(result.count,66194);assert.equal(result.segments.length,3);
  const p=logCoverage(result.data,result.segments,parseClock('18:30:37.317'));assert.ok(p);assert.ok(Math.abs(p.alpha-9/29)<1e-7);assert.equal(result.segments[p.segment].fileIndex,1);
});
