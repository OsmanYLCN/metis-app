import {useEffect,useRef,useState} from 'react';
import {loginStore} from '../identity/login';
import type {TaskOwner} from '../tasks/client';
type Candidate={entity:string;id:string;title:string;digest:string;pending:boolean;month:string;category:string};
type Operation={entity:string;id:string;operationId:string;action:string;expectedRevision:number;payload:unknown};
async function call<T>(name:string,args:Record<string,unknown>){return await window.__TAURI__!.core.invoke(name,args) as T;}
const names:Record<string,string>={note:'Not',project:'Proje',goal:'Hedef',event:'Etkinlik',finance:'Finans',budget:'Bütçe'};
export function CloudUpload({owner}:{owner:TaskOwner}){
 const [items,setItems]=useState<Candidate[]>([]),[offset,setOffset]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const mounted=useRef(true),lock=useRef(false),abort=useRef<AbortController|null>(null);
 async function load(n:number){const rows=await call<Candidate[]>('outbound_list',{owner,offset:n});if(mounted.current){setItems(rows);setOffset(n);}}
 useEffect(()=>{mounted.current=true;let active=true;call<Candidate[]>('outbound_list',{owner,offset:0}).then(rows=>{if(active)setItems(rows)}).catch(()=>{if(active)setMessage('Yerel gönderim listesi açılamadı.');});return()=>{active=false;mounted.current=false;abort.current?.abort();};},[owner.projectRef,owner.userId]);
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);try{await action();}catch(e){if(mounted.current)setMessage(e instanceof Error?e.message:e==='recoveryRequired'?'Yedekten dönüş nedeniyle gönderim kilitli.':e==='conflict'?'Kayıt değişti veya bulutla uzlaştırma gerekiyor. Listeyi yenile.':'Gönderim hazırlanamadı. Yerel veri korunuyor.');}finally{lock.current=false;if(mounted.current)setBusy(false);}}
 async function send(item:Candidate){const controller=new AbortController();abort.current=controller;try{
  const op=await call<Operation>('outbound_prepare',{owner,entity:item.entity,id:item.id,expectedDigest:item.digest,month:item.month,category:item.category});
  const revision=await loginStore.sendWorkspace(owner,op,controller.signal);
  await call('outbound_ack',{owner,entity:op.entity,id:op.id,operation:op.operationId,revision});
  if(mounted.current){setMessage('Kayıt buluta gönderildi. Gönderim sırasında yaptığın yeni düzenlemeler varsa sonraki gönderimde alınır.');await load(offset);}
 }finally{abort.current=null;}}
 return <article className="panel"><h3>Yerel kayıtları buluta gönder</h3><p>Not, proje, hedef, takvim, finans ve bütçe kayıtlarını seçerek oluştur veya güncelle. Silmeler bu bölümden gönderilmez. Görevler kendi gönderim alanını kullanır.</p><p>İlk gönderimde yeni kayıt oluşturulur. Aynı kimlikle bulutta kayıt varsa sessizce üzerine yazılmaz. Yarım kalan gönderim aynı işlem kimliğiyle tekrar denenir; otomatik arka plan gönderimi yoktur.</p><button className="text-button" disabled={busy} onClick={()=>void run(()=>load(0))}>Listeyi yenile</button>{message&&<p role="status">{message}</p>}<ul className="overview-list">{items.map(item=><li key={item.entity+item.id}><div><strong>{item.title}</strong><p>{names[item.entity]}{item.pending?' · Yarım kalan gönderim':''}</p></div><button className="secondary-button" disabled={busy} onClick={()=>void run(()=>send(item))}>{item.pending?'Aynı gönderimi tekrar dene':'Buluta gönder'}</button></li>)}</ul><div className="workspace-quick-links"><button disabled={busy||offset===0} className="text-button" onClick={()=>void run(()=>load(Math.max(0,offset-50)))}>Önceki</button><button disabled={busy||items.length<50} className="text-button" onClick={()=>void run(()=>load(offset+50))}>Sonraki</button></div></article>;
}
