export const DISCOVERY = 'https://raw.githubusercontent.com/robinags06-star/lunagpt-connection/main/connection.json';
export const defaults = Object.freeze({themeId:'luna',shortTermMemory:true,haptics:true,largeText:false,confirmDelete:false,reduceMotion:false,temperature:0.7,topK:40,topP:0.9,voiceName:'',discoveryUrl:DISCOVERY,manualUrl:''});
export const themes = {
  luna:['#141311','#1a1814','#28241e','#463f36','#f6f1e6','#c8bba6','#d2be96','#e4d4ae','#342e26','#e8c98a','#3a2e22'],
  ember:['#140806','#2a100c','#3e1a12','#8a4630','#fbe6d8','#e4b09a','#ff8a3d','#ffc49a','#542418','#ff5a1f','#5a160c'],
  midnight:['#060910','#0a1224','#15243c','#3c5680','#e6eef8','#9aadc8','#8eb6f0','#c9daf6','#1a3054','#3a6fe0','#101c38'],
  aurora:['#03110e','#06201a','#0e322a','#2a6e5c','#e4f8f2','#8ec8b8','#4ee0bc','#b6f3e2','#123c32','#1ec898','#063028'],
  dusk:['#120810','#22101c','#381828','#7a4060','#fbeaf4','#d4a8c0','#f090c4','#f8c8dc','#4a2034','#d050a8','#3a1028'],
  pine:['#07100a','#0e1c12','#183024','#3e6848','#e8f6ea','#a4c8ae','#b6d45a','#d8eca0','#1c3c26','#6aaa30','#102818']
};
export function settingsFrom(value={}) {
  const s={...defaults};
  if(!value || typeof value!=='object') return s;
  if(Object.hasOwn(themes,value.themeId)) s.themeId=value.themeId;
  for(const k of ['shortTermMemory','haptics','largeText','confirmDelete','reduceMotion']) if(typeof value[k]==='boolean') s[k]=value[k];
  for(const [k,lo,hi] of [['temperature',0,2],['topK',0,200],['topP',0,1]]) if(typeof value[k]==='number' && Number.isFinite(value[k])) s[k]=Math.max(lo,Math.min(hi,value[k]));
  s.topK=Math.round(s.topK);
  for(const k of ['voiceName','discoveryUrl','manualUrl']) if(typeof value[k]==='string') s[k]=value[k];
  return s;
}
export function initialSettings(meta){
  const s=settingsFrom(meta?.settings);
  // Apply the user's new defaults once to existing installations, then keep edits.
  if((meta?.settingsVersion||0)<2)Object.assign(s,{shortTermMemory:true,temperature:0.7,topP:0.9,topK:40});
  return s;
}
export function uuid(){return globalThis.crypto?.randomUUID?.() || 'luna-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
export function newChat(){return {id:uuid(),title:'New chat',updated:Date.now(),created:Date.now(),draft:'',messages:[]};}
export function generationPayload(text,messages,settings){
  const s=settingsFrom(settings);
  const payload={cmd:'generate',text,temperature:s.temperature,top_k:s.topK,top_p:s.topP};
  if(s.shortTermMemory){
    const turns=[];
    // Exact pairing rules from minigpt_app/lib/data/app_settings.dart.
    let mine=null;
    for(const message of messages){
      const content=message.content.trim();if(!content)continue;
      if(message.role==='user')mine=content;
      else if(message.role==='assistant'&&mine!==null){turns.push({role:'user',text:mine},{role:'assistant',text:content});mine=null;}
    }
    if(turns.length)payload.turns=[...turns,{role:'user',text}];
  }
  return payload;
}
export function websocketAddress(value,pageProtocol='https:'){
  const u=new URL(value);
  if(!['http:','https:','ws:','wss:'].includes(u.protocol)) throw new Error('Use an http, https, ws or wss address.');
  if(u.username || u.password) throw new Error('Enter the password in the password field.');
  u.protocol=['https:','wss:'].includes(u.protocol)?'wss:':'ws:';
  if(pageProtocol==='https:' && u.protocol!=='wss:') throw new Error('This page uses HTTPS. The server must use a secure wss/https address.');
  u.pathname='/ws';u.search='';u.hash='';return u.href;
}
export function discoveryCandidates(value){
  const raw=new URL(value);
  if(!['http:','https:'].includes(raw.protocol)) throw new Error('Invalid connection.json address.');
  const candidates=[];
  const p=raw.pathname.split('/').filter(Boolean);
  if(raw.hostname==='raw.githubusercontent.com' && p.length>=4){
    const api=new URL(`https://api.github.com/repos/${p[0]}/${p[1]}/contents/${p.slice(3).join('/')}`);api.searchParams.set('ref',p[2]);candidates.push(api.href);
  }
  raw.searchParams.set('t',String(Date.now()));candidates.push(raw.href);return candidates;
}
export function splitFences(text){
  const result=[];const lines=String(text).replace(/\r\n/g,'\n').split('\n');let code=null;let prose=[];
  const flush=()=>{if(prose.length){result.push({type:'text',text:prose.join('\n')});prose=[];}};
  for(const line of lines){
    if(code){if(/^\s*```\s*$/.test(line)){result.push({...code,text:code.lines.join('\n')});code=null;}else code.lines.push(line);}
    else {const m=line.match(/^\s*```(.*)$/);if(m){flush();code={type:'code',language:m[1].trim()||'code',lines:[]};}else prose.push(line);}
  }
  if(code) result.push({...code,text:code.lines.join('\n')});flush();return result;
}
export function validateBackup(data){
  if(!data || data.format!=='lunagpt-web' || data.version!==1 || !Array.isArray(data.chats)) throw new Error('This is not a LunaGPT Web backup.');
  const seen=new Set();
  const chats=data.chats.map(c=>{
    if(!c || typeof c.id!=='string' || !c.id || seen.has(c.id) || typeof c.title!=='string' || !Array.isArray(c.messages)) throw new Error('The backup contains an invalid conversation.');
    seen.add(c.id);
    return {id:c.id,title:c.title.slice(0,160),created:Number(c.created)||Date.now(),updated:Number(c.updated)||Date.now(),draft:typeof c.draft==='string'?c.draft:'',messages:c.messages.map(m=>{
      if(!m || !['user','assistant'].includes(m.role) || typeof m.content!=='string') throw new Error('The backup contains an invalid message.');
      return {id:typeof m.id==='string'?m.id:uuid(),role:m.role,content:m.content,state:['done','stopped','interrupted','error'].includes(m.state)?m.state:'interrupted',model:typeof m.model==='string'?m.model:'',note:typeof m.note==='string'?m.note:''};
    })};
  });
  return {chats,settings:settingsFrom(data.settings)};
}
