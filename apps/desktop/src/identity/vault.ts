export interface SessionVault {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}
type NativeWindow = Window & { __TAURI__?: { core?: { invoke<T>(command: string, args: Record<string, unknown>): Promise<T> } } };
export function nativeVault(issuer: string): SessionVault | undefined {
  const invoke = typeof window !== 'undefined' ? (window as NativeWindow).__TAURI__?.core?.invoke : undefined;
  if (!invoke) return undefined;
  const projectRef = new URL(issuer).hostname.split('.')[0];
  return {
    read: async () => {
      const value = await invoke<unknown>('session_vault_read', { projectRef });
      if (value === null) return null;
      if (typeof value !== 'string' || !value.length || value.length > 8192) throw Error('Invalid saved session');
      return value;
    },
    write: token => invoke<void>('session_vault_write', { projectRef, token }),
    clear: () => invoke<void>('session_vault_clear', { projectRef }),
  };
}
