import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

// Add only the selected public project origin to Tauri CSP; no wildcard hosts or remote IPC.
const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
const command = process.argv[2];
if (!['dev', 'build'].includes(command)) throw new Error('Expected dev or build.');
const env = loadEnv(command === 'dev' ? 'development' : 'production', desktop, 'VITE_');
let origin = '';
if (env.VITE_SUPABASE_URL || env.VITE_SUPABASE_PUBLISHABLE_KEY) {
  try {
    const url = new URL(env.VITE_SUPABASE_URL);
    if (url.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]*\.supabase\.co$/.test(url.hostname)
      || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '')) throw new Error();
    origin = url.origin;
  } catch { throw new Error('Invalid public Supabase configuration. See apps/desktop/.env.example.'); }
}
const base = JSON.parse(readFileSync(new URL('../apps/desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const security = {};
for (const key of ['csp', 'devCsp']) {
  security[key] = origin ? base.app.security[key].replace("connect-src 'self'", `connect-src 'self' ${origin}`) : base.app.security[key];
}
const cli = fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url));
const args = [cli, command, '--config', JSON.stringify({ app: { security } })];
if (command === 'build') args.push('--no-bundle');
const result = spawnSync(process.execPath, args, { cwd: desktop, stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
