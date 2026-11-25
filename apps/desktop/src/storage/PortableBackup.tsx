import { useRef, useState } from 'react';

type Preview = { ticket: string; accounts: number; records: number; pending: number };
const confirmation = 'TÜM YEREL VERİYİ DEĞİŞTİR';

export function PortableBackup() {
  const [password, setPassword] = useState(''), [repeat, setRepeat] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null), [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const lock = useRef(false);
  if (!window.__TAURI__) return null;
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (e) { setError(e === 'invalidInput' ? 'Parola yanlış, yedek bozulmuş veya bu sürümle uyumlu değil.' : e === 'conflict' ? 'Dosya zaten var veya önizlemeden sonra değişmiş. Yeni bir dosya adı seç ya da yedeği yeniden incele.' : 'İşlem tamamlanamadı. Dosya erişimini ve boş disk alanını kontrol et; mevcut veriler korunuyor.'); }
    finally { lock.current = false; setBusy(false); setPassword(''); setRepeat(''); }
  }
  const call = <T,>(cmd: string, args: Record<string, unknown>) => window.__TAURI__!.core.invoke(cmd, args) as Promise<T>;
  return <article className="panel" aria-busy={busy} data-workspace-dirty={busy || Boolean(password) || Boolean(preview)}>
    <h3>Taşınabilir şifreli yedek</h3>
    <p>Bu cihazdaki tüm Metis hesaplarının kayıtlarını, bulut sürümlerini ve yarım kalan gönderimlerini birlikte saklar. Oturum anahtarları ve servis parolaları dahil değildir. Başka bir Windows profilinde veya yeni bilgisayarda açılabilir.</p>
    <p>En az 12 karakterlik, yalnızca bu yedek için kullandığın bir parola belirle. Parolanı kaybedersen yedek açılamaz. Dosyayı başka bir diske kopyala; parola ile aynı yerde tutma.</p>
    <div className="workspace-quick-links">
      <label>Yedek parolası<input type="password" autoComplete="new-password" maxLength={256} disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
      <label>Yeni yedek için parolayı tekrarla<input type="password" autoComplete="new-password" maxLength={256} disabled={busy} value={repeat} onChange={e => setRepeat(e.target.value)} /></label>
    </div>
    <div className="workspace-quick-links">
      <button className="primary-button" disabled={busy || password.length < 12 || password !== repeat} onClick={() => void run(async () => {
        const file = await call<string | null>('portable_export', { password });
        if (file) setMessage('Şifreli yedek kaydedildi: ' + file);
      })}>Dosyaya yedekle</button>
      <button className="secondary-button" disabled={busy || password.length < 12} onClick={() => void run(async () => {
        setPreview(null); setConfirm('');
        setPreview(await call<Preview | null>('portable_inspect', { password }));
      })}>Mevcut yedeği seç ve incele</button>
    </div>
    {busy && <p role="status">Yedek güvenli biçimde işleniyor…</p>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {message && <p className="workspace-notice" role="status" style={{ overflowWrap: 'anywhere' }}>{message}</p>}
    {preview && <div>
      <h4>Yeni veri alanı hazır</h4>
      <p>{preview.accounts} hesap · {preview.records} kayıt ve geçmiş satırı · {preview.pending} gönderim günlüğü kaydı.</p>
      <p>Onayladığında uygulama yeniden başlayacak ve tüm yerel veri alanı bu yedekle değişecek. Şu anki dosyaların ayrı klasörde korunacak. Kaydedilmemiş düzenlemelerini önce kaydet. Bulut değişmez, otomatik alma ve gönderme kapalı başlar. Yeni cihazda aynı Metis hesabına giriş yapmalısın.</p>
      <p>İlk açılışta “Bulutu al ve güvenle birleştir” ile güncel durumu al; ardından bekleyen gönderimleri tamamla. Sonucu belirsiz işlemler aynı kimlikle tekrar denenir. Eski cihazda eşitlemeyi kapatarak bu cihazdan devam et.</p>
      <label>Onay için {confirmation} yaz<input autoComplete="off" disabled={busy} value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
      <div className="workspace-quick-links"><button className="secondary-button" disabled={busy} onClick={() => { setPreview(null); setConfirm(''); }}>Vazgeç</button>
        <button className="primary-button" disabled={busy || confirm !== confirmation} onClick={() => void run(async () => { await call('portable_activate', { ticket: preview.ticket }); })}>Geri yükle ve yeniden başlat</button></div>
    </div>}
  </article>;
}
