import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { FolderKanban, Plus, Search, StickyNote, Trash2 } from 'lucide-react';
import { loginStore } from '../identity/login';
import { loginSettings } from '../identity/config';
import { projectProgress, type ProjectProgress, type TaskOwner } from '../tasks/client';
import { getEntry, createEntry, deleteEntry, listEntries, saveEntry, type Entry, type EntryDraft, type EntryKind } from './client';
import { NotePreview } from './NotePreview';
import { ProjectTasks } from './ProjectTasks';

const blank = (): EntryDraft => ({ title: '', body: '', state: 'active', pinned: false });
const fromEntry = (entry: Entry): EntryDraft => ({ title: entry.title, body: entry.body, state: entry.state, pinned: entry.pinned });
const message = (error: unknown) => error instanceof Error ? error.message : 'İşlem tamamlanamadı. Tekrar dene.';

export function WorkspaceView({ kind, onAccount, onTasks, onOpenTask, startNew = false, initialId = '' }: { kind: EntryKind; startNew?: boolean; initialId?: string; onAccount: () => void; onOpenTask: (taskId:string)=>void; onTasks: (projectId: string) => void }) {
  const session = useSyncExternalStore(loginStore.subscribe, loginStore.getSnapshot);
  const name = kind === 'note' ? 'Notlarını' : 'Projelerini';
  if (!globalThis.window?.__TAURI__) return <section className="empty-state"><h2>{name} Windows uygulamasında.</h2><p>Tarayıcı önizlemesi kayıt tutmaz.</p></section>;
  if (session.phase !== 'signedIn' || session.expiresAt <= Date.now() || loginSettings.kind !== 'ready')
    return <section className="empty-state"><h2>{name} görmek için giriş yap.</h2><p>Kayıtlar bu cihazda ve hesabına ayrılmış alanda tutulur.</p><button className="primary-button" onClick={onAccount}>Hesabıma git</button></section>;
  const owner = { projectRef: new URL(loginSettings.config.url).hostname.split('.')[0], userId: session.userId.toLowerCase() };
  return <EntryBoard key={`${owner.projectRef}:${owner.userId}:${kind}`} kind={kind} owner={owner} onTasks={onTasks} onOpenTask={onOpenTask} startNew={startNew} initialId={initialId} />;
}

function EntryBoard({ kind, owner, onTasks, onOpenTask, startNew, initialId }: { kind: EntryKind; owner: TaskOwner; startNew: boolean; initialId: string; onOpenTask: (taskId:string)=>void; onTasks: (projectId: string) => void }) {
  const notes = kind === 'note';
  const [items, setItems] = useState<Entry[]>([]);
  const [search, setSearch] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [editing, setEditing] = useState<Entry | 'new' | null>(startNew ? 'new' : null);
  const [draft, setDraft] = useState<EntryDraft>(blank);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [targetError,setTargetError]=useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState<Record<string, ProjectProgress>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [preview, setPreview] = useState(false);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('updated');
  const request = useRef(0);
  const newId = useRef<string | null>(null);
  if (startNew && editing === 'new' && !newId.current) newId.current = crypto.randomUUID().replaceAll('-', '');
  const base = editing === 'new' ? blank() : editing ? fromEntry(editing) : null;
  const dirty = !!base && (draft.title !== base.title || draft.body !== base.body || draft.state !== base.state || draft.pinned !== base.pinned);

  useEffect(()=>{if(!initialId)return;let active=true;setBusy(true);setTargetError('');getEntry(owner,kind,initialId).then(entry=>{if(active){setEditing(entry);setDraft(fromEntry(entry));}}).catch(failure=>{if(active)setTargetError(message(failure));}).finally(()=>{if(active)setBusy(false)});return()=>{active=false}},[owner.projectRef,owner.userId,kind,initialId]);
  async function load(query = search, append = false) {
    const attempt = ++request.current;
    setLoading(true); setError('');
    try {
      const today=new Date(); const todayIso=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const [page,stats] = await Promise.all([listEntries(owner, kind, query.trim(), append ? items.length : 0, filter, sort),notes?Promise.resolve([]):projectProgress(owner,todayIso)]);
      if (attempt !== request.current) return;
      setItems(previous => append ? [...previous, ...page.items.filter(item => !previous.some(old => old.id === item.id))] : page.items);
      setHasMore(page.hasMore);
      if(!notes)setProgress(Object.fromEntries(stats.map(item=>[item.projectId,item])));
    } catch (failure) { if (attempt === request.current) setError(message(failure)); }
    finally { if (attempt === request.current) setLoading(false); }
  }
  useEffect(() => {
    const timer = setTimeout(() => void load(search, false), 250);
    return () => { clearTimeout(timer); ++request.current; };
  }, [kind, owner.projectRef, owner.userId, search, filter, sort]);
  function open(entry: Entry | 'new') {
    if(busy)return;
    if (dirty) { setError('Önce açık kaydı kaydet veya vazgeç.'); return; }
    setEditing(entry); setDraft(entry === 'new' ? blank() : fromEntry(entry)); setPreview(false);
    setConfirmDelete(false); setError(''); setNotice('');
    if (entry === 'new') newId.current = crypto.randomUUID().replaceAll('-', '');
  }
  function duplicate() {
    if(busy||!editing||editing==='new')return;
    if(dirty){setError('Kopyalamadan önce değişikliklerini kaydet veya vazgeç.');return;}
    const copy={...fromEntry(editing),title:(editing.title+' — Kopya').slice(0,200),state:'active' as const,pinned:false};
    newId.current=crypto.randomUUID().replaceAll('-','');setEditing('new');setDraft(copy);setConfirmDelete(false);setPreview(false);setNotice(notes?'Not kopyası hazır. Kaydet ile oluştur.':'Proje açıklaması kopyalandı. Bağlı görevler kopyalanmaz; Kaydet ile oluştur.');
  }
  function formatLines(prefix:string){
    const input=document.getElementById('workspace-body') as HTMLTextAreaElement|null;if(!input||busy)return;
    const start=input.selectionStart===0?0:draft.body.lastIndexOf('\n',input.selectionStart-1)+1;
    const endIndex=draft.body.indexOf('\n',input.selectionEnd);const end=endIndex<0?draft.body.length:endIndex;
    const changed=draft.body.slice(0,start)+draft.body.slice(start,end).split('\n').map(line=>prefix+line).join('\n')+draft.body.slice(end);
    if(changed.length>20000){setError('İçerik 20.000 karakter sınırını aşıyor.');return;}
    setDraft({...draft,body:changed});requestAnimationFrame(()=>{input.focus();input.setSelectionRange(start,end+changed.length-draft.body.length)});
  }
  function toggleCheck(index:number){if(busy)return;setDraft(old=>{const lines=old.body.split('\n');if(!/^[-*] \[[ xX]\] /.test(lines[index]??''))return old;lines[index]=lines[index].slice(0,3)+(/[xX]/.test(lines[index][3])?' ':'x')+lines[index].slice(4);return {...old,body:lines.join('\n')}})}
  function formatInline(marker:string){
    const input=document.getElementById('workspace-body') as HTMLTextAreaElement|null;if(!input||busy)return;
    const start=input.selectionStart,end=input.selectionEnd;const selected=draft.body.slice(start,end)||'metin';
    const body=draft.body.slice(0,start)+marker+selected+marker+draft.body.slice(end);
    if(body.length>20000){setError('İçerik 20.000 karakter sınırını aşıyor.');return;}
    setDraft({...draft,body});requestAnimationFrame(()=>{input.focus();input.setSelectionRange(start+marker.length,start+marker.length+selected.length)});
  }
  function discard() { setEditing(null); setDraft(blank()); setConfirmDelete(false); setPreview(false); setError(''); newId.current = null; }
  function template(name: string) {
    if (dirty || busy) { setError('Önce açık kaydı kaydet veya vazgeç.'); return; }
    open('new');
    const templates: Record<string, EntryDraft> = {
      daily: { ...blank(), title: 'Günlük plan', body: '# Bugün\n- [ ] Öncelikli iş\n- [ ] İkinci iş\n\n## Günün notları\n\n## Gün sonunda\n' },
      meeting: { ...blank(), title: 'Toplantı notu', body: '# Gündem\n- \n\n## Kararlar\n- \n\n## Yapılacaklar\n- [ ] \n' },
      project: { ...blank(), title: 'Yeni proje planı', body: '# Amaç\n\n## Kapsam\n\n## Aşamalar\n- [ ] Hazırlık\n- [ ] Uygulama\n- [ ] Değerlendirme\n' },
    };
    setDraft(templates[name]);
  }
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
      await load();
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
  const visible = items;
  return <section className="workspace-board" data-workspace-dirty={dirty} aria-label={notes ? 'Notlar çalışma alanı' : 'Projeler çalışma alanı'} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.currentTarget.querySelector<HTMLFormElement>('form.workspace-editor')?.requestSubmit(); } }}>
    <div className="workspace-toolbar"><div><h2>{notes ? 'Fikirlerin için bir alan' : 'Üzerinde çalıştıkların'}</h2><p>{notes ? 'Yaz, düzenle ve önemli notları sabitle.' : 'Projelerini tanımla, durumlarını güncelle ve ilerlemeyi takip et.'}</p></div>
      <button className="primary-button" disabled={busy} onClick={() => open('new')}><Plus size={16} /> {notes ? 'Yeni not' : 'Yeni proje'}</button></div>
    <p className="workspace-local-note">Bu kayıtlar yalnızca bu cihazda tutulur. Bulut eşitlemesi henüz yok.</p>
    <div className="workspace-quick-links">{notes ? <><button className="secondary-button" disabled={busy} onClick={()=>template('daily')}>Günlük plan şablonu</button><button className="secondary-button" disabled={busy} onClick={()=>template('meeting')}>Toplantı şablonu</button></> : <button className="secondary-button" disabled={busy} onClick={()=>template('project')}>Proje planı şablonu</button>}<span className="section-description">Ctrl+S ile kaydet</span></div>
    {targetError&&<p className="workspace-error" role="alert">{targetError}</p>}
    {notice && <p className="workspace-notice" role="status">{notice}</p>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <div className="workspace-columns">
      <div className="workspace-list-panel">
        <label className="workspace-search"><Search size={17} /><span className="sr-only">{notes ? 'Notlarda ara' : 'Projelerde ara'}</span><input aria-label={notes ? 'Notlarda ara' : 'Projelerde ara'} value={search} maxLength={100} placeholder={notes ? 'Notlarda ara' : 'Projelerde ara'} onChange={event => setSearch(event.target.value)} /></label>
        <div className="workspace-list-head"><span>{loading ? 'Yükleniyor…' : `${items.length} ${notes ? 'not' : 'proje'}`}</span><button className="text-button" onClick={() => void load()} disabled={loading}>Yenile</button></div>
        <label className="workspace-search">Göster<select aria-label="Kayıt filtresi" value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">Tümü</option>{notes?<option value="pinned">Sabit notlar</option>:<><option value="active">Aktif</option><option value="paused">Beklemede</option><option value="done">Tamamlanan</option></>}</select></label>
        <label className="workspace-search">Sırala<select aria-label="Kayıt sıralaması" value={sort} onChange={event=>setSort(event.target.value)}><option value="updated">Son güncellenen / sabit</option><option value="created">Yeni oluşturulan</option><option value="title">Ada göre</option></select></label><p className="section-description">Filtreleme ve sıralama tüm kayıtları kapsar.</p><div className="workspace-list" role="list">
          {visible.map(entry => <div role="listitem" key={entry.id}><button className={`workspace-item ${editing !== 'new' && editing?.id === entry.id ? 'selected' : ''}`} onClick={() => open(entry)}>
            <span className="workspace-item-icon">{notes ? <StickyNote size={17} /> : <FolderKanban size={17} />}</span>
            <span className="workspace-item-copy"><strong>{entry.title}</strong><small>{entry.body.trim().slice(0, 90) || (notes ? 'Boş not' : 'Açıklama yok')}</small>{!notes&&progress[entry.id]&&<span className="project-mini-progress"><i style={{width:`${Math.round(progress[entry.id].completed/progress[entry.id].total*100)}%`}}/></span>}<em>{new Date(entry.updatedAt).toLocaleDateString('tr-TR')}{!notes ? ` · ${entry.state === 'active' ? 'Aktif' : entry.state === 'paused' ? 'Beklemede' : 'Tamamlandı'}${progress[entry.id]?` · ${progress[entry.id].completed}/${progress[entry.id].total} görev`:''}` : ''}</em></span>
            {entry.pinned && <span className="workspace-pin">Sabit</span>}
          </button></div>)}
          {!loading && !items.length && <div className="workspace-list-empty">{search ? 'Aramana uygun kayıt yok.' : notes ? 'İlk notunu oluştur.' : 'İlk projeni oluştur.'}</div>}
          {!loading && items.length>0 && !visible.length && <div className="workspace-list-empty">Bu filtrede kayıt yok.{hasMore?' Diğer kayıtları yükleyebilirsin.':''}</div>}
        </div>
        {hasMore && <button className="text-button workspace-more" disabled={loading} onClick={() => void load(search, true)}>Daha fazla göster</button>}
      </div>
      <div className="workspace-editor-panel">
        {!editing ? <div className="workspace-editor-empty">{notes ? <StickyNote size={31} /> : <FolderKanban size={31} />}<h3>{notes ? 'Bir not seç veya yeni bir not yaz.' : 'Bir proje seç veya yenisini oluştur.'}</h3><p>Yazdıkların kaydettiğinde bu cihazda kalıcı olur.</p></div>
          : <form onSubmit={save} className="workspace-editor">
            <div className="workspace-editor-head"><span>{editing === 'new' ? notes ? 'YENİ NOT' : 'YENİ PROJE' : `SON GÜNCELLEME · ${new Date(editing.updatedAt).toLocaleString('tr-TR')}`}{dirty ? ' · KAYDEDİLMEDİ' : ''}</span><button type="button" className="text-button" disabled={busy} onClick={()=>{if(!dirty||window.confirm('Kaydedilmemiş değişiklikler silinsin mi?'))discard()}}>{dirty ? 'Vazgeç' : 'Kapat'}</button></div>
            <div className="workspace-quick-links">{editing!=='new'&&<button type="button" className="secondary-button" disabled={busy} onClick={duplicate}>Kopyasını oluştur</button>}</div><label htmlFor="workspace-title">{notes ? 'Not başlığı' : 'Proje adı'}</label>
            <input id="workspace-title" autoFocus value={draft.title} maxLength={200} disabled={busy} placeholder={notes ? 'Başlıksız not' : 'Projene bir ad ver'} onChange={event => setDraft({ ...draft, title: event.target.value })} />
            <div className="workspace-body-heading"><label htmlFor="workspace-body">{notes ? 'İçerik' : 'Açıklama'}</label>{notes&&<button type="button" className="text-button" aria-pressed={preview} onClick={()=>setPreview(value=>!value)}>{preview?'Düzenle':'Önizle'}</button>}</div>
            {notes&&!preview&&<div className="note-tools" role="group" aria-label="Not biçimlendirme"><button type="button" disabled={busy} onClick={()=>formatInline('**')}>Kalın</button><button type="button" disabled={busy} onClick={()=>formatInline('*')}>İtalik</button><button type="button" disabled={busy} onClick={()=>formatInline('`')}>Kod</button><button type="button" disabled={busy} onClick={()=>formatLines('# ')}>Başlık</button><button type="button" disabled={busy} onClick={()=>formatLines('## ')}>Alt başlık</button><button type="button" disabled={busy} onClick={()=>formatLines('- ')}>Madde</button><button type="button" disabled={busy} onClick={()=>formatLines('- [ ] ')}>Kontrol listesi</button></div>}
            {notes&&preview?<NotePreview body={draft.body} disabled={busy} onToggle={toggleCheck}/>:<textarea id="workspace-body" value={draft.body} maxLength={20000} disabled={busy} placeholder={notes ? 'Aklındakileri buraya yaz…' : 'Bu proje ne için?'} onChange={event => setDraft({ ...draft, body: event.target.value })} />}
            {notes&&<p className="note-count">{draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0} kelime · {draft.body.length}/20.000 karakter · Başlık için #, madde için - kullanabilirsin.</p>}
            {!notes&&editing!=='new'&&<div className="project-progress-card"><div><strong>{progress[editing.id]?.total??0} görev</strong><span>{progress[editing.id]?.completed??0} tamamlandı · {progress[editing.id]?.overdue??0} geciken</span></div><span className="project-progress-value">{progress[editing.id]?.total?Math.round(progress[editing.id].completed/progress[editing.id].total*100):0}%</span><div className="project-progress-track"><i style={{width:`${progress[editing.id]?.total?Math.round(progress[editing.id].completed/progress[editing.id].total*100):0}%`}}/></div></div>}
            <div className="workspace-editor-options">{notes ? <label className="workspace-check"><input type="checkbox" checked={draft.pinned} disabled={busy} onChange={event => setDraft({ ...draft, pinned: event.target.checked })} /> Önemli not olarak sabitle</label>
              : <label>Durum <select value={draft.state} disabled={busy} onChange={event => setDraft({ ...draft, state: event.target.value as EntryDraft['state'] })}><option value="active">Aktif</option><option value="paused">Beklemede</option><option value="done">Tamamlandı</option></select></label>}</div>
            <div className="workspace-editor-actions">{editing !== 'new' && <button className="text-button workspace-delete" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Sil</button>}
              <button className="primary-button" type="submit" disabled={busy || !draft.title.trim()}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button></div>
            {!notes&&editing!=='new'&&<ProjectTasks key={editing.id} owner={owner} projectId={editing.id} onTasks={()=>onTasks(editing.id)} onOpenTask={onOpenTask}/>}
            {confirmDelete && editing !== 'new' && <div className="workspace-confirm"><p><strong>{editing.title}</strong> kalıcı olarak silinsin mi?</p><div><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmDelete(false)}>İptal</button><button type="button" className="primary-button" disabled={busy} onClick={() => void remove()}>Evet, sil</button></div></div>}
          </form>}
      </div>
    </div>
  </section>;
}
