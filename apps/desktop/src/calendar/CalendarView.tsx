import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { loginStore } from '../identity/login';
import { loginSettings } from '../identity/config';
import { scheduledTasks, type Task, type TaskOwner } from '../tasks/client';
import { listEntries, type Entry } from '../workspace/client';
import { createEvent, deleteEvent, listEvents, saveEvent, type CalendarEvent, type EventDraft } from './client';

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
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [editing, setEditing] = useState<CalendarEvent | 'new' | null>(null);
  const [draft, setDraft] = useState<EventDraft>({title:'',details:'',eventDate:iso(new Date()),startTime:null,endTime:null});
  const [saving, setSaving] = useState(false); const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const grid = useMemo(() => { const start = new Date(month); start.setDate(1-((start.getDay()+6)%7)); return Array.from({length:42},(_,i) => { const day=new Date(start); day.setDate(start.getDate()+i); return day; }); }, [month]);
  useEffect(() => { let active=true; setLoading(true); setError(''); const from=iso(grid[0]), to=iso(grid[41]);
    Promise.all([scheduledTasks(owner,from,to),listEntries(owner,'project'),listEvents(owner,from,to)]).then(([items,page,entries])=>{if(active){setTasks(items);setProjects(page.items);setEvents(entries);}}).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Takvim açılamadı.');}).finally(()=>{if(active)setLoading(false);}); return()=>{active=false};
  },[owner.projectRef,owner.userId,grid[0].getTime()]);
  const selectedTasks=tasks.filter(task=>task.dueDate===selected);
  const selectedEvents=events.filter(event=>event.eventDate===selected);
  function open(value:CalendarEvent|'new'){setEditing(value);setDraft(value==='new'?{title:'',details:'',eventDate:selected,startTime:null,endTime:null}:{title:value.title,details:value.details,eventDate:value.eventDate,startTime:value.startTime,endTime:value.endTime});setConfirm(false);setError('')}
  async function save(e:React.FormEvent){e.preventDefault();if(!editing||saving)return;setSaving(true);setError('');try{const result=editing==='new'?await createEvent(owner,crypto.randomUUID().replaceAll('-',''),draft):await saveEvent(owner,editing,draft);setEvents(old=>[result,...old.filter(item=>item.id!==result.id)]);setSelected(result.eventDate);setEditing(null)}catch(failure){setError(failure instanceof Error?failure.message:'Kaydedilemedi.')}finally{setSaving(false)}}
  async function remove(){if(!editing||editing==='new'||!confirm)return;setSaving(true);try{await deleteEvent(owner,editing);setEvents(old=>old.filter(item=>item.id!==editing.id));setEditing(null)}catch(failure){setError(failure instanceof Error?failure.message:'Silinemedi.')}finally{setSaving(false)}}
  const move=(delta:number)=>setMonth(value=>new Date(value.getFullYear(),value.getMonth()+delta,1));
  return <section className="calendar-layout" aria-busy={loading}>
    <div className="panel calendar-panel"><div className="calendar-toolbar"><div><h2>{monthName(month)}</h2><p>{tasks.filter(task=>!task.completed).length} açık görev · {events.length} etkinlik</p></div><div><button className="icon-button" aria-label="Önceki ay" onClick={()=>move(-1)}><ChevronLeft/></button><button className="secondary-button" onClick={()=>{const now=new Date();setMonth(new Date(now.getFullYear(),now.getMonth(),1));setSelected(iso(now));}}>Bugün</button><button className="icon-button" aria-label="Sonraki ay" onClick={()=>move(1)}><ChevronRight/></button></div></div>
      {error && <p role="alert" className="workspace-error">{error}</p>}<div className="calendar-weekdays">{['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'].map(day=><span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">{grid.map(day=>{const key=iso(day), dayTasks=tasks.filter(task=>task.dueDate===key),dayEvents=events.filter(event=>event.eventDate===key); return <button key={key} className={`${day.getMonth()!==month.getMonth()?'outside ':''}${key===selected?'selected ':''}${key===iso(new Date())?'today':''}`} onClick={()=>setSelected(key)}><span>{day.getDate()}</span><div>{dayEvents.slice(0,2).map(event=><i key={event.id} className="calendar-event-chip">{event.startTime&&`${event.startTime} `}{event.title}</i>)}{dayTasks.slice(0,2).map(task=><i key={task.id} className={task.completed?'done':''}>{task.title}</i>)}{dayTasks.length+dayEvents.length>4&&<small>+{dayTasks.length+dayEvents.length-4} daha</small>}</div></button>})}</div>
    </div>
    <aside className="panel calendar-agenda"><span className="eyebrow">SEÇİLİ GÜN</span><h2>{new Date(`${selected}T12:00:00`).toLocaleDateString('tr-TR',{day:'numeric',month:'long',weekday:'long'})}</h2><button className="primary-button" onClick={()=>open('new')}><Plus size={16}/> Etkinlik ekle</button>{selectedEvents.length>0&&<ul>{selectedEvents.map(event=><li key={event.id}><span className="priority"/><div><button className="calendar-event-link" onClick={()=>open(event)}><strong>{event.title}</strong></button><small>{event.startTime?`${event.startTime}${event.endTime?`–${event.endTime}`:''}`:'Tüm gün'}{event.details?` · ${event.details}`:''}</small></div></li>)}</ul>}{selectedTasks.length?<ul>{selectedTasks.map(task=><li key={task.id}><span className={`priority priority-${task.priority}`}/><div><strong className={task.completed?'done':''}>{task.title}</strong><small>Görev · {projects.find(project=>project.id===task.projectId)?.title??'Projesiz'}</small></div></li>)}</ul>:!selectedEvents.length&&<p>Bu gün için plan yok.</p>}<button className="secondary-button" onClick={onTasks}>Görevleri düzenle</button>
      {editing&&<form className="calendar-event-form" onSubmit={save}><h3>{editing==='new'?'Yeni etkinlik':'Etkinliği düzenle'}</h3><label>Başlık<input autoFocus required maxLength={200} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label><label>Tarih<input type="date" required value={draft.eventDate} onChange={e=>setDraft({...draft,eventDate:e.target.value})}/></label><div className="calendar-time-fields"><label>Başlangıç<input type="time" value={draft.startTime??''} onChange={e=>setDraft({...draft,startTime:e.target.value||null,endTime:e.target.value?draft.endTime:null})}/></label><label>Bitiş<input type="time" min={draft.startTime??undefined} disabled={!draft.startTime} value={draft.endTime??''} onChange={e=>setDraft({...draft,endTime:e.target.value||null})}/></label></div><label>Not<textarea maxLength={5000} value={draft.details} onChange={e=>setDraft({...draft,details:e.target.value})}/></label>{error&&<p role="alert" className="workspace-error">{error}</p>}<div className="calendar-form-actions"><button type="button" className="secondary-button" onClick={()=>setEditing(null)}>Vazgeç</button><button className="primary-button" disabled={saving||!draft.title.trim()}>Kaydet</button></div>{editing!=='new'&&<div className="calendar-delete">{confirm?<><span>Silinsin mi?</span><button type="button" onClick={()=>setConfirm(false)}>İptal</button><button type="button" disabled={saving} onClick={()=>void remove()}>Evet, sil</button></>:<button type="button" className="text-button" onClick={()=>setConfirm(true)}><Trash2 size={15}/> Etkinliği sil</button>}</div>}</form>}
    </aside>
  </section>;
}
