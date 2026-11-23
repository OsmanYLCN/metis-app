import { CloudUpload } from './CloudUpload';
import { CloudInbox } from './CloudInbox';
import { syncPendingTasks } from '../tasks/sync';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Database, Download, RefreshCw } from 'lucide-react';
import { loginStore } from '../identity/login';
import { loginSettings } from '../identity/config';
import type { TaskOwner } from '../tasks/client';

type DeliveryStatus = { paused: boolean; pending: number; conflicts: number; uncertain: number };
type Count = { name: string; count: number };
type Backup = { id: string; createdAt: string; counts: Count[]; bytes: number };
type Listing = { directory: string; items: Backup[]; unreadable: number; paused: boolean };
type Preview = { backup: Backup; currentCounts: Count[]; currentDigest: string; backupDigest: string };
const names: Record<string, string> = { workspace_entries: 'Notlar ve projeler', tasks: 'Görevler', task_attributes: 'Görev planları', goals: 'Hedefler', finance_entries: 'Finans kayıtları', calendar_events: 'Etkinlikler', finance_budgets: 'Bütçeler', notification_state: 'Hatırlatma tercihleri', task_outbox: 'Görev gönderim geçmişi', task_action_outbox: 'Görev işlem geçmişi', cloud_bindings: 'Bulut sürüm bağlantıları' };
function errorText(e: unknown) {
  return e === 'conflict' ? 'Veri önizlemeden sonra değişti veya sonucu belirsiz bir bulut işlemi var. Listeyi yenile; sürmekte olan gönderimi tamamlamadan geri yükleme yapma.'
    : e === 'invalidInput' ? 'Yedek bu hesap veya uygulama sürümüyle uyumlu değil.'
      : 'İşlem tamamlanamadı. Yedek dosyasını, disk alanını ve Windows profilini kontrol et.';
}
async function call<T>(command: string, args: Record<string, unknown>): Promise<T> { return await window.__TAURI__!.core.invoke(command, args) as T; }
const when = (s: string) => new Date(s).toLocaleString('tr-TR');

export function DataSafetyView({ onAccount }: { onAccount: () => void }) {
  const session = useSyncExternalStore(loginStore.subscribe, loginStore.getSnapshot);
  if (!window.__TAURI__ || session.phase !== 'signedIn' || session.expiresAt <= Date.now() || loginSettings.kind !== 'ready')
    return <section className="empty-state"><Database size={32} /><h2>Veri alanın için giriş yap.</h2><p>Yedekler yalnızca seçili Metis hesabının yerel kayıtlarını içerir.</p><button className="primary-button" onClick={onAccount}>Hesabıma git</button></section>;
  const owner = { projectRef: new URL(loginSettings.config.url).hostname.split('.')[0], userId: session.userId.toLowerCase() };
  return <Board key={owner.projectRef + ':' + owner.userId} owner={owner} />;
}
function Board({ owner }: { owner: TaskOwner }) {
  const [data, setData] = useState<Listing | null>(null), [preview, setPreview] = useState<Preview | null>(null), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [delivery,setDelivery]=useState<DeliveryStatus|null>(null);
  const network=useRef<AbortController|null>(null);
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;let active=true;
    Promise.all([call<Listing>('backup_list',{owner}),call<DeliveryStatus>('delivery_status',{owner})]).then(([v,status])=>{if(active){setData(v);setDelivery(status)}}).catch(e=>{if(active)setError(errorText(e))}).finally(()=>{if(active)setBusy(false)});
    return () => { active=false;mounted.current = false;network.current?.abort(); };
  }, [owner.projectRef, owner.userId]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await action(); } catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function refresh() { const [v,status] = await Promise.all([call<Listing>('backup_list', { owner }),call<DeliveryStatus>('delivery_status',{owner})]); if (mounted.current){setData(v);setDelivery(status)} }
  async function send(){const controller=new AbortController();network.current=controller;try{const r=await syncPendingTasks(owner,AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),100);if(mounted.current)setNotice(r.sent+' görev işlemi gönderildi; '+r.remaining+' işlem bekliyor.')}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Gönderim tamamlanamadı.')}finally{network.current=null;await refresh()}}
  async function create() {
    await call<Backup>('backup_create', { owner });
    if (mounted.current) { setNotice('Şifreli yerel yedek oluşturuldu.'); setPreview(null); }
    await refresh();
  }
  async function inspect(id: string) {
    const v = await call<Preview>('backup_preview', { owner, id });
    if (mounted.current) { setPreview(v); setConfirmation(''); setNotice(''); }
  }
  async function restore() {
    if (!preview || confirmation !== 'GERİ YÜKLE') return;
    await call('backup_restore', { owner, id: preview.backup.id, currentDigest: preview.currentDigest, backupDigest: preview.backupDigest });
    if (mounted.current) { setPreview(null); setConfirmation(''); setNotice('Yerel kayıtlar geri yüklendi. Önceki durumun güvenlik yedeği alındı. Buluta gönderim duraklatıldı.'); }
    await refresh();
  }
  return <section className="data-safety" aria-busy={busy} data-workspace-dirty={busy && lock.current}>
    <div className="workspace-toolbar"><div><h2>Veri ve eşitleme</h2><p>Verinin nerede olduğunu gör, yerel geri dönüş noktası oluştur.</p></div><button className="secondary-button" disabled={busy} onClick={() => void run(refresh)}><RefreshCw size={16} /> Yenile</button></div>
    <div className="overview-columns"><article className="panel"><h3>Bu cihaz</h3><p>Görev, proje, not, hedef, takvim, finans ve bütçe kayıtları SQLite içinde tutulur.</p></article><article className="panel"><h3>Bulut kapsamı</h3><p>Görev başlığı, tamamlanma ve silme işlemleri gönderilebilir. Tüm desteklenen modüllerin bulut değişiklikleri aşağıda önbelleğe alınabilir. Seçilen bulut kaydı karşılaştırmadan sonra onayla uygulanabilir. Tam otomatik eşitleme henüz yok.</p></article></div>
    {data?.paused && <p className="workspace-error" role="status">Yedekten dönüş sonrası buluta gönderim duraklatıldı. Yerel verilerin açık kalır; bulutla bağlantılı görev işlemleri engellenir. Bulutla karşılaştırma ve uzlaştırma hazır olana kadar bu kilit açılmayacak.</p>}
    <article className="panel"><h3>Görev gönderim durumu</h3>{delivery?<><p>{delivery.pending} bekleyen · {delivery.conflicts} çakışan · {delivery.uncertain} sonucu henüz doğrulanmamış işlem.</p><button className="secondary-button" disabled={busy||delivery.paused||delivery.pending===0} onClick={()=>void run(send)}>Bekleyen görev işlemlerini gönder</button><p className="section-description">Bir seferde en fazla 100 işlem gönderilir. Bu düğme diğer modülleri eşitlemez ve buluttan veri indirmez.</p></>:<p>Gönderim durumu alınamadı.</p>}</article>
    <CloudUpload owner={owner} />
    <CloudInbox owner={owner} />
    <article className="panel"><h3>Şifreli yerel yedekler</h3><p>Yedek yalnızca bu Metis hesabının kayıtlarını ve gönderim geçmişini içerir; parola ve oturum anahtarlarını içermez. Windows profilinle şifrelenir. Aynı Windows profili ve desteklenen şema sürümüyle geri yüklenebilir; başka cihaza taşınabilir bir yedek değildir.</p><p>Dosyalar bu diskte tutulur. Disk arızasına karşı ayrıca güvenli bir konuma kopyalanmalıdır; Windows profilinin kaybında çözülemeyebilir.</p><button className="primary-button" disabled={busy} onClick={() => void run(create)}><Download size={16} /> Şimdi yerel yedek al</button>{data && <p className="section-description">Yedek klasörü: <code style={{ overflowWrap: 'anywhere' }}>{data.directory}</code></p>}</article>
    {error && <p className="workspace-error" role="alert">{error}</p>}{notice && <p className="workspace-notice" role="status">{notice}</p>}
    {data?.unreadable ? <p role="alert">{data.unreadable} yedek okunamadı. Dosyalar korunuyor.</p> : null}
    <article className="panel"><h3>Son 30 yedek</h3>{!data?.items.length ? <p>Henüz okunabilir yedek yok.</p> : <ul className="overview-list">{data.items.map(b => <li key={b.id}><div><strong>{when(b.createdAt)}</strong><small> · {Math.ceil(b.bytes / 1024)} KB</small></div><button className="text-button" disabled={busy} onClick={() => void run(() => inspect(b.id))}>Geri yüklemeyi incele</button></li>)}</ul>}</article>
    {preview && <article className="panel"><h3>Geri yükleme önizlemesi</h3><p>{when(preview.backup.createdAt)} tarihli yedek, bu hesabın mevcut yerel kayıtlarının yerini alacak. Diğer hesaplar ve bulut verisi değişmez. İşlemden önce mevcut durumun güvenlik yedeği alınır.</p><table><thead><tr><th>Veri</th><th>Şimdi</th><th>Yedekte</th></tr></thead><tbody>{preview.backup.counts.map(c => <tr key={c.name}><td>{names[c.name] ?? c.name}</td><td>{preview.currentCounts.find(v => v.name === c.name)?.count ?? 0}</td><td>{c.count}</td></tr>)}</tbody></table><p>Sonrasında otomatik ve elle buluta gönderim duraklatılacak. Uzlaştırma hazır olana kadar yeniden açılamaz.</p><label>Onay için GERİ YÜKLE yaz<input disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" /></label><div className="workspace-quick-links"><button className="secondary-button" disabled={busy} onClick={() => setPreview(null)}>Vazgeç</button><button className="primary-button" disabled={busy || confirmation !== 'GERİ YÜKLE'} onClick={() => void run(restore)}>Yerel veriyi geri yükle</button></div></article>}
  </section>;
}
