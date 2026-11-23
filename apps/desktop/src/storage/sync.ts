import {loginStore,WorkspaceConflictError} from '../identity/login';
import {syncPendingTasks} from '../tasks/sync';
import type {TaskOwner} from '../tasks/client';

export type SyncStatus={enabled:boolean;paused:boolean;pending:number;rejected:number;recovering:boolean};
export type Operation={entity:string;id:string;operationId:string;action:string;expectedRevision:number;payload:unknown};
export type SyncReport={sent:number;rejected:number};
export const syncEvent='metis-sync-status';
export async function native<T>(command:string,args:Record<string,unknown>):Promise<T>{
 return await window.__TAURI__!.core.invoke(command,args) as T;
}
export type SyncActivity={busy:boolean;message:string};
const activity=new Map<string,SyncActivity>();
export function getSyncActivity(owner:TaskOwner){return activity.get(owner.projectRef+':'+owner.userId);}
// Manual buttons and the background runner share a receipt, not two competing acknowledgements.
const deliveries=new Map<string,Promise<void>>();
export function deliverWorkspace(owner:TaskOwner,op:Operation,signal:AbortSignal):Promise<void>{
 const key=owner.projectRef+':'+owner.userId+':'+op.operationId;
 const current=deliveries.get(key);if(current)return current;
 const job=(async()=>{
  try{
   const revision=await loginStore.sendWorkspace(owner,op,signal);
   await native('outbound_ack',{owner,entity:op.entity,id:op.id,operation:op.operationId,revision});
  }catch(e){
   if(e instanceof WorkspaceConflictError)await native('outbound_reject',{owner,entity:op.entity,id:op.id,operation:op.operationId});
   throw e;
  }
 })().finally(()=>deliveries.delete(key));
 deliveries.set(key,job);return job;
}
const running=new Map<string,Promise<SyncReport>>();
const offsets=new Map<string,number>();
export function syncNow(owner:TaskOwner,signal:AbortSignal,automatic=false):Promise<SyncReport>{
 const key=owner.projectRef+':'+owner.userId;
 const current=running.get(key);if(current)return current;
 activity.set(key,{busy:true,message:'Değişiklikler gönderiliyor…'});
 window.dispatchEvent(new Event(syncEvent));
 const job=perform(owner,signal,key,automatic).then(result=>{
  activity.set(key,{busy:false,message:result.sent+' işlem gönderildi; '+result.rejected+' yeni ret. Son kontrol: '+new Date().toLocaleTimeString('tr-TR')});return result;
 },error=>{activity.set(key,{busy:false,message:error instanceof Error?error.message:'Gönderim durdu. Veri ve eşitleme ekranından bekleyen işlemleri kontrol et.'});throw error;}).finally(()=>{running.delete(key);window.dispatchEvent(new Event(syncEvent));});
 running.set(key,job);return job;
}
async function perform(owner:TaskOwner,signal:AbortSignal,key:string,automatic:boolean):Promise<SyncReport>{
 const active=async()=>{
  if(signal.aborted)throw new Error('Gönderim durduruldu; bekleyen işlemler korunuyor.');
  const state=await native<SyncStatus>('sync_status',{owner});
  if(state.paused)throw new Error('Yedekten dönüş sonrası önce uzlaştırmayı tamamla.');
  if(automatic&&!state.enabled)throw new Error('Otomatik gönderim kapatıldı.');
 };
 await active();let sent=0,rejected=0;
 const deliver=async()=>{
  const pending=await native<Operation[]>('sync_pending',{owner});
  for(const op of pending){
   if(sent+rejected>=100)break;
   await active();
   try{
    await deliverWorkspace(owner,op,signal);sent++;
   }catch(e){
    if(!(e instanceof WorkspaceConflictError))throw e;
    rejected++;
   }
  }
 };
 // Finish frozen planning before the task lifecycle can acquire the same revision.
 await deliver();await active();
 if(sent+rejected<100){const tasks=await syncPendingTasks(owner,signal,100-sent-rejected);sent+=tasks.sent;}
 // Scan a bounded number of pages; the next run continues rather than starving later pages.
 for(let page=0;page<10&&sent+rejected<100;page++){
  await active();
  const scan=await native<{nextOffset:number;queued:number}>('sync_scan',{owner,offset:offsets.get(key)??0});
  offsets.set(key,scan.nextOffset);
  await deliver();
  if(sent+rejected<100){await active();const tasks=await syncPendingTasks(owner,signal,100-sent-rejected);sent+=tasks.sent;}
  if(scan.nextOffset===0&&scan.queued===0)break;
 }
 return {sent,rejected};
}
export async function downloadCloud(owner:TaskOwner,signal:AbortSignal,onProgress?:(count:number)=>void){
 let current=await native<{cursor:string}>('inbox_status',{owner});let count=0;
 for(;;){
  if(signal.aborted)throw new Error('İndirme durduruldu. Alınan sayfalar korunuyor.');
  const page=await loginStore.readChanges(owner,current.cursor,signal);
  if(signal.aborted)throw new Error('İndirme durduruldu.');
  current=await native<{cursor:string}>('inbox_stage',{owner,expected:current.cursor,page});
  const summary=page as {items:unknown[];hasMore:boolean};count+=summary.items.length;onProgress?.(count);
  if(!summary.hasMore)return;
 }
}
