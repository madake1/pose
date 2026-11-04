import * as THREE from 'three';
export const STRIDE = 66;
export function jawOpening(grip,jawLength) {
  // The logged value is interpreted as the total included angle in radians.
  // Negative angles indicate overclosure; never turn them positive with abs().
  const total=THREE.MathUtils.clamp(Number.isFinite(grip)?grip:0,0,Math.PI);
  return {raw:grip,total,half:total/2,degrees:THREE.MathUtils.radToDeg(total),gap:2*jawLength*Math.sin(total/2)};
}
export function parseClock(value) {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})(?:[:.](\d{1,3}))?$/.exec(value.trim().replaceAll('：',':'));
  if (!m || +m[1]>23 || +m[2]>59 || +m[3]>59) return NaN;
  return +m[1]*3600 + +m[2]*60 + +m[3] + +(m[4]||'0').padEnd(3,'0')/1000;
}
export function logTimeAtVideo(t,sync){return parseClock(sync.zero)+sync.offset+t*sync.rate;}
export function videoTimeAtLog(t,sync){return (t-parseClock(sync.zero)-sync.offset)/sync.rate;}
export function elapsed(t){if(!Number.isFinite(t))return '—';const ms=Math.round(Math.max(0,t)*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;}
export function clock(t) {
  if (!Number.isFinite(t)) return '—';
  const ms = Math.round(((t%86400)+86400)%86400*1000);
  return `${String(Math.floor(ms/3600000)%24).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
}
export function parseLine(line) {
  const s=line.trim().split(/\s+/);
  if(s.length!==70 || !s[0].startsWith('iSerialNum:') || !s[1].startsWith('dateTime:')) return null;
  const row=new Float64Array(STRIDE);
  row[0]=parseClock(s[1].slice(9)); row[1]=Number(s[0].slice(11));
  for(let i=0;i<4;i++) {
    const k=2+i*17, a=2+i*16, n=i+1;
    const keys=[`iInsType${n}:`,`iInsOperationType${n}:`,`iEmergyType${n}:`,`lInsGrip${n}:`,`lArrInsPose${n}:`];
    if(s[k]!==`arm${n}`)return null;
    for(let j=0;j<5;j++) {
      if(!s[k+1+j].startsWith(keys[j]))return null;
      row[a+j]=Number(s[k+1+j].slice(keys[j].length));
    }
    for(let j=0;j<11;j++)row[a+5+j]=Number(s[k+6+j]);
  }
  return row.every(Number.isFinite)?row:null;
}
export function poseMatrix(v, columnMajor=false, inverse=false) {
  const m=new THREE.Matrix4().set(v[0],v[1],v[2],v[9],v[3],v[4],v[5],v[10],v[6],v[7],v[8],v[11],0,0,0,1);
  if(columnMajor) {
    const e=m.elements;
    [e[1],e[4]]=[e[4],e[1]];[e[2],e[8]]=[e[8],e[2]];[e[6],e[9]]=[e[9],e[6]];
  }
  if(inverse)m.invert();
  return m;
}
export function correction(p) {
  const m=new THREE.Matrix4();
  return m.compose(new THREE.Vector3(p.x,p.y,p.z),new THREE.Quaternion().setFromEuler(new THREE.Euler(...[p.rx,p.ry,p.rz].map(THREE.MathUtils.degToRad),'XYZ')),new THREE.Vector3(1,1,1));
}
export function cameraFrames(loggedPose,installation) {
  // Installation is fixed in the moving arm2 local frame, never a replacement
  // for the logged world pose. Three.js camera looks along -Z with Y up.
  const opticalFrame=loggedPose.clone().multiply(correction(installation));
  return {opticalFrame,renderFrame:opticalFrame.clone().multiply(new THREE.Matrix4().makeRotationX(Math.PI))};
}
export function validArm(data, row, arm) {
  const a=row*STRIDE+2+arm*16;
  if(data[a]===32767)return false;
  const v=data.subarray(a+4,a+16);
  if(v.every(x=>x===0))return false;
  const r=new THREE.Matrix3().set(...v.subarray(0,9));
  return Math.abs(r.determinant()-1)<0.001;
}
export function locate(data,t,start=0,end=data.length/STRIDE-1) {
  let l=start,r=end;
  while(l<r){const mid=Math.ceil((l+r)/2);if(data[mid*STRIDE]<=t)l=mid;else r=mid-1;}
  const next=Math.min(end,l+1),dt=data[next*STRIDE]-data[l*STRIDE];
  return {a:l,b:next,alpha:dt>0&&dt<=0.15?THREE.MathUtils.clamp((t-data[l*STRIDE])/dt,0,1):0};
}
export function logCoverage(data,segments,t,maxGap=.15){
  if(!data||!Number.isFinite(t))return null;
  for(let i=0;i<segments.length;i++){
    const s=segments[i];
    if(t>=s.t0-1e-7&&t<=s.t1+1e-7){const p=locate(data,t,s.start,s.end),dt=data[p.b*STRIDE]-data[p.a*STRIDE];if(t>data[p.a*STRIDE]+1e-7&&dt>maxGap)return null;return {...p,segment:i};}
    const next=segments[i+1];if(!next||t<=s.t1||t>=next.t0)continue;
    const gap=next.t0-s.t1,a=s.end,b=next.start;
    // Small file-boundary sampling gaps may interpolate. Session resets may not.
    if(gap>0&&gap<=maxGap&&data[b*STRIDE+1]>data[a*STRIDE+1])return {a,b,alpha:(t-s.t1)/gap,segment:i};
  }
  return null;
}
export function sampleArm(data, indices, arm, convention) {
  const {a,b,alpha}=indices, off=a*STRIDE+2+arm*16, next=b*STRIDE+2+arm*16;
  if(!validArm(data,a,arm))return null;
  const m=poseMatrix(data.subarray(off+4,off+16),convention.column,convention.inverse);
  const pos=new THREE.Vector3(),q=new THREE.Quaternion(),scale=new THREE.Vector3();m.decompose(pos,q,scale);
  let grip=data[off+3];
  if(alpha>0&&data[off]===data[next]&&validArm(data,b,arm)) {
    const p2=new THREE.Vector3(),q2=new THREE.Quaternion();poseMatrix(data.subarray(next+4,next+16),convention.column,convention.inverse).decompose(p2,q2,scale);
    pos.lerp(p2,alpha);q.slerp(q2,alpha);grip=THREE.MathUtils.lerp(grip,data[next+3],alpha);
  }
  pos.multiplyScalar(convention.scale);
  return {matrix:new THREE.Matrix4().compose(pos,q,new THREE.Vector3(1,1,1)),grip,type:data[off],op:data[off+1],energy:data[off+2]};
}
export function intrinsicsCamera(camera,w,h,cfg) {
  const fy=cfg.advanced?cfg.fy:h/(2*Math.tan(THREE.MathUtils.degToRad(cfg.fov)/2));
  const fx=cfg.advanced?cfg.fx:fy;
  const cx=cfg.cx*w/100,cy=cfg.cy*h/100,n=cfg.near,f=cfg.far;
  camera.near=n;camera.far=f;
  camera.projectionMatrix.makePerspective(-cx*n/fx,(w-cx)*n/fx,cy*n/fy,-(h-cy)*n/fy,n,f);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return {fx,fy,cx,cy};
}
