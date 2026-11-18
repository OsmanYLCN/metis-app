import { useEffect, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { summaryDates } from './summary';
import { listTasks, type Task, type TaskOwner } from '../tasks/client';

const dateLabel = (date: string | null) => date ? new Date(`${date}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Tarihsiz';

export function ProjectTasks({ owner, projectId, onTasks, onOpenTask }: { owner: TaskOwner; projectId: string; onTasks: () => void; onOpenTask:(id:string)=>void }) {
  const[status,setStatus]=useState('all');const[priority,setPriority]=useState('all');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    async function load() {
      const page = await listTasks(owner, offset, projectId,{query:'',status,date:'all',priority,sort:'due',...summaryDates()});
      if(active){setTasks(old=>offset?[...old,...page.items.filter(item=>!old.some(existing=>existing.id===item.id))]:page.items);setHasMore(page.hasMore);}
    }
    void load().catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Proje görevleri okunamadı.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [owner.projectRef, owner.userId, projectId, refresh, offset, status, priority]);

  const ordered = [...tasks].sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.priority - a.priority);
  return <section className="project-task-panel"><div className="section-heading"><div><h3>Proje görevleri</h3><p className="section-description">{loading ? 'Yükleniyor…' : `${tasks.filter(task => task.completed).length} / ${tasks.length} yüklenen görev tamamlandı`}</p></div><button type="button" className="text-button" disabled={loading} onClick={() => {setOffset(0);setRefresh(n => n + 1)}}><RefreshCw size={14}/> Yenile</button></div>
    <div className="goal-filters"><label>Durum<select value={status} disabled={loading} onChange={e=>{setOffset(0);setStatus(e.target.value)}}><option value="all">Tümü</option><option value="open">Açık</option><option value="done">Tamamlanan</option></select></label><label>Öncelik<select value={priority} disabled={loading} onChange={e=>{setOffset(0);setPriority(e.target.value)}}><option value="all">Tümü</option><option value="high">Yüksek ve kritik</option><option value="critical">Kritik</option></select></label></div><p className="section-description">Filtreler projenin tüm görevlerine uygulanır. Düzenlemek için görev adına tıkla.</p>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {hasMore && <button type="button" className="text-button" disabled={loading} onClick={()=>setOffset(tasks.length)}>Daha fazla görev yükle</button>}
    {!loading && !error && (ordered.length ? <ul>{ordered.map(task => <li key={task.id}><span className={`project-task-check ${task.completed ? 'done' : ''}`}>{task.completed ? '✓' : ''}</span><div><button type="button" className="text-button" onClick={()=>onOpenTask(task.id)}><strong className={task.completed ? 'done' : ''}>{task.title}</strong></button><small>{dateLabel(task.dueDate)}{task.priority >= 2 ? ` · ${task.priority === 3 ? 'Kritik' : 'Yüksek'}` : ''}</small></div></li>)}</ul> : <p className="section-description">Bu filtrelerde proje görevi yok.</p>)}
    <button type="button" className="secondary-button" onClick={onTasks}>Görevleri aç <ArrowRight size={14}/></button>
  </section>;
}
