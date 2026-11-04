import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {STRIDE,jawOpening} from '../src/core.js';
import {recommendSetup} from '../src/recommend.js';

function synthetic(){
  const count=60,data=new Float64Array(count*STRIDE),cam=new THREE.Matrix4().makeRotationY(Math.PI/2);cam.setPosition(10,20,30);
  for(let row=0;row<count;row++){
    data[row*STRIDE]=66600+row/60;data[row*STRIDE+1]=row;
    for(let arm=0;arm<4;arm++){
      const a=row*STRIDE+2+arm*16;data[a]=arm===1?3590:1028;
      const m=cam.clone();if(arm!==1){const p=new THREE.Vector3((arm-2)*4,6+Math.sin(row/10),100).applyMatrix4(cam);m.setPosition(p);}
      const e=m.elements;data.set([e[0],e[1],e[2],e[4],e[5],e[6],e[8],e[9],e[10],e[12],e[13],e[14]],a+4);
    }
  }return data;
}
test('logged total angle drives both jaws directly; negative angles close rather than reopen',()=>{
  const o=jawOpening(Math.PI/3,22);assert.ok(Math.abs(o.degrees-60)<1e-10);assert.ok(Math.abs(o.half-Math.PI/6)<1e-10);assert.ok(Math.abs(o.gap-22)<1e-10);
  assert.equal(jawOpening(-.6,22).total,0);assert.equal(jawOpening(-.6,22).raw,-.6);assert.equal(jawOpening(0,22).gap,0);assert.equal(jawOpening(5,22).total,Math.PI);
});
test('log geometry selects the forward-facing matrix convention and a repeatable camera recommendation',()=>{
  const data=synthetic(),segment={start:0,end:59},r=recommendSetup(data,segment);
  assert.equal(r.available,true);assert.equal(r.column,true);assert.equal(r.pairs,180);assert.ok(r.camera.fov>=45&&r.camera.fov<=130);assert.ok(Math.abs(r.camera.rx)<10&&Math.abs(r.camera.ry)<10);
  assert.deepEqual(recommendSetup(data,segment),r);
});
test('invalid instruments never influence camera recommendation, even with nonzero retained poses',()=>{
  const data=synthetic();for(let row=0;row<60;row++){data[row*STRIDE+2]=32767;data[row*STRIDE+15]=1e10;}
  const r=recommendSetup(data,{start:0,end:59});assert.equal(r.pairs,120);assert.ok(Math.abs(r.observer.x)<200);
});
test('no paired valid camera/tool samples returns an explicit unfitted fallback',()=>{
  const data=synthetic();for(let row=0;row<60;row++)data[row*STRIDE+18]=32767;
  const r=recommendSetup(data,{start:0,end:59});assert.equal(r.available,false);assert.equal(r.pairs,0);assert.equal(r.camera.rx,0);
});
