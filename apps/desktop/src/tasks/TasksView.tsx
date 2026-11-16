import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { CheckCheck, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { loginStore } from '../identity/login';
import { loginSettings } from '../identity/config';
import { beginLocalDelivery, beginTaskAction, cloudStatuses, completeTask, confirmLocalDelivery, confirmTaskAction, createTask, deleteTask, listTasks, pendingCount, prepareTaskAction, renameTask, setTaskPlanning, type CloudStatus, type Task, type TaskOwner, type TaskPriority } from './client';
import { syncPendingTasks } from './sync';
import { listEntries, type Entry } from '../workspace/client';

export function TasksView({ onAccount, intent = '' }: { onAccount: () => void; intent?: string }) {
  const session = useSyncExternalStore(loginStore.subscribe, loginStore.getSnapshot);
  if (!globalThis.window?.__TAURI__) return <section className="empty-state">
    <CheckCheck size={32} /><h2>Görevlerin Windows uygulamasında.</h2>
    <p>Bu tarayıcı önizlemesinde görev kaydedilmez.</p>
    <button className="primary-button" onClick={onAccount}>Genel bakışa dön</button>
  </section>;
  if (session.phase !== 'signedIn' || session.expiresAt <= Date.now() || loginSettings.kind !== 'ready')
    return <section className="empty-state"><CheckCheck size={32} /><h2>Görevlerin için giriş yap.</h2>
      <p>Bu cihazdaki görevler her hesap için ayrı tutulur.<br />Oturum açıldıktan sonra kendi listeni görebilirsin.</p>
      <button className="primary-button" onClick={onAccount}>Hesabıma git</button></section>;
  const projectRef = new URL(loginSettings.config.url).hostname.split('.')[0];
  const userId = session.userId.toLowerCase();
  // Unmount on logout/account changes: stale async replies and drafts cannot cross accounts.
  return <TaskList key={`${projectRef}:${userId}`} owner={{ projectRef, userId }} intent={intent} />;
}

function TaskList({ owner, intent }: { owner: TaskOwner; intent: string }) {
  const [items, setItems] = useState<Task[]>([]);
  const [cloud, setCloud] = useState<Record<string, CloudStatus>>({});
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(true);
  useEffect(()=>{if(loaded&&intent==='new')document.getElementById('task-title')?.focus()},[loaded,intent]);
  const [title, setTitle] = useState('');
  const initialProject = intent.startsWith('project:') ? intent.slice(8) : '';
  const [projectId, setProjectId] = useState(initialProject);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>(0);
  const [projects, setProjects] = useState<Entry[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'open' | 'done' | 'all'>('open');
  const [projectFilter, setProjectFilter] = useState(initialProject || 'all');
  const [dateFilter, setDateFilter] = useState<'all' | 'overdue' | 'today' | 'week' | 'none'>(intent === 'overdue' || intent === 'today' || intent === 'week' ? intent : 'all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'high' | 'critical'>('all');
  const [sort, setSort] = useState<'due' | 'priority' | 'newest'>('due');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [queued, setQueued] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    setQueued(null);
    if (!busy) void pendingCount(owner).then(value => { if (active) setQueued(value); }).catch(() => { if (active) setQueued(null); });
    return () => { active = false; };
  }, [busy, items, owner.projectRef, owner.userId]);
  const [action, setAction] = useState<{ kind: 'edit' | 'delete'; task: Task; draft: string; projectId: string; dueDate: string; priority: TaskPriority } | null>(null);
  const [actionError, setActionError] = useState('');
  const actionTrigger = useRef<HTMLButtonElement | null>(null);
  const request = useRef(0);
  const inFlight = useRef(false);
  const draftId = useRef<string | null>(null);
  const syncAbort = useRef<AbortController | null>(null);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoAttempted = useRef(false);
  const autoBlocked = useRef(false);

  function scheduleAutoSync() {
    if (autoBlocked.current) return;
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => { autoTimer.current = null; void runSync(true); }, 200);
  }
  async function runSync(automatic: boolean) {
    if (inFlight.current || syncAbort.current || (automatic && autoBlocked.current)) return;
    const controller = new AbortController();
    syncAbort.current = controller;
    const attempt = ++request.current;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const signal = automatic ? AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) : controller.signal;
      const result = await syncPendingTasks(owner, signal, automatic ? 20 : 100);
      if (attempt !== request.current) return;
      setQueued(result.remaining);
      setNotice(result.sent ? `${result.sent} işlem buluta gönderildi. ${result.remaining} işlem bekliyor.`
        : result.remaining ? 'Gönderilmeye hazır işlem yok. Listeyi yenileyip tekrar dene.' : 'Bütün değişiklikler gönderildi.');
      autoBlocked.current = false;
    } catch (failure) {
      if (attempt === request.current) {
        autoBlocked.current = true;
        setError(`Buluta gönderim durdu. Yerel kayıtlar korundu. ${message(failure)}`);
      }
    } finally {
      if (syncAbort.current === controller) syncAbort.current = null;
      if (attempt === request.current) {
        inFlight.current = false; setBusy(false);
        void load(0, false);
      }
    }
  }

  function closeAction() {
    setAction(null); setActionError('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (actionTrigger.current?.isConnected) actionTrigger.current.focus();
      else document.getElementById('task-title')?.focus();
    }));
  }
  function beginAction(kind: 'edit' | 'delete', task: Task, trigger: HTMLButtonElement) {
    if (inFlight.current || action) return;
    actionTrigger.current = trigger;
    setAction({ kind, task, draft: task.title, projectId: task.projectId ?? '', dueDate: task.dueDate ?? '', priority: task.priority }); setActionError(''); setNotice(''); setError('');
  }
  async function applyAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || inFlight.current) return;
    const trimmed = action.draft.trim();
    if (action.kind === 'edit' && (!trimmed || [...trimmed].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(trimmed))) {
      setActionError('1–200 karakterlik bir görev başlığı yaz.'); return;
    }
    const attempt = ++request.current;
    inFlight.current = true; setBusy(true); setActionError(''); setNotice('');
    try {
      if (action.kind === 'edit') {
        const renamed = trimmed === action.task.title ? action.task : await renameTask(owner, action.task, trimmed);
        const saved = await setTaskPlanning(owner, renamed.id, action.projectId || null, action.dueDate || null, action.priority);
        if (attempt !== request.current) return;
        setItems(previous => previous.map(item => item.id === saved.id ? saved : item));
        if (cloud[saved.id]?.phase === 'sent') setCloud(previous => ({ ...previous, [saved.id]: { taskId: saved.id, phase: 'pendingRename', revision: null } }));
        setNotice(cloud[saved.id]?.phase === 'sent' && trimmed !== action.task.title ? 'Görev planı kaydedildi; başlık buluta gönderilecek.' : 'Görev planı kaydedildi.');
        if (trimmed !== action.task.title) scheduleAutoSync();
      } else {
        if (cloud[action.task.id]?.phase === 'sent' || cloud[action.task.id]?.phase === 'pendingDelete')
          await sendAction(action.task, 'delete', null, attempt);
        else await deleteTask(owner, action.task);
        if (attempt !== request.current) return;
        setItems(previous => previous.filter(item => item.id !== action.task.id));
        setNotice(cloud[action.task.id]?.phase === 'sent' ? 'Görev buluttan ve bu cihazdan silindi.' : 'Görev bu cihazdan silindi.');
      }
      closeAction();
    } catch (failure) { if (attempt === request.current) setActionError(message(failure)); }
    finally { if (attempt === request.current) { inFlight.current = false; setBusy(false); } }
  }

  async function load(offset = 0, clearMessages = true) {
    const attempt = ++request.current;
    inFlight.current = true; setBusy(true);
    if (clearMessages) { setError(''); setNotice(''); }
    try {
      const [result, projectPage] = await Promise.all([listTasks(owner, offset, projectFilter==='all'?null:projectFilter), listEntries(owner, 'project')]);
      const statuses = await cloudStatuses(owner, result.items.map(task => task.id));
      if (attempt !== request.current) return;
      setItems(previous => offset ? [...previous, ...result.items.filter(task => !previous.some(old => old.id === task.id))] : result.items);
      setCloud(previous => offset ? { ...previous, ...Object.fromEntries(statuses.map(status => [status.taskId, status])) }
        : Object.fromEntries(statuses.map(status => [status.taskId, status])));
      setHasMore(result.hasMore); setLoaded(true); setProjects(projectPage.items);
    } catch (failure) { if (attempt === request.current) setError(message(failure)); }
    finally { if (attempt === request.current) { setBusy(false); inFlight.current = false; } }
  }
  useEffect(() => { void load(); return () => { ++request.current; syncAbort.current?.abort(); if (autoTimer.current) clearTimeout(autoTimer.current); }; }, [owner.projectRef, owner.userId, projectFilter]);
  useEffect(() => {
    if (!loaded || queued === null || autoAttempted.current) return;
    autoAttempted.current = true;
    if (queued > 0) scheduleAutoSync();
  }, [loaded, queued]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const trimmed = title.trim();
    if (!trimmed || [...trimmed].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) {
      setError('1–200 karakterlik bir görev başlığı yaz.'); return;
    }
    draftId.current ??= crypto.randomUUID().replaceAll('-', '');
    const attempt = ++request.current;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const created = await createTask(owner, draftId.current, trimmed);
      const task = await setTaskPlanning(owner, created.id, projectId || null, dueDate || null, priority);
      if (attempt !== request.current) return;
      setItems(previous => [task, ...previous.filter(old => old.id !== task.id)]);
      setCloud(previous => ({ ...previous, [task.id]: { taskId: task.id, phase: 'pendingCreate', revision: null } }));
      setTitle(''); setProjectId(initialProject); setDueDate(''); setPriority(0); draftId.current = null; setNotice('Görev ve planı bu cihaza kaydedildi.');
      scheduleAutoSync();
    } catch (failure) { if (attempt === request.current) setError(message(failure)); }
    finally { if (attempt === request.current) { inFlight.current = false; setBusy(false); } }
  }
  async function toggle(task: Task) {
    if (inFlight.current) return;
    const attempt = ++request.current;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (cloud[task.id]?.phase === 'sent' || cloud[task.id]?.phase === 'pendingComplete') {
        const receipt = await sendAction(task, 'complete', !task.completed, attempt);
        if (attempt !== request.current) return;
        setItems(previous => previous.map(item => item.id === task.id ? { ...item, completed: !task.completed } : item));
        setNotice(task.completed ? 'Görev bulutta yeniden açıldı.' : 'Görev bulutta tamamlandı.');
        setCloud(previous => ({ ...previous, [task.id]: { taskId: task.id, phase: 'sent', revision: receipt } }));
        return;
      }
      const saved = await completeTask(owner, task.id, !task.completed);
      if (attempt !== request.current) return;
      setItems(previous => previous.map(item => item.id === saved.id ? saved : item));
      setNotice(saved.completed ? 'Görev tamamlandı.' : 'Görev yeniden açıldı.');
    } catch (failure) { if (attempt === request.current) setError(message(failure)); }
    finally { if (attempt === request.current) { inFlight.current = false; setBusy(false); } }
  }
  async function sendAction(task: Task, kind: 'complete' | 'delete', completed: boolean | null, attempt: number): Promise<number> {
    const prepared = await prepareTaskAction(owner, task.id, kind, completed);
    if (attempt !== request.current) throw new Error('Oturum veya liste değişti. Listeyi yenile.');
    setCloud(previous => ({ ...previous, [task.id]: { taskId: task.id, phase: kind === 'delete' ? 'pendingDelete' : 'pendingComplete', revision: null } }));
    const frozen = await beginTaskAction(owner, prepared);
    const receipt = await loginStore.sendOneLocalAction(frozen, new AbortController().signal);
    if (attempt !== request.current) throw new Error('Oturum veya liste değişti. Listeyi yenile.');
    await confirmTaskAction(owner, frozen, receipt.revision);
    return receipt.revision;
  }
  async function retryAction(task: Task) {
    if (inFlight.current) return;
    const kind = cloud[task.id]?.phase === 'pendingDelete' ? 'delete' : 'complete';
    const attempt = ++request.current;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const revision = await sendAction(task, kind, kind === 'complete' ? !task.completed : null, attempt);
      if (attempt !== request.current) return;
      if (kind === 'delete') setItems(previous => previous.filter(item => item.id !== task.id));
      else {
        setItems(previous => previous.map(item => item.id === task.id ? { ...item, completed: !task.completed } : item));
        setCloud(previous => ({ ...previous, [task.id]: { taskId: task.id, phase: 'sent', revision } }));
      }
      setNotice(kind === 'delete' ? 'Görev buluttan silindi.' : 'Görev durumu bulutta güncellendi.');
    } catch (failure) { if (attempt === request.current) setError(message(failure)); }
    finally { if (attempt === request.current) { inFlight.current = false; setBusy(false); } }
  }
  async function sendOne(task: Task) {
    if (inFlight.current) return;
    const attempt = ++request.current;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const operation = await beginLocalDelivery(owner, task.id);
      if (!operation) throw new Error('Bu görev için bekleyen gönderim kaydı yok.');
      const receipt = operation.kind === 'create'
        ? await loginStore.sendOneLocalCreate(operation, new AbortController().signal)
        : await loginStore.sendOneLocalRename(operation, new AbortController().signal);
      if (attempt !== request.current) return;
      await confirmLocalDelivery(owner, operation, receipt.outcome, receipt.revision);
      setCloud(previous => ({ ...previous, [task.id]: { taskId: task.id, phase: 'sent', revision: receipt.revision } }));
      setNotice(operation.kind === 'create' ? 'Görev buluta gönderildi.' : 'Başlık bulutta güncellendi.');
    } catch (failure) { if (attempt === request.current) setError(message(failure)); }
    finally { if (attempt === request.current) { inFlight.current = false; setBusy(false); } }
  }
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const nextWeek = new Date(today); nextWeek.setDate(today.getDate()+7);
  const weekKey = `${nextWeek.getFullYear()}-${String(nextWeek.getMonth()+1).padStart(2,'0')}-${String(nextWeek.getDate()).padStart(2,'0')}`;
  const visible = items.filter(task => task.id === action?.task.id || (
    (statusFilter === 'all' || task.completed === (statusFilter === 'done'))
    && (projectFilter === 'all' || (projectFilter === 'none' ? !task.projectId : task.projectId === projectFilter))
    && (priorityFilter === 'all' || task.priority >= (priorityFilter === 'critical' ? 3 : 2))
    && (dateFilter === 'all' || (dateFilter === 'none' ? !task.dueDate : dateFilter === 'overdue' ? !!task.dueDate && task.dueDate < todayKey && !task.completed : dateFilter === 'today' ? task.dueDate === todayKey : !!task.dueDate && task.dueDate >= todayKey && task.dueDate <= weekKey))
    && task.title.toLocaleLowerCase('tr-TR').includes(query.trim().toLocaleLowerCase('tr-TR'))
  )).sort((a, b) => sort === 'priority' ? b.priority - a.priority || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')
    : sort === 'newest' ? b.createdAt.localeCompare(a.createdAt)
    : (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.priority - a.priority);
  return <section className="panel tasks-panel" aria-label="Yerel görevler" aria-busy={busy}>
    <div className="section-heading"><div><h2>Bir sonraki küçük adımın</h2>
      <p className="section-description">Görevlerin bu cihazda saklanır. Açık oturumda bekleyen değişiklikler buluta gönderilir; buluttan indirme henüz yok.</p></div>
      <button className="text-button" disabled={busy || !!action} onClick={() => void load()}><RefreshCw size={15} /> Listeyi yenile</button></div>
    <p role="status">{queued === null ? 'Bekleyen kayıt sayısı henüz alınamadı.' : `${queued} yerel değişiklik bekliyor.`}
      {' '}<button className="text-button" disabled={busy || !!action || queued === 0} onClick={() => { autoBlocked.current = false; void runSync(false); }}>Şimdi buluta gönder</button></p>
    <form className="task-form" onSubmit={save}>
      <label htmlFor="task-title">Yeni görev</label>
      <div className="task-compose"><input id="task-title" autoFocus={intent==='new'} value={title} maxLength={200} disabled={busy || !loaded || !!action}
        placeholder="Ne yapmak istiyorsun?" autoComplete="off"
        onChange={event => { setTitle(event.target.value); draftId.current = null; }} />
        <button className="primary-button" disabled={busy || !loaded || !title.trim() || !!action} type="submit"><Plus size={17} /> Görev ekle</button></div>
      <div className="task-planning-fields">
        <label>Proje<select value={projectId} disabled={busy || !!action} onChange={event => setProjectId(event.target.value)}><option value="">Projesiz</option>{projects.filter(item => item.state !== 'done').map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
        <label>Son tarih<input type="date" value={dueDate} disabled={busy || !!action} onChange={event => setDueDate(event.target.value)} /></label>
        <label>Öncelik<select value={priority} disabled={busy || !!action} onChange={event => setPriority(Number(event.target.value) as TaskPriority)}><option value={0}>Normal</option><option value={1}>Düşük</option><option value={2}>Yüksek</option><option value={3}>Kritik</option></select></label>
      </div>
    </form>
    {error && <p className="task-message" role="alert">{error}</p>}
    <div className="workspace-quick-links" aria-label="Hızlı görev görünümleri"><button className="secondary-button" onClick={()=>{setStatusFilter('open');setDateFilter('today')}}>Bugün</button><button className="secondary-button" onClick={()=>{setStatusFilter('open');setDateFilter('overdue')}}>Geciken</button><button className="secondary-button" onClick={()=>{setStatusFilter('open');setDateFilter('week')}}>Bu hafta</button><button className="text-button" disabled={busy||!!action} onClick={()=>{setQuery('');setStatusFilter('all');setDateFilter('all');setProjectFilter('all');setPriorityFilter('all');setSort('due')}}>Filtreleri temizle</button></div>
    <div className="task-filters" aria-label="Görev filtreleri"><label>Görev ara<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Başlıkta ara" /></label><label>Durum<select value={statusFilter} onChange={event=>setStatusFilter(event.target.value as typeof statusFilter)}><option value="open">Açık</option><option value="done">Tamamlanan</option><option value="all">Tümü</option></select></label><label>Tarih<select value={dateFilter} onChange={event=>setDateFilter(event.target.value as typeof dateFilter)}><option value="all">Tüm tarihler</option><option value="overdue">Geciken</option><option value="today">Bugün</option><option value="week">7 gün içinde</option><option value="none">Tarihsiz</option></select></label><label>Proje<select disabled={busy || !!action} value={projectFilter} onChange={event=>setProjectFilter(event.target.value)}><option value="all">Tüm projeler</option><option value="none">Projesiz</option>{projects.map(project=><option value={project.id} key={project.id}>{project.title}</option>)}</select></label><label>Öncelik<select value={priorityFilter} onChange={event=>setPriorityFilter(event.target.value as typeof priorityFilter)}><option value="all">Tüm öncelikler</option><option value="high">Yüksek ve kritik</option><option value="critical">Yalnızca kritik</option></select></label><label>Sırala<select value={sort} onChange={event=>setSort(event.target.value as typeof sort)}><option value="due">Son tarih</option><option value="priority">Öncelik</option><option value="newest">En yeni</option></select></label></div>
    <p className="task-feedback" role="status">{busy ? 'İşleniyor…' : notice || (loaded ? `${visible.length} görev gösteriliyor${hasMore ? ' · Diğer kayıtlar için “Daha fazla göster”' : ''}` : 'Görevler yüklenemedi. Listeyi yenileyebilirsin.')}</p>
    {loaded && items.length === 0 && !hasMore && <div className="tasks-empty"><CheckCheck size={28} /><h3>İlk görevine yer aç.</h3><p>Yukarıya bir başlık yaz; küçük bir adımla başla.</p></div>}
    {loaded && items.length > 0 && visible.length === 0 && <p className="section-description">Bu filtrelerde görev bulunamadı.{hasMore ? ' Daha fazla görev yükleyebilirsin.' : ''}</p>}
    <ul className="task-list">{visible.map(task => <li key={task.id} className={task.completed ? 'is-complete' : ''}>
      <label><input type="checkbox" checked={task.completed} disabled={busy || !!action || ['pendingRename', 'pendingComplete', 'pendingDelete', 'conflict'].includes(cloud[task.id]?.phase ?? '')} onChange={() => void toggle(task)}
        aria-label={`${task.title}: ${task.completed ? 'yeniden aç' : 'tamamla'}`} /><span className="task-title-block"><span>{task.title}</span><span className="task-meta">{[task.projectId && projects.find(project => project.id === task.projectId)?.title, task.dueDate && new Date(`${task.dueDate}T12:00:00`).toLocaleDateString('tr-TR'), task.priority > 1 && (task.priority === 3 ? 'Kritik' : 'Yüksek')].filter(Boolean).join(' · ') || 'Plansız'}</span></span></label>
      <span className="small-tag">{task.completed ? 'Tamamlandı' : 'Açık'}</span>
      <span className="small-tag">{cloud[task.id]?.phase === 'sent' ? 'Bulutta'
        : cloud[task.id]?.phase === 'pendingComplete' ? 'Durum gönderimi bekliyor'
          : cloud[task.id]?.phase === 'pendingDelete' ? 'Silme gönderimi bekliyor'
        : cloud[task.id]?.phase === 'pendingRename' ? 'Değişiklik bekliyor'
          : cloud[task.id]?.phase === 'pendingCreate' ? 'Gönderim bekliyor'
            : cloud[task.id]?.phase === 'conflict' ? 'Bulut çatışması'
            : 'Yalnızca bu cihazda'}</span>
      <div className="task-row-actions">
        {!task.completed && (cloud[task.id]?.phase === 'pendingCreate' || cloud[task.id]?.phase === 'pendingRename')
          && <button className="text-button" disabled={busy || !!action} onClick={() => void sendOne(task)}>{cloud[task.id]?.phase === 'pendingRename' ? 'Değişikliği gönder' : 'Buluta gönder'}</button>}
        {['pendingComplete', 'pendingDelete'].includes(cloud[task.id]?.phase ?? '')
          && <button className="text-button" disabled={busy || !!action} onClick={() => void retryAction(task)}>İşlemi tekrar dene</button>}
        <button className="icon-button" disabled={busy || !!action || ['pendingRename', 'pendingComplete', 'pendingDelete', 'conflict'].includes(cloud[task.id]?.phase ?? '')} aria-label={`${task.title}: düzenle`} title="Başlığı düzenle" onClick={event => beginAction('edit', task, event.currentTarget)}><Pencil size={16} /></button>
        <button className="icon-button" disabled={busy || !!action || ['pendingRename', 'pendingComplete', 'pendingDelete', 'conflict'].includes(cloud[task.id]?.phase ?? '')} aria-label={`${task.title}: sil`} title="Görevi sil" onClick={event => beginAction('delete', task, event.currentTarget)}><Trash2 size={16} /></button>
      </div>
      {action?.task.id === task.id && <form className="task-editor" onSubmit={applyAction}
        aria-label={action.kind === 'edit' ? 'Görev başlığını düzenle' : 'Görevi silme onayı'}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) closeAction(); } }}>
        {action.kind === 'edit' ? <><label htmlFor="task-edit-title">Görev başlığı</label>
          <input id="task-edit-title" autoFocus value={action.draft} maxLength={200} disabled={busy}
            onChange={event => setAction({ ...action, draft: event.target.value })} />
          <div className="task-planning-fields"><label>Proje<select value={action.projectId} onChange={event => setAction({ ...action, projectId: event.target.value })}><option value="">Projesiz</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><label>Son tarih<input type="date" value={action.dueDate} onChange={event => setAction({ ...action, dueDate: event.target.value })} /></label><label>Öncelik<select value={action.priority} onChange={event => setAction({ ...action, priority: Number(event.target.value) as TaskPriority })}><option value={0}>Normal</option><option value={1}>Düşük</option><option value={2}>Yüksek</option><option value={3}>Kritik</option></select></label></div></>
          : <><h3>Bu görev silinsin mi?</h3><p className="task-delete-title">{action.task.title}</p><p>Bu cihazdaki kayıt kalıcı olarak silinecek. Bu işlem geri alınamaz.</p></>}
        {actionError && <p className="task-message" role="alert">{actionError}</p>}
        <div className="task-editor-actions">
          <button className="secondary-button" type="button" autoFocus={action.kind === 'delete'} disabled={busy} onClick={closeAction}>İptal</button>
          <button className="primary-button" type="submit" disabled={busy || (action.kind === 'edit' && !action.draft.trim())}>{action.kind === 'edit' ? 'Değişikliği kaydet' : 'Görevi kalıcı sil'}</button>
        </div>
      </form>}
    </li>)}</ul>
    {hasMore && <button className="text-button" disabled={busy || !!action} onClick={() => void load(items.length)}>Daha fazla göster</button>}
  </section>;
}
function message(failure: unknown) { return failure instanceof Error ? failure.message : 'İşlem tamamlanamadı. Tekrar dene.'; }
