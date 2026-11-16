import { useEffect, useState } from 'react';
import type { TaskOwner } from '../tasks/client';
import { financeTotals } from './totals';

export function adjacentMonth(month: string, delta: number) {
  const date = new Date(`${month}-01T12:00:00`);
  date.setMonth(date.getMonth() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
const money = (value: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(value / 100);
type Summary = { income: number; expense: number; count: number };
export function MonthComparison({ owner, month }: { owner: TaskOwner; month: string }) {
  const [data, setData] = useState<Summary[] | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { const reload = () => setRefresh(n => n + 1); window.addEventListener('metis:finance-changed', reload); return () => window.removeEventListener('metis:finance-changed', reload); }, []);
  useEffect(() => {
    let active = true; setData(null); setError('');
    Promise.all([adjacentMonth(month, -1), month].map(key => financeTotals(owner, key).then(rows => rows.reduce((sum, row) => ({ ...sum, [row.kind]: sum[row.kind] + row.amountCents, count: sum.count + row.count }), { income: 0, expense: 0, count: 0 }))))
      .then(value => { if (active) setData(value); }).catch(() => { if (active) setError('Ay karşılaştırması okunamadı.'); });
    return () => { active = false; };
  }, [owner.projectRef, owner.userId, month, refresh]);
  return <section className="panel month-comparison"><div className="section-heading"><h2>Önceki ayla karşılaştırma</h2><button className="text-button" onClick={() => setRefresh(n => n + 1)}>Yenile</button></div>
    {error ? <p role="alert">{error}</p> : !data ? <p>Hesaplanıyor…</p> : <>
      <p className="section-description">{adjacentMonth(month, -1)} → {month} · Seçili ayın kayıtları ile önceki ayın tamamı karşılaştırılır.</p>
      <table><thead><tr><th>Özet</th><th>Önceki ay</th><th>Seçili ay</th><th>Fark</th></tr></thead><tbody>{(['income', 'expense'] as const).map(kind => <tr key={kind}><th>{kind === 'income' ? 'Gelir' : 'Gider'}</th><td>{money(data[0][kind])}</td><td>{money(data[1][kind])}</td><td>{money(data[1][kind] - data[0][kind])}</td></tr>)}</tbody></table>
      {!data[0].count && <p className="section-description">Önceki ay için kayıt bulunmuyor; önceki tutarlar sıfır gösteriliyor.</p>}
    </>}
  </section>;
}
