export type StorageInfo = {
  engine: 'sqlite';
  schemaVersion: number;
  migrationCount: number;
  storageId: string;
  createdAt: string;
};

export type StorageState =
  | { kind: 'preview' }
  | { kind: 'ready'; info: StorageInfo }
  | { kind: 'failed'; code: string };

type Invoke = (command: string) => Promise<unknown>;
declare global {
  interface Window {
    __TAURI__?: { core: { invoke: Invoke } };
  }
}

function validInfo(value: unknown): value is StorageInfo {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<StorageInfo>;
  return item.engine === 'sqlite'
    && Number.isInteger(item.schemaVersion) && item.schemaVersion === 1
    && item.migrationCount === 1
    && typeof item.storageId === 'string' && /^[a-f0-9]{32}$/.test(item.storageId)
    && typeof item.createdAt === 'string' && !Number.isNaN(Date.parse(item.createdAt));
}

export async function readLocalStorage(
  invoke: Invoke | undefined = globalThis.window?.__TAURI__?.core.invoke,
): Promise<StorageState> {
  // Browser preview has no SQLite substitute, IndexedDB fallback or fake success state.
  if (!invoke) return { kind: 'preview' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject('timeout'), 6000);
    });
    const value = await Promise.race([invoke('local_storage_status'), deadline]);
    if (!validInfo(value)) return { kind: 'failed', code: 'invalidSchema' };
    return { kind: 'ready', info: value };
  } catch (error) {
    const known = ['unavailable', 'busy', 'corrupt', 'newerSchema', 'invalidSchema', 'migrationFailed', 'timeout'];
    return { kind: 'failed', code: typeof error === 'string' && known.includes(error) ? error : 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

export function storageMessage(code: string): string {
  switch (code) {
    case 'busy': return 'Yerel alan başka bir işlem tarafından kullanılıyor. Birazdan tekrar dene.';
    case 'newerSchema': return 'Bu veri alanı daha yeni bir sürüme ait. Uygulamayı güncelle.';
    case 'corrupt': return 'Yerel dosya okunamadı. Veriler silinmedi veya sıfırlanmadı.';
    case 'invalidSchema': return 'Yerel veri yapısı doğrulanamadı. Mevcut dosya korunuyor.';
    case 'migrationFailed': return 'Yerel alan hazırlanamadı; tamamlanmayan değişiklikler geri alındı.';
    case 'timeout': return 'Yerel alan henüz yanıt vermedi. Tekrar kontrol edebilirsin.';
    default: return 'Yerel alana erişilemiyor. Klasörün erişilebilir olduğunu kontrol et.';
  }
}
