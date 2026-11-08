// Optional Windows release smoke check. Debugging is enabled only for this child process.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const testRoot = path.join(root, 'test-results');
await mkdir(testRoot, { recursive: true });
const dataDirectory = await mkdtemp(path.join(testRoot, 'native-storage-'));
const mockApi = process.env.METIS_NATIVE_MOCK_API === '1';
if (!mockApi) {
  const probe = createServer();
  probe.listen(5080, '127.0.0.1');
  await once(probe, 'listening');
  await new Promise((resolve) => probe.close(resolve));
}
const debugListener = createServer();
debugListener.listen(0, '127.0.0.1');
await once(debugListener, 'listening');
let debugPort = debugListener.address().port;
await new Promise((resolve) => debugListener.close(resolve));
const children = [];
let browser;

async function preparePage(context) {
  if (mockApi) {
    await context.route('http://127.0.0.1:5080/**', route => route.fulfill({ json: route.request().url().endsWith('/health')
      ? { status: 'Healthy', service: 'personal-os-api', scope: 'process-only' }
      : { status: 'notConfigured', provider: null, signInAvailable: false, sessionPersistence: 'none', issuer: null } }));
    await context.route('https://**/*', route => route.abort());
  }
  const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 10000 });
  if (mockApi) await page.reload();
  return page;
}

function launch(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (data) => process.stderr.write(data));
  child.stdout.resume();
  child.on('error', (error) => { child.launchError = error; });
  children.push(child);
  return child;
}

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.launchError) throw child.launchError;
    if (child.exitCode !== null) throw new Error(`Process exited: ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch { /* Wait for child startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Startup timed out: ${url}`);
}

try {
  if (!mockApi) {
    const api = launch('dotnet', ['services/api/bin/Release/net10.0/PersonalOS.Api.dll'], {
      ASPNETCORE_ENVIRONMENT: 'Development', ASPNETCORE_URLS: 'http://127.0.0.1:5080',
      Identity__Provider: 'Disabled', Identity__Authority: '', CentralTasks__Provider: 'Disabled', CentralTaskWriter__Provider: 'Disabled',
    });
    await waitFor('http://127.0.0.1:5080/health', api);
  }
  let desktop = launch('apps/desktop/src-tauri/target/release/personal-os-desktop.exe', [], {
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --remote-debugging-address=127.0.0.1`,
    PERSONAL_OS_DATA_DIR: dataDirectory,
    WEBVIEW2_USER_DATA_FOLDER: path.join(dataDirectory, 'webview'),
  });
  await waitFor(`http://127.0.0.1:${debugPort}/json/version`, desktop);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  const page = await preparePage(context);
  await expect(page.getByRole('heading', { name: 'Her şey için bir başlangıç.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Yerel API bağlı' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Yerel alan hazır' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hesap bağlantısı kurulmadı' })).toBeVisible();
  const first = await page.evaluate(() => window.__TAURI__.core.invoke('local_storage_status'));
  expect(first.schemaVersion).toBe(2);
  expect(first.migrationCount).toBe(2);
  await page.evaluate(() => window.__TAURI__.core.invoke('session_vault_write', { projectRef: 'native-test', token: 'synthetic-native-refresh' }));
  expect(await page.evaluate(() => window.__TAURI__.core.invoke('session_vault_read', { projectRef: 'native-test' }))).toBe('synthetic-native-refresh');
  expect(await page.evaluate(() => window.__TAURI__.core.invoke('session_vault_read', { projectRef: 'another-test' }))).toBeNull();
  const denied = await page.evaluate(async () => {
    try { await window.__TAURI__.core.invoke('plugin:fs|read_text_file', { path: 'C:/Windows/win.ini' }); return false; }
    catch { return true; }
  });
  expect(denied).toBe(true);
  await page.getByRole('button', { name: 'Görevler' }).click();
  await expect(page.getByRole('heading', { name: 'Görevlerin için giriş yap.' })).toBeVisible();
  await page.getByRole('button', { name: 'Hesabıma git' }).click();
  const taskOwner = { projectRef: 'native-test', userId: '11111111-1111-4111-8111-111111111111' };
  const taskId = 'a'.repeat(32);
  const task = await page.evaluate(({ owner, id }) => window.__TAURI__.core.invoke('tasks_create', { owner, id, title: 'Yerel test görevi' }), { owner: taskOwner, id: taskId });
  expect(task.title).toBe('Yerel test görevi');
  const completed = await page.evaluate(({ owner, id }) => window.__TAURI__.core.invoke('tasks_set_completed', { owner, id, completed: true }), { owner: taskOwner, id: taskId });
  expect(completed.completed).toBe(true);
  const renamed = await page.evaluate(({ owner, id, expectedTitle }) => window.__TAURI__.core.invoke('tasks_rename', { owner, id, expectedTitle, title: 'Düzenlenen yerel görev' }), { owner: taskOwner, id: taskId, expectedTitle: completed.title });
  expect(renamed.title).toBe('Düzenlenen yerel görev');
  expect(renamed.completed).toBe(true);
  await page.evaluate(owner => window.__TAURI__.core.invoke('tasks_create', { owner, id: 'b'.repeat(32), title: 'Silinecek test görevi' }), taskOwner);
  await page.evaluate(owner => window.__TAURI__.core.invoke('tasks_delete', { owner, id: 'b'.repeat(32), expectedTitle: 'Silinecek test görevi' }), taskOwner);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${root}test-results/m0.9-native.png` });

  // End the actual process, then reopen the same isolated on-disk database.
  await browser.close();
  browser = undefined;
  if (desktop.exitCode === null && desktop.signalCode === null) {
    const stopped = once(desktop, 'exit');
    desktop.kill();
    await stopped;
  }
  const bytes = await readFile(path.join(dataDirectory, 'storage', 'personal-os.sqlite3'));
  expect(bytes.subarray(0, 16).toString()).toBe('SQLite format 3\0');
  const nextDebugListener = createServer();
  nextDebugListener.listen(0, '127.0.0.1');
  await once(nextDebugListener, 'listening');
  debugPort = nextDebugListener.address().port;
  await new Promise((resolve) => nextDebugListener.close(resolve));
  desktop = launch('apps/desktop/src-tauri/target/release/personal-os-desktop.exe', [], {
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --remote-debugging-address=127.0.0.1`,
    PERSONAL_OS_DATA_DIR: dataDirectory,
    WEBVIEW2_USER_DATA_FOLDER: path.join(dataDirectory, 'webview'),
  });
  await waitFor(`http://127.0.0.1:${debugPort}/json/version`, desktop);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const nextContext = browser.contexts()[0];
  const reopened = await preparePage(nextContext);
  await expect(reopened.getByRole('heading', { name: 'Yerel alan hazır' })).toBeVisible();
  const second = await reopened.evaluate(() => window.__TAURI__.core.invoke('local_storage_status'));
  expect(second).toEqual(first);
  const persisted = await reopened.evaluate(owner => window.__TAURI__.core.invoke('tasks_list', { owner, offset: 0 }), taskOwner);
  expect(persisted.items).toEqual([renamed]);
  const other = await reopened.evaluate(owner => window.__TAURI__.core.invoke('tasks_list', { owner, offset: 0 }), { ...taskOwner, projectRef: 'another-test' });
  expect(other.items).toEqual([]);
  expect(await reopened.evaluate(() => window.__TAURI__.core.invoke('session_vault_read', { projectRef: 'native-test' }))).toBe('synthetic-native-refresh');
  await reopened.evaluate(() => window.__TAURI__.core.invoke('session_vault_clear', { projectRef: 'native-test' }));
  expect(await reopened.evaluate(() => window.__TAURI__.core.invoke('session_vault_read', { projectRef: 'native-test' }))).toBeNull();
  console.log(`PASS: Windows IPC task create/complete/rename/delete/restart and owner partition, vault save/reopen/delete, restricted permissions, and SQLite restart identity. API mode: ${mockApi ? 'mock responses; existing API untouched' : 'real isolated local process'}.`);
} finally {
  await browser?.close().catch(() => {});
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.signalCode === null && !child.launchError) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
  }
}
