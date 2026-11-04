import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

// Development convenience: derive the public API issuer from the same local client settings.
// Production configuration remains standard ASP.NET environment/configuration providers.
const root = fileURLToPath(new URL('../', import.meta.url));
const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
const config = loadEnv('development', desktop, 'VITE_');
const environment = { ...process.env };
if (!environment.Identity__Provider && !environment.Identity__Authority && config.VITE_SUPABASE_URL) {
  let url;
  try {
    url = new URL(config.VITE_SUPABASE_URL);
    if (url.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]*\.supabase\.co$/.test(url.hostname)
      || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
  } catch { throw new Error('Invalid public Supabase project URL.'); }
  environment.Identity__Provider = 'Supabase';
  environment.Identity__Authority = `${url.origin}/auth/v1`;
}
const child = spawn('dotnet', ['run', '--project', 'services/api/PersonalOS.Api.csproj', '--launch-profile', 'local'],
  { cwd: root, stdio: 'inherit', env: environment });
child.on('error', () => { console.error('API could not start. Check the .NET installation.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
