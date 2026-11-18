import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Search, X } from 'lucide-react';
import { loginStore } from '../identity/login';
import { loginSettings } from '../identity/config';
import { type TaskOwner } from '../tasks/client';

type Result = { id: string; title: string; text: string; kind: string; route: string; date: string };
export function GlobalSearch({ onClose, navigate }: { onClose: () => void; navigate: (route: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const session = useSyncExternalStore(loginStore.subscribe, loginStore.getSnapshot);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const owner = window.__TAURI__ && session.phase === 'signedIn' && session.expiresAt > Date.now() && loginSettings.kind === 'ready'
    ? { projectRef: new URL(loginSettings.config.url).hostname.split('.')[0], userId: session.userId.toLowerCase() } : null;
  return <dialog ref={dialog} className="global-search" aria-labelledby="global-search-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="section-heading"><h2 id="global-search-title"><Search size={18}/> Çalışma alanında ara</h2><button className="icon-button" aria-label="Aramayı kapat" onClick={onClose}><X size={19}/></button></div>
    {owner ? <SearchResults key={`${owner.projectRef}:${owner.userId}`} owner={owner} navigate={route => { onClose(); navigate(route); }}/> : <p>Yerel kayıtlarında arama yapmak için Windows uygulamasında oturum aç.</p>}
  </dialog>;
}

const kinds:Record<string,string>={all:'Tümü',task:'Görev',note:'Not',project:'Proje',goal:'Hedef',event:'Etkinlik',finance:'Finans'};
function SearchResults({owner,navigate}:{owner:TaskOwner;navigate:(route:string)=>void}){
 const[query,setQuery]=useState('');const[kind,setKind]=useState('all');const[offset,setOffset]=useState(0);
 const[items,setItems]=useState<Result[]>([]);const[total,setTotal]=useState(0);const[more,setMore]=useState(false);const[loading,setLoading]=useState(false);const[error,setError]=useState('');const[refresh,setRefresh]=useState(0);
 useEffect(()=>{let active=true;setLoading(!!query.trim());setError('');setItems([]);setTotal(0);setMore(false);
  if(!query.trim()){setLoading(false);return;}
  const timer=setTimeout(()=>{void window.__TAURI__!.core.invoke('workspace_search',{owner,query:query.trim(),kind,offset}).then(raw=>{
   if(!active)return;const page=raw as {items:Result[];total:number;hasMore:boolean};
   if(!page||!Array.isArray(page.items)||page.items.length>50||!Number.isSafeInteger(page.total)||page.total<0||typeof page.hasMore!=='boolean'||page.items.some(item=>!item||typeof item.id!=='string'||typeof item.title!=='string'||typeof item.text!=='string'||typeof item.date!=='string'||!(item.kind in kinds)||!['Tasks','Notes','Projects','Goals','Calendar','Finance'].includes(item.route)))throw new Error();
   setItems(page.items);setTotal(page.total);setMore(page.hasMore);
  }).catch(()=>{if(active)setError('Arama tamamlanamadı. Yeniden dene.');}).finally(()=>{if(active)setLoading(false);});},250);
  return()=>{active=false;clearTimeout(timer)};
 },[owner.projectRef,owner.userId,query,kind,offset,refresh]);
 return <><label className="workspace-search"><span className="sr-only">Arama metni</span><input autoFocus type="search" maxLength={100} value={query} placeholder="Başlık, açıklama veya kategori ara…" onChange={event=>{setQuery(event.target.value);setOffset(0)}}/></label>
 <div className="search-kinds" role="group" aria-label="Arama türü">{Object.entries(kinds).map(([value,label])=><button key={value} aria-pressed={kind===value} onClick={()=>{setKind(value);setOffset(0)}}>{label}</button>)}</div>
 {loading?<p role="status">Aranıyor…</p>:error?<p role="alert">{error} <button className="text-button" onClick={()=>setRefresh(n=>n+1)}>Yeniden dene</button></p>:<>
 <p className="section-description" role="status">{query.trim()?`${total} sonuç · ${total?offset+1:0}–${offset+items.length} gösteriliyor`:'Altı alandaki yerel kayıtlarında ara. Sonuçlar ilgili bölümü açar.'}</p>
 <ul className="search-results">{items.map(item=><li key={`${item.kind}:${item.id}`}><button onClick={()=>navigate(['task','note','project','goal','event'].includes(item.kind)?`${item.route}:record:${item.id}`:item.kind==='finance'?`Finance:month:${item.date.slice(0,7)}`:item.route)}><span>{kinds[item.kind]} · {item.date.slice(0,10)}</span><strong>{item.title}</strong><small>{item.text}</small></button></li>)}</ul>
 {query.trim()&&!total&&<p>Aramana uygun kayıt bulunamadı. Başka bir kelime veya tür seçebilirsin.</p>}
 <div className="search-pagination">{offset>0&&<button className="secondary-button" onClick={()=>setOffset(n=>Math.max(0,n-50))}>Önceki 50</button>}{more&&<button className="secondary-button" onClick={()=>setOffset(n=>n+50)}>Sonraki 50</button>}</div>
 </>}</>;
}
