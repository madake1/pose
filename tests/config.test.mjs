import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configurationDocument,readConfiguration,saveConfigurationToDirectory} from '../src/config.js';

const defaults={camera:{rx:0,fov:65},arms:{1:{jaw:22}},display:{axes:true,style:'outline'},sync:{zero:'18:30:37.317',offset:0,rate:1}};
const controls=new Map([['camera.rx',{min:-180,max:180}],['camera.fov',{min:5,max:150}],['arms.1.jaw',{min:1,max:100}],['display.axes',{}],['display.style',{options:['outline','solid','wire']}],['sync.offset',{min:-120,max:120}],['sync.rate',{min:.98,max:1.02}]]);
test('all settings and timing survive JSON export/import, including legacy v1 documents',()=>{
  const config=structuredClone(defaults);config.camera.rx=23;config.camera.fov=77;config.arms[1].jaw=35;config.sync.offset=.123;config.display.axes=false;
  const exported=configurationDocument(config,{speed:.5,overlay:false});
  const loaded=readConfiguration(JSON.parse(JSON.stringify(exported)),defaults,controls);
  assert.deepEqual(loaded.config,config);assert.deepEqual(loaded.view,{speed:.5,overlay:false});
  config.camera.rx=99;assert.equal(exported.config.camera.rx,23);
  assert.deepEqual(readConfiguration({schema:'pose-lab-v1',config:defaults},defaults,controls).view,{speed:1,overlay:true});
});
test('invalid import is rejected without mutating the current/default parameters',()=>{
  const original=structuredClone(defaults),bad=configurationDocument(defaults);bad.config.camera.fov=999;
  assert.throws(()=>readConfiguration(bad,defaults,controls),/超出范围/);assert.deepEqual(defaults,original);
  bad.config.camera.fov=65;bad.config.sync.zero='bad time';assert.throws(()=>readConfiguration(bad,defaults,controls),/时间无效/);
  assert.throws(()=>readConfiguration({schema:'pose-lab-v1',config:'bad'},defaults,controls),/不支持/);
});
test('folder export writes a new JSON and closes it; an earlier export is preserved',async()=>{
  const existing=new Map([['parameters.json','previous parameters']]);let picked=false,closed=false;
  const result=await saveConfigurationToDirectory(configurationDocument(defaults),async options=>{assert.equal(options.mode,'readwrite');picked=true;return {name:'chosen-folder',async getFileHandle(name,options){if(!existing.has(name)&&!options?.create)throw Object.assign(Error(),{name:'NotFoundError'});return {async createWritable(){return {async write(text){existing.set(name,text);},async close(){closed=true;}};}};}};},'parameters.json');
  assert.equal(picked,true);assert.equal(closed,true);assert.equal(result.folder,'chosen-folder');assert.equal(result.name,'parameters-1.json');assert.equal(existing.get('parameters.json'),'previous parameters');assert.deepEqual(JSON.parse(existing.get(result.name)).config,defaults);
});
test('cancelling folder selection performs no write and reports cancellation',async()=>{
  await assert.rejects(saveConfigurationToDirectory(configurationDocument(defaults),async()=>{throw Object.assign(Error('cancel'),{name:'AbortError'});}),e=>e.name==='AbortError');
});
