import { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowRight, CalendarClock, CheckCheck, FolderKanban, RefreshCw, Target } from 'lucide-react';
import { loginStore } from '../identity/login';
import { loginSettings } from '../identity/config';
import { scheduledTasks, type Task, type TaskOwner } from '../tasks/client';
import { listEvents, type CalendarEvent } from '../calendar/client';
import { listEntries, type Entry } from '../workspace/client';
import { goalSummary, type GoalSummary } from '../goals/client';

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function ProductOverview({ navigate }: { navigate: (name: string) => void }) {
  const session = useSyncExternalStore(loginStore.subscribe, loginStore.getSnapshot);
  if (!window.__TAURI__ || session.phase !== 'signedIn' || session.expiresAt <= Date.now() || loginSettings.kind !== 'ready') return null;
  const owner = { projectRef: new URL(loginSettings.config.url).hostname.split('.')[0], userId: session.userId.toLowerCase() };
  return <Board key={`${owner.projectRef}:${owner.userId}`} owner={owner} navigate={navigate}/>;
}

function Board({ owner, navigate }: { owner: TaskOwner; navigate: (name: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [notes, setNotes] = useState<Entry[]>([]);
  const [projects, setProjects] = useState<Entry[]>([]);
  const [goals, setGoals] = useState<GoalSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [limited, setLimited] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const now = new Date(), past = new Date(now), future = new Date(now);
    past.setDate(now.getDate() - 90); future.setDate(now.getDate() + 7);
    Promise.all([scheduledTasks(owner, iso(past), iso(future)), listEvents(owner, iso(now), iso(future)), listEntries(owner, 'project'), goalSummary(owner), listEntries(owner, 'note', '', 0, 'pinned')])
      .then(([taskItems, eventItems, projectPage, goalItems, notePage]) => { if (active) { setNotes(notePage.items); setTasks(taskItems); setEvents(eventItems); setProjects(projectPage.items); setGoals(goalItems); setLimited(taskItems.length === 500 || eventItems.length === 500 || projectPage.hasMore); } })
      .catch(() => { if (active) setError('Genel bakış yüklenemedi. Yeniden dene.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [owner.projectRef, owner.userId, refresh]);

  const today = iso(new Date()), week = new Date(); week.setDate(week.getDate() + 7);
  const weekKey = iso(week);
  const open = tasks.filter(task => !task.completed);
  const todayTasks = open.filter(task => task.dueDate === today);
  const overdue = open.filter(task => task.dueDate && task.dueDate < today);
  const soon = open.filter(task => task.dueDate && task.dueDate >= today && task.dueDate <= weekKey);
  const todayEvents = events.filter(event => event.eventDate === today).sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
  const activeProjects = projects.filter(project => project.state === 'active');
  const activeGoals = goals?.upcoming ?? [];
  return <section className="product-overview" aria-busy={loading}>
    <div className="section-heading"><h2>Çalışma alanım</h2><button className="text-button" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14}/> Yenile</button></div>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {limited && !error && <p className="workspace-notice">Çok sayıda kayıt var; bu özetin bazı sayıları kısmi olabilir.</p>}
    {loading && !tasks.length && !error ? <p className="section-description">Planların okunuyor…</p> : !error && <>
      <div className="overview-metrics"><button onClick={() => navigate('Calendar')}><CalendarClock/><span><strong>{todayTasks.length + todayEvents.length}</strong> bugün</span></button><button onClick={() => navigate('Tasks:overdue')}><CheckCheck/><span><strong>{overdue.length}</strong> son 90 gün geciken</span></button><button onClick={() => navigate('Projects')}><FolderKanban/><span><strong>{activeProjects.length}</strong> aktif proje</span></button><button onClick={() => navigate('Goals')}><Target/><span><strong>{goals?.active ?? 0}</strong> aktif hedef</span></button></div>
      <div className="overview-columns"><article className="panel"><div className="section-heading"><h2>Bugünün planı</h2><button className="text-button" onClick={() => navigate('Calendar')}>Takvim <ArrowRight size={14}/></button></div>{todayTasks.length || todayEvents.length ? <ul className="overview-list">{todayEvents.slice(0,5).map(event => <li key={`event-${event.id}`}><span>{event.startTime ?? 'Tüm gün'}</span><button className="text-button" onClick={()=>navigate(`Calendar:record:${event.id}`)}>{event.title}</button></li>)}{todayTasks.slice(0,5).map(task => <li key={`task-${task.id}`}><span>Görev</span><strong>{task.title}</strong></li>)}</ul> : <p className="section-description">Bugün için plan yok.</p>}{(todayTasks.length > 5 || todayEvents.length > 5) && <p className="section-description">Tüm planları takvimde görebilirsin.</p>}</article>
      <article className="panel"><div className="section-heading"><h2>Sıradaki işler</h2><button className="text-button" onClick={() => navigate('Tasks:week')}>Görevler <ArrowRight size={14}/></button></div>{soon.length ? <ul className="overview-list">{soon.slice(0, 5).map(task => <li key={task.id}><span>{new Date(`${task.dueDate}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</span><strong>{task.title}</strong></li>)}</ul> : <p className="section-description">Önümüzdeki yedi günde görev yok.</p>}</article></div>
      <article className="panel analytics-goals"><div className="section-heading"><h2>Sabit notlar</h2><button className="text-button" onClick={()=>navigate('Notes')}>Notları aç <ArrowRight size={14}/></button></div>{notes.length?<ul className="overview-list projects">{notes.slice(0,5).map(note=><li key={note.id}><button className="text-button" onClick={()=>navigate(`Notes:record:${note.id}`)}>{note.title}</button><span>{new Date(note.updatedAt).toLocaleDateString('tr-TR')}</span></li>)}</ul>:<p className="section-description">Önemli notlarını sabitle; burada görünsün.</p>}</article>
      <article className="panel analytics-goals"><div className="section-heading"><h2>Öncelikli hedefler</h2><button className="text-button" onClick={() => navigate('Goals')}>Tümü <ArrowRight size={14}/></button></div><p className="section-description">{goals?.active ?? 0} aktif · {goals?.overdue ?? 0} geciken · Ortalama %{goals?.averageProgress ?? 0} ilerleme. Tarihi en yakın beş aktif hedef gösterilir.</p>{activeGoals.length ? <ul className="overview-list projects">{activeGoals.slice(0, 5).map(goal => <li key={goal.id}><button className="text-button" onClick={()=>navigate(`Goals:record:${goal.id}`)}>{goal.title}</button><span>%{goal.progress}</span></li>)}</ul> : <p className="section-description">İlk hedefin için alan hazır.</p>}</article>
    </>}
  </section>;
}
