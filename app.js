import {defaults,themes,settingsFrom,initialSettings,newChat,uuid,generationPayload,splitFences,validateBackup} from './core.js';
import {openStore} from './storage.js';
import {LunaConnection} from './connection.js';

const $=s=>document.querySelector(s);
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function button(text,action,cls=''){const b=node('button',cls,text);b.type='button';b.addEventListener('click',action);return b;}
function actionIcon(label,kind,action){
  const paths={copy:['M9 9h11v11H9z','M15 9V4H4v11h5'],read:['M11 5 6 9H3v6h3l5 4z','M15 8a6 6 0 0 1 0 8','M18 5a10 10 0 0 1 0 14'],regenerate:['M20 7v5h-5','M4 17v-5h5','M6.1 7a7 7 0 0 1 11.5-1L20 9','M4 15l2.4 3A7 7 0 0 0 18 17'],edit:['m16 3 5 5-12 12H4v-5z','m13 6 5 5']};
  const b=button('',action,'message-action'+(kind==='regenerate'?' regenerate-action':''));b.title=label;b.setAttribute('aria-label',label);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
  for(const d of paths[kind]){const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',d);svg.append(p);}b.append(svg);return b;
}
let settings={...defaults},chats=[],current=null,store,active=null,server={},online=false,paintTimer,toastTimer,stopTimer,voices=[];
const saveTimers=new Map();
let storageBroken=false,lastState='offline',unloading=false;
const messageNodes=new Map();
const privatePassword=typeof window.LUNA_PRIVATE_CONFIG?.password==='string'?window.LUNA_PRIVATE_CONFIG.password:'';
const conn=new LunaConnection({onState:connectionState,onMessage:serverMessage,onDisconnect:()=>finish('interrupted','Connection lost. You can regenerate the response.')});

function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4800);}
function announce(message){$('#announcer').textContent=message;}
function haptic(){if(settings.haptics)navigator.vibrate?.(8);}
function showDialog(id){const d=$('#'+id);if(!d.open)d.showModal();}
function storageError(){storageBroken=true;$('#save-status').textContent='Storage failed — export a backup';$('#save-status').style.color='#f1b6a6';toast('Could not save on this device. Export your conversations in Settings before closing the page.');}
async function saveChat(chat=current){if(!store||!chat)return;try{await store.saveChat(chat);}catch{storageError();}}
function saveMeta(){if(!store)return;store.saveMeta({settings,currentId:current?.id,settingsVersion:2}).catch(storageError);}
function queueSave(chat=current){if(!chat||saveTimers.has(chat.id))return;saveTimers.set(chat.id,setTimeout(()=>{saveTimers.delete(chat.id);saveChat(chat);},200));}
function rememberPassword(password,remember){try{localStorage.removeItem('luna-password');sessionStorage.removeItem('luna-password');(remember?localStorage:sessionStorage).setItem('luna-password',password);}catch{toast('The browser could not remember your password.');}}
function getPassword(){try{return sessionStorage.getItem('luna-password')||localStorage.getItem('luna-password')||privatePassword;}catch{return privatePassword;}}
function forgetPassword(){try{localStorage.removeItem('luna-password');sessionStorage.removeItem('luna-password');}catch{}}

function applyTheme(){
  const keys=['ink','canvas','surface','line','text','muted','accent','user','selected','wash','horizon'];
  themes[settings.themeId].forEach((v,i)=>document.documentElement.style.setProperty('--'+keys[i],v));
  document.documentElement.dataset.theme=settings.themeId;document.querySelector('meta[name=theme-color]').content=themes[settings.themeId][1];
  document.body.classList.toggle('large-text',settings.largeText);document.body.classList.toggle('reduce-motion',settings.reduceMotion);
  $('#memory-indicator').textContent=settings.shortTermMemory?'Short-term memory is on':'One thought at a time';
  document.querySelectorAll('[data-theme-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeChoice===settings.themeId)));
}
function setDrawer(open){$('#sidebar').classList.toggle('open',open);$('#scrim').hidden=!open;$('#open-sidebar').setAttribute('aria-expanded',String(open));if(open)$('#search').focus();else $('#open-sidebar').focus();}
function renderHistory(){
  const query=$('#search').value.toLocaleLowerCase();const list=$('#chat-list');list.replaceChildren();
  const all=chats.filter(c=>c.messages.length||c.draft||c.id===current?.id).sort((a,b)=>b.updated-a.updated);
  const filtered=all.filter(c=>c.title.toLocaleLowerCase().includes(query)||c.messages.some(m=>m.content.toLocaleLowerCase().includes(query)));
  $('#chat-count').textContent=String(all.filter(c=>c.messages.length).length);
  if(!filtered.length)list.append(node('p','history-empty',query?'No matching conversations.':'It starts with one thought. Your conversations will appear here.'));
  for(const chat of filtered){
    const row=node('div','chat-row'+(chat.id===current?.id?' active':''));
    const b=button(chat.title,()=>selectChat(chat),'chat-title');b.title=chat.title;if(chat.id===current?.id)b.setAttribute('aria-current','page');
    const menu=button('···',()=>chatMenu(chat),'chat-menu');menu.setAttribute('aria-label','Actions for '+chat.title);
    row.append(b,menu);list.append(row);
  }
}
function chatMenu(chat){
  const d=node('dialog');const content=node('div','dialog-content');content.append(node('h2','',chat.title));
  const rename=button('Rename',()=>{const name=window.prompt('Conversation name',chat.title);if(name?.trim()){chat.title=name.trim().slice(0,160);saveChat(chat);renderHistory();}d.close();});
  const del=button('Delete conversation',async()=>{if(active?.chat.id===chat.id){toast('Stop the response before deleting this conversation.');return;}if(settings.confirmDelete&&!confirm('Delete this conversation?'))return;clearTimeout(saveTimers.get(chat.id));saveTimers.delete(chat.id);try{await store?.deleteChat(chat.id);}catch{storageError();return;}chats=chats.filter(c=>c.id!==chat.id);if(current?.id===chat.id){current=chats[0]||newChat();if(!chats.length)chats.push(current);renderConversation();saveMeta();}renderHistory();d.close();});
  content.append(rename,document.createTextNode(' '),del,button('Cancel',()=>d.close(),'text-button'));d.append(content);document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();
}
async function selectChat(chat){if(current)await saveChat();current=chat;await saveChat(chat);saveMeta();renderHistory();renderConversation();if(innerWidth<=700)setDrawer(false);}
function createChat(){const blank=chats.find(c=>!c.messages.length&&!c.draft);const chat=blank||newChat();if(!blank)chats.push(chat);selectChat(chat);haptic();return chat;}
function renderConversation(){
  $('#input').value=current?.draft||'';resizeInput();messageNodes.clear();$('#messages').replaceChildren();
  $('#welcome').hidden=!!current?.messages.length;
  for(const msg of current?.messages||[])appendMessage(msg);
  updateControls();scrollBottom();
}
function inlineText(parent,text){
  // Render only a small, safe Markdown subset. Model output is never HTML.
  for(const part of text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g)){
    if(part.startsWith('`')&&part.endsWith('`'))parent.append(node('code','',part.slice(1,-1)));
    else if(part.startsWith('**')&&part.endsWith('**'))parent.append(node('strong','',part.slice(2,-2)));
    else parent.append(document.createTextNode(part));
  }
}
function highlight(code,text,language){
  if(!['python','py'].includes(language.toLowerCase())){code.textContent=text;return;}
  const re=/(#[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:def|class|return|if|elif|else|for|while|in|import|from|as|try|except|finally|with|lambda|yield|True|False|None|and|or|not|pass|raise|async|await|break|continue)\b)/g;
  let start=0;for(const match of text.matchAll(re)){code.append(document.createTextNode(text.slice(start,match.index)));code.append(node('span',match[0].startsWith('#')?'syntax-comment':/^["']/.test(match[0])?'syntax-string':'syntax-keyword',match[0]));start=match.index+match[0].length;}code.append(document.createTextNode(text.slice(start)));
}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('Copied');}catch{const t=node('textarea');t.value=text;document.body.append(t);t.select();const ok=document.execCommand('copy');t.remove();toast(ok?'Copied':'Could not copy. Select the text and copy it manually.');}}
function renderProse(target,text){
  target.replaceChildren();let paragraph=[],list=null;
  const flush=()=>{if(paragraph.length){const p=node('p');inlineText(p,paragraph.join('\n'));target.append(p);paragraph=[];}};
  for(const line of text.split('\n')){
    const heading=line.match(/^\s{0,3}(#{1,4})\s+(.*)$/),item=line.match(/^\s{0,3}([-*•]|\d{1,3}[.)])\s+(.*)$/);
    if(heading){flush();list=null;const h=node('h'+Math.min(4,heading[1].length+1));inlineText(h,heading[2]);target.append(h);}
    else if(item){flush();const tag=/^\d/.test(item[1])?'OL':'UL';if(!list||list.tagName!==tag){list=node(tag.toLowerCase());target.append(list);}const li=node('li');inlineText(li,item[2]);list.append(li);}
    else {list=null;if(!line.trim())flush();else paragraph.push(line);}
  }
  flush();
}
function renderContent(container,msg){
  if(active?.message===msg&&msg.state==='streaming')msg={...msg,content:msg.content.slice(0,active.visibleLength||0)};
  if(msg.role==='user'){container.textContent=msg.content;return;}
  if(!msg.content&&msg.state==='streaming'){container.replaceChildren();const dots=node('div','typing');dots.setAttribute('aria-label','Luna is thinking');dots.append(node('i'),node('i'),node('i'));container.append(dots);container._blocks=[];return;}
  const parts=splitFences(msg.content).filter(p=>p.type==='code'||p.text.trim());const old=container._blocks||[];const blocks=[];
  for(let i=0;i<parts.length;i++){
    const part=parts[i],key=part.type+':'+(part.language||'');let block=old[i];
    if(!block||block.key!==key){
      block={key,text:null,el:node('div',part.type==='code'?'code-block':'prose-block')};
      if(part.type==='code'){
        const head=node('div','code-heading'),badge=node('span','code-language',part.language),pre=node('pre'),code=node('code');
        const target=block;head.append(badge,button('Copy',()=>copy(target.text||'')));pre.append(code);block.el.append(head,pre);block.code=code;
      }
    }
    if(block.text!==part.text){block.text=part.text;if(block.code){block.code.replaceChildren();highlight(block.code,part.text,part.language);}else renderProse(block.el,part.text);}
    if(container.children[i]!==block.el){if(container.children[i])container.replaceChild(block.el,container.children[i]);else container.append(block.el);}
    blocks.push(block);
  }
  while(container.children.length>blocks.length)container.lastElementChild.remove();container._blocks=blocks;
}
function appendMessage(msg){
  const row=node('article','message '+msg.role+(msg.state==='streaming'?' streaming':''));row.dataset.id=msg.id;
  if(msg.role==='assistant'){const label=node('div','assistant-label'),img=node('img');img.src='assets/logo.png';img.alt='';label.append(img,node('span','','Luna'+(msg.model?' · '+msg.model:'')));row.append(label);}
  const body=node('div','message-content');renderContent(body,msg);row.append(body);const note=node('div','message-note');note.textContent=msg.note||'';note.hidden=!msg.note;row.append(note);
  const actions=node('div','message-actions');actions.append(actionIcon('Copy','copy',()=>copy(msg.content)));
  if(msg.role==='assistant'){
    const read=actionIcon('Read aloud','read',()=>speak(msg.content));read.disabled=!('speechSynthesis'in window);actions.append(read);
    const retry=actionIcon('Regenerate','regenerate',()=>regenerate(msg));retry.hidden=msg!==current?.messages.at(-1);actions.append(retry);
  }else actions.append(actionIcon('Edit','edit',()=>{if(active)return toast('Wait for the response to finish, or stop it first.');$('#input').value=msg.content;current.draft=msg.content;queueSave();resizeInput();$('#input').focus();toast('Edit the text and send it as a new message.');}));
  actions.hidden=msg.state==='streaming';row.append(actions);$('#messages').append(row);messageNodes.set(msg.id,{row,body,note,actions});
}
function refreshMessage(msg){let parts=messageNodes.get(msg.id);if(!parts){appendMessage(msg);return;}parts.row.classList.toggle('streaming',msg.state==='streaming');renderContent(parts.body,msg);parts.note.textContent=msg.note||'';parts.note.hidden=!msg.note;parts.actions.hidden=msg.state==='streaming';}
function nearBottom(){const c=$('#conversation');return c.scrollHeight-c.scrollTop-c.clientHeight<100;}
function scrollBottom(){const c=$('#conversation');c.scrollTop=c.scrollHeight;$('#scroll-bottom').hidden=true;}
function schedulePaint(){if(paintTimer==null)paintTimer=requestAnimationFrame(paintLive);}
function paintLive(now){
  paintTimer=null;if(!active)return;
  const total=active.message.content.length,shown=Math.min(active.visibleLength||0,total);
  const elapsed=Math.min(32,Math.max(1,now-(active.lastPaint||now-16)));
  if(!active.revealDeadline)active.revealDeadline=now+160;
  const left=Math.max(16,active.revealDeadline-now);
  let next=Math.min(total,shown+Math.max(1,Math.ceil((total-shown)*elapsed/left)));
  // Never reveal half of a UTF-16 surrogate pair (for example an emoji).
  if(next<total&&/[\uD800-\uDBFF]/.test(active.message.content[next-1]||''))next++;
  active.visibleLength=next;active.lastPaint=now;
  if(active.chat.id===current?.id){const follow=nearBottom();refreshMessage(active.message);if(follow)scrollBottom();else $('#scroll-bottom').hidden=false;}
  if(next<total)schedulePaint();
  else {active.revealDeadline=null;if(active.completion){const {state,note}=active.completion;finish(state,note);}}
}
function resizeInput(){const t=$('#input');t.style.height='auto';t.style.height=Math.min(160,t.scrollHeight)+'px';updateControls();}
function updateControls(){
  document.body.classList.toggle('generating',!!active);
  for(const [id,parts] of messageNodes){const retry=parts.actions.querySelector('.regenerate-action');if(retry){retry.hidden=id!==current?.messages.at(-1)?.id;retry.disabled=!!active;}}
  const ready=online&&server.current&&!server.loading&&!server.busy&&!active;
  $('#send').disabled=!ready||!$('#input').value.trim();$('#send').hidden=!!active;$('#stop').hidden=!active;$('#model').disabled=!online||!!active||!!server.busy||!!server.loading;
}
async function generate(text,history){
  if(!online||!server.current||server.loading||server.busy||active){toast('Connect and wait for the model to be ready.');return false;}
  text=text.trim();if(!text)return false;
  const chat=current;const payload=generationPayload(text,history||chat.messages,settings);
  const user={id:uuid(),role:'user',content:text,state:'done'};
  const answer={id:uuid(),role:'assistant',content:'',state:'streaming',model:server.current};
  chat.messages.push(user,answer);chat.draft='';chat.updated=Date.now();if(chat.title==='New chat')chat.title=text.replace(/\s+/g,' ').slice(0,70);
  active={chat,message:answer,visibleLength:0};$('#input').value='';$('#welcome').hidden=true;appendMessage(user);appendMessage(answer);resizeInput();renderHistory();scrollBottom();saveMeta();
  await saveChat(chat);
  // The network can disappear while IndexedDB is committing the prompt.
  if(!active||active.message!==answer)return false;
  if(!conn.send(payload)){finish('interrupted','The message was not sent. Reconnect and try again.');return false;}
  haptic();announce('Luna is writing a response.');return true;
}
async function regenerate(msg){
  if(active)return toast('Stop the current response first.');
  if(!online||!server.current||server.loading||server.busy)return toast('Connect and wait for the model to be ready.');
  const index=current.messages.findIndex(m=>m.id===msg.id),previous=current.messages[index-1];
  if(previous?.role!=='user'||index!==current.messages.length-1)return;
  // Like the native app: replace only the latest assistant reply, keeping its user turn.
  const chat=current,payload=generationPayload(previous.content,chat.messages.slice(0,index-1),settings);
  window.speechSynthesis?.cancel();
  Object.assign(msg,{content:'',state:'streaming',model:server.current,note:''});chat.updated=Date.now();
  active={chat,message:msg,visibleLength:0};refreshMessage(msg);updateControls();scrollBottom();
  await saveChat(chat);
  if(!active||active.message!==msg)return;
  if(!conn.send(payload)){finish('interrupted','The message was not sent. Reconnect and try again.');return;}
  haptic();announce('Luna is regenerating the response.');
}
function finish(state='done',note=''){
  if(!active)return;clearTimeout(stopTimer);cancelAnimationFrame(paintTimer);paintTimer=null;const {chat,message}=active;const follow=nearBottom();
  message.state=state;message.note=note;chat.updated=Date.now();active=null;server.busy=false;$('#tool-request').hidden=true;$('#stop').disabled=false;
  if(current?.id===chat.id){refreshMessage(message);if(follow)scrollBottom();}
  saveChat(chat);renderHistory();updateControls();announce(state==='done'?'Luna has finished.':note);
}
function serverError(value){
  const errors={
    'Fant ikke modellen på serveren.':'The model was not found on the server.',
    'Vent til svaret er ferdig før du bytter modell.':'Wait for the response to finish before switching models.',
    'Modellen lastes fortsatt. Vent litt.':'The model is still loading. Please wait.',
    'Ingen modell er lastet på serveren.':'No model is loaded on the server.',
    'Serveren svarer allerede på en annen melding.':'The server is already responding to another message.'
  };
  return errors[value]||'LunaServer reported an error. Check the server log for details.';
}
function serverMessage(data){
  if(data.type==='status'){
    server=data;const select=$('#model');select.replaceChildren();
    for(const m of data.models||[]){const opt=node('option','',m.label||m.id);opt.value=m.id;select.append(opt);}
    if(!select.options.length)select.append(node('option','','No models'));
    select.value=data.loading||data.current||'';
    if(data.loading)setNotice('Loading '+data.loading+' on the server…');else if(data.error)setNotice(serverError(data.error));else setNotice('');updateControls();
  }else if(data.type==='token'&&active){active.message.content+=String(data.text||'');schedulePaint();queueSave(active.chat);}
  else if(data.type==='done'&&active){if(typeof data.text==='string'&&!(data.aborted&&data.text===''&&active.message.content))active.message.content=data.text;const stopped=data.aborted||active.stopRequested;if(stopped||document.hidden)finish(stopped?'stopped':'done',stopped?'Response stopped.':'');else{active.completion={state:'done',note:''};queueSave(active.chat);schedulePaint();}}
  else if(data.type==='error'){if(active)finish('error',serverError(data.error));else toast(serverError(data.error));}
  else if(data.type==='switch_error'){toast(serverError(data.error));}
  else if(data.type==='tool'&&active){$('#tool-title').textContent='Luna is requesting: '+String(data.tool||'tool');$('#tool-body').textContent=String(data.body||'');$('#tool-result').value='';$('#tool-request').hidden=false;announce('Luna needs a tool result.');}
}
function setNotice(text){$('#connection-notice').textContent=text;$('#connection-notice').hidden=!text;}
function connectionState(state,message){
  lastState=state;online=state==='online';$('#connection-button').className='connection-pill '+state;
  $('#connection-label').textContent=online?'Connected':state==='connecting'?'Connecting…':'Connect';
  $('#login-submit').disabled=state==='connecting';$('#login-submit').textContent=state==='connecting'?message:'Connect to Luna ↗';
  if(online){$('#login-error').textContent='';$('#login-dialog').close();$('#server-address').textContent=new URL(conn.address).host;setNotice('');announce('Connected to LunaServer.');}
  else if(state==='offline'){server={};$('#login-error').textContent=message;setNotice(message);}
  else {$('#login-error').textContent='';setNotice(message);}
  updateControls();
}
function openLogin(){
  $('#password').value=getPassword();try{$('#remember').checked=!!localStorage.getItem('luna-password');}catch{}
  $('#discovery-url').value=settings.discoveryUrl;$('#manual-url').value=settings.manualUrl;showDialog('login-dialog');
}

function fillSettings(){
  for(const key of ['largeText','reduceMotion','shortTermMemory','haptics','confirmDelete'])$('#'+key).checked=settings[key];
  for(const key of ['temperature','topK','topP']){$('#'+key).value=settings[key];$('#'+key+'-value').textContent=key==='topK'?settings[key]:settings[key].toFixed(2);}
  applyTheme();loadVoices();
}
function loadVoices(){
  voices=window.speechSynthesis?.getVoices()||[];const select=$('#voiceName');select.replaceChildren();const opt=node('option','','Device default voice');opt.value='';select.append(opt);
  for(const v of voices){const o=node('option','',`${v.name} (${v.lang})`);o.value=v.voiceURI;select.append(o);}select.value=settings.voiceName;
  $('#test-voice').disabled=!('speechSynthesis'in window);$('#voice-info').textContent='speechSynthesis'in window?'Uses voices available on this device. These may differ from the native iPhone app.':'This browser does not support speech playback.';
}
function speak(text){if(!window.speechSynthesis)return;const synth=window.speechSynthesis;if(synth.speaking){synth.cancel();return;}const u=new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g,' Code block. '));const voice=voices.find(v=>v.voiceURI===settings.voiceName);if(voice)u.voice=voice;u.onerror=e=>{if(e.error!=='interrupted'&&e.error!=='canceled')toast('Could not read aloud. Please choose another voice.');};synth.speak(u);}
let recognition;
function setupDictation(){
  const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Speech||!window.isSecureContext){$('#dictate').disabled=true;$('#dictate').title='Dictation requires a supported browser and HTTPS. You can also use the microphone on your keyboard.';return;}
  recognition=new Speech();recognition.lang='en-US';recognition.interimResults=false;recognition.continuous=false;
  recognition.onresult=e=>{const transcript=e.results[0][0].transcript;$('#input').value+=($('#input').value?' ':'')+transcript;current.draft=$('#input').value;saveChat();resizeInput();};
  recognition.onend=()=>{$('#dictate').classList.remove('listening');$('#dictate').setAttribute('aria-pressed','false');};
  recognition.onerror=e=>toast(e.error==='not-allowed'?'Allow Safari to access your microphone, or use keyboard dictation.':'Dictation stopped: '+e.error);
  $('#dictate').addEventListener('click',()=>{if($('#dictate').classList.contains('listening')){recognition.stop();return;}try{recognition.start();$('#dictate').classList.add('listening');$('#dictate').setAttribute('aria-pressed','true');toast('Listening…');}catch{toast('Dictation is already running.');}});
}

function bindUI(){
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$('#'+b.dataset.close).close()));
  for(const d of document.querySelectorAll('dialog'))d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});
  $('#open-sidebar').onclick=()=>setDrawer(true);$('#close-sidebar').onclick=()=>setDrawer(false);$('#scrim').onclick=()=>setDrawer(false);
  $('#new-chat').onclick=createChat;$('#search').oninput=renderHistory;
  $('#open-settings').onclick=()=>{fillSettings();showDialog('settings-dialog');};$('#connection-button').onclick=openLogin;
  $('#reconnect').onclick=()=>{$('#settings-dialog').close();openLogin();};
  $('#logout').onclick=()=>{conn.disconnect();finish('interrupted','You logged out while Luna was responding.');forgetPassword();window.speechSynthesis?.cancel();$('#settings-dialog').close();connectionState('offline','Logged out. Your conversations are still saved.');openLogin();};
  $('#login-form').onsubmit=e=>{e.preventDefault();const password=$('#password').value;if(!password)return;settings.discoveryUrl=$('#discovery-url').value.trim()||defaults.discoveryUrl;settings.manualUrl=$('#manual-url').value.trim();saveMeta();rememberPassword(password,$('#remember').checked);finish('interrupted','Server connection changed.');conn.connect(settings,password);};
  $('#model').onchange=e=>{if(conn.send({cmd:'switch',model:e.target.value})){setNotice('Switching model…');server.loading=e.target.value;updateControls();}};
  $('#composer').onsubmit=e=>{e.preventDefault();generate($('#input').value);};
  $('#input').oninput=()=>{current.draft=$('#input').value;queueSave();resizeInput();};
  $('#input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&matchMedia('(pointer:fine)').matches){e.preventDefault();generate($('#input').value);}};
  $('#stop').onclick=()=>{if(!active)return;if(active.completion){finish('stopped','Response stopped.');return;}active.stopRequested=true;conn.send({cmd:'stop'});$('#stop').disabled=true;stopTimer=setTimeout(()=>{if(active){conn.disconnect();finish('stopped','Response stopped. Reconnect to continue.');connectionState('offline','Response stopped. Please reconnect.');}$('#stop').disabled=false;},10000);};
  $('#scroll-bottom').onclick=scrollBottom;$('#conversation').onscroll=()=>$('#scroll-bottom').hidden=nearBottom();
  document.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>{$('#input').value=b.dataset.prompt;current.draft=$('#input').value;queueSave();resizeInput();$('#input').focus();});
  $('#deny-tool').onclick=()=>{if(active)active.stopRequested=true;conn.send({cmd:'tool_deny'});$('#tool-request').hidden=true;};
  $('#submit-tool').onclick=()=>{if(!$('#tool-result').value.trim())return toast('Enter a result or choose Decline and stop.');conn.send({cmd:'tool_result',text:$('#tool-result').value});$('#tool-request').hidden=true;};
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(t=>t.setAttribute('aria-selected',String(t===b)));for(const tab of ['look','model','app'])$('#panel-'+tab).hidden=tab!==b.dataset.tab;});
  for(const [id,colors] of Object.entries(themes)){const b=button('',()=>{settings.themeId=id;applyTheme();saveMeta();haptic();},'theme-button');b.dataset.themeChoice=id;const preview=node('span','theme-preview','☾');preview.style.background=colors[1];preview.style.color=colors[6];b.append(preview,document.createTextNode(id[0].toUpperCase()+id.slice(1)));$('#themes').append(b);}
  for(const key of ['largeText','reduceMotion','shortTermMemory','haptics','confirmDelete'])$('#'+key).onchange=e=>{settings[key]=e.target.checked;applyTheme();saveMeta();haptic();};
  for(const key of ['temperature','topK','topP'])$('#'+key).oninput=e=>{settings[key]=Number(e.target.value);$('#'+key+'-value').textContent=key==='topK'?settings[key]:settings[key].toFixed(2);saveMeta();};
  $('#reset-sampling').onclick=()=>{for(const k of ['temperature','topK','topP'])settings[k]=defaults[k];fillSettings();saveMeta();};
  $('#voiceName').onchange=e=>{settings.voiceName=e.target.value;saveMeta();};$('#test-voice').onclick=()=>speak('Hi! I am Luna. What shall we explore together?');window.speechSynthesis?.addEventListener('voiceschanged',loadVoices);
  if(!navigator.vibrate)$('#haptic-info').textContent='This browser does not support vibration. Your preference is still saved.';
  $('#export').onclick=()=>{const data={format:'lunagpt-web',version:1,exported:new Date().toISOString(),settings,chats};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=node('a');a.href=url;a.download='LunaGPT-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);};
  $('#import').onclick=()=>$('#import-file').click();$('#import-file').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(active)return toast('Wait for Luna to finish before importing.');try{if(file.size>50*1024*1024)throw new Error('File is too large (maximum 50 MB).');const backup=validateBackup(JSON.parse(await file.text()));if(!store)throw new Error('Browser storage is unavailable.');
    // Import as separate conversations, preserving every existing conversation.
    const imported=backup.chats.map(c=>({...c,id:uuid()}));await store.importChats(imported);chats.push(...imported);if(imported.length)await selectChat(imported[0]);toast(imported.length+' conversations imported. Existing conversations were kept.');
  }catch(err){toast(err.message||'Could not import the backup.');}};
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!document.querySelector('dialog[open]'))createChat();}if(e.key==='Escape'&&$('#sidebar').classList.contains('open'))setDrawer(false);});
  window.addEventListener('pagehide',()=>{unloading=true;for(const timer of saveTimers.values())clearTimeout(timer);saveTimers.clear();if(current)saveChat();if(active)saveChat(active.chat);});
  document.addEventListener('visibilitychange',()=>{document.body.classList.toggle('page-hidden',document.hidden);if(document.hidden&&active?.completion){const end=active.completion;finish(end.state,end.note);}if(document.hidden){saveChat();if(active)saveChat(active.chat);}else if(!unloading&&lastState==='offline'&&getPassword()&&conn.enabled){conn.connect(settings,getPassword(),true);}else if(online)conn.send({cmd:'status'});});
  window.addEventListener('pageshow',()=>unloading=false);
  window.addEventListener('online',()=>{if(!online&&conn.enabled&&getPassword())conn.connect(settings,getPassword(),true);});
  // Keep the composer above the on-screen keyboard in iOS Safari.
  if(window.visualViewport){const resize=()=>{document.body.style.height=window.visualViewport.height+'px';};visualViewport.addEventListener('resize',resize);resize();}
  setupDictation();
}

async function start(){
  const started=Date.now();
  try{store=await openStore();const [saved,meta]=await Promise.all([store.chats(),store.meta()]);chats=saved;settings=initialSettings(meta);
    for(const chat of chats){let changed=false;for(const m of chat.messages)if(m.state==='streaming'){m.state='interrupted';m.note='The previous response was interrupted when the page closed.';changed=true;}if(changed)await store.saveChat(chat);}
    current=chats.find(c=>c.id===meta?.currentId)||chats.sort((a,b)=>b.updated-a.updated)[0];
  }catch{storageError();}
  if(!current){current=newChat();chats.push(current);}
  bindUI();fillSettings();renderHistory();renderConversation();saveMeta();
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,950-(Date.now()-started))));$('#splash').classList.add('finished');
  const password=getPassword();if(password)conn.connect(settings,password);else openLogin();
  if('serviceWorker'in navigator && window.isSecureContext && /^https?:$/.test(location.protocol))navigator.serviceWorker.register('./sw.js').catch(()=>{});
  // Optional WebMCP support shares exactly the actions used by the visible UI.
  if(document.modelContext?.registerTool){
    const lifecycle=new AbortController();
    for(const tool of [
      {name:'read_luna_state',description:'Read the connection state and saved conversation titles. Does not expose passwords or message bodies.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({connected:online,model:server.current||null,currentChatId:current.id,chats:chats.map(c=>({id:c.id,title:c.title}))})},
      {name:'start_luna_conversation',description:'Open a new empty conversation in LunaGPT. Does not send a message.',inputSchema:{type:'object',properties:{},additionalProperties:false},execute:async()=>{const chat=createChat();await saveChat(chat);return {id:chat.id};}},
      {name:'stage_luna_message',description:'Put a message in the current composer for the user to review. Does not send it.',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},execute:async input=>{if(typeof input?.text!=='string'||input.text.length>100000)throw new Error('text must be a string of at most 100000 characters');$('#input').value=input.text;current.draft=input.text;resizeInput();await saveChat();return {staged:true,chatId:current.id};}}
    ]){try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
  }
}
start().catch(()=>{ $('#splash').classList.add('finished');setNotice('Could not start LunaGPT. Please reload the page.'); });
