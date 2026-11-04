import {createReadStream} from 'node:fs';
import {readdir,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import * as THREE from 'three';
import {parseLine,validArm,poseMatrix,clock} from '../src/core.js';

const report={units:{translation:'log position units (assumed mm)',rotation:'degrees'},method:'Only valid arm2 records; break at invalid records, nonpositive time, gaps >150ms, serial reset, or instrument type change. Compare roughly 1-second windows. Noise-screening thresholds: 0.5 position units or 0.5 degrees per window.',files:[]};
for(const file of (await readdir('data')).filter(n=>n.endsWith('.txt')).sort()){
  const summary={file,rows:0,valid:0,invalid:0,continuousRuns:0,positionMin:[Infinity,Infinity,Infinity],positionMax:[-Infinity,-Infinity,-Infinity],operations:{},windows:0,translationWindows:0,rotationWindows:0,topWindows:[]};
  let previous=null,anchor=null,baseline=null,maxStepTranslation=0,maxStepRotation=0;
  summary.maxAdjacentTranslation=0;summary.maxAdjacentRotationDeg=0;summary.smoothExample=null;
  summary.maxDisplacementFromRunStart=0;summary.maxRotationFromRunStartDeg=0;
  for await(const line of createInterface({input:createReadStream(`data/${file}`),crlfDelay:Infinity})){
    const row=parseLine(line);if(!row)continue;summary.rows++;
    const op=row[19];summary.operations[op]=(summary.operations[op]??0)+1;
    if(!validArm(row,0,1)){summary.invalid++;previous=anchor=baseline=null;continue;}
    summary.valid++;
    const matrix=poseMatrix(row.subarray(22,34),true),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();matrix.decompose(position,rotation,scale);
    const current={t:row[0],serial:row[1],type:row[18],op,position,rotation};
    for(let j=0;j<3;j++){summary.positionMin[j]=Math.min(summary.positionMin[j],row[31+j]);summary.positionMax[j]=Math.max(summary.positionMax[j],row[31+j]);}
    const dt=previous?current.t-previous.t:Infinity;
    if(!previous||dt<=0||dt>.15||current.serial<=previous.serial||current.type!==previous.type){anchor=baseline=current;maxStepTranslation=maxStepRotation=0;summary.continuousRuns++;}
    else{const dp=position.distanceTo(previous.position),dr=THREE.MathUtils.radToDeg(rotation.angleTo(previous.rotation));maxStepTranslation=Math.max(maxStepTranslation,dp);maxStepRotation=Math.max(maxStepRotation,dr);summary.maxAdjacentTranslation=Math.max(summary.maxAdjacentTranslation,dp);summary.maxAdjacentRotationDeg=Math.max(summary.maxAdjacentRotationDeg,dr);}
    summary.maxDisplacementFromRunStart=Math.max(summary.maxDisplacementFromRunStart,position.distanceTo(baseline.position));
    summary.maxRotationFromRunStartDeg=Math.max(summary.maxRotationFromRunStartDeg,THREE.MathUtils.radToDeg(rotation.angleTo(baseline.rotation)));
    if(current.t-anchor.t>=1){
      const translation=position.distanceTo(anchor.position),rotationDeg=THREE.MathUtils.radToDeg(rotation.angleTo(anchor.rotation));summary.windows++;if(translation>.5)summary.translationWindows++;if(rotationDeg>.5)summary.rotationWindows++;
      const event={start:clock(anchor.t),end:clock(current.t),duration:current.t-anchor.t,translation,rotationDeg,maxStepTranslation,maxStepRotationDeg:maxStepRotation,operationStart:anchor.op,operationEnd:op};
      if(maxStepTranslation<2&&maxStepRotation<2&&(translation>.5||rotationDeg>.5)&&(!summary.smoothExample||translation+rotationDeg>summary.smoothExample.translation+summary.smoothExample.rotationDeg))summary.smoothExample=event;
      summary.topWindows.push(event);summary.topWindows.sort((a,b)=>(b.translation+b.rotationDeg)-(a.translation+a.rotationDeg));summary.topWindows.length=Math.min(summary.topWindows.length,3);anchor=current;maxStepTranslation=maxStepRotation=0;
    }
    previous=current;
  }
  if(!summary.valid)summary.positionMin=summary.positionMax=null;
  report.files.push(summary);console.log(JSON.stringify(summary));
}
await writeFile('camera-motion-report.json',JSON.stringify(report,null,2));
