import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loginStore } from '../identity/login';
import * as client from './client';
import { syncPendingTasks } from './sync';

vi.mock('../identity/login', () => ({ TaskConflictError:class extends Error{},loginStore: {
  sendOneLocalCreate: vi.fn(), sendOneLocalRename: vi.fn(), sendOneLocalAction: vi.fn(),
} }));
vi.mock('./client', () => ({
  pendingDeliveries: vi.fn(), beginQueuedDelivery: vi.fn(), confirmLocalDelivery: vi.fn(),
  pendingTaskActions: vi.fn(), beginTaskAction: vi.fn(), confirmTaskAction: vi.fn(), pendingCount: vi.fn(),
}));

const owner = { projectRef: 'test-project', userId: '11111111-1111-4111-8111-111111111111' };
const create = { sequence: 1, operationId: 'a'.repeat(32), taskId: 'b'.repeat(32), kind: 'create' as const, expectedRevision: 0, title: 'Task' };
const rename = { ...create, sequence: 2, operationId: 'c'.repeat(32), kind: 'rename' as const, expectedRevision: 1, title: 'Renamed' };
const complete = { operationId: 'd'.repeat(32), taskId: 'b'.repeat(32), kind: 'complete' as const, expectedRevision: 2, completed: true };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.pendingDeliveries).mockResolvedValue([create, rename]);
  vi.mocked(client.beginQueuedDelivery).mockImplementation(async (_owner, item) => item);
  vi.mocked(client.pendingTaskActions).mockResolvedValue([complete]);
  vi.mocked(client.beginTaskAction).mockImplementation(async (_owner, item) => item);
  vi.mocked(client.pendingCount).mockResolvedValue(0);
  vi.mocked(loginStore.sendOneLocalCreate).mockResolvedValue({ outcome: 'applied', revision: 1 });
  vi.mocked(loginStore.sendOneLocalRename).mockResolvedValue({ outcome: 'applied', revision: 2 });
  vi.mocked(loginStore.sendOneLocalAction).mockResolvedValue({ outcome: 'applied', revision: 3 });
});

describe('outgoing task sync', () => {
  it('sends frozen operations in order and acknowledges only validated receipts', async () => {
    const result = await syncPendingTasks(owner, new AbortController().signal);
    expect(result).toEqual({ sent: 3, attempted:3, remaining: 0 });
    expect(client.confirmLocalDelivery).toHaveBeenNthCalledWith(1, owner, create, 'applied', 1);
    expect(client.confirmLocalDelivery).toHaveBeenNthCalledWith(2, owner, rename, 'applied', 2);
    expect(client.confirmTaskAction).toHaveBeenCalledWith(owner, complete, 3);
    expect(vi.mocked(client.confirmLocalDelivery).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(loginStore.sendOneLocalAction).mock.invocationCallOrder[0]);
  });
  it('stops after an uncertain HTTP response without acknowledging or advancing the queue', async () => {
    vi.mocked(loginStore.sendOneLocalCreate).mockRejectedValueOnce(Error('uncertain'));
    await expect(syncPendingTasks(owner, new AbortController().signal)).rejects.toThrow('uncertain');
    expect(client.confirmLocalDelivery).not.toHaveBeenCalled();
    expect(client.pendingTaskActions).not.toHaveBeenCalled();
  });
  it('does not start a queued request after account navigation aborts the run', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(syncPendingTasks(owner, controller.signal)).rejects.toThrow('durduruldu');
    expect(client.pendingDeliveries).not.toHaveBeenCalled();
  });
});
