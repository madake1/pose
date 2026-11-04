import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {STRIDE,sampleArm,cameraFrames,intrinsicsCamera} from '../src/core.js';

const installation={x:0,y:0,z:0,rx:0,ry:0,rz:0};
function pixels(logged,point=new THREE.Vector3(10,0,100),offset=installation){
  const cam=new THREE.PerspectiveCamera();cam.matrixAutoUpdate=false;cam.matrix.copy(cameraFrames(logged,offset).renderFrame);cam.updateMatrixWorld(true);
  intrinsicsCamera(cam,100,100,{advanced:true,fx:100,fy:100,cx:50,cy:50,near:1,far:1000});const p=point.clone().project(cam);return [(p.x+1)*50,(1-p.y)*50];
}
test('a stationary tool moves in image coordinates when arm2 translates or rotates',()=>{
  const a=pixels(new THREE.Matrix4()),b=pixels(new THREE.Matrix4().makeTranslation(5,0,0)),c=pixels(new THREE.Matrix4().makeRotationZ(Math.PI/2));
  for(const [actual,expected]of [[a,[60,50]],[b,[55,50]],[c,[50,40]]])actual.forEach((x,i)=>assert.ok(Math.abs(x-expected[i])<1e-8));
});
test('fixed camera installation follows arm2 and does not freeze its world pose',()=>{
  const logged=new THREE.Matrix4().makeRotationZ(Math.PI/2);logged.setPosition(10,20,30);
  const frame=cameraFrames(logged,{...installation,x:5}).opticalFrame;
  assert.ok(new THREE.Vector3().setFromMatrixPosition(frame).distanceTo(new THREE.Vector3(10,25,30))<1e-10);
});
test('arm2 translation and rotation both interpolate; invalid camera samples stay invalid',()=>{
  const data=new Float64Array(2*STRIDE);
  for(let row=0;row<2;row++){const a=row*STRIDE;data[a]=66600+row*.1;data[a+18]=3590;const m=new THREE.Matrix4().makeRotationZ(row*Math.PI/2);m.setPosition(row*10,0,0);const e=m.elements;data.set([e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10],e[12],e[13],e[14]],a+22);}
  const convention={column:false,inverse:false,scale:1},pose=sampleArm(data,{a:0,b:1,alpha:.5},1,convention),p=pixels(pose.matrix);
  assert.ok(Math.abs(p[0]-(50+5/Math.sqrt(2)))<1e-8);assert.ok(Math.abs(p[1]-(50-5/Math.sqrt(2)))<1e-8);
  data[STRIDE+18]=32767;assert.equal(sampleArm(data,{a:1,b:1,alpha:0},1,convention),null);
});
