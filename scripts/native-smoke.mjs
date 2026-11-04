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
const probe = createServer();
probe.listen(5080, '127.0.0.1');
await once(probe, 'listening');
await new Promise((resolve) => probe.close(resolve));
const debugListener = createServer();
debugListener.listen(0, '127.0.0.1');
await once(debugListener, 'listening');
let debugPort = debugListener.address().port;
await new Promise((resolve) => debugListener.close(resolve));
const children = [];
let browser;

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
  const api = launch('dotnet', ['services/api/bin/Release/net10.0/PersonalOS.Api.dll'], {
    ASPNETCORE_ENVIRONMENT: 'Development', ASPNETCORE_URLS: 'http://127.0.0.1:5080',
  });
  await waitFor('http://127.0.0.1:5080/health', api);
  let desktop = launch('apps/desktop/src-tauri/target/release/personal-os-desktop.exe', [], {
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --remote-debugging-address=127.0.0.1`,
    PERSONAL_OS_DATA_DIR: dataDirectory,
    WEBVIEW2_USER_DATA_FOLDER: path.join(dataDirectory, 'webview'),
  });
  await waitFor(`http://127.0.0.1:${debugPort}/json/version`, desktop);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 10000 });
  await expect(page.getByRole('heading', { name: 'Her şey için bir başlangıç.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Yerel API bağlı' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Yerel alan hazır' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hesap bağlantısı kurulmadı' })).toBeVisible();
  const first = await page.evaluate(() => window.__TAURI__.core.invoke('local_storage_status'));
  expect(first.schemaVersion).toBe(1);
  expect(first.migrationCount).toBe(1);
  const denied = await page.evaluate(async () => {
    try { await window.__TAURI__.core.invoke('plugin:fs|read_text_file', { path: 'C:/Windows/win.ini' }); return false; }
    catch { return true; }
  });
  expect(denied).toBe(true);
  await page.getByRole('button', { name: 'Görevler Planlandı' }).click();
  await expect(page.getByRole('heading', { name: 'Görevler için yerimiz hazır.' })).toBeVisible();
  await page.getByRole('button', { name: 'Genel bakışa dön' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${root}docs/screenshots/m0.3-native.png` });

  // End the actual process, then reopen the same isolated on-disk database.
  await browser.close();
  browser = undefined;
  if (desktop.exitCode === null) {
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
  const reopened = nextContext.pages()[0] ?? await nextContext.waitForEvent('page', { timeout: 10000 });
  await expect(reopened.getByRole('heading', { name: 'Yerel alan hazır' })).toBeVisible();
  const second = await reopened.evaluate(() => window.__TAURI__.core.invoke('local_storage_status'));
  expect(second).toEqual(first);
  console.log('PASS: Windows release renders, connects to API, permits only storage status, and preserves SQLite identity across process restarts.');
} finally {
  await browser?.close().catch(() => {});
  for (const child of children.reverse()) {
    if (child.exitCode === null && !child.launchError) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
  }
}
