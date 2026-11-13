import { storageMessage } from '../storage/localStorage';

export type TaskOwner = { projectRef: string; userId: string };
export type Task = { id: string; title: string; completed: boolean; createdAt: string; updatedAt: string };
export type TaskPage = { items: Task[]; hasMore: boolean };
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
function parseTask(value: unknown): Task {
  if (!isObject(value) || typeof value.id !== 'string' || !/^[a-f0-9]{32}$/.test(value.id)
    || typeof value.title !== 'string' || !value.title.trim() || [...value.title].length > 200
    || typeof value.completed !== 'boolean' || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)))
    throw new Error('Görev kaydı okunamadı. Listeyi yenile.');
  return value as Task;
}
async function invoke(command: string, args: Record<string, unknown>): Promise<unknown> {
  const bridge = globalThis.window?.__TAURI__?.core.invoke;
  if (!bridge) throw new Error('Görevlerini kaydetmek için Windows uygulamasını aç.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject('timeout'), 10000); });
    return await Promise.race([bridge(command, args), deadline]);
  }
  catch (error) {
    if (error === 'timeout') throw new Error('İşlemin sonucu henüz alınamadı. Aynı işlemi tekrar dene veya listeyi yenile.');
    if (error === 'invalidInput') throw new Error('Görev başlığı 1–200 karakter olmalı; kontrol karakteri içermemeli.');
    if (error === 'notFound') throw new Error('Görev bulunamadı. Listeyi yenile.');
    if (error === 'conflict') throw new Error('Görev değişmiş olabilir. İptal edip listeyi yenile, ardından tekrar dene.');
    if (isObject(error) && typeof error.storage === 'string') throw new Error(storageMessage(error.storage));
    throw new Error('İşlem doğrulanamadı. Aynı işlemi tekrar deneyebilir veya listeyi yenileyebilirsin.');
  } finally { clearTimeout(timer); }
}
export async function listTasks(owner: TaskOwner, offset = 0): Promise<TaskPage> {
  const value = await invoke('tasks_list', { owner, offset });
  if (!isObject(value) || !Array.isArray(value.items) || value.items.length > 100 || typeof value.hasMore !== 'boolean')
    throw new Error('Görev listesi okunamadı. Tekrar dene.');
  const items = value.items.map(parseTask);
  if (new Set(items.map(task => task.id)).size !== items.length) throw new Error('Görev listesi doğrulanamadı.');
  return { items, hasMore: value.hasMore };
}
export async function pendingCount(owner: TaskOwner): Promise<number> {
  const value = await invoke('outbox_count', { owner });
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Bekleyen kayıt sayısı okunamadı.');
  return value;
}
export type CloudStatus = { taskId: string; phase: 'localOnly' | 'pendingCreate' | 'pendingRename' | 'sent' | 'conflict'; revision: number | null };
export async function cloudStatuses(owner: TaskOwner, taskIds: string[]): Promise<CloudStatus[]> {
  const value = await invoke('outbox_statuses', { owner, taskIds });
  if (!Array.isArray(value) || value.length !== taskIds.length || value.some((entry, index) =>
    !isObject(entry) || entry.taskId !== taskIds[index]
    || typeof entry.phase !== 'string' || !['localOnly', 'pendingCreate', 'pendingRename', 'sent', 'conflict'].includes(entry.phase)
    || (entry.phase === 'sent' ? !Number.isSafeInteger(entry.revision) || (entry.revision as number) <= 0 : entry.revision !== null)))
    throw new Error('Görevlerin bulut durumu okunamadı. Listeyi yenile.');
  return value as CloudStatus[];
}
export type PendingDelivery = { sequence: number; operationId: string; taskId: string; kind: 'create' | 'rename'; expectedRevision: number; title: string };
export async function beginLocalDelivery(owner: TaskOwner, taskId: string): Promise<PendingDelivery | null> {
  const item = await invoke('outbox_pending_for_task', { owner, taskId });
  if (item === null) return null;
  if (!isObject(item) || !Number.isSafeInteger(item.sequence) || (item.sequence as number) <= 0
    || item.taskId !== taskId || !/^[a-f0-9]{32}$/.test(String(item.operationId))
    || !((item.kind === 'create' && item.expectedRevision === 0)
      || (item.kind === 'rename' && Number.isSafeInteger(item.expectedRevision) && (item.expectedRevision as number) > 0))
    || typeof item.title !== 'string' || !item.title.trim() || [...item.title].length > 200)
    throw new Error('Bekleyen görev doğrulanamadı.');
  const frozen = await invoke('outbox_begin', { owner, sequence: item.sequence });
  if (!isObject(frozen) || frozen.operationId !== item.operationId || frozen.taskId !== item.taskId
    || frozen.title !== item.title || frozen.sequence !== item.sequence || frozen.kind !== item.kind
    || frozen.expectedRevision !== item.expectedRevision) throw new Error('Gönderim kaydı değişti. Yeniden dene.');
  return frozen as PendingDelivery;
}
export async function confirmLocalDelivery(owner: TaskOwner, item: PendingDelivery, outcome: 'applied' | 'replayed', revision: number): Promise<void> {
  await invoke('outbox_acknowledge', { owner, operationId: item.operationId, taskId: item.taskId, outcome, revision });
}
export async function createTask(owner: TaskOwner, id: string, title: string): Promise<Task> {
  return parseTask(await invoke('tasks_create', { owner, id, title }));
}
export async function completeTask(owner: TaskOwner, id: string, completed: boolean): Promise<Task> {
  return parseTask(await invoke('tasks_set_completed', { owner, id, completed }));
}
export async function renameTask(owner: TaskOwner, task: Task, title: string): Promise<Task> {
  return parseTask(await invoke('tasks_rename', { owner, id: task.id, title, expectedTitle: task.title }));
}
export async function deleteTask(owner: TaskOwner, task: Task): Promise<void> {
  const value = await invoke('tasks_delete', { owner, id: task.id, expectedTitle: task.title });
  if (value !== null) throw new Error('Silme işlemi doğrulanamadı. Listeyi yenile.');
}
