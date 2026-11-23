import {useEffect,useSyncExternalStore} from 'react';
import {loginStore} from '../identity/login';
import {loginSettings} from '../identity/config';
import {native,syncNow,syncEvent,type SyncStatus} from './sync';

export function SyncRuntime(){
 const session=useSyncExternalStore(loginStore.subscribe,loginStore.getSnapshot);
 const user=session.phase==='signedIn'?session.userId.toLowerCase():'';
 const project=loginSettings.kind==='ready'?new URL(loginSettings.config.url).hostname.split('.')[0]:'';
 useEffect(()=>{
  if(!window.__TAURI__||!user||!project)return;
  const owner={projectRef:project,userId:user};
  let stopped=false,busy=false,failures=0,timer:ReturnType<typeof setTimeout>|undefined;
  let controller:AbortController|null=null;
  const schedule=()=>{if(!stopped)timer=setTimeout(()=>void tick(),Math.min(300000,30000*2**failures));};
  async function tick(){
   if(stopped||busy)return;busy=true;
   try{
    const state=await native<SyncStatus>('sync_status',{owner});
    if(!stopped&&state.enabled&&!state.paused&&navigator.onLine){
     controller=new AbortController();await syncNow(owner,controller.signal,true);failures=0;
    }
   }catch{failures=Math.min(failures+1,4);}
   finally{busy=false;controller=null;schedule();}
  }
  const wake=()=>{if(timer)clearTimeout(timer);if(!busy)void tick();};
  const settings=()=>{controller?.abort();wake();};
  window.addEventListener('online',wake);window.addEventListener('focus',wake);
  window.addEventListener('metis-sync-settings',settings);
  void tick();
  return()=>{stopped=true;if(timer)clearTimeout(timer);controller?.abort();window.removeEventListener('online',wake);window.removeEventListener('focus',wake);window.removeEventListener('metis-sync-settings',settings);window.dispatchEvent(new Event(syncEvent));};
 },[user,project]);
 return null;
}
