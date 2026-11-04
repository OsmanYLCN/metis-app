import { API_URL } from '../api/health';

export type IdentityStatus = {
  status: 'notConfigured'; provider: null; signInAvailable: false; sessionPersistence: 'none';
} | {
  status: 'connectionPending' | 'verificationConfigured'; provider: 'supabase'; signInAvailable: false; sessionPersistence: 'none';
};

// This slice stores no access/refresh tokens, cookies or user identity in the browser or SQLite.
export async function readIdentityStatus(signal?: AbortSignal): Promise<IdentityStatus> {
  const response = await fetch(`${API_URL}/api/v1/auth/status`, {
    credentials: 'omit', cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error('Hesap durumuna erişilemiyor.');
  const value: unknown = await response.json();
  if (typeof value !== 'object' || value === null) throw new Error('Hesap durumu doğrulanamadı.');
  const item = value as Partial<IdentityStatus>;
  if (item.signInAvailable !== false || item.sessionPersistence !== 'none'
    || !((item.status === 'notConfigured' && item.provider === null)
      || ((item.status === 'connectionPending' || item.status === 'verificationConfigured') && item.provider === 'supabase'))) {
    throw new Error('Hesap durumu doğrulanamadı.');
  }
  return item as IdentityStatus;
}
