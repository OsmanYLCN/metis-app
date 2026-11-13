import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { CheckCheck, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { loginStore } from '../identity/login';
import { loginSettings } from '../identity/config';
import { beginLocalDelivery, cloudStatuses, completeTask, confirmLocalDelivery, createTask, deleteTask, listTasks, pendingCount, renameTask, type CloudStatus, type Task, type TaskOwner } from './client';

export function TasksView({ onAccount }: { onAccount: () => void }) {
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
  return <TaskList key={`${projectRef}:${userId}`} owner={{ projectRef, userId }} />;
}

function TaskList({ owner }: { owner: TaskOwner }) {
  const [items, setItems] = useState<Task[]>([]);
  const [cloud, setCloud] = useState<Record<string, CloudStatus>>({});
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(true);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [queued, setQueued] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    setQueued(null);
    if (!busy) void pendingCount(owner).then(value => { if (active) setQueued(value); }).catch(() => { if (active) setQueued(null); });
    return () => { active = false; };
  }, [busy, items, owner.projectRef, owner.userId]);
  const [action, setAction] = useState<{ kind: 'edit' | 'delete'; task: Task; draft: string } | null>(null);
  const [actionError, setActionError] = useState('');
  const actionTrigger = useRef<HTMLButtonElement | null>(null);
  const request = useRef(0);
  const inFlight = useRef(false);
  const draftId = useRef<string | null>(null);

  function closeAction() {
    setAction(null); setActionError('');
    requestAnimationFrame(() => {
      if (actionTrigger.current?.isConnected) actionTrigger.current.focus();
      else document.getElementById('task-title')?.focus();
    });
  }
  function beginAction(kind: 'edit' | 'delete', task: Task, trigger: HTMLButtonElement) {
    if (inFlight.current || action) return;
    actionTrigger.current = trigger;
    setAction({ kind, task, draft: task.title }); setActionError(''); setNotice(''); setError('');
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
        const saved = await renameTask(owner, action.task, trimmed);
        if (attempt !== request.current) return;
        setItems(previous => previous.map(item => item.id === saved.id ? saved : item));
        if (cloud[saved.id]?.phase === 'sent') setCloud(previous => ({ ...previous, [saved.id]: { taskId: saved.id, phase: 'pendingRename', revision: null } }));
        setNotice(cloud[saved.id]?.phase === 'sent' ? 'Başlık bu cihazda kaydedildi. Değişikliği buluta gönderebilirsin.' : 'Görev başlığı kaydedildi.');
      } else {
        await deleteTask(owner, action.task);
        if (attempt !== request.current) return;
        setItems(previous => previous.filter(item => item.id !== action.task.id));
        setNotice('Görev bu cihazdan silindi.');
      }
      closeAction();
    } catch (failure) { if (attempt === request.current) setActionError(message(failure)); }
    finally { if (attempt === request.current) { inFlight.current = false; setBusy(false); } }
  }

  async function load(offset = 0) {
    const attempt = ++request.current;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await listTasks(owner, offset);
      const statuses = await cloudStatuses(owner, result.items.map(task => task.id));
      if (attempt !== request.current) return;
      setItems(previous => offset ? [...previous, ...result.items.filter(task => !previous.some(old => old.id === task.id))] : result.items);
      setCloud(previous => offset ? { ...previous, ...Object.fromEntries(statuses.map(status => [status.taskId, status])) }
        : Object.fromEntries(statuses.map(status => [status.taskId, status])));
      setHasMore(result.hasMore); setLoaded(true);
    } catch (failure) { if (attempt === request.current) setError(message(failure)); }
    finally { if (attempt === request.current) { setBusy(false); inFlight.current = false; } }
  }
  useEffect(() => { void load(); return () => { ++request.current; }; }, [owner.projectRef, owner.userId]);

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
      const task = await createTask(owner, draftId.current, trimmed);
      if (attempt !== request.current) return;
      setItems(previous => [task, ...previous.filter(old => old.id !== task.id)]);
      setCloud(previous => ({ ...previous, [task.id]: { taskId: task.id, phase: 'pendingCreate', revision: null } }));
      setTitle(''); draftId.current = null; setNotice('Görev bu cihaza kaydedildi.');
    } catch (failure) { if (attempt === request.current) setError(message(failure)); }
    finally { if (attempt === request.current) { inFlight.current = false; setBusy(false); } }
  }
  async function toggle(task: Task) {
    if (inFlight.current) return;
    const attempt = ++request.current;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const saved = await completeTask(owner, task.id, !task.completed);
      if (attempt !== request.current) return;
      setItems(previous => previous.map(item => item.id === saved.id ? saved : item));
      setNotice(saved.completed ? 'Görev tamamlandı.' : 'Görev yeniden açıldı.');
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
      setNotice(operation.kind === 'create' ? 'Görev buluta gönderildi. Otomatik eşitleme henüz yok.' : 'Başlık bulutta güncellendi.');
    } catch (failure) { if (attempt === request.current) setError(message(failure)); }
    finally { if (attempt === request.current) { inFlight.current = false; setBusy(false); } }
  }
  return <section className="panel tasks-panel" aria-label="Yerel görevler" aria-busy={busy}>
    <div className="section-heading"><div><h2>Bir sonraki küçük adımın</h2>
      <p className="section-description">Görevlerin bu cihazda saklanır. Bulut eşitlemesi henüz yok.</p></div>
      <button className="text-button" disabled={busy || !!action} onClick={() => void load()}><RefreshCw size={15} /> Listeyi yenile</button></div>
    <p role="status">{queued === null ? 'Bekleyen kayıt sayısı henüz alınamadı.' : `${queued} yerel değişiklik gönderim hazırlığında.`} Değişiklikleri tek tek gönderebilirsin.</p>
    <form className="task-form" onSubmit={save}>
      <label htmlFor="task-title">Yeni görev</label>
      <div className="task-compose"><input id="task-title" value={title} maxLength={200} disabled={busy || !loaded || !!action}
        placeholder="Ne yapmak istiyorsun?" autoComplete="off"
        onChange={event => { setTitle(event.target.value); draftId.current = null; }} />
        <button className="primary-button" disabled={busy || !loaded || !title.trim() || !!action} type="submit"><Plus size={17} /> Görev ekle</button></div>
    </form>
    {error && <p className="task-message" role="alert">{error}</p>}
    <p className="task-feedback" role="status">{busy ? 'İşleniyor…' : notice || (loaded ? `${items.length} görev listeleniyor` : 'Görevler yüklenemedi. Listeyi yenileyebilirsin.')}</p>
    {loaded && items.length === 0 && !hasMore && <div className="tasks-empty"><CheckCheck size={28} /><h3>İlk görevine yer aç.</h3><p>Yukarıya bir başlık yaz; küçük bir adımla başla.</p></div>}
    <ul className="task-list">{items.map(task => <li key={task.id} className={task.completed ? 'is-complete' : ''}>
      <label><input type="checkbox" checked={task.completed} disabled={busy || !!action || ['sent', 'pendingRename', 'conflict'].includes(cloud[task.id]?.phase ?? '')} onChange={() => void toggle(task)}
        aria-label={`${task.title}: ${task.completed ? 'yeniden aç' : 'tamamla'}`} /><span>{task.title}</span></label>
      <span className="small-tag">{task.completed ? 'Tamamlandı' : 'Açık'}</span>
      <span className="small-tag">{cloud[task.id]?.phase === 'sent' ? 'Bulutta'
        : cloud[task.id]?.phase === 'pendingRename' ? 'Değişiklik bekliyor'
          : cloud[task.id]?.phase === 'pendingCreate' ? 'Gönderim bekliyor'
            : cloud[task.id]?.phase === 'conflict' ? 'Bulut çatışması'
            : 'Yalnızca bu cihazda'}</span>
      <div className="task-row-actions">
        {!task.completed && (cloud[task.id]?.phase === 'pendingCreate' || cloud[task.id]?.phase === 'pendingRename')
          && <button className="text-button" disabled={busy || !!action} onClick={() => void sendOne(task)}>{cloud[task.id]?.phase === 'pendingRename' ? 'Değişikliği gönder' : 'Buluta gönder'}</button>}
        <button className="icon-button" disabled={busy || !!action || ['pendingRename', 'conflict'].includes(cloud[task.id]?.phase ?? '')} aria-label={`${task.title}: düzenle`} title="Başlığı düzenle" onClick={event => beginAction('edit', task, event.currentTarget)}><Pencil size={16} /></button>
        <button className="icon-button" disabled={busy || !!action || ['sent', 'pendingRename', 'conflict'].includes(cloud[task.id]?.phase ?? '')} aria-label={`${task.title}: sil`} title={cloud[task.id]?.phase === 'sent' ? 'Buluttaki görev silme henüz hazır değil' : 'Görevi sil'} onClick={event => beginAction('delete', task, event.currentTarget)}><Trash2 size={16} /></button>
      </div>
      {action?.task.id === task.id && <form className="task-editor" onSubmit={applyAction}
        aria-label={action.kind === 'edit' ? 'Görev başlığını düzenle' : 'Görevi silme onayı'}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) closeAction(); } }}>
        {action.kind === 'edit' ? <><label htmlFor="task-edit-title">Görev başlığı</label>
          <input id="task-edit-title" autoFocus value={action.draft} maxLength={200} disabled={busy}
            onChange={event => setAction({ ...action, draft: event.target.value })} /></>
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
