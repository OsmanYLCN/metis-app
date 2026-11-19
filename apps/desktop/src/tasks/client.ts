import { storageMessage } from '../storage/localStorage';

export type TaskOwner = { projectRef: string; userId: string };
export type TaskPriority = 0 | 1 | 2 | 3;
export type Task = { id: string; title: string; completed: boolean; createdAt: string; updatedAt: string;
  projectId: string | null; dueDate: string | null; priority: TaskPriority };
export type TaskPage = { items: Task[]; hasMore: boolean };
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
function parseTask(value: unknown): Task {
  if (!isObject(value) || typeof value.id !== 'string' || !/^[a-f0-9]{32}$/.test(value.id)
    || typeof value.title !== 'string' || !value.title.trim() || [...value.title].length > 200
    || typeof value.completed !== 'boolean' || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))
    || !(value.projectId === null || (typeof value.projectId === 'string' && /^[a-f0-9]{32}$/.test(value.projectId)))
    || !(value.dueDate === null || (typeof value.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.dueDate)))
    || ![0, 1, 2, 3].includes(value.priority as number))
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
    if (error === 'recoveryRequired') throw new Error('Yedekten geri yükleme sonrası buluta gönderim duraklatıldı. Veri ve eşitleme ekranını aç.');
    if (error === 'conflict') throw new Error('Görev değişmiş olabilir. İptal edip listeyi yenile, ardından tekrar dene.');
    if (isObject(error) && typeof error.storage === 'string') throw new Error(storageMessage(error.storage));
    throw new Error('İşlem doğrulanamadı. Aynı işlemi tekrar deneyebilir veya listeyi yenileyebilirsin.');
  } finally { clearTimeout(timer); }
}
export async function listTasks(owner: TaskOwner, offset = 0, projectFilter: string | null = null, filters?: {query:string;status:string;date:string;priority:string;sort:string;today:string;week:string}): Promise<TaskPage> {
  const value = await invoke('tasks_list', { owner, offset, projectFilter, filters: filters ?? null });
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
export type CloudStatus = { taskId: string; phase: 'localOnly' | 'pendingCreate' | 'pendingRename' | 'pendingComplete' | 'pendingDelete' | 'sent' | 'conflict'; revision: number | null };
export async function cloudStatuses(owner: TaskOwner, taskIds: string[]): Promise<CloudStatus[]> {
  const value = await invoke('outbox_statuses', { owner, taskIds });
  if (!Array.isArray(value) || value.length !== taskIds.length || value.some((entry, index) =>
    !isObject(entry) || entry.taskId !== taskIds[index]
    || typeof entry.phase !== 'string' || !['localOnly', 'pendingCreate', 'pendingRename', 'pendingComplete', 'pendingDelete', 'sent', 'conflict'].includes(entry.phase)
    || (entry.phase === 'sent' ? !Number.isSafeInteger(entry.revision) || (entry.revision as number) <= 0 : entry.revision !== null)))
    throw new Error('Görevlerin bulut durumu okunamadı. Listeyi yenile.');
  return value as CloudStatus[];
}
export type PendingDelivery = { sequence: number; operationId: string; taskId: string; kind: 'create' | 'rename'; expectedRevision: number; title: string };
function parseDelivery(item: unknown): PendingDelivery {
  if (!isObject(item) || !Number.isSafeInteger(item.sequence) || (item.sequence as number) <= 0
    || !/^[a-f0-9]{32}$/.test(String(item.taskId)) || !/^[a-f0-9]{32}$/.test(String(item.operationId))
    || !((item.kind === 'create' && item.expectedRevision === 0)
      || (item.kind === 'rename' && Number.isSafeInteger(item.expectedRevision) && (item.expectedRevision as number) > 0))
    || typeof item.title !== 'string' || !item.title.trim() || [...item.title].length > 200)
    throw new Error('Bekleyen görev doğrulanamadı.');
  return item as PendingDelivery;
}
export async function pendingDeliveries(owner: TaskOwner, after = 0): Promise<PendingDelivery[]> {
  const value = await invoke('outbox_pending', { owner, after });
  if (!Array.isArray(value) || value.length > 100) throw new Error('Gönderim kuyruğu okunamadı.');
  const items = value.map(parseDelivery);
  if (items.some((item, index) => item.sequence <= (index ? items[index - 1].sequence : after)))
    throw new Error('Gönderim kuyruğu sırası doğrulanamadı.');
  return items;
}
export async function beginQueuedDelivery(owner: TaskOwner, item: PendingDelivery): Promise<PendingDelivery> {
  const frozen = parseDelivery(await invoke('outbox_begin', { owner, sequence: item.sequence }));
  if (frozen.operationId !== item.operationId || frozen.taskId !== item.taskId || frozen.title !== item.title
    || frozen.sequence !== item.sequence || frozen.kind !== item.kind || frozen.expectedRevision !== item.expectedRevision)
    throw new Error('Gönderim kaydı değişti. Yeniden dene.');
  return frozen;
}
export async function beginLocalDelivery(owner: TaskOwner, taskId: string): Promise<PendingDelivery | null> {
  const item = await invoke('outbox_pending_for_task', { owner, taskId });
  if (item === null) return null;
  const parsed = parseDelivery(item);
  if (parsed.taskId !== taskId) throw new Error('Bekleyen görev doğrulanamadı.');
  return beginQueuedDelivery(owner, parsed);
}
export async function confirmLocalDelivery(owner: TaskOwner, item: PendingDelivery, outcome: 'applied' | 'replayed', revision: number): Promise<void> {
  await invoke('outbox_acknowledge', { owner, operationId: item.operationId, taskId: item.taskId, outcome, revision });
}
export type PendingAction = { operationId: string; taskId: string; kind: 'complete' | 'delete'; expectedRevision: number; completed: boolean | null };
function parseAction(value: unknown, taskId: string): PendingAction {
  if (!isObject(value) || value.taskId !== taskId || !/^[a-f0-9]{32}$/.test(String(value.operationId))
    || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 1
    || !((value.kind === 'complete' && typeof value.completed === 'boolean') || (value.kind === 'delete' && value.completed === null)))
    throw new Error('Bulut işlemi doğrulanamadı. Listeyi yenile.');
  return value as PendingAction;
}
export async function pendingTaskActions(owner: TaskOwner): Promise<PendingAction[]> {
  const value = await invoke('task_actions_pending', { owner });
  if (!Array.isArray(value) || value.length > 100) throw new Error('Bekleyen bulut işlemleri okunamadı.');
  const actions = value.map(item => parseAction(item, isObject(item) ? String(item.taskId) : ''));
  if (new Set(actions.map(item => item.operationId)).size !== actions.length)
    throw new Error('Bekleyen bulut işlemleri doğrulanamadı.');
  return actions;
}
export async function prepareTaskAction(owner: TaskOwner, taskId: string, kind: PendingAction['kind'], completed: boolean | null): Promise<PendingAction> {
  return parseAction(await invoke('task_action_prepare', { owner, taskId, kind, completed }), taskId);
}
export async function beginTaskAction(owner: TaskOwner, action: PendingAction): Promise<PendingAction> {
  const frozen = parseAction(await invoke('task_action_begin', { owner, operationId: action.operationId }), action.taskId);
  if (frozen.operationId !== action.operationId || frozen.kind !== action.kind || frozen.expectedRevision !== action.expectedRevision
    || frozen.completed !== action.completed) throw new Error('Bulut işlemi değişti. Listeyi yenile.');
  return frozen;
}
export async function confirmTaskAction(owner: TaskOwner, action: PendingAction, revision: number): Promise<void> {
  const value = await invoke('task_action_acknowledge', { owner, operationId: action.operationId, taskId: action.taskId, revision });
  if (value !== null) throw new Error('Bulut işleminin yerel kaydı doğrulanamadı. Listeyi yenile.');
}
export async function createTask(owner: TaskOwner, id: string, title: string): Promise<Task> {
  return parseTask(await invoke('tasks_create', { owner, id, title }));
}
export async function completeTask(owner: TaskOwner, id: string, completed: boolean): Promise<Task> {
  return parseTask(await invoke('tasks_set_completed', { owner, id, completed }));
}
export async function setTaskPlanning(owner: TaskOwner, id: string, projectId: string | null, dueDate: string | null, priority: TaskPriority): Promise<Task> {
  return parseTask(await invoke('tasks_set_planning', { owner, id, projectId, dueDate, priority }));
}
export async function scheduledTasks(owner: TaskOwner, from: string, to: string): Promise<Task[]> {
  const value = await invoke('tasks_scheduled', { owner, from, to });
  if (!Array.isArray(value) || value.length > 500) throw new Error('Takvim görevleri okunamadı. Tekrar dene.');
  return value.map(parseTask);
}
export type ProjectProgress = { projectId: string; total: number; completed: number; overdue: number };
export async function projectProgress(owner: TaskOwner, today: string): Promise<ProjectProgress[]> {
  const value=await invoke('project_progress',{owner,today});
  if(!Array.isArray(value)||value.length>200||value.some(item=>!isObject(item)||typeof item.projectId!=='string'||!/^[a-f0-9]{32}$/.test(item.projectId)||![item.total,item.completed,item.overdue].every(number=>Number.isSafeInteger(number)&&Number(number)>=0)||Number(item.completed)>Number(item.total))) throw new Error('Proje ilerlemesi okunamadı.');
  return value as ProjectProgress[];
}
export async function renameTask(owner: TaskOwner, task: Task, title: string): Promise<Task> {
  return parseTask(await invoke('tasks_rename', { owner, id: task.id, title, expectedTitle: task.title }));
}
export async function deleteTask(owner: TaskOwner, task: Task): Promise<void> {
  const value = await invoke('tasks_delete', { owner, id: task.id, expectedTitle: task.title });
  if (value !== null) throw new Error('Silme işlemi doğrulanamadı. Listeyi yenile.');
}

export async function getTask(owner:TaskOwner,id:string):Promise<Task>{return parseTask(await invoke('tasks_get',{owner,id}))}
