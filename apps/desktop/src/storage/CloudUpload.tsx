import {useEffect,useRef,useState} from 'react';
import {WorkspaceConflictError} from '../identity/login';
import {deliverWorkspace} from './sync';
import type {TaskOwner} from '../tasks/client';
type Removed={entity:string;id:string;title:string;digest:string};
type Candidate=Removed&{pending:boolean;rejected:boolean;dirty:boolean;pendingAction:string;month:string;category:string};
type Operation={entity:string;id:string;operationId:string;action:string;expectedRevision:number;payload:unknown};
async function call<T>(name:string,args:Record<string,unknown>){return await window.__TAURI__!.core.invoke(name,args) as T;}
const names:Record<string,string>={note:'Not',project:'Proje',goal:'Hedef',event:'Etkinlik',finance:'Finans',budget:'Bütçe',taskPlan:'Görev planı'};
export function CloudUpload({owner}:{owner:TaskOwner}){
 const [items,setItems]=useState<Candidate[]>([]),[removed,setRemoved]=useState<Removed[]>([]);
 const [offset,setOffset]=useState(0),[removedOffset,setRemovedOffset]=useState(0),[confirmation,setConfirmation]=useState('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const mounted=useRef(true),lock=useRef(false),abort=useRef<AbortController|null>(null);
 async function load(n:number,r=removedOffset){
  const [rows,deleted]=await Promise.all([call<Candidate[]>('outbound_list',{owner,offset:n}),call<Removed[]>('outbound_removed',{owner,offset:r})]);
  if(mounted.current){setItems(rows);setRemoved(deleted);setOffset(n);setRemovedOffset(r);setConfirmation('');}
 }
 useEffect(()=>{mounted.current=true;let active=true;
  Promise.all([call<Candidate[]>('outbound_list',{owner,offset:0}),call<Removed[]>('outbound_removed',{owner,offset:0})]).then(([rows,deleted])=>{if(active){setItems(rows);setRemoved(deleted);setOffset(0);setRemovedOffset(0);setConfirmation('');}}).catch(()=>{if(active)setMessage('Yerel gönderim listesi açılamadı.');});
  return()=>{active=false;mounted.current=false;abort.current?.abort();};
 },[owner.projectRef,owner.userId]);
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);try{await action();}catch(e){if(mounted.current)setMessage(e instanceof Error?e.message:e==='recoveryRequired'?'Yedekten dönüş nedeniyle gönderim kilitli.':e==='conflict'?'Kayıt değişti veya bulutla uzlaştırma gerekiyor. Listeyi yenile.':'Gönderim hazırlanamadı. Yerel veri korunuyor.');}finally{lock.current=false;if(mounted.current)setBusy(false);}}
 async function deliver(op:Operation,controller:AbortController){
  try{
   await deliverWorkspace(owner,op,controller.signal);
   if(mounted.current){await load(offset);setMessage(op.action==='delete'?'Buluttaki kayıt silindi. Yerel yeni kayıtlar korunuyor.':'Kayıt buluta gönderildi. Arada yaptığın yeni düzenlemeler sonraki gönderimde alınır.');}
  }catch(e){
   if(e instanceof WorkspaceConflictError){
    if(mounted.current)await load(offset);
   }
   throw e;
  }
 }
 async function send(item:Candidate|Removed,deleting=false){
  const controller=new AbortController();abort.current=controller;
  try{
   const op=deleting?await call<Operation>('outbound_delete',{owner,entity:item.entity,id:item.id,digest:item.digest}):await call<Operation>('outbound_prepare',{owner,entity:item.entity,id:item.id,expectedDigest:item.digest,month:(item as Candidate).month,category:(item as Candidate).category});
   if(!mounted.current)controller.abort();
   await deliver(op,controller);
  }finally{abort.current=null;}
 }
 async function discard(item:Candidate){
  await call('outbound_discard',{owner,entity:item.entity,id:item.id});
  if(mounted.current){await load(offset);setMessage('Reddedilen istek kaldırıldı; yerel kayıt değişmedi. Bulut değişikliklerini indir, ilgili kaydı karşılaştır ve seçiminle uygula. Sonra yeniden düzenleyip gönderebilirsin.');}
 }
 return <article className="panel">
  <h3>Yerel kayıtları buluta gönder</h3>
  <p>Not, proje, hedef, takvim, finans ve bütçe kayıtlarını seçerek gönder. Görevler kendi gönderim alanını kullanır. Otomatik gönderimi üstteki bölümden açabilirsin.</p>
  <p>Yarım kalan gönderim aynı işlemle tekrar denenir. Yalnızca sunucunun kesin olarak reddettiği istek kaldırılabilir; ardından bulut kopyasını aşağıdaki karşılaştırma alanından inceleyebilirsin.</p>
  <button className="text-button" disabled={busy} onClick={()=>void run(()=>load(0,0))}>Listeyi yenile</button>
  {message&&<p role="status">{message}</p>}
  <ul className="overview-list">{items.map(item=><li key={item.entity+item.id}>
   <div><strong>{item.title||(item.entity==='taskPlan'?'Görev planı':'Bekleyen işlem')}</strong><p>{names[item.entity]}{item.rejected?' · Sunucu reddetti':item.pending?(item.pendingAction==='delete'?' · Onaylanmış silme bekliyor':' · Yarım kalan gönderim'):''}</p></div>
   <button className="secondary-button" disabled={busy||(!item.dirty&&!item.pending)} onClick={()=>void run(()=>item.rejected?discard(item):send(item))}>{item.rejected?'Reddedilen isteği kaldır':item.pending?(item.pendingAction==='delete'?'Aynı silmeyi tekrar dene':'Aynı gönderimi tekrar dene'):item.dirty?'Buluta gönder':'Güncel'}</button>
  </li>)}</ul>
  <div className="workspace-quick-links"><button disabled={busy||offset===0} className="text-button" onClick={()=>void run(()=>load(Math.max(0,offset-50)))}>Önceki</button><button disabled={busy||items.length<50} className="text-button" onClick={()=>void run(()=>load(offset+50))}>Sonraki</button></div>
  <h3>Cihazdan sildiklerin</h3>
  <p>Önceden buluta gönderilmiş, bu cihazdan silinmiş kayıtlar. Buluttan silme ayrıca onay ister. Bulutta yeni bir değişiklik varsa işlem durur.</p>
  {!removed.length&&<p>Bu sayfada silinmeyi bekleyen kayıt yok.</p>}
  <ul className="overview-list">{removed.map(item=><li key={item.entity+item.id}>
   <div><strong>{item.title}</strong><p>{names[item.entity]}{confirmation===item.entity+item.id?' · Buluttaki kopya da silinecek.':''}</p></div>
   {confirmation===item.entity+item.id?<div className="workspace-quick-links"><button className="secondary-button" disabled={busy} onClick={()=>void run(()=>send(item,true))}>Silmeyi onayla</button><button className="text-button" disabled={busy} onClick={()=>setConfirmation('')}>Vazgeç</button></div>:<button className="secondary-button" disabled={busy} onClick={()=>setConfirmation(item.entity+item.id)}>Buluttan da sil</button>}
  </li>)}</ul>
  <div className="workspace-quick-links"><button disabled={busy||removedOffset===0} className="text-button" onClick={()=>void run(()=>load(offset,Math.max(0,removedOffset-50)))}>Önceki silmeler</button><button disabled={busy||removed.length<50} className="text-button" onClick={()=>void run(()=>load(offset,removedOffset+50))}>Sonraki silmeler</button></div>
 </article>;
}
