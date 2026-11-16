import { useEffect, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { listTasks, type Task, type TaskOwner } from '../tasks/client';

const dateLabel = (date: string | null) => date ? new Date(`${date}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Tarihsiz';

export function ProjectTasks({ owner, projectId, onTasks }: { owner: TaskOwner; projectId: string; onTasks: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [limited, setLimited] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setTasks([]);
    async function load() {
      const matches: Task[] = [];
      for (let offset = 0; offset < 1000; offset += 100) {
        if (!active) return;
        const page = await listTasks(owner, offset);
        matches.push(...page.items.filter(task => task.projectId === projectId));
        if (!page.hasMore) { if (active) { setTasks(matches); setLimited(false); } return; }
      }
      if (active) { setTasks(matches); setLimited(true); }
    }
    void load().catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Proje görevleri okunamadı.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [owner.projectRef, owner.userId, projectId, refresh]);

  const ordered = [...tasks].sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.priority - a.priority);
  return <section className="project-task-panel"><div className="section-heading"><div><h3>Proje görevleri</h3><p className="section-description">{loading ? 'Yükleniyor…' : `${tasks.filter(task => task.completed).length} / ${tasks.length} tamamlandı`}</p></div><button type="button" className="text-button" disabled={loading} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={14}/> Yenile</button></div>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {limited && <p className="workspace-notice">Çok sayıda görev var. Bu listede ilk 1000 kayıt tarandı; toplam ilerleme yukarıdaki proje özetindedir.</p>}
    {!loading && !error && (ordered.length ? <ul>{ordered.map(task => <li key={task.id}><span className={`project-task-check ${task.completed ? 'done' : ''}`}>{task.completed ? '✓' : ''}</span><div><strong className={task.completed ? 'done' : ''}>{task.title}</strong><small>{dateLabel(task.dueDate)}{task.priority >= 2 ? ` · ${task.priority === 3 ? 'Kritik' : 'Yüksek'}` : ''}</small></div></li>)}</ul> : <p className="section-description">Bu projeye bağlı görev yok.</p>)}
    <button type="button" className="secondary-button" onClick={onTasks}>Görevleri aç <ArrowRight size={14}/></button>
  </section>;
}
