import { loginStore } from '../identity/login';
import { beginQueuedDelivery, beginTaskAction, confirmLocalDelivery, confirmTaskAction, pendingCount, pendingDeliveries, pendingTaskActions, type TaskOwner } from './client';

export type SyncResult = { sent: number; remaining: number };

// Outgoing operations only. Every HTTP request uses a frozen local operation ID;
// an ambiguous response remains in SQLite for an identical replay on the next run.
export async function syncPendingTasks(owner: TaskOwner, signal: AbortSignal, limit = 50): Promise<SyncResult> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Eşitleme sınırı geçersiz.');
  let sent = 0;
  let after = 0;
  while (sent < limit) {
    if (signal.aborted) throw new Error('Eşitleme durduruldu. Bekleyen işlemler korunuyor.');
    const batch = await pendingDeliveries(owner, after);
    if (!batch.length) break;
    for (const item of batch) {
      after = item.sequence;
      if (signal.aborted) throw new Error('Eşitleme durduruldu. Bekleyen işlemler korunuyor.');
      const frozen = await beginQueuedDelivery(owner, item);
      const receipt = frozen.kind === 'create'
        ? await loginStore.sendOneLocalCreate(frozen, signal)
        : await loginStore.sendOneLocalRename(frozen, signal);
      await confirmLocalDelivery(owner, frozen, receipt.outcome, receipt.revision);
      sent++;
      if (sent >= limit) break;
    }
    if (batch.length < 100) break;
  }
  if (sent < limit) {
    const actions = await pendingTaskActions(owner);
    for (const action of actions) {
      if (signal.aborted) throw new Error('Eşitleme durduruldu. Bekleyen işlemler korunuyor.');
      const frozen = await beginTaskAction(owner, action);
      const receipt = await loginStore.sendOneLocalAction(frozen, signal);
      await confirmTaskAction(owner, frozen, receipt.revision);
      sent++;
      if (sent >= limit) break;
    }
  }
  return { sent, remaining: await pendingCount(owner) };
}
