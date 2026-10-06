// Resolve writes only after the transaction commits, not just the put request.
export async function openStore(){
  const db=await new Promise((resolve,reject)=>{
    const r=indexedDB.open('lunagpt-web',1);
    r.onupgradeneeded=()=>{r.result.createObjectStore('chats',{keyPath:'id'});r.result.createObjectStore('meta');};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Close other LunaGPT tabs and try again.'));
  });
  function run(stores,mode,action){return new Promise((resolve,reject)=>{const tx=db.transaction(stores,mode);let result;try{result=action(tx);}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(result?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Saving was interrupted.'));});}
  return {
    chats:()=>run(['chats'],'readonly',t=>t.objectStore('chats').getAll()),
    meta:()=>run(['meta'],'readonly',t=>t.objectStore('meta').get('state')),
    saveChat:c=>run(['chats'],'readwrite',t=>t.objectStore('chats').put(c)),
    saveMeta:s=>run(['meta'],'readwrite',t=>t.objectStore('meta').put(s,'state')),
    deleteChat:id=>run(['chats'],'readwrite',t=>t.objectStore('chats').delete(id)),
    importChats:chats=>run(['chats'],'readwrite',t=>{for(const c of chats)t.objectStore('chats').put(c);})
  };
}
