import {parseClock} from './core.js';

export const CONFIG_STORAGE_KEY='pose-lab-parameters-v1';
export function configurationDocument(config,view={speed:1,overlay:true}){
  return {schema:'pose-lab-v1',savedAt:new Date().toISOString(),config:structuredClone(config),view:structuredClone(view)};
}
export function readConfiguration(document,defaults,controls){
  if(document?.schema!=='pose-lab-v1'||!document.config||typeof document.config!=='object'||Array.isArray(document.config))throw Error('不支持的参数文件');
  const config=structuredClone(defaults);
  for(const [path,control]of controls){
    const keys=path.split('.'),value=keys.reduce((v,k)=>v?.[k],document.config),original=keys.reduce((v,k)=>v[k],defaults);
    if(value===undefined)continue;
    const freeObserver=/^observer\.[xyz]$/.test(path);
    if(typeof value!==typeof original||(typeof value==='number'&&(!Number.isFinite(value)||(!freeObserver&&(value<control.min||value>control.max))))||(control.options&&!control.options.includes(value)))throw Error(`参数 ${path} 无效或超出范围`);
    const key=keys.pop();keys.reduce((v,k)=>v[k],config)[key]=value;
  }
  const zero=document.config.sync?.zero??defaults.sync.zero;
  if(typeof zero!=='string'||(zero&&!Number.isFinite(parseClock(zero))))throw Error('视频起始时间无效');
  config.sync.zero=zero;
  const view={speed:document.view?.speed??1,overlay:document.view?.overlay??true};
  if(![.25,.5,1,2].includes(view.speed)||typeof view.overlay!=='boolean')throw Error('播放或叠加参数无效');
  return {config,view};
}
export async function saveConfigurationToDirectory(document,pickDirectory,filename=`pose-lab-parameters-${new Date().toISOString().replace(/[:.]/g,'-')}.json`){
  const folder=await pickDirectory({id:'pose-lab-parameter-folder',mode:'readwrite',startIn:'documents'});
  let name=filename,index=1;
  // Always create a new parameter file; do not overwrite earlier exports.
  while(true){try{await folder.getFileHandle(name);name=filename.replace(/\.json$/,`-${index++}.json`);}catch(e){if(e.name==='NotFoundError')break;throw e;}}
  const handle=await folder.getFileHandle(name,{create:true}),stream=await handle.createWritable();
  try{await stream.write(JSON.stringify(document,null,2));await stream.close();}catch(error){try{await stream.abort();}catch{}throw error;}
  return {folder:folder.name,name};
}
