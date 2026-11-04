import { useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowUpRight, Bell, CalendarDays, ChartNoAxesCombined,
  Check, CheckCheck, Circle, Command, Files, FolderKanban,
  House, Layers3, Menu, RefreshCw, Sparkles, StickyNote,
  Sun, Target, Wallet, Workflow, X,
} from 'lucide-react';
import { checkHealth } from './api/health';
import { StorageCard } from './storage/StorageCard';
import { AccountCard } from './identity/AccountCard';

const modules = [
  { name: 'Dashboard', label: 'Genel bakış', icon: House },
  { name: 'Calendar', label: 'Takvim', icon: CalendarDays },
  { name: 'Tasks', label: 'Görevler', icon: CheckCheck },
  { name: 'Projects', label: 'Projeler', icon: FolderKanban },
  { name: 'Finance', label: 'Finans', icon: Wallet },
  { name: 'Notes', label: 'Notlar', icon: StickyNote },
  { name: 'Goals', label: 'Hedefler', icon: Target },
  { name: 'Files', label: 'Dosyalar', icon: Files },
  { name: 'Notifications', label: 'Bildirimler', icon: Bell },
  { name: 'Automations', label: 'Otomasyonlar', icon: Workflow },
  { name: 'Analytics', label: 'Analizler', icon: ChartNoAxesCombined },
  { name: 'Assistant', label: 'Asistan', icon: Sparkles },
];

export function App() {
  const [selected, setSelected] = useState('Dashboard');
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [menuOpen, setMenuOpen] = useState(false);
  const [connection, setConnection] = useState<'checking' | 'online' | 'offline'>('checking');
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const pageTitle = useRef<HTMLHeadingElement>(null);
  const current = modules.find((module) => module.name === selected)!;

  async function refresh() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setConnection('checking');
    try {
      await checkHealth(controller.signal);
      if (!controller.signal.aborted) setConnection('online');
    } catch {
      if (!controller.signal.aborted) setConnection('offline');
    } finally {
      if (!controller.signal.aborted) setLastChecked(new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
    }
  }

  useEffect(() => { void refresh(); return () => request.current?.abort(); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { document.title = `${current.label} · Personal OS`; }, [current.label]);

  function navigate(name: string) {
    setSelected(name);
    setMenuOpen(false);
    requestAnimationFrame(() => pageTitle.current?.focus());
  }

  const status = { checking: 'Kontrol ediliyor', online: 'Yerel API bağlı', offline: 'Yerel API kapalı' }[connection];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">İçeriğe geç</a>
      <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="Ana gezinme">
        <div className="brand"><span className="brand-symbol"><Layers3 size={21} /></span><span>Personal OS<small>Kişisel çalışma alanın</small></span>
          <button className="icon-button mobile-only" aria-label="Menüyü kapat" onClick={() => setMenuOpen(false)}><X size={18} /></button>
        </div>
        <div className="workspace"><div className="workspace-avatar">P</div><div><strong>Kişisel alan</strong><span>Yerel önizleme</span></div><span className="workspace-dot" /></div>
        <div className="nav-heading">ÇALIŞMA ALANI</div>
        <nav>{modules.map(({ name, label, icon: Icon }) => (
          <button key={name} className={`nav-item ${selected === name ? 'active' : ''}`} aria-current={selected === name ? 'page' : undefined} onClick={() => navigate(name)}>
            <Icon size={18} /><span>{label}</span>{name !== 'Dashboard' && <span className="planned-dot" title="Planlandı" aria-label="Planlandı" />}
          </button>
        ))}</nav>
        <div className="sidebar-bottom"><span className="foundation-tag"><span /> FOUNDATION</span><p>Önce sağlam bir temel.<br />Sonra, senin ritminde.</p><div className="build-label">M0 · Dilim 04 <span>v0.4.0</span></div></div>
      </aside>

      <div className="main-layout">
        <header className="topbar">
          <div className="breadcrumb"><button className="icon-button mobile-only" aria-label="Menüyü aç" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={20} /></button><span>Çalışma alanı</span><span className="slash">/</span><strong>{current.label}</strong></div>
          <div className="topbar-actions"><span className="preview-badge">Yerel önizleme</span><label className="theme-control"><Sun size={15} /><span className="sr-only">Görünüm</span><select aria-label="Görünüm" value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}><option value="system">Sistem</option><option value="light">Açık</option><option value="dark">Koyu</option></select></label></div>
        </header>

        <main id="main" tabIndex={-1}>
          <div className="page-heading"><div><div className="eyebrow">PERSONAL OS / FOUNDATION</div><h1 ref={pageTitle} tabIndex={-1}>{selected === 'Dashboard' ? 'Her şey için bir başlangıç.' : current.label}</h1><p>{selected === 'Dashboard' ? 'Hayatının farklı parçaları, tek bir sakin çalışma alanında.' : 'Bu alan ürün planında yer alıyor; henüz geliştirilmedi.'}</p></div><span className="phase-label"><Circle size={13} /> M0 · Yerel temel</span></div>

          {selected === 'Dashboard' ? <>
            <section className="hero-card" aria-labelledby="hero-title"><div className="hero-copy"><span className="hero-kicker"><span /> TEMEL OLUŞTURULUYOR</span><h2 id="hero-title">Kendi düzenin.<br />Kendi ritmin.</h2><p>Planların, fikirlerin ve günlük hayatın için<br className="desktop-only" /> birlikte büyüyecek bir alan.</p><button className="primary-button" onClick={() => document.getElementById('foundation')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Temeli keşfet <ArrowUpRight size={17} /></button></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="art-core"><Layers3 size={40} strokeWidth={1.3} /></div><div className="art-chip chip-top"><CalendarDays size={19} /></div><div className="art-chip chip-right"><CheckCheck size={20} /></div><div className="art-chip chip-bottom"><StickyNote size={19} /></div><span className="art-spark spark-one" /><span className="art-spark spark-two" /><span className="art-caption">BİR ALAN. BİRÇOK OLASILIK.</span></div></section>

            <section className="status-grid" aria-label="Temel durumları"><article className="status-card"><span className="card-icon mint"><Activity size={19} /></span><span className="card-caption">Bağlantı</span><h3 aria-live="polite">{status}</h3><p>Yalnızca API sürecinin sağlık kontrolü.</p><button className="text-button" onClick={() => void refresh()} disabled={connection === 'checking'}><RefreshCw size={14} className={connection === 'checking' ? 'spin' : ''} /> Yeniden kontrol et</button></article><StorageCard /><AccountCard /></section>

            <div className="lower-grid"><section className="panel" id="foundation" aria-labelledby="foundation-title"><div className="section-heading"><h2 id="foundation-title">İlk adım, sağlam temel</h2><span className="subtle-label">03 / M0</span></div><p className="section-description">Bu önizlemede yer alanlar</p><ul className="foundation-list"><li><span className="check-icon"><Check size={14} /></span><div><strong>Ortak uygulama kabuğu</strong><p>Gezinme, görünüm ve tutarlı bir başlangıç.</p></div><span className="row-status">Hazır</span></li><li><span className="check-icon"><Check size={14} /></span><div><strong>Yerel API bağlantısı</strong><p>Gerçek health endpoint ve görünür bağlantı durumu.</p></div><span className="row-status">Hazır</span></li><li><span className="pending-icon"><Circle size={14} /></span><div><strong>Hesap ve eşitleme</strong><p>Ayrı, kontrollü geliştirme dilimleri.</p></div><span className="subtle-label">Sonra</span></li></ul></section><section className="panel next-panel"><div className="card-icon neutral"><Command size={19} /></div><h2>Adım adım, birlikte.</h2><p>Bu ekran uygulamanın ilk temelidir. Görev, finans, takvim ve diğer ürün modülleri henüz çalışmaz.</p><div className="next-note"><span className="note-dot" /><span>Sonraki dilim, sen “devam edelim” dediğinde.</span></div></section></div>
          </> : <section className="empty-state"><span className="empty-icon"><current.icon size={32} strokeWidth={1.4} /></span><span className="small-tag">Planlandı</span><h2>{current.label} için yerimiz hazır.</h2><p>Bu bölüm şu an yalnızca gezinme iskeletidir.<br />Gerçek kayıtlar ve işlemler, ilgili geliştirme diliminde eklenecek.</p><button className="primary-button" onClick={() => navigate('Dashboard')}>Genel bakışa dön <ArrowUpRight size={17} /></button></section>}

          <footer><span><span className={`connection-dot ${connection}`} />{status}{lastChecked ? ` · ${lastChecked}` : ''}</span><span>Yerel temel önizlemesi · Bulut servisi bağlı değil</span></footer>
        </main>
      </div>
    </div>
  );
}
