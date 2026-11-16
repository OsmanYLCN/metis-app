import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { loginStore } from '../identity/login';
import { loginSettings } from '../identity/config';
import { scheduledTasks, type Task, type TaskOwner } from '../tasks/client';
import { listEntries, type Entry } from '../workspace/client';

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const monthName = (date: Date) => date.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });

export function CalendarView({ onAccount, onTasks }: { onAccount: () => void; onTasks: () => void }) {
  const session = useSyncExternalStore(loginStore.subscribe, loginStore.getSnapshot);
  if (!window.__TAURI__ || session.phase !== 'signedIn' || session.expiresAt <= Date.now() || loginSettings.kind !== 'ready')
    return <section className="empty-state"><h2>Takvimini görmek için giriş yap.</h2><p>Tarihli görevlerin bu cihazdaki takvimde görünür.</p><button className="primary-button" onClick={onAccount}>Hesabıma git</button></section>;
  const owner = { projectRef: new URL(loginSettings.config.url).hostname.split('.')[0], userId: session.userId.toLowerCase() };
  return <CalendarBoard key={`${owner.projectRef}:${owner.userId}`} owner={owner} onTasks={onTasks} />;
}

function CalendarBoard({ owner, onTasks }: { owner: TaskOwner; onTasks: () => void }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(iso(new Date()));
  const [tasks, setTasks] = useState<Task[]>([]); const [projects, setProjects] = useState<Entry[]>([]);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const grid = useMemo(() => { const start = new Date(month); start.setDate(1-((start.getDay()+6)%7)); return Array.from({length:42},(_,i) => { const day=new Date(start); day.setDate(start.getDate()+i); return day; }); }, [month]);
  useEffect(() => { let active=true; setLoading(true); setError(''); const from=iso(grid[0]), to=iso(grid[41]);
    Promise.all([scheduledTasks(owner,from,to),listEntries(owner,'project')]).then(([items,page])=>{if(active){setTasks(items);setProjects(page.items);}}).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Takvim açılamadı.');}).finally(()=>{if(active)setLoading(false);}); return()=>{active=false};
  },[owner.projectRef,owner.userId,grid[0].getTime()]);
  const selectedTasks=tasks.filter(task=>task.dueDate===selected);
  const move=(delta:number)=>setMonth(value=>new Date(value.getFullYear(),value.getMonth()+delta,1));
  return <section className="calendar-layout" aria-busy={loading}>
    <div className="panel calendar-panel"><div className="calendar-toolbar"><div><h2>{monthName(month)}</h2><p>{tasks.filter(task=>!task.completed).length} planlanmış açık görev</p></div><div><button className="icon-button" aria-label="Önceki ay" onClick={()=>move(-1)}><ChevronLeft/></button><button className="secondary-button" onClick={()=>{const now=new Date();setMonth(new Date(now.getFullYear(),now.getMonth(),1));setSelected(iso(now));}}>Bugün</button><button className="icon-button" aria-label="Sonraki ay" onClick={()=>move(1)}><ChevronRight/></button></div></div>
      {error && <p role="alert" className="workspace-error">{error}</p>}<div className="calendar-weekdays">{['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'].map(day=><span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">{grid.map(day=>{const key=iso(day), dayTasks=tasks.filter(task=>task.dueDate===key); return <button key={key} className={`${day.getMonth()!==month.getMonth()?'outside ':''}${key===selected?'selected ':''}${key===iso(new Date())?'today':''}`} onClick={()=>setSelected(key)}><span>{day.getDate()}</span><div>{dayTasks.slice(0,3).map(task=><i key={task.id} className={task.completed?'done':''}>{task.title}</i>)}{dayTasks.length>3&&<small>+{dayTasks.length-3} daha</small>}</div></button>})}</div>
    </div>
    <aside className="panel calendar-agenda"><span className="eyebrow">SEÇİLİ GÜN</span><h2>{new Date(`${selected}T12:00:00`).toLocaleDateString('tr-TR',{day:'numeric',month:'long',weekday:'long'})}</h2>{selectedTasks.length?<ul>{selectedTasks.map(task=><li key={task.id}><span className={`priority priority-${task.priority}`}/><div><strong className={task.completed?'done':''}>{task.title}</strong><small>{projects.find(project=>project.id===task.projectId)?.title??'Projesiz'}</small></div></li>)}</ul>:<p>Bu gün için planlanmış görev yok.</p>}<button className="secondary-button" onClick={onTasks}>Görevleri düzenle</button></aside>
  </section>;
}
