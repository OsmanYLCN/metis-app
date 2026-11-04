export type LoginConfig = { url: string; issuer: string; publishableKey: string };
export type LoginSettings = { kind: 'missing' } | { kind: 'invalid' } | { kind: 'ready'; config: LoginConfig };

export function parseLoginSettings(urlValue?: string, keyValue?: string): LoginSettings {
  if (!urlValue && !keyValue) return { kind: 'missing' };
  try {
    const url = new URL(urlValue ?? '');
    if (url.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]*\.supabase\.co$/.test(url.hostname)
      || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(keyValue ?? '')) return { kind: 'invalid' };
    return { kind: 'ready', config: { url: url.origin, issuer: `${url.origin}/auth/v1`, publishableKey: keyValue! } };
  } catch { return { kind: 'invalid' }; }
}

export const loginSettings = parseLoginSettings(
  import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
