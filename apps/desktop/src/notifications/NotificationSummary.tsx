import { useEffect,useState,useSyncExternalStore } from 'react';
import { Bell,ArrowRight } from 'lucide-react';
import { loginStore } from '../identity/login';
import { loginSettings } from '../identity/config';
import { reminders,type Reminder } from './client';
export function NotificationSummary({onOpen}:{onOpen:()=>void}){
 const session=useSyncExternalStore(loginStore.subscribe,loginStore.getSnapshot);
 const[items,setItems]=useState<Reminder[]>([]),[total,setTotal]=useState(0),[failed,setFailed]=useState(false),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const ready=!!window.__TAURI__&&session.phase==='signedIn'&&session.expiresAt>Date.now()&&loginSettings.kind==='ready';
 useEffect(()=>{const changed=()=>setRefresh(n=>n+1);window.addEventListener('metis:reminders-changed',changed);return()=>window.removeEventListener('metis:reminders-changed',changed)},[]);
 useEffect(()=>{if(!ready||session.phase!=='signedIn'||loginSettings.kind!=='ready')return;let active=true;setLoading(true);setFailed(false);setItems([]);setTotal(0);
 const owner={projectRef:new URL(loginSettings.config.url).hostname.split('.')[0],userId:session.userId.toLowerCase()};
 reminders(owner).then(page=>{if(active){setItems(page.items.slice(0,3));setTotal(page.total)}}).catch(()=>{if(active)setFailed(true)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}
 },[ready,session.phase==='signedIn'?session.userId:'',refresh]);
 if(!ready)return null;
 return <section className="panel notification-summary"><div className="section-heading"><h2><Bell size={17}/> Hatırlatmalar</h2><button className="text-button" onClick={onOpen}>Tümünü aç <ArrowRight size={14}/></button></div>{loading?<p>Hatırlatmalar yükleniyor…</p>:failed?<p>Hatırlatmalar yüklenemedi. Bildirimler ekranından tekrar dene.</p>:items.length?<><p className="section-description">{total} okunmamış · Gecikenler ve gelecek 30 gün.</p><ul>{items.map(item=><li key={`${item.kind}:${item.id}:${item.due}`}><span>{new Date(`${item.due}T12:00:00`).toLocaleDateString('tr-TR',{day:'numeric',month:'short'})}</span><strong>{item.title}</strong></li>)}</ul></>:<p className="section-description">Yeni hatırlatma yok.</p>}</section>;
}
