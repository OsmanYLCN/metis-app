import { financeTotals } from '../finance/totals';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ChartNoAxesCombined, RefreshCw } from 'lucide-react';
import { loginStore } from '../identity/login';
import { loginSettings } from '../identity/config';
import { listTasks, projectProgress, type ProjectProgress, type Task, type TaskOwner } from '../tasks/client';
import { listEntries, type Entry } from '../workspace/client';
import { goalSummary, type GoalSummary } from '../goals/client';

type Month = { key: string; label: string; income: number; expense: number; count: number; limited: boolean };
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const money = (cents: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(cents / 100);
const monthKey = (date: Date) => iso(date).slice(0, 7);

async function financeMonth(owner: TaskOwner, date: Date): Promise<Month> {
  const key = monthKey(date);
  const result = await financeTotals(owner, key);
  const income = result.filter(row => row.kind === 'income').reduce((sum,row)=>sum+row.amountCents,0);
  const expense = result.filter(row => row.kind === 'expense').reduce((sum,row)=>sum+row.amountCents,0);
  return { key, label: date.toLocaleDateString('tr-TR', { month: 'short', year: 'numeric' }), income, expense, count: result.reduce((sum,row)=>sum+row.count,0), limited: false };
}

async function taskSample(owner: TaskOwner): Promise<{ tasks: Task[]; limited: boolean }> {
  const tasks: Task[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await listTasks(owner, offset);
    tasks.push(...page.items);
    if (!page.hasMore) return { tasks, limited: false };
  }
  return { tasks, limited: true };
}

export function AnalyticsView({ onAccount, navigate }: { onAccount: () => void; navigate: (name: string) => void }) {
  const session = useSyncExternalStore(loginStore.subscribe, loginStore.getSnapshot);
  if (!window.__TAURI__ || session.phase !== 'signedIn' || session.expiresAt <= Date.now() || loginSettings.kind !== 'ready')
    return <section className="empty-state"><ChartNoAxesCombined size={32}/><h2>Analizlerini görmek için giriş yap.</h2><p>Bu cihazdaki kayıtların özeti hesabına özel gösterilir.</p><button className="primary-button" onClick={onAccount}>Hesabıma git</button></section>;
  const owner = { projectRef: new URL(loginSettings.config.url).hostname.split('.')[0], userId: session.userId.toLowerCase() };
  return <Board key={`${owner.projectRef}:${owner.userId}`} owner={owner} navigate={navigate}/>;
}

function Board({ owner, navigate }: { owner: TaskOwner; navigate: (name: string) => void }) {
  const [months, setMonths] = useState<Month[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Entry[]>([]);
  const [progress, setProgress] = useState<ProjectProgress[]>([]);
  const [goals, setGoals] = useState<GoalSummary | null>(null);
  const [limited, setLimited] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const load = useCallback(() => {
    let active = true;
    setLoading(true); setError('');
    const now = new Date();
    const dates = Array.from({ length: 6 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - 5 + index, 1));
    Promise.all([Promise.all(dates.map(date => financeMonth(owner, date))), taskSample(owner), listEntries(owner, 'project'), projectProgress(owner, iso(now)), goalSummary(owner)])
      .then(([financial, taskResult, projectPage, stats, goalItems]) => {
        if (!active) return;
        setMonths(financial); setTasks(taskResult.tasks); setProjects(projectPage.items); setProgress(stats); setGoals(goalItems);
        setLimited(taskResult.limited || projectPage.hasMore || financial.some(month => month.limited));
      }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Analizler yüklenemedi.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [owner.projectRef, owner.userId, refresh]);
  useEffect(load, [load]);

  const current = months.at(-1);
  const completed = tasks.filter(task => task.completed).length;
  const open = tasks.length - completed;
  const totalProjectTasks = progress.reduce((sum, item) => sum + item.total, 0);
  const completedProjectTasks = progress.reduce((sum, item) => sum + item.completed, 0);
  const max = Math.max(1, ...months.flatMap(month => [month.income, month.expense]));
  const activeProjects = projects.filter(project => project.state === 'active');
  const activeGoals = goals?.upcoming ?? [];
  return <section className="analytics-board" aria-busy={loading}>
    <div className="workspace-toolbar"><div><h2>Çalışma alanının özeti</h2><p>Bu cihazdaki kayıtlardan hesaplanan görünüm.</p></div><button className="secondary-button" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15}/> Yenile</button></div>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {limited && <p className="workspace-notice">Çok sayıda kayıt var; bazı sayılar gösterim sınırı nedeniyle kısmi olabilir.</p>}
    {loading && !months.length ? <p className="section-description">Veriler okunuyor…</p> : <>
      <div className="analytics-metrics"><article className="panel"><span>Bu ay gelir</span><strong>{money(current?.income ?? 0)}</strong></article><article className="panel"><span>Bu ay gider</span><strong>{money(current?.expense ?? 0)}</strong></article><article className="panel"><span>Bu ay net</span><strong>{money((current?.income ?? 0) - (current?.expense ?? 0))}</strong></article><article className="panel"><span>Tamamlanan görev</span><strong>{completed} / {tasks.length}</strong></article></div>
      <div className="analytics-columns"><article className="panel"><div className="section-heading"><h2>Son 6 ay · gelir ve gider</h2><button className="text-button" onClick={() => navigate('Finance')}>Finans →</button></div><div className="analytics-chart" role="img" aria-label="Son altı ayın gelir ve gider çubuk grafiği">{months.map(month => <div className="analytics-month" key={month.key}><div className="analytics-bars"><span className="income" style={{ height: `${Math.max(2, month.income / max * 100)}%` }} title={`${month.label} gelir: ${money(month.income)}`}/><span className="expense" style={{ height: `${Math.max(2, month.expense / max * 100)}%` }} title={`${month.label} gider: ${money(month.expense)}`}/></div><small>{month.label}</small></div>)}</div><div className="analytics-legend"><span>■ Gelir</span><span>■ Gider</span></div></article>
      <article className="panel"><div className="section-heading"><h2>Görev ve proje ilerlemesi</h2><button className="text-button" onClick={() => navigate('Projects')}>Projeler →</button></div><p className="section-description">{open} açık görev · {activeProjects.length} aktif proje</p><div className="analytics-progress"><span>Bağlı görevler</span><strong>{completedProjectTasks} / {totalProjectTasks}</strong><i><b style={{ width: `${totalProjectTasks ? completedProjectTasks / totalProjectTasks * 100 : 0}%` }}/></i></div><ul className="analytics-projects">{activeProjects.slice(0,5).map(project => { const item = progress.find(value => value.projectId === project.id); return <li key={project.id}><span>{project.title}</span><strong>{item?.completed ?? 0} / {item?.total ?? 0}</strong></li>; })}</ul></article></div>
      <article className="panel analytics-goals"><div className="section-heading"><h2>Hedefler</h2><button className="text-button" onClick={() => navigate('Goals')}>Hedefler →</button></div><p className="section-description">{goals?.active ?? 0} aktif · {goals?.paused ?? 0} beklemede · {goals?.done ?? 0} tamamlandı · {goals?.overdue ?? 0} geciken · Aktif hedeflerde ortalama %{goals?.averageProgress ?? 0} ilerleme</p><div className="analytics-goal-list">{activeGoals.slice(0,5).map(goal => <div key={goal.id}><button className="text-button" onClick={()=>navigate(`Goals:record:${goal.id}`)}>{goal.title}</button><strong>%{goal.progress}</strong><i><b style={{ width: `${goal.progress}%` }}/></i></div>)}{!activeGoals.length && <p className="section-description">Aktif hedef bulunmuyor.</p>}</div></article>
    </>}
  </section>;
}
