import {useEffect,useRef,useState} from 'react';
import type {TaskOwner} from '../tasks/client';
import {native,syncEvent} from './sync';
type Entry={entity:string;id:string;reason:string;digest:string;local:Record<string,unknown>|null;cloud:Record<string,unknown>|null;base:Record<string,unknown>|null;canKeepLocal:boolean};
const names:Record<string,string>={task:'Görev',note:'Not',project:'Proje',goal:'Hedef',event:'Etkinlik',finance:'Finans',budget:'Bütçe'};
const labels:Record<string,string>={title:'Başlık',body:'İçerik',description:'Açıklama',details:'Açıklama',state:'Durum',pinned:'Sabit',completed:'Tamamlandı',projectId:'Proje',dueDate:'Tarih',priority:'Öncelik',progress:'İlerleme',targetDate:'Hedef tarihi',eventDate:'Etkinlik günü',startTime:'Başlangıç',endTime:'Bitiş',direction:'İşlem türü',category:'Kategori',amountCents:'Tutar (kuruş)',entryDate:'İşlem tarihi',currency:'Para birimi',month:'Ay',limitCents:'Limit (kuruş)'};
const show=(v:unknown)=>v==null?'—':typeof v==='boolean'?(v?'Evet':'Hayır'):String(v);
export function ConflictPanel({owner}:{owner:TaskOwner}){
 const [items,setItems]=useState<Entry[]>([]),[offset,setOffset]=useState(0),[selected,setSelected]=useState<Entry|null>(null);
 const [choice,setChoice]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const alive=useRef(true),lock=useRef(false);
 async function load(n:number){const rows=await native<Entry[]>('merge_conflicts',{owner,offset:n});if(alive.current){setItems(rows);setOffset(n);setSelected(null);setChoice('');}}
 useEffect(()=>{alive.current=true;void load(0).catch(()=>{if(alive.current)setMessage('Çakışma listesi alınamadı.');});return()=>{alive.current=false;};},[owner.projectRef,owner.userId]);
 async function run(fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);try{await fn();}catch{if(alive.current)setMessage('Veri değişti veya bekleyen bir işlem var. Önce eşitlemeyi çalıştırıp bu listeyi yenile.');}finally{lock.current=false;if(alive.current)setBusy(false);}}
 async function resolve(){
  if(!selected||!choice)return;
  await native('merge_resolve',{owner,entity:selected.entity,id:selected.id,digest:selected.digest,choice});
  if(alive.current){setMessage('Seçimin uygulandı; önceki durum güvenlik yedeğinde. Yerel değişiklik varsa sonraki gönderimde alınacak.');await load(offset);}
  window.dispatchEvent(new Event(syncEvent));window.dispatchEvent(new Event('metis-workspace-updated'));
 }
 return <article className="panel"><h3>Karar bekleyen çakışmalar</h3>
  <p>Aynı alan iki tarafta farklı değişmişse veya bir tarafta silinmişse üzerine yazılmaz. Seçimden önce güncel kayıt tekrar denetlenir ve güvenlik yedeği alınır.</p>
  <button className="text-button" disabled={busy} onClick={()=>void run(()=>load(0))}>Çakışmaları yenile</button>
  {!items.length&&<p>Bu sayfada karar bekleyen kayıt yok.</p>}
  <ul className="overview-list">{items.map(i=><li key={i.entity+i.id}><div><strong>{show(i.local?.title??i.cloud?.title??i.local?.category??i.cloud?.category??names[i.entity])}</strong><p>{names[i.entity]} · {i.reason==='deleteEdit'?'Silme ve düzenleme çakışması':i.reason==='unknownBase'?'Ortak sürüm bilinmiyor':i.reason==='dependency'?'Bağlı kayıt kontrol edilmeli':'İki tarafta farklı değişiklik'}</p></div><button className="secondary-button" disabled={busy} onClick={()=>{setSelected(i);setChoice('');}}>Karşılaştır ve seç</button></li>)}</ul>
  <div className="workspace-quick-links"><button className="text-button" disabled={busy||!offset} onClick={()=>void run(()=>load(Math.max(0,offset-50)))}>Önceki</button><button className="text-button" disabled={busy||items.length<50} onClick={()=>void run(()=>load(offset+50))}>Sonraki</button></div>
  {selected&&<div><p>{!selected.cloud?'Buluttaki kayıt silinmiş. Yerel içeriği korumak istersen yeni bir kayıt olarak kopyala; aynı silinmiş kimlik yeniden kullanılamaz.':!selected.local?'Bu cihazda kayıt silinmiş; yerel sürümü seçmek silmeyi buluta göndermeye hazırlar.':'Seçtiğin kaydın bütün alanları kullanılacak.'}</p>
   <div style={{overflowX:'auto'}}><table><thead><tr><th>Alan</th><th>Ortak sürüm</th><th>Bu cihaz</th><th>Bulut</th></tr></thead><tbody>{Object.keys(selected.cloud??selected.local??selected.base??{}).map(k=><tr key={k}><th>{labels[k]??k}</th>{[selected.base,selected.local,selected.cloud].map((v,n)=><td key={n} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxWidth:280}}>{v?show(v[k]):'Silinmiş / yok'}</td>)}</tr>)}</tbody></table></div>
   <div className="workspace-quick-links"><button className="secondary-button" disabled={busy||!selected.canKeepLocal} onClick={()=>setChoice('local')}>Bu cihazdaki sürümü seç</button><button className="secondary-button" disabled={busy} onClick={()=>setChoice('cloud')}>Bulut sürümünü seç</button></div>
   {choice&&<p>{choice==='local'?'Bu cihazdaki':'Buluttaki'} sürüm kullanılacak. {choice==='cloud'&&!selected.cloud?'Bu cihazdaki kayıt kaldırılacak.':''}</p>}
   <button className="primary-button" disabled={busy||!choice} onClick={()=>void run(resolve)}>Seçimi onayla ve uygula</button>
  </div>}
  {message&&<p role="status">{message}</p>}
 </article>;
}
