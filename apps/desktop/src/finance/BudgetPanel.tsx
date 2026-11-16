import { useEffect, useState, type FormEvent } from 'react';
import type { TaskOwner } from '../tasks/client';

type Budget = { month: string; category: string; limitCents: number; spentCents: number };
const money = (cents: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(cents / 100);

export function BudgetPanel({ owner, month, onMonthChange }: { owner: TaskOwner; month: string; onMonthChange: (month: string) => void }) {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => { const changed = () => setRefresh(n => n + 1); window.addEventListener('metis:finance-changed', changed); return () => window.removeEventListener('metis:finance-changed', changed); }, []);
  useEffect(() => {
    let active = true;
    setBusy(true);
    window.__TAURI__!.core.invoke('budgets_list', { owner, month }).then(value => {
      if (!active) return;
      if (!Array.isArray(value) || value.length > 200 || value.some(item => item.month !== month || typeof item.category !== 'string' || !Number.isSafeInteger(item.limitCents) || item.limitCents < 1 || !Number.isSafeInteger(item.spentCents) || item.spentCents < 0)) throw new Error('Bütçe verileri okunamadı.');
      setBudgets(value as Budget[]);
      setError('');
    }).catch(() => { if (active) { setBudgets([]); setError('Bütçeler okunamadı. Yeniden dene.'); } }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [owner.projectRef, owner.userId, month, refresh]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const text = amount.trim().replace(',', '.');
    if (!category.trim() || !/^(?:0|\d+(?:\.\d{1,2})?)$/.test(text)) { setError('Kategori ve geçerli tutar gir.'); return; }
    const cents = Math.round(Number(text) * 100);
    if (!Number.isSafeInteger(cents) || cents > 999999999999) { setError('Tutar sınırı aşıldı.'); return; }
    setBusy(true); setError('');
    try {
      await window.__TAURI__!.core.invoke('budgets_set', { owner, month, category: category.trim(), limitCents: cents });
      setCategory(''); setAmount(''); setRefresh(n => n + 1);
    } catch { setError('Bütçe kaydedilemedi. Tekrar dene.'); } finally { setBusy(false); }
  }

  return <section className="panel budget-panel">
    <div className="section-heading"><div><h2>Kategori bütçeleri</h2><p className="section-description">Aylık gider sınırları ve gerçekleşen kullanım.</p></div><input aria-label="Bütçe ayı" type="month" value={month} onChange={e => onMonthChange(e.target.value)} /></div>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <form className="budget-form" onSubmit={save}><label>Kategori<input required maxLength={60} value={category} onChange={e => setCategory(e.target.value)} placeholder="Örn. Market" /></label><label>Aylık sınır (₺)<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" /></label><button className="primary-button" disabled={busy}>Bütçeyi kaydet</button></form>
    <p className="section-description">Mevcut kategoriyi aynı adla kaydedersen sınır güncellenir. 0 girersen bütçe kaldırılır.</p>
    {budgets.length ? <div className="budget-list">{budgets.map(b => <article key={b.category}><div><strong>{b.category}</strong><span>{money(b.spentCents)} / {money(b.limitCents)}</span></div><div className="budget-track"><i className={b.spentCents > b.limitCents ? 'over' : ''} style={{ width: `${Math.min(100, b.spentCents / b.limitCents * 100)}%` }} /></div><small>{b.spentCents > b.limitCents ? `${money(b.spentCents - b.limitCents)} sınırın üzerinde` : `${money(b.limitCents - b.spentCents)} kaldı`}</small></article>)}</div> : !error && <p className="section-description">Bu ay için kategori bütçesi yok.</p>}
  </section>;
}
