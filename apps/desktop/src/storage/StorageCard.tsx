import { useCallback, useEffect, useRef, useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { readLocalStorage, storageMessage, type StorageState } from './localStorage';

export function StorageCard() {
  const [state, setState] = useState<StorageState | { kind: 'loading' }>({ kind: 'loading' });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setState({ kind: 'loading' });
    const result = await readLocalStorage();
    if (generation.current === current) setState(result);
  }, []);
  useEffect(() => {
    void refresh();
    return () => { ++generation.current; };
  }, [refresh]);

  const title = {
    loading: 'Yerel alan kontrol ediliyor',
    preview: 'Masaüstünde kullanılabilir',
    ready: 'Yerel alan hazır',
    failed: 'Yerel alan kullanılamıyor',
  }[state.kind];
  const description = state.kind === 'ready'
    ? 'Kayıtlar bu cihazda saklanıyor. Yedekleri ve bulut kapsamını Veri ve eşitleme bölümünde görebilirsin.'
    : state.kind === 'preview'
      ? 'Tarayıcı önizlemesinde SQLite çalışmaz. Yerel alan için Windows uygulamasını aç.'
      : state.kind === 'failed' ? storageMessage(state.code) : 'Bu cihazdaki veri alanı doğrulanıyor.';

  return <article className="status-card" aria-label="Yerel depolama">
    <span className="card-icon lilac"><Database size={19} /></span>
    <span className="card-caption">Veri alanı</span>
    <h3 aria-live="polite">{title}</h3>
    <p>{description}</p>
    {state.kind === 'preview'
      ? <span className="small-tag">Bu önizlemede veri kaydedilmiyor</span>
      : <button className="text-button" onClick={() => void refresh()} disabled={state.kind === 'loading'}>
        <RefreshCw size={14} className={state.kind === 'loading' ? 'spin' : ''} /> Yerel alanı kontrol et
      </button>}
  </article>;
}
