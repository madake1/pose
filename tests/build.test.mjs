import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

test('the shipped offline page contains one valid script with no expanded build placeholders',()=>{
  const root=new URL('../',import.meta.url);
  execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root,stdio:'pipe'});
  const html=readFileSync(new URL('index.html',root),'utf8');
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length,1);
  assert.doesNotMatch(html,/\/\* APP_(JS|CSS) \*\//);
  assert.doesNotThrow(()=>new Script(scripts[0][1],{filename:'index.html'}));
});
