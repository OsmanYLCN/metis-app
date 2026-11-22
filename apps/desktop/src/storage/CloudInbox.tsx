import { useEffect, useRef, useState } from 'react';
import { loginStore } from '../identity/login';
import type { TaskOwner } from '../tasks/client';

type Status = { cursor: string; records: number };
type Difference = { entity: string; id: string; title: string; state: string; local: Record<string, unknown> | null; cloud: Record<string, unknown>; deleted: boolean };
type Comparison = { items: Difference[]; total: number; hasMore: boolean };
const kinds: Record<string,string> = { task:'Görev', note:'Not', project:'Proje', goal:'Hedef', event:'Etkinlik', finance:'Finans', budget:'Bütçe' };
const states: Record<string,string> = { same:'Aynı', different:'Farklı — karar gerekli', onlyCloud:'Yalnızca bulutta', cloudDeleted:'Bulutta silinmiş, bu cihazda duruyor', absentBoth:'İki tarafta da silinmiş / yok' };
const labels: Record<string,string> = { title:'Başlık',body:'İçerik',description:'Açıklama',details:'Açıklama',state:'Durum',pinned:'Sabitlenmiş',completed:'Tamamlandı',projectId:'Proje kimliği',dueDate:'Son tarih',priority:'Öncelik',targetDate:'Hedef tarihi',progress:'İlerleme',eventDate:'Etkinlik tarihi',startTime:'Başlangıç',endTime:'Bitiş',direction:'Gelir / gider',category:'Kategori',amountCents:'Tutar (kuruş)',entryDate:'Kayıt tarihi',currency:'Para birimi',month:'Ay',limitCents:'Limit (kuruş)' };
const show = (value:unknown) => value == null ? '—' : typeof value === 'boolean' ? value ? 'Evet':'Hayır' : String(value);
async function call<T>(name:string,args:Record<string,unknown>) { return await window.__TAURI__!.core.invoke(name,args) as T; }
export function CloudInbox({owner}:{owner:TaskOwner}) {
 const [status,setStatus]=useState<Status|null>(null),[comparison,setComparison]=useState<Comparison|null>(null);
 const [offset,setOffset]=useState(0),[selected,setSelected]=useState<Difference|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const controller=useRef<AbortController|null>(null),mounted=useRef(true),lock=useRef(false);
 useEffect(()=>{mounted.current=true;let active=true;call<Status>('inbox_status',{owner}).then(s=>{if(active)setStatus(s)}).catch(()=>{if(active)setError('Bulut önbelleği açılamadı. Yerel kayıtların korunuyor.');});return()=>{active=false;mounted.current=false;controller.current?.abort();};},[owner.projectRef,owner.userId]);
 async function load(start:number){const page=await call<Comparison>('inbox_compare',{owner,offset:start});if(mounted.current){setComparison(page);setOffset(start);setSelected(null);}}
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();}catch(e){if(mounted.current)setError(e instanceof Error?e.message:e==='conflict'?'Bulut önbelleği başka işlemde değişti. Tekrar dene.':'Bulut yanıtı veya önbellek doğrulanamadı. Yerel kayıtlar değiştirilmedi.');}finally{lock.current=false;if(mounted.current)setBusy(false);}}
 async function download(){
  const abort=new AbortController();controller.current=abort;let count=0;
  try{let current=await call<Status>('inbox_status',{owner});
   for(let i=0;i<10;i++){
    const page=await loginStore.readChanges(owner,current.cursor,abort.signal);
    if(abort.signal.aborted)break;
    current=await call<Status>('inbox_stage',{owner,expected:current.cursor,page});
    const summary=page as {items:unknown[];hasMore:boolean};count+=summary.items.length;
    if(mounted.current){setStatus(current);setMessage(`${count} değişiklik önbelleğe alındı. Yerel kayıtlar değişmedi.`);}
    if(!summary.hasMore)break;
    if(i===9&&mounted.current)setMessage(`${count} değişiklik alındı. Devamı var; aynı düğmeyle kaldığın yerden alabilirsin.`);
   }
   if(mounted.current)await load(0);
  }finally{controller.current=null;}
 }
 return <article className="panel" aria-busy={busy}>
  <h3>Bulut kayıtlarını karşılaştır</h3>
  <p>Görev, proje, not, hedef, takvim, finans ve bütçedeki bulut değişikliklerini bu cihaza önbellek olarak al. Buradaki işlem yerel kayıtları değiştirmez ve buluta veri göndermez.</p>
  <p>{status?`${status.records} bulut kaydı önbellekte.`:'Önbellek hazırlanıyor.'} Bu sayı yerel kayıt sayısı değildir.</p>
  <div className="workspace-quick-links"><button className="secondary-button" disabled={busy} onClick={()=>void run(download)}>Bulut değişikliklerini al</button><button className="text-button" disabled={busy||!status} onClick={()=>void run(()=>load(0))}>Bu cihazla karşılaştır</button>{busy&&<button className="text-button" onClick={()=>controller.current?.abort()}>İndirmeyi durdur</button>}</div>
  <p className="section-description">Karşılaştırma önbelleğin son alınan durumuyla yapılır. Farklılık, hangi kopyanın doğru olduğunu tek başına söylemez. Otomatik birleştirme ve farkları uygulama henüz açık değil.</p>
  {error&&<p role="alert" className="workspace-error">{error}</p>}{message&&<p role="status">{message}</p>}
  {comparison&&<><p>{comparison.total} bulut kaydı karşılaştırılabilir. Yalnızca bu cihazda olan kayıtlar bu listede yer almaz.</p><ul className="overview-list">{comparison.items.map(item=><li key={item.entity+item.id}><div><strong>{item.title||kinds[item.entity]}</strong><p>{kinds[item.entity]} · {states[item.state]}</p></div><button className="text-button" disabled={busy} onClick={()=>setSelected(item)}>Farkı incele</button></li>)}</ul><div className="workspace-quick-links"><button className="text-button" disabled={busy||offset===0} onClick={()=>void run(()=>load(Math.max(0,offset-50)))}>Önceki</button><button className="text-button" disabled={busy||!comparison.hasMore} onClick={()=>void run(()=>load(offset+50))}>Sonraki</button></div></>}
  {selected&&<div><h4>{selected.title} — karşılaştırma anındaki değerler</h4>{selected.deleted&&<p>Bulut kaydı silinmiş. Sağ sütun silinmeden kalan son değerleri gösterir.</p>}<div style={{overflowX:'auto'}}><table><thead><tr><th>Alan</th><th>Bu cihaz</th><th>Bulut</th></tr></thead><tbody>{Object.keys(selected.cloud).map(key=><tr key={key}><th>{labels[key]??key}</th><td style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxWidth:420}}>{show(selected.local?.[key])}</td><td style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxWidth:420}}>{show(selected.cloud[key])}</td></tr>)}</tbody></table></div><button className="text-button" onClick={()=>setSelected(null)}>Karşılaştırmayı kapat</button></div>}
 </article>;
}
