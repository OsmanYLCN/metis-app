import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { FolderKanban, Plus, Search, StickyNote, Trash2 } from 'lucide-react';
import { loginStore } from '../identity/login';
import { loginSettings } from '../identity/config';
import type { TaskOwner } from '../tasks/client';
import { createEntry, deleteEntry, listEntries, saveEntry, type Entry, type EntryDraft, type EntryKind } from './client';

const blank = (): EntryDraft => ({ title: '', body: '', state: 'active', pinned: false });
const fromEntry = (entry: Entry): EntryDraft => ({ title: entry.title, body: entry.body, state: entry.state, pinned: entry.pinned });
const message = (error: unknown) => error instanceof Error ? error.message : 'İşlem tamamlanamadı. Tekrar dene.';

export function WorkspaceView({ kind, onAccount }: { kind: EntryKind; onAccount: () => void }) {
  const session = useSyncExternalStore(loginStore.subscribe, loginStore.getSnapshot);
  const name = kind === 'note' ? 'Notlarını' : 'Projelerini';
  if (!globalThis.window?.__TAURI__) return <section className="empty-state"><h2>{name} Windows uygulamasında.</h2><p>Tarayıcı önizlemesi kayıt tutmaz.</p></section>;
  if (session.phase !== 'signedIn' || session.expiresAt <= Date.now() || loginSettings.kind !== 'ready')
    return <section className="empty-state"><h2>{name} görmek için giriş yap.</h2><p>Kayıtlar bu cihazda ve hesabına ayrılmış alanda tutulur.</p><button className="primary-button" onClick={onAccount}>Hesabıma git</button></section>;
  const owner = { projectRef: new URL(loginSettings.config.url).hostname.split('.')[0], userId: session.userId.toLowerCase() };
  return <EntryBoard key={`${owner.projectRef}:${owner.userId}:${kind}`} kind={kind} owner={owner} />;
}

function EntryBoard({ kind, owner }: { kind: EntryKind; owner: TaskOwner }) {
  const notes = kind === 'note';
  const [items, setItems] = useState<Entry[]>([]);
  const [search, setSearch] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [editing, setEditing] = useState<Entry | 'new' | null>(null);
  const [draft, setDraft] = useState<EntryDraft>(blank);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const request = useRef(0);
  const newId = useRef<string | null>(null);
  const base = editing === 'new' ? blank() : editing ? fromEntry(editing) : null;
  const dirty = !!base && (draft.title !== base.title || draft.body !== base.body || draft.state !== base.state || draft.pinned !== base.pinned);

  async function load(query = search, append = false) {
    const attempt = ++request.current;
    setLoading(true); setError('');
    try {
      const page = await listEntries(owner, kind, query.trim(), append ? items.length : 0);
      if (attempt !== request.current) return;
      setItems(previous => append ? [...previous, ...page.items.filter(item => !previous.some(old => old.id === item.id))] : page.items);
      setHasMore(page.hasMore);
    } catch (failure) { if (attempt === request.current) setError(message(failure)); }
    finally { if (attempt === request.current) setLoading(false); }
  }
  useEffect(() => {
    const timer = setTimeout(() => void load(search, false), 250);
    return () => { clearTimeout(timer); ++request.current; };
  }, [kind, owner.projectRef, owner.userId, search]);
  function open(entry: Entry | 'new') {
    if (dirty) { setError('Önce açık kaydı kaydet veya vazgeç.'); return; }
    setEditing(entry); setDraft(entry === 'new' ? blank() : fromEntry(entry));
    setConfirmDelete(false); setError(''); setNotice('');
    if (entry === 'new') newId.current = crypto.randomUUID().replaceAll('-', '');
  }
  function discard() { setEditing(null); setDraft(blank()); setConfirmDelete(false); setError(''); newId.current = null; }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !editing) return;
    const title = draft.title.trim();
    if (!title || [...title].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(title)
      || [...draft.body].length > 20000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(draft.body)) {
      setError('Başlık 1–200, içerik en çok 20.000 karakter olmalı.'); return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = { ...draft, title };
      const saved = editing === 'new'
        ? await createEntry(owner, kind, newId.current!, payload)
        : await saveEntry(owner, editing, payload);
      setItems(previous => [saved, ...previous.filter(item => item.id !== saved.id)]);
      setEditing(saved); setDraft(fromEntry(saved)); newId.current = null;
      setNotice(notes ? 'Not kaydedildi.' : 'Proje kaydedildi.');
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!editing || editing === 'new' || busy || !confirmDelete) return;
    setBusy(true); setError('');
    try {
      await deleteEntry(owner, editing);
      setItems(previous => previous.filter(item => item.id !== editing.id));
      setNotice(notes ? 'Not silindi.' : 'Proje silindi.');
      setEditing(null); setDraft(blank()); setConfirmDelete(false);
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  return <section className="workspace-board" data-workspace-dirty={dirty} aria-label={notes ? 'Notlar çalışma alanı' : 'Projeler çalışma alanı'}>
    <div className="workspace-toolbar"><div><h2>{notes ? 'Fikirlerin için bir alan' : 'Üzerinde çalıştıkların'}</h2><p>{notes ? 'Yaz, düzenle ve önemli notları sabitle.' : 'Projelerini tanımla, durumlarını güncelle ve ilerlemeyi takip et.'}</p></div>
      <button className="primary-button" disabled={busy} onClick={() => open('new')}><Plus size={16} /> {notes ? 'Yeni not' : 'Yeni proje'}</button></div>
    <p className="workspace-local-note">Bu kayıtlar yalnızca bu cihazda tutulur. Bulut eşitlemesi henüz yok.</p>
    {notice && <p className="workspace-notice" role="status">{notice}</p>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <div className="workspace-columns">
      <div className="workspace-list-panel">
        <label className="workspace-search"><Search size={17} /><span className="sr-only">{notes ? 'Notlarda ara' : 'Projelerde ara'}</span><input aria-label={notes ? 'Notlarda ara' : 'Projelerde ara'} value={search} maxLength={100} placeholder={notes ? 'Notlarda ara' : 'Projelerde ara'} onChange={event => setSearch(event.target.value)} /></label>
        <div className="workspace-list-head"><span>{loading ? 'Yükleniyor…' : `${items.length} ${notes ? 'not' : 'proje'}`}</span><button className="text-button" onClick={() => void load()} disabled={loading}>Yenile</button></div>
        <div className="workspace-list" role="list">
          {items.map(entry => <div role="listitem" key={entry.id}><button className={`workspace-item ${editing !== 'new' && editing?.id === entry.id ? 'selected' : ''}`} onClick={() => open(entry)}>
            <span className="workspace-item-icon">{notes ? <StickyNote size={17} /> : <FolderKanban size={17} />}</span>
            <span className="workspace-item-copy"><strong>{entry.title}</strong><small>{entry.body.trim().slice(0, 90) || (notes ? 'Boş not' : 'Açıklama yok')}</small><em>{new Date(entry.updatedAt).toLocaleDateString('tr-TR')}{!notes ? ` · ${entry.state === 'active' ? 'Aktif' : entry.state === 'paused' ? 'Beklemede' : 'Tamamlandı'}` : ''}</em></span>
            {entry.pinned && <span className="workspace-pin">Sabit</span>}
          </button></div>)}
          {!loading && !items.length && <div className="workspace-list-empty">{search ? 'Aramana uygun kayıt yok.' : notes ? 'İlk notunu oluştur.' : 'İlk projeni oluştur.'}</div>}
        </div>
        {hasMore && <button className="text-button workspace-more" disabled={loading} onClick={() => void load(search, true)}>Daha fazla göster</button>}
      </div>
      <div className="workspace-editor-panel">
        {!editing ? <div className="workspace-editor-empty">{notes ? <StickyNote size={31} /> : <FolderKanban size={31} />}<h3>{notes ? 'Bir not seç veya yeni bir not yaz.' : 'Bir proje seç veya yenisini oluştur.'}</h3><p>Yazdıkların kaydettiğinde bu cihazda kalıcı olur.</p></div>
          : <form onSubmit={save} className="workspace-editor">
            <div className="workspace-editor-head"><span>{editing === 'new' ? notes ? 'YENİ NOT' : 'YENİ PROJE' : `SON GÜNCELLEME · ${new Date(editing.updatedAt).toLocaleString('tr-TR')}`}{dirty ? ' · KAYDEDİLMEDİ' : ''}</span><button type="button" className="text-button" disabled={busy} onClick={discard}>{dirty ? 'Vazgeç' : 'Kapat'}</button></div>
            <label htmlFor="workspace-title">{notes ? 'Not başlığı' : 'Proje adı'}</label>
            <input id="workspace-title" autoFocus value={draft.title} maxLength={200} disabled={busy} placeholder={notes ? 'Başlıksız not' : 'Projene bir ad ver'} onChange={event => setDraft({ ...draft, title: event.target.value })} />
            <label htmlFor="workspace-body">{notes ? 'İçerik' : 'Açıklama'}</label>
            <textarea id="workspace-body" value={draft.body} maxLength={20000} disabled={busy} placeholder={notes ? 'Aklındakileri buraya yaz…' : 'Bu proje ne için?'} onChange={event => setDraft({ ...draft, body: event.target.value })} />
            <div className="workspace-editor-options">{notes ? <label className="workspace-check"><input type="checkbox" checked={draft.pinned} disabled={busy} onChange={event => setDraft({ ...draft, pinned: event.target.checked })} /> Önemli not olarak sabitle</label>
              : <label>Durum <select value={draft.state} disabled={busy} onChange={event => setDraft({ ...draft, state: event.target.value as EntryDraft['state'] })}><option value="active">Aktif</option><option value="paused">Beklemede</option><option value="done">Tamamlandı</option></select></label>}</div>
            <div className="workspace-editor-actions">{editing !== 'new' && <button className="text-button workspace-delete" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Sil</button>}
              <button className="primary-button" type="submit" disabled={busy || !draft.title.trim()}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button></div>
            {confirmDelete && editing !== 'new' && <div className="workspace-confirm"><p><strong>{editing.title}</strong> kalıcı olarak silinsin mi?</p><div><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmDelete(false)}>İptal</button><button type="button" className="primary-button" disabled={busy} onClick={() => void remove()}>Evet, sil</button></div></div>}
          </form>}
      </div>
    </div>
  </section>;
}
