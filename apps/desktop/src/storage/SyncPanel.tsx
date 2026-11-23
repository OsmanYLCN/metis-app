import {useEffect,useRef,useState} from 'react';
import type {TaskOwner} from '../tasks/client';
import {downloadCloud,native,syncEvent,syncNow,getSyncActivity,type SyncStatus,type SyncActivity} from './sync';

type Preview={digest:string;cloudRecords:number;different:number;localOnly:number};
export function SyncPanel({owner,onChange}:{owner:TaskOwner;onChange:()=>Promise<void>}){
 const [status,setStatus]=useState<SyncStatus|null>(null),[preview,setPreview]=useState<Preview|null>(null);
 const [activity,setActivity]=useState<SyncActivity|undefined>(getSyncActivity(owner));
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[confirm,setConfirm]=useState('');
 const mounted=useRef(true),lock=useRef(false),network=useRef<AbortController|null>(null);
 async function refresh(){const s=await native<SyncStatus>('sync_status',{owner});if(mounted.current){setStatus(s);setActivity(getSyncActivity(owner));}}
 useEffect(()=>{mounted.current=true;const update=()=>{void refresh().catch(()=>{});};update();window.addEventListener(syncEvent,update);return()=>{mounted.current=false;network.current?.abort();window.removeEventListener(syncEvent,update);};},[owner.projectRef,owner.userId]);
 async function run(fn:(signal:AbortSignal)=>Promise<void>){
  if(lock.current)return;lock.current=true;setBusy(true);setMessage('');network.current=new AbortController();
  try{await fn(network.current.signal);}
  catch(e){if(mounted.current)setMessage(e instanceof Error?e.message:e==='conflict'?'Veri değişti, indirme tamamlanmadı veya bekleyen işlem var. Bulutu yeniden alıp önizlemeyi yenile.':'İşlem tamamlanamadı; kayıtlar ve gönderim kilidi korunuyor.');}
  finally{network.current=null;lock.current=false;if(mounted.current){setBusy(false);try{await refresh();await onChange();}catch{setMessage('Durum yenilenemedi. Yenile düğmesini kullan.');}}}
 }
 async function download(signal:AbortSignal){
  await downloadCloud(owner,signal,n=>{if(mounted.current)setMessage(n+' bulut değişikliği alındı.');});
  const p=await native<Preview>('recovery_preview',{owner});if(mounted.current){setPreview(p);setConfirm('');setMessage('Karşılaştırma hazır.');}
 }
 async function toggle(){await native('sync_enable',{owner,enabled:!status?.enabled});window.dispatchEvent(new Event('metis-sync-settings'));}
 return <article className="panel" aria-busy={busy}>
  <h3>Otomatik gönderim ve kurtarma</h3>
  <p>Uygulama açıkken görevler, görevlerin proje/tarih/öncelik bilgisi ve diğer altı modüldeki değişiklikler sırayla gönderilir. Şimdi gönder düğmesi ve otomatik gönderim yerel silmeleri de buluta taşır. Bulut kayıtları otomatik olarak cihazdaki kayıtların üzerine yazılmaz.</p>
  <p>{status?.enabled?'Otomatik gönderim açık':'Otomatik gönderim kapalı'} · {status?.pending??0} kalıcı gönderim · {status?.rejected??0} karar bekleyen ret.</p>
  <div className="workspace-quick-links">
   <button className="secondary-button" disabled={busy||!status||status.paused} onClick={()=>void run(toggle)}>{status?.enabled?'Otomatik gönderimi kapat':'Otomatik gönderimi aç'}</button>
   <button className="secondary-button" disabled={busy||!status||status.paused} onClick={()=>void run(async signal=>{const r=await syncNow(owner,signal);if(mounted.current)setMessage(r.sent+' işlem gönderildi; '+r.rejected+' işlem inceleme bekliyor.');})}>Değişiklikleri şimdi gönder</button>
   {busy&&<button className="text-button" onClick={()=>network.current?.abort()}>Ağ işlemini durdur</button>}
  </div>
  {status?.paused&&<div>
   <h4>Yedekten dönüşü uzlaştır</h4>
   <p>Gönderim kilitli. Önce mevcut durumun şifreli güvenlik yedeği alınır; eski görev gönderim geçmişi yeniden kurulmak üzere ayrılır. Sonra bulutun tamamı okunur. Bu işlem buluta yazmaz.</p>
   {!status.recovering?<button className="secondary-button" disabled={busy} onClick={()=>void run(async signal=>{await native('recovery_begin',{owner});await download(signal);})}>Güvenlik yedeği al ve karşılaştırmayı başlat</button>:<button className="secondary-button" disabled={busy} onClick={()=>void run(download)}>Bulutu al ve önizlemeyi yenile</button>}
   {preview&&<>
    <p>{preview.cloudRecords} bulut kaydı · {preview.different} fark · yaklaşık {preview.localOnly} yalnızca yerel kayıt.</p>
    <p>Bulutta bulunan kayıtlar için güncel bulut sürümü kullanılacak; bulutta silinenler cihazdan kaldırılacak. Yalnızca bu cihazdaki kayıtlar korunacak. Eski yerel içerik güvenlik yedeğinde kalır. Ayrıntıları aşağıdaki karşılaştırma alanından inceleyebilirsin.</p>
    <label>Onay için BULUTU ESAS AL yaz<input value={confirm} disabled={busy} onChange={e=>setConfirm(e.target.value)} autoComplete="off"/></label>
    <div className="workspace-quick-links">
     <button className="secondary-button" disabled={busy||confirm!=='BULUTU ESAS AL'} onClick={()=>void run(async()=>{await native('recovery_apply',{owner,digest:preview.digest});const p=await native<Preview>('recovery_preview',{owner});if(mounted.current){setPreview(p);setConfirm('');setMessage('Bulut sürümleri uygulandı; yerel kayıtların güvenlik yedeği korundu.');}})}>Bulut sürümlerini uygula</button>
     <button className="primary-button" disabled={busy||preview.different!==0} onClick={()=>void run(async signal=>{
      await downloadCloud(owner,signal);const fresh=await native<Preview>('recovery_preview',{owner});
      if(fresh.different!==0){if(mounted.current)setPreview(fresh);throw new Error('Bulutta yeni farklar var; önce güncel önizlemeyi uygula.');}
      await native('recovery_finish',{owner,digest:fresh.digest});
      if(mounted.current){setPreview(null);setMessage('Uzlaştırma tamamlandı. Gönderim kilidi açıldı; otomatik gönderimi istediğinde açabilirsin.');}
     })}>Uzlaştırmayı bitir ve gönderim kilidini aç</button>
    </div>
   </>}
  </div>}
  {activity&&<p className="section-description">{activity.message}</p>}
  {message&&<p role="status">{message}</p>}
 </article>;
}
