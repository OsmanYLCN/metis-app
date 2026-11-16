import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Search, X } from 'lucide-react';
import { loginStore } from '../identity/login';
import { loginSettings } from '../identity/config';
import { listTasks, type TaskOwner } from '../tasks/client';
import { listEntries } from '../workspace/client';
import { listGoals } from '../goals/client';

type Result = { id: string; title: string; text: string; kind: string; route: string };
export function GlobalSearch({ onClose, navigate }: { onClose: () => void; navigate: (route: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const session = useSyncExternalStore(loginStore.subscribe, loginStore.getSnapshot);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const owner = window.__TAURI__ && session.phase === 'signedIn' && session.expiresAt > Date.now() && loginSettings.kind === 'ready'
    ? { projectRef: new URL(loginSettings.config.url).hostname.split('.')[0], userId: session.userId.toLowerCase() } : null;
  return <dialog ref={dialog} className="global-search" aria-labelledby="global-search-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="section-heading"><h2 id="global-search-title"><Search size={18}/> Çalışma alanında ara</h2><button className="icon-button" aria-label="Aramayı kapat" onClick={onClose}><X size={19}/></button></div>
    {owner ? <SearchResults key={`${owner.projectRef}:${owner.userId}`} owner={owner} navigate={route => { onClose(); navigate(route); }}/> : <p>Yerel kayıtlarında arama yapmak için Windows uygulamasında oturum aç.</p>}
  </dialog>;
}

function SearchResults({ owner, navigate }: { owner: TaskOwner; navigate: (route: string) => void }) {
  const [items, setItems] = useState<Result[]>([]);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('Tümü');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [limited, setLimited] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    async function load() {
      const rows: Result[] = [];
      let truncated = false;
      for (const source of ['task', 'note', 'project'] as const) {
        for (let offset = 0; offset < 1000; offset += 100) {
          if (!active) return;
          const page = source === 'task' ? await listTasks(owner, offset) : await listEntries(owner, source, '', offset);
          rows.push(...page.items.map(item => ({ id: `${source}:${item.id}`, title: item.title, text: 'body' in item ? item.body : '', kind: source === 'task' ? 'Görev' : source === 'note' ? 'Not' : 'Proje', route: source === 'task' ? 'Tasks' : source === 'note' ? 'Notes' : 'Projects' })));
          if (!page.hasMore) break;
          if (offset === 900) truncated = true;
        }
      }
      if (!active) return;
      const goals = await listGoals(owner);
      rows.push(...goals.map(goal => ({ id: `goal:${goal.id}`, title: goal.title, text: goal.description, kind: 'Hedef', route: 'Goals' })));
      if (active) { setItems(rows); setLimited(truncated || goals.length === 200); }
    }
    void load().catch(() => { if (active) setError('Arama kayıtları okunamadı. Yeniden dene.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [owner.projectRef, owner.userId, refresh]);
  const needle = query.trim().toLocaleLowerCase('tr-TR');
  const matches = needle ? items.filter(item => (kind === 'Tümü' || item.kind === kind) && `${item.title} ${item.text}`.toLocaleLowerCase('tr-TR').includes(needle)) : [];
  return <>
    <label className="workspace-search"><span className="sr-only">Arama metni</span><input autoFocus type="search" value={query} maxLength={100} placeholder="Görev, not, proje veya hedef ara…" onChange={event => setQuery(event.target.value)}/></label>
    <div className="search-kinds" role="group" aria-label="Arama türü">{['Tümü', 'Görev', 'Not', 'Proje', 'Hedef'].map(value => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value}</button>)}</div>
    {loading ? <p role="status">Kayıtlar okunuyor…</p> : error ? <p role="alert">{error} <button className="text-button" onClick={() => setRefresh(n => n + 1)}>Yeniden dene</button></p> : <>
      {limited && <p className="section-description">Çok sayıda kayıt var; arama her türün ilk 1000 kaydı ve ilk 200 hedef ile sınırlı.</p>}
      <p className="section-description" role="status">{!needle ? 'Başlık ve not/proje/hedef içeriklerinde arama yapabilirsin.' : `${matches.length} sonuç${matches.length > 50 ? ' · İlk 50 gösteriliyor' : ''}. Sonucu seçerek ilgili bölüme geç.`}</p>
      <ul className="search-results">{matches.slice(0, 50).map(item => <li key={item.id}><button onClick={() => navigate(item.route)}><span>{item.kind}</span><strong>{item.title}</strong><small>{item.text.slice(0, 100)}</small></button></li>)}</ul>
    </>}
  </>;
}
