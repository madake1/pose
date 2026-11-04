import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {STRIDE,clock,parseClock,sampleArm,correction,intrinsicsCamera,jawOpening,cameraFrames,validArm,logCoverage,logTimeAtVideo,videoTimeAtLog,elapsed} from './core.js';
import {recommendSetup} from './recommend.js';

const $=id=>document.getElementById(id);
const defaults={
  observer:{azimuth:35,elevation:28,distance:650,x:0,y:-160,z:1050,roll:0},
  camera:{x:0,y:0,z:0,rx:0,ry:0,rz:0,fov:65,advanced:false,fx:1100,fy:1100,cx:50,cy:50,near:1,far:1200,k1:0,k2:0,k3:0,p1:0,p2:0},
  convention:{column:true,inverse:false,scale:1},
  bases:Object.fromEntries([1,2,3,4].map(n=>[n,{x:0,y:0,z:0,rx:0,ry:0,rz:0}])),
  arms:Object.fromEntries([1,3,4].map(n=>[n,{visible:true,x:0,y:0,z:0,rx:0,ry:0,rz:0,length:220,radius:3,jaw:22,width:2.2}])),
  display:{axes:true,frustum:true,directions:true,style:'outline',opacity:70,labels:true},
  sync:{zero:'18:30:37.317',offset:0,rate:1}
};
let cfg=structuredClone(defaults);
const state={data:null,segments:[],recommendations:[],segment:0,cameraStart:null,t:parseClock(defaults.sync.zero),row:-1,logCovered:false,files:[],worker:null,videoURL:null,videoReady:false,playing:false,videoSeeking:false,pendingSeek:null,requestId:0,manualOverlay:true,demo:false,lastFrame:0,lastVideoFrame:0,dirty:true,camValid:false,poses:[],frameTime:0};
const controlsMap=new Map();
const get=path=>path.split('.').reduce((v,k)=>v[k],cfg);
function put(path,value){const keys=path.split('.'),key=keys.pop();keys.reduce((v,k)=>v[k],cfg)[key]=value;}
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
function addGroup(title,num,open=false){const el=document.createElement('details');el.open=open;el.innerHTML=`<summary><span class="num">${num}</span>${title}</summary>`;$('parameters').append(el);return el;}
function note(parent,text){const el=document.createElement('div');el.className='hint';el.textContent=text;parent.append(el);}
function sub(parent,text){const el=document.createElement('div');el.className='subheading';el.textContent=text;parent.append(el);}
function number(parent,label,path,min,max,step,unit='') {
  const el=document.createElement('div');el.className='control';
  el.innerHTML=`<div class="control-label"><span>${label}</span><span class="unit">${unit}</span></div><div class="control-input"><input type="range" min="${min}" max="${max}" step="${step}" aria-label="${label}"><input type="number" min="${min}" max="${max}" step="${step}" aria-label="${label}数值"></div>`;
  const [range,input]=el.querySelectorAll('input');range.value=input.value=get(path);
  function change(e){if(!Number.isFinite(+e.target.value)||e.target.value==='')return;const v=THREE.MathUtils.clamp(+e.target.value,min,max);put(path,v);range.value=input.value=v;changed(path);}
  range.addEventListener('input',change);input.addEventListener('input',change);input.addEventListener('blur',()=>input.value=get(path));
  parent.append(el);controlsMap.set(path,{range,input,min,max});
}
function check(parent,label,path){const el=document.createElement('label');el.className='check-control';const text=document.createElement('span');text.textContent=label;const input=document.createElement('input');input.type='checkbox';input.checked=get(path);input.onchange=()=>{put(path,input.checked);changed(path);};el.append(text,input);parent.append(el);controlsMap.set(path,{input});}
function select(parent,label,path,options){const el=document.createElement('div');el.className='control';const labelEl=document.createElement('label');labelEl.className='control-label';labelEl.textContent=label;const input=document.createElement('select');for(const [v,t]of options)input.add(new Option(t,v));input.value=get(path);input.onchange=()=>{put(path,input.value);changed(path);};el.append(labelEl,input);parent.append(el);controlsMap.set(path,{input,options:options.map(x=>x[0])});}
function buttons(parent,items){const el=document.createElement('div');el.className='inline-buttons';for(const [text,fn]of items){const b=document.createElement('button');b.textContent=text;b.onclick=fn;el.append(b);}parent.append(el);}
function refreshControls(prefix=''){for(const [path,c]of controlsMap){if(!path.startsWith(prefix))continue;const v=get(path);if(document.activeElement!==c.input)c.input.type==='checkbox'?c.input.checked=v:c.input.value=v;if(c.range&&document.activeElement!==c.range)c.range.value=v;}}
function buildParameters(){
  $('parameters').replaceChildren();controlsMap.clear();
  const obs=addGroup('3D 观察视角','02',false);
  note(obs,'仅改变左侧观察视角；不影响相机投影。');
  for(const [label,key,min,max,step,unit]of [['水平角','azimuth',-180,180,1,'°'],['俯仰角','elevation',-89,89,1,'°'],['观察距离','distance',20,3000,1,'mm'],['画面旋转','roll',-180,180,1,'°'],['观察中心 X','x',-2000,2000,1,'mm'],['观察中心 Y','y',-2000,2000,1,'mm'],['观察中心 Z','z',-2000,3000,1,'mm']])number(obs,label,`observer.${key}`,min,max,step,unit);
  buttons(obs,[['默认',()=>resetObserver()],['正面',()=>setObserver({azimuth:0,elevation:0})],['侧面',()=>setObserver({azimuth:90,elevation:0})],['俯视',()=>setObserver({azimuth:0,elevation:89})],['看向器械',()=>fitTools()],['相机视角',()=>followCamera()]]);
  const cam=addGroup('投影相机 · arm2','03',true);
  note(cam,'随日志运动；以下是末端到光学坐标系的固定安装修正。光学轴：X 向右、Y 向下、Z 向前。');
  const motion=document.createElement('div');motion.id='cameraMotionReadout';motion.className='grip-readout';motion.style.whiteSpace='pre-line';motion.textContent='ARM2 动态位姿 · 等待日志';cam.append(motion);
  for(const k of ['x','y','z'])number(cam,`光心偏移 ${k.toUpperCase()}`,`camera.${k}`,-300,300,.1,'mm');
  for(const k of ['rx','ry','rz'])number(cam,`安装旋转 ${k.slice(1).toUpperCase()}`,`camera.${k}`,-180,180,.1,'°');
  number(cam,'垂直视场角','camera.fov',5,150,.1,'°');
  number(cam,'主点水平位置','camera.cx',0,100,.1,'% 图像宽');number(cam,'主点垂直位置','camera.cy',0,100,.1,'% 图像高');
  const adv=addGroup('相机高级参数','04');
  check(adv,'使用像素焦距（替代视场角）','camera.advanced');
  number(adv,'水平焦距 fx','camera.fx',20,10000,1,'px');number(adv,'垂直焦距 fy','camera.fy',20,10000,1,'px');
  note(adv,'像素焦距按视频原始分辨率解释。主点用百分比表示，中心为 50%。');
  number(adv,'近裁剪面','camera.near',.1,100, .1,'mm');number(adv,'远裁剪面','camera.far',101,5000,1,'mm');
  for(const k of ['k1','k2','k3','p1','p2'])number(adv,`畸变 ${k}`,`camera.${k}`,-.5,.5,.0001,'');
  note(adv,'畸变作用于投影和叠加。3D 中视锥展示无畸变的针孔范围；大畸变值仅用于试调。');
  const inst=addGroup('器械几何与安装','05');
  for(const n of [1,3,4]){
    const p=`arms.${n}`;sub(inst,`ARM ${n}`);check(inst,'显示器械',`${p}.visible`);
    for(const [label,key,min,max,step,unit]of [['杆长','length',10,600,1,'mm'],['杆半径','radius',.5,15,.1,'mm'],['夹爪长度','jaw',1,100,.5,'mm'],['夹爪宽度','width',.5,15,.1,'mm']])number(inst,label,`${p}.${key}`,min,max,step,unit);
    const grip=document.createElement('div');grip.className='grip-readout';grip.id=`gripReadout${n}`;grip.textContent='开合角由日志自动计算';inst.append(grip);
    for(const k of ['x','y','z'])number(inst,`安装偏移 ${k.toUpperCase()}`,`${p}.${k}`,-300,300,.1,'mm');
    for(const k of ['rx','ry','rz'])number(inst,`安装旋转 ${k.slice(1).toUpperCase()}`,`${p}.${k}`,-180,180,.1,'°');
  }
  note(inst,'朝向随日志逐帧更新。模型原点为夹爪铰链，杆沿 −Z，夹爪沿 +Z。日志角按总开口弧度解释，两爪各转一半；负角按闭合显示。');
  const sync=addGroup('视频与日志对齐','06',true);
  const e=document.createElement('div');e.className='control';e.innerHTML='<label class="control-label" for="zeroTime">视频起始绝对时间（视频 00:00）</label><input id="zeroTime" type="text" placeholder="18:30:37.317" autocomplete="off">';sync.append(e);
  $('zeroTime').value=cfg.sync.zero;$('zeroTime').onchange=()=>{const v=$('zeroTime').value.trim();if(v&&!Number.isFinite(parseClock(v))){notice('时间格式应为 HH:mm:ss.SSS。',true);return;}cfg.sync.zero=v;changed('sync.zero');};
  number(sync,'时间微调','sync.offset',-120,120,.001,'秒');number(sync,'时钟比例','sync.rate',.98,1.02,.000001,'日志秒 / 视频秒');
  buttons(sync,[['用当前画面对齐',()=>alignCurrent()],['跳至片段起点',()=>seekLog(activeSegment()?.t0??state.t)]]);
  note(sync,'本批视频从 18:30:37.317 开始。按绝对时间相减，不要求日志存在同一条时间戳。多选 TXT 可自动衔接；缺失日志时继续视频、隐藏投影。');
  const timing=document.createElement('div');timing.id='syncReadout';timing.className='grip-readout';timing.style.whiteSpace='pre-line';sync.append(timing);
  const absolute=document.createElement('div');absolute.className='control';absolute.innerHTML='<label class="control-label" for="absoluteSeek">跳至绝对时间</label><input id="absoluteSeek" type="text" placeholder="例如 18:40:00.000"><button id="seekAbsolute" style="margin-top:6px">跳转</button>';sync.append(absolute);
  $('seekAbsolute').onclick=()=>{const t=parseClock($('absoluteSeek').value);if(!Number.isFinite(t)){notice('请输入有效的绝对时间，例如 18:40:00.000。',true);return;}pause();seekLog(t);};
  const seek=document.createElement('div');seek.className='inline-buttons';seek.innerHTML='<input id="videoSeek" type="number" min="0" step="0.001" value="0" aria-label="独立定位视频秒数"><button id="seekVideo">视频定位（秒）</button>';sync.append(seek);
  $('seekVideo').onclick=()=>{if(!state.videoReady)return;pause();requestVideoSeek(THREE.MathUtils.clamp(+$('videoSeek').value,0,video.duration));};
  const disp=addGroup('显示与叠加','07');
  check(disp,'坐标轴','display.axes');check(disp,'相机视锥','display.frustum');check(disp,'器械方向线','display.directions');check(disp,'投影编号与尖端标记','display.labels');
  select(disp,'投影样式','display.style',[['outline','轮廓线'],['solid','实体'],['wire','线框']]);number(disp,'叠加透明度','display.opacity',0,100,1,'%');
  const conv=addGroup('日志坐标约定','08');
  check(conv,'旋转矩阵按列展开','convention.column');check(conv,'日志变换取逆','convention.inverse');
  number(conv,'位置单位 → 毫米','convention.scale',.001,1000,.001,'倍');
  note(conv,'初始按列展开：当前样本中可使器械位于相机前方，但仍待设备资料确认。默认末端到基座、毫米、四臂共享基座。');
  const bases=addGroup('各臂基座外参（高级）','09');
  note(bases,'若四臂基坐标不同，在此设置“各臂基座 → 公共基座”的固定变换。左乘日志位姿，与末端局部安装修正不同。');
  for(const n of [1,2,3,4]){sub(bases,`ARM ${n}${n===2?' · 相机':''}`);for(const k of ['x','y','z'])number(bases,`基座平移 ${k.toUpperCase()}`,`bases.${n}.${k}`,-3000,3000,.1,'mm');for(const k of ['rx','ry','rz'])number(bases,`基座旋转 ${k.slice(1).toUpperCase()}`,`bases.${n}.${k}`,-180,180,.1,'°');}
}

const colors={1:0x48d4b2,3:0xf3bd68,4:0x9b9bff};
const scene=new THREE.Scene();
scene.add(new THREE.AmbientLight(0xc5d9ef,2.1));
const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(100,-300,1800);scene.add(light);
const guides=new THREE.Group();scene.add(guides);
const grid=new THREE.GridHelper(1200,24,0x33495c,0x1b2c3d);grid.rotation.x=Math.PI/2;grid.position.set(0,-150,900);guides.add(grid);
const baseAxes=new THREE.AxesHelper(90);baseAxes.position.set(0,-150,1000);guides.add(baseAxes);
const observer=new THREE.PerspectiveCamera(48,1,.1,20000);observer.up.set(0,0,1);
const optical=new THREE.PerspectiveCamera(65,16/9,1,1200);optical.matrixAutoUpdate=false;scene.add(optical);
const helper=new THREE.CameraHelper(optical);helper.material.transparent=true;helper.material.opacity=.4;guides.add(helper);
const cameraBody=new THREE.Mesh(new THREE.BoxGeometry(16,12,22),new THREE.MeshStandardMaterial({color:0x6b9bc7,metalness:.4,roughness:.4}));guides.add(cameraBody);
const cameraAxes=new THREE.AxesHelper(45);guides.add(cameraAxes);
let renderer,projectRenderer,orbit;
try {
  renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.setClearColor(0x0c1420);$('sceneView').prepend(renderer.domElement);
  projectRenderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});projectRenderer.setPixelRatio(1);projectRenderer.setClearColor(0x000000,0);$('projectionView').prepend(projectRenderer.domElement);
  orbit=new OrbitControls(observer,renderer.domElement);orbit.enableDamping=false;orbit.minDistance=20;orbit.maxDistance=3000;orbit.screenSpacePanning=true;
}catch(e){notice('无法初始化 WebGL，请使用支持硬件加速的现代浏览器。'+e.message,true);throw e;}
const renderTarget=new THREE.WebGLRenderTarget(1,1,{format:THREE.RGBAFormat});
const postScene=new THREE.Scene(),postCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const distortion=new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,uniforms:{image:{value:renderTarget.texture},focal:{value:new THREE.Vector2(1,1)},principal:{value:new THREE.Vector2(.5,.5)},radial:{value:new THREE.Vector3()},tangent:{value:new THREE.Vector2()}},vertexShader:'varying vec2 tex; void main(){tex=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`precision highp float; varying vec2 tex; uniform sampler2D image; uniform vec2 focal; uniform vec2 principal; uniform vec3 radial; uniform vec2 tangent;
void main(){vec2 target=(vec2(tex.x,1.-tex.y)-principal)/focal;vec2 p=target;for(int i=0;i<8;i++){float r2=dot(p,p);float r=1.+radial.x*r2+radial.y*r2*r2+radial.z*r2*r2*r2;vec2 delta=vec2(2.*tangent.x*p.x*p.y+tangent.y*(r2+2.*p.x*p.x),tangent.x*(r2+2.*p.y*p.y)+2.*tangent.y*p.x*p.y);if(abs(r)<.01){gl_FragColor=vec4(0.);return;}p=(target-delta)/r;}vec2 uv=p*focal+principal;uv.y=1.-uv.y;if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)))){gl_FragColor=vec4(0.);return;}gl_FragColor=texture2D(image,uv);}`});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),distortion));
const tools={};
function part(geometry,material,parent){const mesh=new THREE.Mesh(geometry,material);const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,25),new THREE.LineBasicMaterial({color:material.color}));edges.visible=false;mesh.add(edges);parent.add(mesh);return mesh;}
for(const n of [1,3,4]) {
  const root=new THREE.Group();root.matrixAutoUpdate=false;root.visible=false;scene.add(root);
  const mat=new THREE.MeshStandardMaterial({color:colors[n],metalness:.45,roughness:.35});
  const rod=part(new THREE.CylinderGeometry(1,1,1,16),mat,root);rod.rotation.x=Math.PI/2;
  const joint=part(new THREE.SphereGeometry(1,12,8),mat,root);
  const pivots=[],jaws=[];
  for(const side of [-1,1]){const pivot=new THREE.Group();root.add(pivot);pivots.push(pivot);jaws.push(part(new THREE.BoxGeometry(1,1,1),mat,pivot));}
  const axis=new THREE.AxesHelper(35);guides.add(axis);
  const dir=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(),65,colors[n],12,5);guides.add(dir);
  tools[n]={root,rod,joint,pivots,jaws,mat,axis,dir};
}
const overlay=$('overlay'),ctx=overlay.getContext('2d');
const video=$('video');
let intrinsics={fx:1100,fy:1100,cx:960,cy:540},imageW=1920,imageH=1080,renderW=1,renderH=1;
function setObserver(values){Object.assign(cfg.observer,values);applyObserver();refreshControls('observer.');}
function resetObserver(){const rec=state.recommendations[state.segment];setObserver(structuredClone(rec?.observer??defaults.observer));}
function applyObserver(){const p=cfg.observer,a=THREE.MathUtils.degToRad(p.azimuth),e=THREE.MathUtils.degToRad(p.elevation);orbit.target.set(p.x,p.y,p.z);observer.position.set(p.x+p.distance*Math.cos(e)*Math.sin(a),p.y-p.distance*Math.cos(e)*Math.cos(a),p.z+p.distance*Math.sin(e));const forward=orbit.target.clone().sub(observer.position).normalize(),right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,0,1)).normalize(),up=new THREE.Vector3().crossVectors(right,forward).normalize(),roll=THREE.MathUtils.degToRad(p.roll);observer.up.copy(up.multiplyScalar(Math.cos(roll)).addScaledVector(right,Math.sin(roll)));observer.lookAt(orbit.target);orbit.update();state.dirty=true;}
let applyingObserver=false;
orbit.addEventListener('change',()=>{if(applyingObserver)return;const d=observer.position.clone().sub(orbit.target),r=d.length();Object.assign(cfg.observer,{x:orbit.target.x,y:orbit.target.y,z:orbit.target.z,distance:r,azimuth:THREE.MathUtils.radToDeg(Math.atan2(d.x,-d.y)),elevation:THREE.MathUtils.radToDeg(Math.asin(d.z/r))});refreshControls('observer.');state.dirty=true;});
function fitTools(){const points=Object.values(tools).filter(t=>t.root.visible).map(t=>new THREE.Vector3().setFromMatrixPosition(t.root.matrix));if(!points.length)return;const center=points.reduce((v,p)=>v.add(p),new THREE.Vector3()).divideScalar(points.length);setObserver({x:center.x,y:center.y,z:center.z,distance:450});}
function followCamera(){if(!state.camValid){notice('当前没有有效相机位姿。',true);return;}const forward=new THREE.Vector3(0,0,-1).transformDirection(optical.matrixWorld),pos=new THREE.Vector3().setFromMatrixPosition(optical.matrixWorld),target=pos.clone().addScaledVector(forward,250);orbit.target.copy(target);observer.position.copy(pos);observer.up.setFromMatrixColumn(optical.matrixWorld,1);observer.lookAt(target);orbit.update();state.dirty=true;}
function changed(path){
  if(path.startsWith('observer.')){applyingObserver=true;applyObserver();applyingObserver=false;}
  if(path.startsWith('sync.')){pause();updateSyncBadge();configureTimeline();if(isMapped()&&state.videoReady)syncFromVideo();}
  state.dirty=true;
}
function sizeViews(){
  const a=$('sceneView').getBoundingClientRect();if(a.width&&a.height){renderer.setSize(a.width,a.height);observer.aspect=a.width/a.height;observer.updateProjectionMatrix();}
  const p=$('projectionView').getBoundingClientRect(),scale=Math.min(p.width/imageW,p.height/imageH);renderW=Math.max(1,Math.round(imageW*scale));renderH=Math.max(1,Math.round(imageH*scale));
  projectRenderer.setSize(renderW,renderH);renderTarget.setSize(renderW,renderH);
  const o=$('overlayView').getBoundingClientRect(),s=Math.min(o.width/imageW,o.height/imageH);overlay.width=Math.max(1,Math.round(imageW*s* Math.min(devicePixelRatio,1.5)));overlay.height=Math.max(1,Math.round(imageH*s*Math.min(devicePixelRatio,1.5)));overlay.style.width=`${imageW*s}px`;overlay.style.height=`${imageH*s}px`;
  state.dirty=true;
}
const resizer=new ResizeObserver(sizeViews);for(const id of ['sceneView','projectionView','overlayView'])resizer.observe($(id));
function updateModel(n,pose){
  const tool=tools[n],p=cfg.arms[n];tool.root.visible=!!pose&&p.visible;
  tool.axis.visible=tool.root.visible&&cfg.display.axes;tool.dir.visible=tool.root.visible&&cfg.display.directions;
  if(!pose)return;
  tool.root.matrix.copy(pose.matrix).multiply(correction(p));tool.root.matrixWorldNeedsUpdate=true;
  tool.rod.scale.set(p.radius,p.length,p.radius);tool.rod.position.z=-p.length/2;
  tool.joint.scale.setScalar(p.radius*1.25);
  const opening=jawOpening(pose.grip,p.jaw);
  tool.opening=opening;tool.tip=new THREE.Vector3(0,0,p.jaw*Math.cos(opening.half));
  for(let i=0;i<2;i++){const side=i?1:-1;tool.pivots[i].position.x=side*p.width/2;tool.pivots[i].rotation.y=side*opening.half;tool.jaws[i].position.z=p.jaw/2;tool.jaws[i].scale.set(p.width,p.width,p.jaw);}
  tool.axis.matrixAutoUpdate=false;tool.axis.matrix.copy(tool.root.matrix);
  const origin=new THREE.Vector3().setFromMatrixPosition(tool.root.matrix),direction=new THREE.Vector3(0,0,1).transformDirection(tool.root.matrix);tool.dir.position.copy(origin);tool.dir.setDirection(direction);
}
function updateScene(){
  const indices=logCoverage(state.data,state.segments,state.t);
  state.row=indices?.a??-1;state.logCovered=!!indices;state.poses=indices?[0,1,2,3].map(i=>{const pose=sampleArm(state.data,indices,i,cfg.convention);if(pose)pose.matrix.premultiply(correction(cfg.bases[i+1]));return pose;}):[];
  for(const n of [1,3,4])updateModel(n,state.poses[n-1]);
  const cam=state.poses[1];state.camValid=!!cam;
  if(cam){const {opticalFrame,renderFrame}=cameraFrames(cam.matrix,cfg.camera);cameraBody.matrixAutoUpdate=false;cameraBody.matrix.copy(opticalFrame);cameraAxes.matrixAutoUpdate=false;cameraAxes.matrix.copy(opticalFrame);optical.matrix.copy(renderFrame);optical.matrixWorldNeedsUpdate=true;optical.updateMatrixWorld(true);}
  intrinsics=intrinsicsCamera(optical,imageW,imageH,cfg.camera);helper.update();
  helper.visible=state.camValid&&cfg.display.frustum;cameraBody.visible=state.camValid;cameraAxes.visible=state.camValid&&cfg.display.axes;baseAxes.visible=cfg.display.axes;
  const u=distortion.uniforms;u.focal.value.set(intrinsics.fx/imageW,intrinsics.fy/imageH);u.principal.value.set(intrinsics.cx/imageW,intrinsics.cy/imageH);u.radial.value.set(cfg.camera.k1,cfg.camera.k2,cfg.camera.k3);u.tangent.value.set(cfg.camera.p1,cfg.camera.p2);
  updateReadouts();
}
// Edges are children of meshes: keep the mesh object visible, suppress its material instead.
function projectionStyle(style){for(const t of Object.values(tools)){t.mat.wireframe=style==='wire';t.mat.visible=style!=='outline';t.root.traverse(o=>{if(o.isMesh){o.visible=true;for(const c of o.children)if(c.isLineSegments)c.visible=style==='outline';}});}}
function render(){
  updateScene();guides.visible=true;projectionStyle('solid');renderer.render(scene,observer);
  guides.visible=false;projectionStyle(cfg.display.style);projectRenderer.setRenderTarget(renderTarget);projectRenderer.clear();if(state.camValid)projectRenderer.render(scene,optical);
  projectRenderer.setRenderTarget(null);projectRenderer.clear();projectRenderer.render(postScene,postCamera);guides.visible=true;
  $('projectionMessage').hidden=state.camValid;$('projectionMessage').textContent=!state.data?'等待日志':!state.logCovered?'当前绝对时间缺少日志':'相机位姿无效（32767 / 缺失）';
  compose();state.dirty=false;
}
function distortedPoint(point){
  const p=point.clone().applyMatrix4(optical.matrixWorldInverse);if(-p.z<cfg.camera.near||-p.z>cfg.camera.far)return null;
  const x=p.x/-p.z,y=-p.y/-p.z,r=x*x+y*y,c=cfg.camera,k=1+c.k1*r+c.k2*r*r+c.k3*r*r*r;
  const dx=x*k+2*c.p1*x*y+c.p2*(r+2*x*x),dy=y*k+c.p1*(r+2*y*y)+2*c.p2*x*y;
  return [(intrinsics.fx*dx+intrinsics.cx)/imageW,(intrinsics.fy*dy+intrinsics.cy)/imageH];
}
function compose(){
  ctx.clearRect(0,0,overlay.width,overlay.height);
  if(state.videoReady&&video.readyState>=2)ctx.drawImage(video,0,0,overlay.width,overlay.height);
  const timeMatches=isMapped()&&Math.abs(logFromVideo(state.frameTime)-state.t)<.06;
  const canOverlay=state.videoReady&&state.camValid&&isMapped()&&withinVideo(state.t)&&timeMatches&&!state.videoSeeking;
  if(canOverlay&&state.manualOverlay){ctx.globalAlpha=cfg.display.opacity/100;ctx.drawImage(projectRenderer.domElement,0,0,overlay.width,overlay.height);ctx.globalAlpha=1;
    if(cfg.display.labels){ctx.font=`${Math.max(10,overlay.width/70)}px Segoe UI`;for(const n of [1,3,4]){const t=tools[n];if(!t.root.visible)continue;const p=t.tip.clone().applyMatrix4(t.root.matrix),uv=distortedPoint(p);if(!uv||uv.some(v=>v<0||v>1))continue;const x=uv[0]*overlay.width,y=uv[1]*overlay.height;ctx.fillStyle=`#${colors[n].toString(16).padStart(6,'0')}`;ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();ctx.fillText(`ARM ${n}`,x+6,y-6);}}
  }
  $('overlayEmpty').hidden=canOverlay;$('overlayEmpty').textContent=!state.videoReady?'等待视频与投影':!isMapped()?'请先设置视频与日志时间对齐':!withinVideo(state.t)?'当前日志时间不在视频范围内':state.videoSeeking?'正在定位视频…':!state.logCovered?'当前绝对时间缺少日志 · 视频继续播放':!timeMatches?'当前视频时刻没有对应日志':!state.camValid?'当前相机位姿无效':'';
}
function activeSegment(){return state.segments[state.segment];}
function isMapped(){return Number.isFinite(parseClock(cfg.sync.zero));}
function logFromVideo(t){return logTimeAtVideo(t,cfg.sync);}
function videoFromLog(t){return videoTimeAtLog(t,cfg.sync);}
function withinVideo(t){if(!isMapped()||!state.videoReady)return false;const v=videoFromLog(t);return v>=-.001&&v<=video.duration+.001;}
function updateSyncBadge(){const ok=isMapped();$('syncBadge').textContent=ok?`视频起点 ${clock(logFromVideo(0))}`:'尚未对齐';$('syncBadge').classList.toggle('warn',!ok);}
function updateReadouts(){
  $('logClock').textContent=(state.data||(state.videoReady&&isMapped()))?clock(state.t):'—';$('sampleText').textContent=state.data?state.row>=0?`${(state.row+1).toLocaleString()} / ${(state.data.length/STRIDE).toLocaleString()}`:'当前无日志':'等待日志';
  const seg=activeSegment();if(state.videoReady&&isMapped())$('timeline').value=THREE.MathUtils.clamp(videoFromLog(state.t),0,video.duration);else if(seg)$('timeline').value=state.t-seg.t0;
  const sampleTime=state.row>=0?state.data[state.row*STRIDE]:NaN;
  $('syncReadout').textContent=`视频已播放 ${elapsed(state.videoReady?video.currentTime:0)}\n当前绝对时间 ${clock(state.t)}\n${Number.isFinite(sampleTime)?`左侧日志样本 ${clock(sampleTime)} · 相差 ${((state.t-sampleTime)*1000).toFixed(1)} ms`:'当前时刻无日志覆盖'}`;
  $('videoClock').textContent=state.videoReady?`+${elapsed(video.currentTime)} · ${isMapped()?clock(logFromVideo(video.currentTime)):'未设置绝对时间'}`:'尚未选择视频';
  const camera=state.poses[1],motion=$('cameraMotionReadout');
  if(camera){const p=new THREE.Vector3().setFromMatrixPosition(camera.matrix);let text=`ARM2 随日志平移 / 旋转\n位置 (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) mm`;if(state.cameraStart!==null){const reference=sampleArm(state.data,{a:state.cameraStart,b:state.cameraStart,alpha:0},1,cfg.convention);if(reference){reference.matrix.premultiply(correction(cfg.bases[2]));const rp=new THREE.Vector3().setFromMatrixPosition(reference.matrix),q=new THREE.Quaternion().setFromRotationMatrix(camera.matrix),rq=new THREE.Quaternion().setFromRotationMatrix(reference.matrix);text+=`\n相对片段首个有效位姿：Δp ${p.distanceTo(rp).toFixed(2)} mm · ΔR ${THREE.MathUtils.radToDeg(q.angleTo(rq)).toFixed(2)}°`;}}motion.textContent=text;}else motion.textContent=state.data?'ARM2 当前位姿无效 · 暂停投影':'ARM2 动态位姿 · 等待日志';
  $('armStatus').replaceChildren();
  for(let i=0;i<4;i++){const pose=state.poses[i],el=document.createElement('div');el.className='arm-row';const dot=document.createElement('i');dot.className='arm-dot';dot.style.background=i===1?'#6b9bc7':`#${colors[i+1]?.toString(16)??'8996aa'}`;const name=document.createElement('span');name.textContent=`ARM ${i+1}${i===1?' · 相机':''}`;const status=document.createElement('span');status.className='arm-state';status.textContent=pose?`${pose.type} · OP ${pose.op} · E ${pose.energy}`:state.data?'无效 / 32767':'等待数据';el.append(dot,name,status);$('armStatus').append(el);}
  for(const n of [1,3,4]){const pose=state.poses[n-1],el=$(`gripReadout${n}`);if(!pose){el.textContent='当前器械无效，不渲染夹爪';continue;}const o=jawOpening(pose.grip,cfg.arms[n].jaw);const text=`日志 ${pose.grip.toFixed(4)} rad → 总开口 ${o.degrees.toFixed(1)}°\n两爪 ±${(o.degrees/2).toFixed(1)}° · 理想尖端开距 ${o.gap.toFixed(1)} mm${pose.grip<0?' · 负角按闭合显示':''}`;el.textContent=text;el.style.whiteSpace='pre-line';const live=document.createElement('div');live.className='arm-grip';live.textContent=`ARM ${n} · ${pose.grip.toFixed(3)} rad → ${o.degrees.toFixed(1)}°`;$('armStatus').append(live);}
  const angles=[];if(state.camValid){const f=new THREE.Vector3(0,0,-1).transformDirection(optical.matrixWorld);for(const n of [1,3,4])if(tools[n].root.visible){const d=new THREE.Vector3(0,0,1).transformDirection(tools[n].root.matrix);angles.push(`${n}↔相机 ${THREE.MathUtils.radToDeg(d.angleTo(f)).toFixed(1)}°`);}}
  for(const [n,m]of [[1,3],[1,4],[3,4]])if(tools[n].root.visible&&tools[m].root.visible){const a=new THREE.Vector3(0,0,1).transformDirection(tools[n].root.matrix),b=new THREE.Vector3(0,0,1).transformDirection(tools[m].root.matrix);angles.push(`${n}↔${m} ${THREE.MathUtils.radToDeg(a.angleTo(b)).toFixed(1)}°`);}
  $('angleText').textContent=angles.join(' · ')||'夹角：等待有效位姿';$('angleText').title=angles.join('\n');
  $('readout').textContent=state.row>=0?`序号 ${state.data[state.row*STRIDE+1]} · ${clock(sampleTime)}`:state.data?'当前绝对时间无日志，不保留旧位姿。':'加载日志后显示位姿。';
  $('lensLabel').textContent=cfg.camera.advanced?`fx ${cfg.camera.fx.toFixed(0)} / fy ${cfg.camera.fy.toFixed(0)} px`:`垂直视场角 ${cfg.camera.fov.toFixed(1)}°`;
  $('overlayLabel').textContent=`${{outline:'轮廓',solid:'实体',wire:'线框'}[cfg.display.style]} · ${cfg.display.opacity}%`;
  let inView=0,visible=0;for(const n of [1,3,4])if(tools[n].root.visible){visible++;const p=state.camValid?distortedPoint(tools[n].tip.clone().applyMatrix4(tools[n].root.matrix)):null;if(p&&p.every(x=>x>=0&&x<=1))inView++;}
  $('cameraBadge').textContent=state.camValid?`尖端视野内 ${inView}/${visible}`:'CAM 2 · 无效';
}

function applyRecommended(full=false,announce=true){
  const rec=state.recommendations[state.segment];
  pause();const sync=structuredClone(cfg.sync),previous=cfg;
  cfg=structuredClone(defaults);cfg.sync=sync;
  if(full){state.manualOverlay=true;$('toggleOverlay').textContent='隐藏投影';}
  if(!full){cfg.display=structuredClone(previous.display);for(const n of [1,3,4])for(const key of ['length','radius','jaw','width','visible'])cfg.arms[n][key]=previous.arms[n][key];}
  if(rec){cfg.convention.column=rec.column;Object.assign(cfg.camera,rec.camera);if(rec.observer)Object.assign(cfg.observer,rec.observer);}
  buildParameters();applyObserver();updateSyncBadge();state.dirty=true;
  $('recommendInfo').textContent=rec?.available?`推荐来源 ${clock(activeSegment()?.t0)}–${clock(activeSegment()?.t1)} · ${rec.pairs.toLocaleString()} 个有效相机—器械样本 · ${rec.column?'按列':'按行'}解释旋转矩阵。推荐视场角 ${rec.camera.fov.toFixed(1)}°；相机安装旋转 X ${rec.camera.rx.toFixed(1)}° / Y ${rec.camera.ry.toFixed(1)}° / Z ${rec.camera.rz.toFixed(1)}°。器械保持日志朝向。`:rec?.reason??'读取日志后自动推荐相机视轴与视场角；器械朝向直接使用日志。';
  configureTimeline();
  if(announce)notice(`${full?'所有几何与显示参数':'摆位参数'}已恢复到当前日志的推荐值，保留视频时间对齐。${rec?.available?'推荐依据日志几何关系，尚未做视频标定。':''}`);
}
function activateSegment(index){state.segment=index;const seg=activeSegment();if(!seg)return;state.cameraStart=null;for(let row=seg.start;row<=seg.end;row++)if(validArm(state.data,row,1)){state.cameraStart=row;break;}$('segmentSelect').value=index;}
function configureTimeline(){
  const seg=activeSegment(),master=state.videoReady&&isMapped();
  $('timeline').disabled=!master&&!seg;$('timeline').max=master?video.duration:seg?Math.max(.001,seg.t1-seg.t0):1;
  $('startLabel').textContent=master?clock(logFromVideo(0)):seg?clock(seg.t0):'起点';$('endLabel').textContent=master?clock(logFromVideo(video.duration)):seg?clock(seg.t1):'终点';
  $('durationText').textContent=master?elapsed(video.duration):seg?`${(seg.t1-seg.t0).toFixed(2)} s`:'—';
  $('timelineHint').textContent=master?'视频全长 · 绝对时间同步 · 缺口不暂停':'日志片段时间轴';
}
function setSegment(index,seek=true){activateSegment(index);const seg=activeSegment();if(!seg)return;state.t=seg.t0;applyRecommended(false,false);configureTimeline();if(seek)seekLog(seg.t0);state.dirty=true;}
function initializeTime(){
  if(!state.data){if(state.videoReady&&isMapped())syncFromVideo();configureTimeline();return;}
  const target=state.videoReady&&isMapped()?logFromVideo(video.currentTime):isMapped()?logFromVideo(0):state.segments[0].t0;
  let index=state.segments.findIndex(s=>target>=s.t0&&target<=s.t1);
  if(index<0)index=state.segments.findIndex(s=>s.t1>=target&&(!state.videoReady||s.t0<=logFromVideo(video.duration)));
  if(index<0)index=0;
  setSegment(index,false);
  if(state.videoReady&&isMapped()){
    const s=activeSegment(),t=Math.max(target,s.t0);
    if(withinVideo(t)&&t<=s.t1)seekLog(t);
    else{syncFromVideo();notice('所选 TXT 与当前视频时段没有交集，请选择其他日志或多选全部 TXT。',true);}
  }else if(isMapped()&&target>=activeSegment().t0&&target<=activeSegment().t1)state.t=target;
  configureTimeline();state.dirty=true;
}
function installData(result,name){state.data=result.data;state.segments=result.segments;state.recommendations=result.recommendations??result.segments.map(s=>recommendSetup(result.data,s,imageW/imageH));state.demo=!!result.demo;$('dataBadge').textContent=result.demo?'演示数据':`${result.count.toLocaleString()} 条记录`;$('segmentSelect').replaceChildren();result.segments.forEach((s,i)=>$('segmentSelect').add(new Option(`${i+1}. ${clock(s.t0)} → ${clock(s.t1)}${s.fileName?' · '+s.fileName:''}`,i)));$('segmentSelect').hidden=result.segments.length<=1;
  $('fileInfo').textContent=`${name} · ${result.count.toLocaleString()} 条 · ${result.segments.length} 个片段${result.bad?` · 跳过 ${result.bad} 行异常`:''}`;
  notice(result.demo?'当前为合成演示数据，用于检查视图和参数；请选择真实 TXT 进行分析。':`日志已载入。${result.segments.length>1?'按文件与时间断点分成多个片段，播放按绝对时间衔接。':''} ${isMapped()?'视频起点使用 '+cfg.sync.zero+'。':'请设置视频起始绝对时间。'}`);
  initializeTime();
}
async function loadLog(index){
  pause();state.worker?.terminate();const sources=index==='all'?state.files:[state.files[+index]];if(!sources.length||!sources[0])return;const name=index==='all'?`全部 ${sources.length} 个 TXT`:sources[0].name;const id=++state.requestId;
  state.data=null;state.segments=[];state.cameraStart=null;state.recommendations=[];$('recommendInfo').textContent='正在读取日志并计算推荐摆位…';state.dirty=true;configureTimeline();$('parseProgress').hidden=false;$('parseProgress').value=0;$('fileInfo').textContent=`正在解析 ${name}…`;
  const url=URL.createObjectURL(new Blob([PARSER_WORKER],{type:'text/javascript'}));const worker=new Worker(url);URL.revokeObjectURL(url);state.worker=worker;
  worker.onmessage=({data:r})=>{if(id!==state.requestId)return;if(r.kind==='progress'){$('parseProgress').value=r.progress;$('fileInfo').textContent=`解析中 ${Math.round(r.progress*100)}% · ${r.rows.toLocaleString()} 条`;}else{worker.terminate();state.worker=null;$('parseProgress').hidden=true;if(r.kind==='error'||!r.count){notice(r.message||'未找到有效记录，请选择本项目格式的 TXT。',true);return;}installData(r,name);}};
  worker.onerror=e=>{worker.terminate();state.worker=null;$('parseProgress').hidden=true;notice(`解析失败：${e.message}`,true);};worker.postMessage({files:sources});
}
function requestVideoSeek(t){state.pendingSeek=t;if(state.videoSeeking)return;if(Math.abs(video.currentTime-t)<.0001&&video.readyState>=2){state.pendingSeek=null;state.frameTime=video.currentTime;syncFromVideo();state.dirty=true;return;}state.videoSeeking=true;const target=state.pendingSeek;state.pendingSeek=null;video.currentTime=target;}
function seekLog(t){
  const seg=activeSegment();state.dirty=true;
  if(state.videoReady&&isMapped()){
    if(withinVideo(t)){state.t=t;syncFromVideo(videoFromLog(t));requestVideoSeek(THREE.MathUtils.clamp(videoFromLog(t),0,video.duration));}
    else{pause();syncFromVideo();notice(`${clock(t)} 不在视频覆盖的 ${clock(logFromVideo(0))}–${clock(logFromVideo(video.duration))} 内。`,true);}
  }else if(seg)state.t=THREE.MathUtils.clamp(t,seg.t0,seg.t1);
}
function syncFromVideo(time=video.currentTime){
  if(!isMapped())return;
  state.t=logFromVideo(time);const coverage=logCoverage(state.data,state.segments,state.t);
  if(coverage&&coverage.segment!==state.segment)activateSegment(coverage.segment);
  state.dirty=true;
}
function alignCurrent(){if(!state.data||!state.videoReady){notice('请先载入日志与视频，再进行时间对齐。',true);return;}pause();cfg.sync.zero=clock(state.t-video.currentTime*cfg.sync.rate-cfg.sync.offset);$('zeroTime').value=cfg.sync.zero;updateSyncBadge();notice(`已将视频 ${video.currentTime.toFixed(3)} 秒对应到日志 ${clock(state.t)}。请在其他时刻检查。`);state.dirty=true;}
function pause(){state.playing=false;video.pause();$('play').textContent='▶';state.dirty=true;}
async function play(){
  if(state.playing){pause();return;}
  if(state.videoReady){
    if(!isMapped()){notice('尚未设置时间对应关系；当前只播放视频，投影保持日志预览。');}
    state.playing=true;$('play').textContent='❚❚';video.playbackRate=+$('speed').value;
    try{await video.play();}catch(e){pause();notice(`视频播放失败：${e.message}`,true);}
  }else if(state.data){state.playing=true;$('play').textContent='❚❚';state.lastFrame=performance.now();}
}
function step(direction){pause();if(state.videoReady)requestVideoSeek(THREE.MathUtils.clamp(video.currentTime+direction/60,0,video.duration));else if(state.data)seekLog(state.t+direction/60);}

$('logFiles').onchange=e=>{const files=[...e.target.files].sort((a,b)=>a.name.localeCompare(b.name));if(!files.length)return;state.files=files;$('logSelect').replaceChildren();if(files.length>1)$('logSelect').add(new Option('全部日志 · 按绝对时间自动衔接','all'));files.forEach((f,i)=>$('logSelect').add(new Option(f.name,i)));loadLog(files.length>1?'all':'0');};
$('logSelect').onchange=e=>loadLog(e.target.value);
$('segmentSelect').onchange=e=>{pause();setSegment(+e.target.value);};
$('videoFile').onchange=e=>{const file=e.target.files[0];if(!file)return;pause();state.videoReady=false;state.videoSeeking=false;state.pendingSeek=null;if(state.videoURL)URL.revokeObjectURL(state.videoURL);state.videoURL=URL.createObjectURL(file);video.src=state.videoURL;video.load();$('videoInfo').textContent=`${file.name} · ${(file.size/1024**3).toFixed(2)} GB`;$('videoState').textContent='读取元数据…';};
video.addEventListener('loadedmetadata',()=>{state.videoReady=true;state.frameTime=video.currentTime;imageW=video.videoWidth||1920;imageH=video.videoHeight||1080;$('resolutionLabel').textContent=`${imageW} × ${imageH}`;$('videoState').textContent=`${imageW} × ${imageH} · ${video.duration.toFixed(2)} s`;sizeViews();initializeTime();});
video.addEventListener('loadeddata',()=>state.dirty=true);
video.addEventListener('seeked',()=>{state.videoSeeking=false;if(state.pendingSeek!==null&&Math.abs(state.pendingSeek-video.currentTime)>.0001){const t=state.pendingSeek;state.pendingSeek=null;requestVideoSeek(t);return;}state.pendingSeek=null;state.frameTime=video.currentTime;syncFromVideo();state.dirty=true;});
video.addEventListener('timeupdate',()=>{if(!('requestVideoFrameCallback'in video)&&!state.videoSeeking)syncFromVideo();state.dirty=true;});
video.addEventListener('ended',pause);video.addEventListener('error',()=>{state.videoReady=false;pause();notice('浏览器无法读取该视频编码。请选择兼容视频，或转换为 H.264 MP4 后重试。',true);});
if('requestVideoFrameCallback'in video){const frame=(now,meta)=>{state.lastVideoFrame=now;if(!state.videoSeeking){state.frameTime=meta.mediaTime;syncFromVideo(meta.mediaTime);state.dirty=true;}video.requestVideoFrameCallback(frame);};video.requestVideoFrameCallback(frame);}
$('timeline').addEventListener('input',e=>{pause();if(state.videoReady&&isMapped())seekLog(logFromVideo(+e.target.value));else if(activeSegment())seekLog(activeSegment().t0+ +e.target.value);});
$('play').onclick=play;$('stepBack').onclick=()=>step(-1);$('stepForward').onclick=()=>step(1);$('speed').onchange=()=>video.playbackRate=+$('speed').value;
$('homeView').onclick=resetObserver;$('muteVideo').onclick=()=>{video.muted=!video.muted;$('muteVideo').textContent=video.muted?'静音':'有声';};
$('toggleOverlay').onclick=()=>{state.manualOverlay=!state.manualOverlay;$('toggleOverlay').textContent=state.manualOverlay?'隐藏投影':'显示投影';state.dirty=true;};
$('exportConfig').onclick=()=>{const text=JSON.stringify({schema:'pose-lab-v1',config:cfg},null,2),url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='pose-lab-parameters.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('importConfig').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const doc=JSON.parse(await file.text());if(doc.schema!=='pose-lab-v1'||!doc.config)throw Error('不支持的参数文件');const next=structuredClone(defaults);for(const [path,c]of controlsMap){const value=path.split('.').reduce((v,k)=>v?.[k],doc.config);if(value===undefined)continue;const old=get(path);if(typeof value!==typeof old||(typeof value==='number'&&(!Number.isFinite(value)||value<c.min||value>c.max))||(c.options&&!c.options.includes(value)))throw Error(`参数 ${path} 无效或超出范围`);const keys=path.split('.'),key=keys.pop();keys.reduce((v,k)=>v[k],next)[key]=value;}const zero=doc.config.sync?.zero??'';if(typeof zero!=='string'||(zero&&!Number.isFinite(parseClock(zero))))throw Error('时间映射无效');next.sync.zero=zero;pause();cfg=next;buildParameters();applyObserver();updateSyncBadge();configureTimeline();if(state.videoReady&&isMapped())syncFromVideo();state.dirty=true;notice('参数已导入；文件仍从本机选择。');}catch(err){notice(`参数导入失败：${err.message}`,true);}e.target.value='';};
$('resetConfig').onclick=()=>applyRecommended(true);
$('restorePose').onclick=()=>applyRecommended(false);
document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))return;if(e.code==='Space'){e.preventDefault();play();}if(e.code==='ArrowLeft'){e.preventDefault();step(-1);}if(e.code==='ArrowRight'){e.preventDefault();step(1);}});
$('loadDemo').onclick=()=>{
  pause();state.worker?.terminate();state.requestId++;const count=1200,data=new Float64Array(count*STRIDE),start=18*3600+30*60;
  for(let i=0;i<count;i++){const t=i/60,row=i*STRIDE;data[row]=start+t;data[row+1]=i+1;for(let arm=0;arm<4;arm++){const a=row+2+arm*16;data[a]=[1028,3590,1025,1034][arm];data[a+1]=1;data[a+3]=.5+.3*Math.sin(t*1.5+arm);const pose=new THREE.Matrix4();if(arm===1)pose.makeTranslation(0,-150,900);else{const side=[-1,0,1,1.5][arm];pose.makeRotationY(-side*.35);pose.setPosition(side*55+Math.sin(t*.6+arm)*12,-150+Math.cos(t*.5+arm)*25,1100+Math.sin(t*.8+arm)*20);}const e=pose.elements;data.set([e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10],e[12],e[13],e[14]],a+4);}}
  // Store demo matrices in the currently selected serialization convention.
  if(cfg.convention.column)for(let i=0;i<count;i++)for(let arm=0;arm<4;arm++){const a=i*STRIDE+2+arm*16+4;for(const [u,v]of [[1,3],[2,6],[5,7]])[data[a+u],data[a+v]]=[data[a+v],data[a+u]];}
  installData({data,segments:[{start:0,end:count-1,t0:start,t1:start+(count-1)/60}],count,bad:0,demo:true},'合成演示');resetObserver();
};
buildParameters();applyObserver();sizeViews();updateSyncBadge();
function tick(now){requestAnimationFrame(tick);if(state.playing&&state.videoReady&&!state.videoSeeking&&now-state.lastVideoFrame>120){state.frameTime=video.currentTime;syncFromVideo();state.dirty=true;}if(state.playing&&!state.videoReady&&state.data){const dt=Math.min(.1,(now-state.lastFrame)/1000)*+$('speed').value;state.lastFrame=now;state.t+=dt;const seg=activeSegment();if(state.t>=seg.t1){state.t=seg.t1;pause();}state.dirty=true;}if(state.dirty)render();}
requestAnimationFrame(tick);
