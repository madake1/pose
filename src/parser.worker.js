import {STRIDE,parseLine} from './core.js';
import {recommendSetup} from './recommend.js';
self.onmessage=async ({data:{file,files}})=>{
  try {
    const sources=files??[file],totalBytes=sources.reduce((s,f)=>s+f.size,0);let fileIndex=0;
    const blocks=[];let block=new Float64Array(8192*STRIDE),used=0,count=0,bad=0,bytes=0,last=null,segment=null;
    const segments=[],zero=[0,0,0,0],invalid=[0,0,0,0];
    const accept=line=>{
      if(!line.trim())return;
      const row=parseLine(line);if(!row){bad++;return;}
      if(!segment||segment.fileIndex!==fileIndex||row[0]-last[0]>1||row[0]<last[0]||row[1]<=last[1]) {
        segment={start:count,end:count,t0:row[0],t1:row[0],fileIndex,fileName:sources[fileIndex].name??''};segments.push(segment);
      }
      segment.end=count;segment.t1=row[0];
      for(let i=0;i<4;i++) {const a=2+16*i;if(row[a]===32767)invalid[i]++;if(row.subarray(a+4,a+16).every(x=>x===0))zero[i]++;}
      if(used===8192){blocks.push(block);block=new Float64Array(8192*STRIDE);used=0;}
      block.set(row,used++*STRIDE);count++;last=row;
    };
    let lastReport=0;
    for(fileIndex=0;fileIndex<sources.length;fileIndex++){
    const reader=sources[fileIndex].stream().getReader(),decoder=new TextDecoder();let carry='';
    while(true) {
      const {value,done}=await reader.read();if(done)break;
      bytes+=value.byteLength;const text=carry+decoder.decode(value,{stream:true}),lines=text.split('\n');carry=lines.pop();lines.forEach(accept);
      if(bytes-lastReport>1024*1024){self.postMessage({kind:'progress',progress:bytes/totalBytes,rows:count});lastReport=bytes;}
    }
    carry+=decoder.decode();if(carry.trim())accept(carry);
    }
    const data=new Float64Array(count*STRIDE);let offset=0;for(const b of blocks){data.set(b,offset);offset+=b.length;}data.set(block.subarray(0,used*STRIDE),offset);
    const recommendations=segments.map(s=>recommendSetup(data,s));
    self.postMessage({kind:'done',data,segments,bad,zero,invalid,count,recommendations},[data.buffer]);
  }catch(e){self.postMessage({kind:'error',message:e.message});}
};
