import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsFrom,initialSettings,defaults,generationPayload,websocketAddress,discoveryCandidates,splitFences,validateBackup} from '../core.js';

test('settings clamp inputs and reject unknown themes',()=>{
  assert.deepEqual(settingsFrom(null),defaults);
  const s=settingsFrom({themeId:'__proto__',temperature:9,topK:2.4,topP:NaN,haptics:'false'});
  assert.equal(s.themeId,'luna');assert.equal(s.temperature,2);assert.equal(s.topK,2);assert.equal(s.topP,.9);assert.equal(s.haptics,true);
});
test('memory matches the native app pairing including nonempty stopped replies',()=>{
  const history=[{role:'user',content:'A'},{role:'assistant',content:'B',state:'done'},{role:'user',content:'C'},{role:'assistant',content:'partial',state:'interrupted'}];
  const p=generationPayload('D',history,{shortTermMemory:true,temperature:.3,topK:11,topP:.8});
  assert.deepEqual(p.turns,[{role:'user',text:'A'},{role:'assistant',text:'B'},{role:'user',text:'C'},{role:'assistant',text:'partial'},{role:'user',text:'D'}]);assert.equal(p.top_k,11);
  assert.equal(generationPayload('D',history,{...defaults,shortTermMemory:false}).turns,undefined);
  assert.deepEqual(generationPayload('Hello',[],defaults),{cmd:'generate',text:'Hello',temperature:.7,top_k:40,top_p:.9});
});
test('new defaults apply once and edited settings persist afterward',()=>{
  const old={settings:{shortTermMemory:false,temperature:.3,topK:7,topP:.95,themeId:'midnight'}};
  assert.deepEqual(initialSettings(old),{...defaults,themeId:'midnight'});
  const custom={...old,settingsVersion:2};assert.equal(initialSettings(custom).temperature,.3);assert.equal(initialSettings(custom).shortTermMemory,false);
});
test('fence labels support text, arbitrary names, multiple blocks and CRLF',()=>{
  const blocks=splitFences('```text\r\nhi\r\n```\r\n```custom language\r\n  keep spaces\r\n```');
  assert.equal(blocks[0].language,'text');assert.equal(blocks[1].language,'custom language');assert.equal(blocks[1].text,'  keep spaces');
});
test('websocket URL strips old secrets and requires TLS on secure pages',()=>{
  assert.equal(websocketAddress('https://example.com/api/status?token=old#foo'),'wss://example.com/ws');
  assert.throws(()=>websocketAddress('http://example.com'));assert.throws(()=>websocketAddress('javascript:alert(1)'));
  assert.equal(websocketAddress('http://localhost:9999','http:'),'ws://localhost:9999/ws');
});
test('discovery prefers uncached contents API',()=>{const urls=discoveryCandidates(defaults.discoveryUrl);assert.match(urls[0],/api.github.com\/repos\/robinags06-star\/lunagpt-connection\/contents\/connection.json/);assert.match(urls[1],/\?t=/);});
test('streaming fences preserve indentation, literal HTML and mixed blocks',()=>{
  const parts=splitFences('Hello\n\n```python\ndef f():\n    return "<script>"\n```\nAfter\n```python\nprint(1)');
  assert.equal(parts.length,4);assert.equal(parts[1].language,'python');assert.equal(parts[1].text,'def f():\n    return "<script>"');assert.equal(parts[3].text,'print(1)');
});
test('backup validates before importing and marks unfinished output interrupted',()=>{
  const b={format:'lunagpt-web',version:1,chats:[{id:'one',title:'A',messages:[{role:'assistant',content:'test',state:'streaming'}]}]};
  assert.equal(validateBackup(b).chats[0].messages[0].state,'interrupted');
  assert.throws(()=>validateBackup({...b,chats:[...b.chats,...b.chats]}));assert.throws(()=>validateBackup({chats:[]}));
});
