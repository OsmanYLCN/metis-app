import type { TaskOwner } from '../tasks/client';

export type EntryKind = 'note' | 'project';
export type EntryState = 'active' | 'paused' | 'done';
export type Entry = { id: string; kind: EntryKind; title: string; body: string; state: EntryState; pinned: boolean;
  revision: number; createdAt: string; updatedAt: string };
export type EntryPage = { items: Entry[]; hasMore: boolean };
export type EntryDraft = Pick<Entry, 'title' | 'body' | 'state' | 'pinned'>;
const idPattern = /^[a-f0-9]{32}$/;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
function parse(value: unknown, kind: EntryKind): Entry {
  if (!object(value) || !idPattern.test(String(value.id)) || value.kind !== kind
    || typeof value.title !== 'string' || !value.title.trim() || [...value.title].length > 200
    || typeof value.body !== 'string' || [...value.body].length > 20000
    || !['active', 'paused', 'done'].includes(String(value.state)) || typeof value.pinned !== 'boolean'
    || (kind === 'note' && value.state !== 'active') || (kind === 'project' && value.pinned)
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)))
    throw new Error('Kayıt okunamadı. Listeyi yenile.');
  return value as Entry;
}
async function invoke(command: string, args: Record<string, unknown>): Promise<unknown> {
  const bridge = globalThis.window?.__TAURI__?.core.invoke;
  if (!bridge) throw new Error('Kayıtları kullanmak için Windows uygulamasını aç.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject('timeout'), 10000); });
    return await Promise.race([bridge(command, args), deadline]);
  }
  catch (error) {
    if (error === 'timeout') throw new Error('İşlemin sonucu alınamadı. Aynı kaydı tekrar dene veya listeyi yenile.');
    if (error === 'invalidInput') throw new Error('Başlık, içerik veya arama çok uzun ya da geçersiz.');
    if (error === 'conflict') throw new Error('Kayıt başka bir işlemde değişti. Listeyi yenileyip tekrar dene.');
    if (error === 'notFound') throw new Error('Kayıt bulunamadı. Listeyi yenile.');
    throw new Error('Yerel kayıt açılamadı. Uygulamayı yeniden dene.');
  } finally { clearTimeout(timer); }
}
export async function listEntries(owner: TaskOwner, kind: EntryKind, query = '', offset = 0, filter = 'all', sort = 'updated'): Promise<EntryPage> {
  const value = await invoke('workspace_list', { owner, kind, query, offset, filter, sort });
  if (!object(value) || !Array.isArray(value.items) || value.items.length > 100 || typeof value.hasMore !== 'boolean')
    throw new Error('Liste okunamadı. Yeniden dene.');
  return { items: value.items.map(item => parse(item, kind)), hasMore: value.hasMore };
}
export async function createEntry(owner: TaskOwner, kind: EntryKind, id: string, draft: EntryDraft): Promise<Entry> {
  return parse(await invoke('workspace_create', { owner, kind, id, ...draft }), kind);
}
export async function saveEntry(owner: TaskOwner, entry: Entry, draft: EntryDraft): Promise<Entry> {
  return parse(await invoke('workspace_save', { owner, kind: entry.kind, id: entry.id, expectedRevision: entry.revision, ...draft }), entry.kind);
}
export async function deleteEntry(owner: TaskOwner, entry: Entry): Promise<void> {
  const value = await invoke('workspace_delete', { owner, kind: entry.kind, id: entry.id, expectedRevision: entry.revision });
  if (value !== null) throw new Error('Silme işlemi doğrulanamadı.');
}
