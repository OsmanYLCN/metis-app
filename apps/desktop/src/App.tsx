import { GlobalSearch } from './search/GlobalSearch';
import { useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowUpRight, Bell, CalendarDays, ChartNoAxesCombined,
  CheckCheck, Circle, Files, FolderKanban,
  House, Layers3, Menu, RefreshCw, Sparkles, StickyNote,
  Sun, Target, Wallet, Workflow, X,
} from 'lucide-react';
import { checkHealth } from './api/health';
import { StorageCard } from './storage/StorageCard';
import { AccountCard } from './identity/AccountCard';
import { loginStore } from './identity/login';
import { TasksView } from './tasks/TasksView';
import { CentralReadCard } from './tasks/CentralReadCard';
import { WorkspaceView } from './workspace/WorkspaceView';
import { CalendarView } from './calendar/CalendarView';
import { ProductOverview } from './dashboard/ProductOverview';
import { GoalsView } from './goals/GoalsView';
import { FinanceView } from './finance/FinanceView';
import { AnalyticsView } from './analytics/AnalyticsView';
import { NotificationsView } from './notifications/NotificationsView';
import { NotificationSummary } from './notifications/NotificationSummary';

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
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(value => !value); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  const [taskIntent, setTaskIntent] = useState('');
  const [entryIntent, setEntryIntent] = useState('');
  const [financeMonth,setFinanceMonth]=useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
    try { const saved = localStorage.getItem('metis-theme'); return saved === 'light' || saved === 'dark' ? saved : 'system'; } catch { return 'system'; }
  });
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
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('metis-theme', theme); } catch { /* The selected theme still works for this session. */ } }, [theme]);
  useEffect(() => { document.title = `${current.label} · Metis`; }, [current.label]);
  useEffect(() => {
    loginStore.start();
    const clearSession = () => loginStore.suspend();
    window.addEventListener('focus', loginStore.checkExpiry);
    document.addEventListener('visibilitychange', loginStore.checkExpiry);
    window.addEventListener('pagehide', clearSession);
    return () => {
      window.removeEventListener('focus', loginStore.checkExpiry);
      document.removeEventListener('visibilitychange', loginStore.checkExpiry);
      window.removeEventListener('pagehide', clearSession);
    };
  }, []);

  function navigate(destination: string) {
    const [name, ...parts] = destination.split(':');
    if ((name !== selected || parts.length > 0 || entryIntent || taskIntent || financeMonth) && document.querySelector('[data-workspace-dirty="true"]')
      && !window.confirm('Kaydedilmemiş değişiklikler var. Bu sayfadan çıkılsın mı?')) return;
    setTaskIntent(name === 'Tasks' ? parts.join(':') : '');
    setEntryIntent(parts[0] === 'new' ? 'new' : parts[0] === 'record' && /^[a-f0-9]{32}$/.test(parts[1] ?? '') ? parts[1] : '');
    if (name === 'Dashboard' && parts[0] === 'account') setAccountOpen(true);
    setFinanceMonth(name==='Finance'&&parts[0]==='month'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(parts[1]??'')?parts[1]:'');
    setSelected(name);
    setMenuOpen(false);
    requestAnimationFrame(() => pageTitle.current?.focus());
  }

  const status = { checking: 'Kontrol ediliyor', online: 'Yerel API bağlı', offline: 'Yerel API kapalı' }[connection];

  return (
    <div className="app-shell">
      {searchOpen && <GlobalSearch onClose={()=>setSearchOpen(false)} navigate={navigate}/>}
      <a className="skip-link" href="#main">İçeriğe geç</a>
      <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="Ana gezinme">
        <div className="brand"><span className="brand-symbol"><Layers3 size={21} /></span><span>Metis<small>Kişisel çalışma alanın</small></span>
          <button className="icon-button mobile-only" aria-label="Menüyü kapat" onClick={() => setMenuOpen(false)}><X size={18} /></button>
        </div>
        <div className="workspace"><div className="workspace-avatar">M</div><div><strong>Kişisel alan</strong><span>Yerel önizleme</span></div><span className="workspace-dot" /></div>
        <div className="nav-heading">ÇALIŞMA ALANI</div>
        <nav>{modules.map(({ name, label, icon: Icon }) => (
          <button key={name} className={`nav-item ${selected === name ? 'active' : ''}`} aria-current={selected === name ? 'page' : undefined} onClick={() => navigate(name)}>
            <Icon size={18} /><span>{label}</span>{!['Dashboard', 'Calendar', 'Tasks', 'Projects', 'Notes', 'Goals', 'Finance', 'Analytics', 'Notifications'].includes(name) && <span className="planned-dot" title="Planlandı" aria-label="Planlandı" />}
          </button>
        ))}</nav>
        <div className="sidebar-bottom"><span className="foundation-tag"><span /> FOUNDATION</span><p>Önce sağlam bir temel.<br />Sonra, senin ritminde.</p><div className="build-label">M0 · Dilim 56 <span>v0.48.0</span></div></div>
      </aside>

      <div className="main-layout">
        <header className="topbar">
          <div className="breadcrumb"><button className="icon-button mobile-only" aria-label="Menüyü aç" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={20} /></button><span>Çalışma alanı</span><span className="slash">/</span><strong>{current.label}</strong></div>
          <div className="topbar-actions"><button className="secondary-button" onClick={()=>setSearchOpen(true)}>Ara · Ctrl+K</button><span className="preview-badge">Yerel önizleme</span><label className="theme-control"><Sun size={15} /><span className="sr-only">Görünüm</span><select aria-label="Görünüm" value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}><option value="system">Sistem</option><option value="light">Açık</option><option value="dark">Koyu</option></select></label></div>
        </header>

        <main id="main" tabIndex={-1}>
          <div className="page-heading"><div><div className="eyebrow">METIS / FOUNDATION</div><h1 ref={pageTitle} tabIndex={-1}>{selected === 'Dashboard' ? 'Bugün, senin ritminde.' : current.label}</h1><p>{selected === 'Dashboard' ? 'Hayatının farklı parçaları, tek bir sakin çalışma alanında.' : selected === 'Tasks' ? 'Küçük adımlar, sana ait bir düzen.' : selected === 'Calendar' ? 'Zamanını ve yaklaşan işlerini tek bakışta gör.' : selected === 'Goals' ? 'Yönünü belirle, ilerlemeni görünür kıl.' : selected === 'Notes' ? 'Düşüncelerini sakla, aradığını kolayca bul.' : selected === 'Projects' ? 'Fikirlerini projeye dönüştür, ilerlemeyi görünür kıl.' : selected === 'Finance' ? 'Gelir, gider ve bütçeni tek yerde izle.' : selected === 'Analytics' ? 'Kayıtlarının sana gösterdiği resmi gör.' : selected === 'Notifications' ? 'Yaklaşan planlarını ve hatırlatmalarını takip et.' : 'Bu alan ürün planında yer alıyor; henüz geliştirilmedi.'}</p></div><span className="phase-label"><Circle size={13} /> M0 · Yerel temel</span></div>

          {selected === 'Dashboard' ? <>
            <div className="dashboard-actions" aria-label="Hızlı oluştur"><button className="primary-button" onClick={()=>navigate('Tasks:new')}><CheckCheck size={17}/> Görev ekle</button><button className="secondary-button" onClick={()=>navigate('Notes:new')}><StickyNote size={17}/> Not yaz</button><button className="secondary-button" onClick={()=>navigate('Projects:new')}><FolderKanban size={17}/> Proje oluştur</button><button className="secondary-button" onClick={()=>navigate('Calendar')}><CalendarDays size={17}/> Takvimi aç</button></div>
            <ProductOverview navigate={navigate}/>
            <NotificationSummary onOpen={()=>navigate('Notifications')}/>
            <details className="dashboard-account" open={accountOpen} onToggle={event=>setAccountOpen(event.currentTarget.open)}><summary>Hesap ve bağlantı · {status}</summary>
            <section className="status-grid" aria-label="Temel durumları"><article className="status-card"><span className="card-icon mint"><Activity size={19} /></span><span className="card-caption">Bağlantı</span><h3 aria-live="polite">{status}</h3><p>Yalnızca API sürecinin sağlık kontrolü.</p><button className="text-button" onClick={() => void refresh()} disabled={connection === 'checking'}><RefreshCw size={14} className={connection === 'checking' ? 'spin' : ''} /> Yeniden kontrol et</button></article><StorageCard /><AccountCard /></section>
              <CentralReadCard/>
            </details>
          </> : selected === 'Tasks' ? <TasksView key={taskIntent} intent={taskIntent} onList={()=>navigate('Tasks')} onAccount={() => navigate('Dashboard:account')} /> : selected === 'Calendar' ? <CalendarView key={entryIntent} initialId={entryIntent} onAccount={() => navigate('Dashboard:account')} onTasks={(intent='') => navigate(intent?`Tasks:${intent}`:'Tasks')} /> : selected === 'Goals' ? <GoalsView key={entryIntent} initialId={entryIntent} onAccount={() => navigate('Dashboard:account')} /> : selected === 'Finance' ? <FinanceView key={`${financeMonth}:${entryIntent}`} initialMonth={financeMonth} initialId={entryIntent} onAccount={() => navigate('Dashboard:account')} /> : selected === 'Analytics' ? <AnalyticsView onAccount={() => navigate('Dashboard:account')} navigate={navigate} /> : selected === 'Notifications' ? <NotificationsView onAccount={() => navigate('Dashboard:account')} navigate={navigate} /> : selected === 'Notes' || selected === 'Projects' ? <WorkspaceView key={`${selected}:${entryIntent}`} startNew={entryIntent==='new'} initialId={entryIntent==='new'?'':entryIntent} kind={selected === 'Notes' ? 'note' : 'project'} onAccount={() => navigate('Dashboard:account')} onTasks={(projectId) => navigate(`Tasks:project:${projectId}`)} onOpenTask={id=>navigate(`Tasks:record:${id}`)} /> : <section className="empty-state"><span className="empty-icon"><current.icon size={32} strokeWidth={1.4} /></span><span className="small-tag">Planlandı</span><h2>{current.label} için yerimiz hazır.</h2><p>Bu bölüm şu an yalnızca gezinme iskeletidir.<br />Gerçek kayıtlar ve işlemler, ilgili geliştirme diliminde eklenecek.</p><button className="primary-button" onClick={() => navigate('Dashboard')}>Genel bakışa dön <ArrowUpRight size={17} /></button></section>}

          <footer><span><span className={`connection-dot ${connection}`} />{status}{lastChecked ? ` · ${lastChecked}` : ''}</span><span>Ürün modülleri geliştirme aşamasında</span></footer>
        </main>
      </div>
    </div>
  );
}
