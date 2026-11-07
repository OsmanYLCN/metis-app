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
