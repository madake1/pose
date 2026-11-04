import {test} from 'node:test';
import assert from 'node:assert/strict';
import {STRIDE,parseClock,clock,elapsed,logTimeAtVideo,videoTimeAtLog,logCoverage} from '../src/core.js';
const sync={zero:'18:30:37.317',offset:0,rate:1};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} vs ${b}`);
function samples(times,serials=times.map((_,i)=>i+1)){const d=new Float64Array(times.length*STRIDE);times.forEach((t,i)=>{d[i*STRIDE]=t;d[i*STRIDE+1]=serials[i];});return d;}
test('absolute clock accepts Chinese colons and maps video endpoints without exact log timestamps',()=>{
  near(parseClock('18：30：37：317'),parseClock(sync.zero));near(videoTimeAtLog(parseClock('18:39:11.087'),sync),513.770);
  assert.equal(clock(logTimeAtVideo(3991,sync)),'19:37:08.317');assert.equal(elapsed(3991),'01:06:31.000');
  near(logTimeAtVideo(videoTimeAtLog(68000,{...sync,offset:.5,rate:1.001}),{...sync,offset:.5,rate:1.001}),68000);
});
test('video zero between 18:30:37.308 and .337 interpolates instead of demanding a matching row',()=>{
  const a=parseClock('18:30:37.308'),b=parseClock('18:30:37.337'),data=samples([a,b]);const p=logCoverage(data,[{start:0,end:1,t0:a,t1:b}],parseClock(sync.zero));
  assert.equal(p.a,0);assert.equal(p.b,1);near(p.alpha,9/29);
});
test('normal short file-boundary gaps can interpolate but real gaps and session resets cannot',()=>{
  const data=samples([10,11,11.06,12,12.205,13],[1,2,5,6,9,10]),segments=[{start:0,end:1,t0:10,t1:11},{start:2,end:3,t0:11.06,t1:12},{start:4,end:5,t0:12.205,t1:13}];
  near(logCoverage(data,segments,11.03).alpha,.5);assert.equal(logCoverage(data,segments,12.1),null);assert.equal(logCoverage(data,segments,9),null);assert.equal(logCoverage(data,segments,14),null);
  data[2*STRIDE+1]=0;assert.equal(logCoverage(data,segments,11.03),null);
});
test('large missing interval inside a file is not rendered as a held old pose',()=>{
  const data=samples([1,1.5]),segments=[{start:0,end:1,t0:1,t1:1.5}];assert.equal(logCoverage(data,segments,1.2),null);assert.ok(logCoverage(data,segments,1.5));
});
