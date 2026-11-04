import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
const worker = await build({entryPoints:['src/parser.worker.js'],bundle:true,write:false,format:'iife',minify:true});
const app = await build({entryPoints:['src/app.js'],bundle:true,write:false,format:'iife',minify:true,define:{PARSER_WORKER:JSON.stringify(worker.outputFiles[0].text)}});
const html = await readFile('src/index.html','utf8');
const css = await readFile('src/style.css','utf8');
await writeFile('index.html',html.replace('/* APP_CSS */',css).replace('/* APP_JS */',app.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')));
console.log('Built offline index.html — double-click to open.');
