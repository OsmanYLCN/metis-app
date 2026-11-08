import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));

async function availablePort() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

test('real API health, routing and development CORS', { timeout: 30000 }, async (t) => {
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn('dotnet', ['services/api/bin/Release/net10.0/PersonalOS.Api.dll'], {
    cwd: root,
    env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Development', ASPNETCORE_URLS: base,
      Identity__Provider: 'Disabled', Identity__Authority: '', CentralTasks__Provider: 'Disabled' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  let launchError;
  child.on('error', (error) => { launchError = error; });
  child.stdout.on('data', (data) => { logs += data; });
  child.stderr.on('data', (data) => { logs += data; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null && !launchError) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
  });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`API exited: ${logs}`);
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch { /* Kestrel is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.ok(ready, `API did not become ready: ${logs}`);

  await t.test('returns a real, uncached process-only health contract', async () => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(await response.json(), { status: 'Healthy', service: 'personal-os-api', scope: 'process-only' });
  });
  await t.test('permits the local Vite and Windows Tauri origins', async () => {
    for (const origin of ['http://127.0.0.1:1420', 'http://tauri.localhost']) {
      const response = await fetch(`${base}/health`, { headers: { Origin: origin } });
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal(response.headers.get('access-control-allow-credentials'), null);
    }
  });
  await t.test('does not grant CORS to an unrelated website', async () => {
    const response = await fetch(`${base}/health`, { headers: { Origin: 'https://untrusted.example' } });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
  await t.test('protects central task reads and does not enable mutations', async () => {
    const tasks = await fetch(`${base}/api/v1/tasks`);
    assert.equal(tasks.status, 401);
    assert.equal(tasks.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await tasks.json(), { code: 'authentication_required' });
    assert.equal((await fetch(`${base}/api/v1/tasks`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/health`, { method: 'POST' })).status, 405);
  });
  await t.test('exposes disconnected identity status without creating a session', async () => {
    const response = await fetch(`${base}/api/v1/auth/status`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      status: 'notConfigured', provider: null, signInAvailable: false, sessionPersistence: 'none', issuer: null,
    });
    const session = await fetch(`${base}/api/v1/auth/session`, {
      headers: { Authorization: 'Bearer unverified-test-token' },
    });
    assert.equal(session.status, 401);
    assert.equal(session.headers.get('set-cookie'), null);
    assert.deepEqual(await session.json(), { authenticated: false, state: 'signedOut', user: null });
  });
});
