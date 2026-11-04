import {build} from 'esbuild';
import {readdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import vm from 'node:vm';
const bundle=await build({entryPoints:['src/parser.worker.js'],bundle:true,format:'iife',write:false});
for(const name of (await readdir('data')).filter(n=>n.endsWith('.txt')).sort()){
  const path=`data/${name}`;let result;
  const self={postMessage(value){if(value.kind==='done'||value.kind==='error')result=value;}};
  vm.runInContext(bundle.outputFiles[0].text,vm.createContext({self,TextDecoder,Float64Array,AbortController,console}));
  await self.onmessage({data:{file:{size:(await stat(path)).size,stream:()=>Readable.toWeb(createReadStream(path))}}});
  if(result.kind==='error')throw Error(result.message);
  console.log(JSON.stringify({file:name,rows:result.count,recommendations:result.recommendations}));
}
