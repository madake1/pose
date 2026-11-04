import * as THREE from 'three';
import {STRIDE,validArm,poseMatrix} from './core.js';

const percentile=(values,q)=>{const v=[...values].sort((a,b)=>a-b);return v.length?v[Math.floor((v.length-1)*q)]:0;};
// Only geometric initialization. No image correspondences are available, so
// camera translation, optical roll, tool mounting offsets and time are not fitted.
export function recommendSetup(data,segment,aspect=16/9){
  const {start=0,end=data.length/STRIDE-1}=segment;
  const stride=Math.max(1,Math.ceil((end-start+1)/1000));
  const candidates=[true,false].map(column=>{
    const rays=[],positions=[];
    for(let row=start;row<=end;row+=stride){
      if(!validArm(data,row,1))continue;
      const a=row*STRIDE+22,cam=poseMatrix(data.subarray(a,a+12),column),inverse=cam.clone().invert();
      for(const arm of [0,2,3])if(validArm(data,row,arm)){
        const off=row*STRIDE+2+arm*16,p=new THREE.Vector3(...data.subarray(off+13,off+16));
        const local=p.clone().applyMatrix4(inverse);if(local.length()<1)continue;
        rays.push(local.normalize());positions.push(p);
      }
    }
    // Prefer the serialization needing the least change to the logged +Z axis.
    const tilt=percentile(rays.map(r=>Math.acos(THREE.MathUtils.clamp(r.z,-1,1))),.5);
    return {column,rays,positions,tilt};
  });
  const available=candidates[0].rays.length>0;
  if(!available)return {available:false,column:true,camera:{rx:0,ry:0,rz:0,fov:65},pairs:0,reason:'没有同时有效的相机和器械，保留日志原始朝向。'};
  const best=candidates[1].tilt+.05<candidates[0].tilt?candidates[1]:candidates[0];
  // Equal-weight unit rays prevent far-away outliers from dominating the view.
  let forward=best.rays.reduce((sum,r)=>sum.add(r),new THREE.Vector3());
  if(forward.length()<1e-6)forward.set(0,0,1);else forward.normalize();
  const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),forward);
  const inverseQ=q.clone().invert();
  const halfAngles=best.rays.map(ray=>{const r=ray.clone().applyQuaternion(inverseQ);return r.z>0?Math.atan2(Math.max(Math.abs(r.y),Math.abs(r.x)/aspect),r.z):Math.PI/2;});
  const fov=THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(percentile(halfAngles,.95))*2+12,45,130);
  const e=new THREE.Euler().setFromQuaternion(q,'XYZ');
  const center=new THREE.Vector3();
  for(const key of ['x','y','z'])center[key]=percentile(best.positions.map(p=>p[key]),.5);
  const radius=percentile(best.positions.map(p=>p.distanceTo(center)),.95);
  const observer={x:center.x,y:center.y,z:center.z,distance:THREE.MathUtils.clamp(2.6*(radius+110),300,1600),azimuth:35,elevation:28,roll:0};
  return {available:true,column:best.column,camera:{rx:THREE.MathUtils.radToDeg(e.x),ry:THREE.MathUtils.radToDeg(e.y),rz:THREE.MathUtils.radToDeg(e.z),fov},observer,pairs:best.rays.length,tiltDegrees:THREE.MathUtils.radToDeg(best.tilt),candidateTilts:candidates.map(c=>({column:c.column,tilt:THREE.MathUtils.radToDeg(c.tilt)})),reason:'从日志有效位置推荐视轴和视场角；器械朝向沿用日志，安装修正为零。'};
}
