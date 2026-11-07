import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
  let user = '11111111-1111-4111-8111-111111111111';
  let failCreate = true;
  let failComplete = true;
  let failRename = true;
  let failDelete = true;
  let deleteCalls = 0;
  let delayNextList = false;
  let releaseList: (() => void) | undefined;
  const rows = new Map<string, { id: string; title: string; completed: boolean; createdAt: string; updatedAt: string }>();
  const createIds: string[] = [];
  await page.exposeFunction('taskBridge', (command: string, args: { owner?: { userId: string }; id?: string; title?: string; completed?: boolean; expectedTitle?: string }) => {
    if (command === 'session_vault_read') return null;
    if (command.startsWith('session_vault_')) return;
    if (command === 'local_storage_status') return { engine: 'sqlite', schemaVersion: 2, migrationCount: 2, storageId: '0123456789abcdef0123456789abcdef', createdAt: '2026-11-04T08:00:00Z' };
    const prefix = `${args.owner!.userId}:`;
    const key = `${prefix}${args.id}`;
    if (command === 'tasks_list') {
      const result = { items: [...rows.entries()].filter(([id]) => id.startsWith(prefix)).map(([, task]) => task), hasMore: false };
      if (delayNextList) { delayNextList = false; return new Promise(resolve => { releaseList = () => resolve(result); }); }
      return result;
    }
    if (command === 'tasks_create') {
      createIds.push(args.id!);
      // Write succeeds but IPC reply is lost: retry must use the same request ID.
      if (!rows.has(key)) rows.set(key, { id: args.id!, title: args.title!.trim(), completed: false, createdAt: '2026-11-07T10:00:00Z', updatedAt: '2026-11-07T10:00:00Z' });
      if (failCreate) { failCreate = false; throw new Error('Synthetic lost reply'); }
      return rows.get(key);
    }
    if (command === 'tasks_set_completed') {
      if (failComplete) { failComplete = false; throw new Error('Synthetic storage failure'); }
      const task = rows.get(key)!; task.completed = args.completed!; return task;
    }
    if (command === 'tasks_rename') {
      if (failRename) { failRename = false; throw new Error('Synthetic edit failure'); }
      const task = rows.get(key)!; task.title = args.title!.trim(); return task;
    }
    if (command === 'tasks_delete') {
      ++deleteCalls; rows.delete(key);
      if (failDelete) { failDelete = false; throw new Error('Synthetic lost delete reply'); }
      return null;
    }
    throw new Error('Unexpected command');
  });
  await page.addInitScript(() => Object.assign(window, { __TAURI__: { core: {
    invoke: (command: string, args: unknown) => (window as unknown as { taskBridge: (command: string, args: unknown) => Promise<unknown> }).taskBridge(command, args),
  } } }));
  await page.route('https://**/*', route => route.abort());
  await page.route('**/health', route => route.fulfill({ json: { status: 'Healthy', service: 'personal-os-api', scope: 'process-only' } }));
  await page.route('**/api/v1/auth/status', route => route.fulfill({ json: { status: 'verificationConfigured', provider: 'supabase', signInAvailable: false, sessionPersistence: 'none', issuer: 'https://test-project.supabase.co/auth/v1' } }));
  await page.route('https://test-project.supabase.co/auth/v1/token?grant_type=password', route => route.fulfill({ json: { access_token: 'fake-task-test', token_type: 'bearer', expires_in: 3600 } }));
  await page.route('**/api/v1/auth/session', route => route.fulfill({ json: { authenticated: true, state: 'signedIn', user: { id: user, displayName: null } } }));
  await page.route('https://test-project.supabase.co/auth/v1/logout?scope=local', route => route.fulfill({ status: 204 }));
  await page.goto('/');
  return { rows, createIds, switchAccount: () => { user = '22222222-2222-4222-8222-222222222222'; },
    delayList: () => { delayNextList = true; }, release: () => releaseList?.(), pending: () => !!releaseList,
    deletions: () => deleteCalls };
}
async function login(page: Page) {
  await page.getByLabel('E-posta', { exact: true }).fill('tasks@example.test');
  await page.getByLabel('Parola', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Oturum açık', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Görevler', exact: true }).click();
}
test('local tasks retry safely, complete/reopen, survive navigation and hide on account switch (mock IPC/auth)', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Görevler', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Görevlerin için giriş yap.' })).toBeVisible();
  await page.getByRole('button', { name: 'Hesabıma git' }).click();
  await login(page);
  await expect(page.getByText('İlk görevine yer aç.')).toBeVisible();
  await page.getByLabel('Yeni görev', { exact: true }).fill('  Haftalık planı hazırla  ');
  await page.getByRole('button', { name: 'Görev ekle' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Yeni görev', { exact: true })).toHaveValue('  Haftalık planı hazırla  ');
  await expect(page.locator('.task-list li')).toHaveCount(0);
  await page.getByRole('button', { name: 'Görev ekle' }).click();
  await expect(page.locator('.task-list li')).toHaveCount(1);
  expect(state.createIds[0]).toBe(state.createIds[1]); expect(state.rows.size).toBe(1);
  const checkbox = page.getByRole('checkbox', { name: 'Haftalık planı hazırla: tamamla' });
  await checkbox.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect(page.getByRole('checkbox', { name: 'Haftalık planı hazırla: yeniden aç' })).toBeChecked();
  await page.getByRole('checkbox').uncheck();
  await expect(checkbox).not.toBeChecked();
  await page.getByRole('button', { name: 'Genel bakış', exact: true }).click();
  await page.getByRole('button', { name: 'Görevler', exact: true }).click();
  await expect(page.locator('.task-list li')).toHaveCount(1);
  await page.getByLabel('Görünüm', { exact: true }).selectOption('dark');
  await page.screenshot({ path: 'test-results/m0.8-tasks-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1360, height: 960 });
  await page.getByRole('button', { name: 'Genel bakış', exact: true }).click();
  await page.getByRole('button', { name: 'Bu cihazdan çıkış yap' }).click();
  await expect(page.getByRole('heading', { name: 'Metis’e giriş yap' })).toBeVisible();
  state.switchAccount(); await login(page);
  await expect(page.getByText('İlk görevine yer aç.')).toBeVisible();
  await expect(page.getByText('Haftalık planı hazırla', { exact: true })).toHaveCount(0);
  expect(state.rows.size).toBe(1);
});

test('a late list reply cannot display a previous account after logout (mock IPC/auth)', async ({ page }) => {
  const state = await setup(page);
  state.rows.set(`11111111-1111-4111-8111-111111111111:${'a'.repeat(32)}`, {
    id: 'a'.repeat(32), title: 'Önceki hesabın görevi', completed: false, createdAt: '2026-11-07T10:00:00Z', updatedAt: '2026-11-07T10:00:00Z',
  });
  state.delayList(); await login(page);
  await expect.poll(state.pending).toBe(true);
  await page.getByRole('button', { name: 'Genel bakış', exact: true }).click();
  await page.getByRole('button', { name: 'Bu cihazdan çıkış yap' }).click();
  await expect(page.getByRole('heading', { name: 'Metis’e giriş yap' })).toBeVisible();
  state.switchAccount(); await login(page);
  await expect(page.getByText('İlk görevine yer aç.')).toBeVisible();
  state.release();
  await page.getByRole('button', { name: 'Listeyi yenile' }).click();
  await expect(page.getByText('0 görev listeleniyor')).toBeVisible();
  await expect(page.getByText('Önceki hesabın görevi')).toHaveCount(0);
});

test('edit retains failed drafts; delete requires confirmation and safely retries a lost reply (mock IPC/auth)', async ({ page }) => {
  const state = await setup(page);
  state.rows.set(`11111111-1111-4111-8111-111111111111:${'b'.repeat(32)}`, {
    id: 'b'.repeat(32), title: 'Eski görev', completed: true, createdAt: '2026-11-07T10:00:00Z', updatedAt: '2026-11-07T10:00:00Z',
  });
  await login(page);
  const editButton = page.getByRole('button', { name: 'Eski görev: düzenle', exact: true });
  await editButton.click();
  await expect(page.getByLabel('Görev başlığı', { exact: true })).toBeFocused();
  await page.getByLabel('Görev başlığı', { exact: true }).fill('İptal edilen');
  await page.keyboard.press('Escape');
  await expect(editButton).toBeFocused();
  expect([...state.rows.values()][0].title).toBe('Eski görev');
  await editButton.click();
  await page.getByLabel('Görev başlığı', { exact: true }).fill('   ');
  await expect(page.getByRole('button', { name: 'Değişikliği kaydet' })).toBeDisabled();
  await page.getByLabel('Görev başlığı', { exact: true }).fill('Yeni görev başlığı');
  await page.getByRole('button', { name: 'Değişikliği kaydet' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Görev başlığı', { exact: true })).toHaveValue('Yeni görev başlığı');
  await expect(page.getByRole('checkbox', { name: 'Eski görev: yeniden aç' })).toBeChecked();
  await page.getByRole('button', { name: 'Değişikliği kaydet' }).click();
  await expect(page.getByRole('checkbox', { name: 'Yeni görev başlığı: yeniden aç' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Yeni görev başlığı: düzenle', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Yeni görev başlığı: sil', exact: true }).click();
  await expect(page.getByRole('button', { name: 'İptal', exact: true })).toBeFocused();
  expect(state.deletions()).toBe(0);
  await page.getByRole('button', { name: 'İptal', exact: true }).click();
  expect(state.deletions()).toBe(0);
  await page.getByRole('button', { name: 'Yeni görev başlığı: sil', exact: true }).click();
  await page.getByLabel('Görünüm', { exact: true }).selectOption('dark');
  await page.screenshot({ path: 'test-results/m0.9-delete-confirmation.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/m0.9-tasks-compact.png', fullPage: true });
  await page.getByRole('button', { name: 'Görevi kalıcı sil', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.task-list li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Görevi kalıcı sil', exact: true }).click();
  await expect(page.locator('.task-list li')).toHaveCount(0);
  await expect(page.getByLabel('Yeni görev', { exact: true })).toBeFocused();
  expect(state.rows.size).toBe(0); expect(state.deletions()).toBe(2);
  await page.getByRole('button', { name: 'Listeyi yenile' }).click();
  await expect(page.getByText('İlk görevine yer aç.')).toBeVisible();
});
