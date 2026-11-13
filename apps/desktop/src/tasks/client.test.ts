import { afterEach, expect, it, vi } from 'vitest';
import { beginLocalDelivery, cloudStatuses, createTask, listTasks } from './client';
const owner = { projectRef: 'test-project', userId: '11111111-1111-4111-8111-111111111111' };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function bridge(invoke: (...args: unknown[]) => Promise<unknown>) { vi.stubGlobal('window', { __TAURI__: { core: { invoke } } }); }

it('rejects browser writes without inventing persistence', async () => {
  vi.stubGlobal('window', {});
  await expect(createTask(owner, 'a'.repeat(32), 'Test')).rejects.toThrow('Windows uygulamasını aç');
});
it('rejects malformed native records instead of rendering successful tasks', async () => {
  bridge(async () => ({ items: [{ id: 'a'.repeat(32), title: 'Test', completed: 'true', createdAt: 'invalid', updatedAt: 'invalid' }], hasMore: false }));
  await expect(listTasks(owner)).rejects.toThrow('Görev kaydı okunamadı');
});
it('bounds a stalled mutation and makes no automatic retry after an ambiguous write', async () => {
  vi.useFakeTimers();
  const invoke = vi.fn(() => new Promise<never>(() => {})); bridge(invoke);
  const pending = expect(createTask(owner, 'a'.repeat(32), 'Test')).rejects.toThrow('sonucu henüz alınamadı');
  await vi.advanceTimersByTimeAsync(10000); await pending;
  expect(invoke).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it('does not expose arbitrary native errors to the interface', async () => {
  bridge(async () => { throw 'C:/private/task/database'; });
  await expect(listTasks(owner)).rejects.toThrow('İşlem doğrulanamadı');
});
it('reads account-scoped delivery status and freezes a rename before network use', async () => {
  const taskId = 'b'.repeat(32);
  const pending = { sequence: 2, operationId: 'a'.repeat(32), taskId, kind: 'rename', expectedRevision: 1, title: 'Updated' };
  const invoke = vi.fn(async (command: unknown) => command === 'outbox_statuses'
    ? [{ taskId, phase: 'pendingRename', revision: null }] : pending);
  bridge(invoke);
  await expect(cloudStatuses(owner, [taskId])).resolves.toEqual([{ taskId, phase: 'pendingRename', revision: null }]);
  await expect(beginLocalDelivery(owner, taskId)).resolves.toEqual(pending);
  expect(invoke).toHaveBeenNthCalledWith(2, 'outbox_pending_for_task', { owner, taskId });
  expect(invoke).toHaveBeenNthCalledWith(3, 'outbox_begin', { owner, sequence: 2 });
});
it('rejects a mismatched delivery status page', async () => {
  bridge(async () => [{ taskId: 'a'.repeat(32), phase: 'sent', revision: 1 }]);
  await expect(cloudStatuses(owner, ['b'.repeat(32)])).rejects.toThrow('bulut durumu okunamadı');
});
