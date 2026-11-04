import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLocalStorage, storageMessage } from './localStorage';

const info = { engine: 'sqlite', schemaVersion: 1, migrationCount: 1,
  storageId: '0123456789abcdef0123456789abcdef', createdAt: '2026-11-04T08:00:00.000Z' };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('local storage bridge', () => {
  it('reports browser preview without inventing SQLite persistence', async () => {
    await expect(readLocalStorage()).resolves.toEqual({ kind: 'preview' });
  });
  it('uses only the parameterless allowlisted storage command', async () => {
    const invoke = vi.fn().mockResolvedValue(info);
    await expect(readLocalStorage(invoke)).resolves.toEqual({ kind: 'ready', info });
    expect(invoke).toHaveBeenCalledExactlyOnceWith('local_storage_status');
  });
  it('does not accept a malformed native status', async () => {
    await expect(readLocalStorage(vi.fn().mockResolvedValue({ engine: 'sqlite' })))
      .resolves.toEqual({ kind: 'failed', code: 'invalidSchema' });
  });
  it('preserves newer-schema errors instead of resetting or retrying migrations', async () => {
    const invoke = vi.fn().mockRejectedValue('newerSchema');
    await expect(readLocalStorage(invoke)).resolves.toEqual({ kind: 'failed', code: 'newerSchema' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('sanitizes arbitrary native errors', async () => {
    const result = await readLocalStorage(vi.fn().mockRejectedValue('C:/private/path/details'));
    expect(result).toEqual({ kind: 'failed', code: 'unavailable' });
    expect(storageMessage('unavailable')).not.toContain('private');
  });
  it('bounds a stalled bridge call without claiming success', async () => {
    vi.useFakeTimers();
    const pending = readLocalStorage(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(6000);
    await expect(pending).resolves.toEqual({ kind: 'failed', code: 'timeout' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
