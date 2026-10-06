import {discoveryCandidates,websocketAddress} from './core.js';
export async function discover(settings,signal){
  if(settings.manualUrl.trim()) return websocketAddress(settings.manualUrl.trim(),location.protocol);
  let last;
  for(const address of discoveryCandidates(settings.discoveryUrl)){
    const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>controller.abort(),8000);
    try{
      if(signal?.aborted) throw new Error('Connection cancelled.');
      const r=await fetch(address,{cache:'no-store',signal:controller.signal,headers:{Accept:'application/vnd.github.raw+json'}});
      if(!r.ok) throw new Error(`Could not find the server address (HTTP ${r.status}). Start LunaServer and wait for the tunnel to be ready.`);
      let data=await r.json();
      if(data.encoding==='base64' && data.content) data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(data.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));
      const url=data.ws_url||data.url;
      if(typeof url!=='string') throw new Error('connection.json is missing url or ws_url.');
      return websocketAddress(url,location.protocol);
    }catch(e){last=e;if(signal?.aborted) throw e;}finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }
  throw last?.name==='AbortError'?new Error('GitHub did not respond in time. Check your connection and try again.'):last;
}
export class LunaConnection {
  constructor({onState,onMessage,onDisconnect}){Object.assign(this,{onState,onMessage,onDisconnect});this.version=0;this.attempts=0;this.socket=null;this.enabled=false;}
  async connect(settings,password,retrying=false){
    this.disconnect();this.enabled=true;this.settings={...settings};this.password=password;if(!retrying)this.attempts=0;
    const version=this.version;this.controller=new AbortController();this.onState('connecting','Finding your server…');
    try{
      const address=await discover(settings,this.controller.signal);if(version!==this.version)return;
      this.address=address;const u=new URL(address);u.searchParams.set('token',password);
      this.onState('connecting','Connecting to LunaServer…');
      const ws=new WebSocket(u.href);this.socket=ws;let ready=false;
      const timer=setTimeout(()=>{if(!ready)ws.close();},15000);
      ws.onmessage=e=>{
        if(version!==this.version)return;let data;try{data=JSON.parse(e.data);}catch{return;}
        if(!data || typeof data!=='object')return;
        if(data.type==='status' && !ready){ready=true;clearTimeout(timer);this.attempts=0;this.onState('online','Connected');this.heartbeat=setInterval(()=>this.send({cmd:'ping'}),25000);}
        this.onMessage(data);
      };
      ws.onerror=()=>{}; // Browsers intentionally hide details of rejected handshakes.
      ws.onclose=()=>{
        clearTimeout(timer);clearInterval(this.heartbeat);if(version!==this.version)return;
        this.socket=null;this.onDisconnect();
        const reason=ready?'Connection lost. Your partial response has been kept.':'Could not reach the server. Check the password and make sure LunaServer and its tunnel are running.';
        this.onState('offline',reason);
        // Retry only previously authenticated connections, never hammer a wrong password.
        if(ready && this.enabled){this.retryAllowed=true;this.scheduleRetry();}
        else if(retrying && this.retryAllowed)this.scheduleRetry();
      };
    }catch(e){if(version!==this.version)return;this.onState('offline',e.message||'Could not connect.');if(retrying && this.retryAllowed)this.scheduleRetry();}
  }
  scheduleRetry(){if(!this.enabled || this.attempts>=3)return;this.attempts++;this.retryTimer=setTimeout(()=>this.connect(this.settings,this.password,true),Math.min(2000*2**this.attempts,16000));}
  send(data){if(this.socket?.readyState!==WebSocket.OPEN)return false;this.socket.send(JSON.stringify(data));return true;}
  disconnect(){this.version++;this.enabled=false;this.controller?.abort();clearTimeout(this.retryTimer);clearInterval(this.heartbeat);if(this.socket){this.socket.onclose=null;this.socket.close();this.socket=null;}}
}
