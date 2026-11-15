import { test, expect, type Page } from '@playwright/test';

const user = '11111111-1111-4111-8111-111111111111';
const now = '2026-11-15T10:00:00Z';

async function setup(page: Page) {
  const rows = new Map<string, any>();
  await page.exposeFunction('workspaceBridge', (command: string, args: any) => {
    if (command === 'session_vault_read') return null;
    if (command.startsWith('session_vault_')) return null;
    if (command === 'local_storage_status') return { engine: 'sqlite', schemaVersion: 6, migrationCount: 6, storageId: '0123456789abcdef0123456789abcdef', createdAt: now };
    const key = `${args.owner?.userId}:${args.id}`;
    if (command === 'workspace_list') {
      const items = [...rows.values()].filter(entry => entry.owner === args.owner.userId && entry.kind === args.kind
        && `${entry.title} ${entry.body}`.toLocaleLowerCase('tr-TR').includes(args.query.toLocaleLowerCase('tr-TR')))
        .map(({ owner: _owner, ...entry }) => entry);
      return { items: items.slice(args.offset, args.offset + 100), hasMore: items.length > args.offset + 100 };
    }
    if (command === 'workspace_create') {
      const entry = { id: args.id, kind: args.kind, title: args.title, body: args.body, state: args.state, pinned: args.pinned,
        revision: 1, createdAt: now, updatedAt: now, owner: args.owner.userId };
      rows.set(key, entry);
      const { owner: _owner, ...result } = entry; return result;
    }
    if (command === 'workspace_save') {
      const entry = rows.get(key);
      if (!entry || entry.revision !== args.expectedRevision) throw 'conflict';
      Object.assign(entry, { title: args.title, body: args.body, state: args.state, pinned: args.pinned, revision: entry.revision + 1 });
      const { owner: _owner, ...result } = entry; return result;
    }
    if (command === 'workspace_delete') { rows.delete(key); return null; }
    throw new Error(`Unexpected command: ${command}`);
  });
  await page.addInitScript(() => Object.assign(window, { __TAURI__: { core: {
    invoke: (command: string, args: unknown) => (window as unknown as { workspaceBridge: (command: string, args: unknown) => Promise<unknown> }).workspaceBridge(command, args),
  } } }));
  await page.route('https://**/*', route => route.abort());
  await page.route('**/health', route => route.fulfill({ json: { status: 'Healthy', service: 'personal-os-api', scope: 'process-only' } }));
  await page.route('**/api/v1/auth/status', route => route.fulfill({ json: { status: 'verificationConfigured', provider: 'supabase', signInAvailable: false, sessionPersistence: 'none', issuer: 'https://test-project.supabase.co/auth/v1' } }));
  await page.route('https://test-project.supabase.co/auth/v1/token?grant_type=password', route => route.fulfill({ json: { access_token: 'fake-workspace-test', token_type: 'bearer', expires_in: 3600 } }));
  await page.route('**/api/v1/auth/session', route => route.fulfill({ json: { authenticated: true, state: 'signedIn', user: { id: user, displayName: null } } }));
  await page.goto('/');
  await page.getByLabel('E-posta', { exact: true }).fill('notes@example.test');
  await page.getByLabel('Parola', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Oturum açık', exact: true })).toBeVisible();
  return rows;
}

test('notes can be created, searched, pinned, edited and deleted', async ({ page }) => {
  const rows = await setup(page);
  await page.getByRole('button', { name: 'Notlar', exact: true }).click();
  await page.getByRole('button', { name: 'Yeni not' }).click();
  await page.getByLabel('Not başlığı').fill('İlk fikir');
  await page.getByLabel('İçerik').fill('Üzerinde çalışılacak düşünce');
  await page.getByLabel('Önemli not olarak sabitle').check();
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByText('Not kaydedildi.')).toBeVisible();
  await page.getByLabel('Görünüm').selectOption('dark');
  await expect(page.getByText('1 not')).toBeVisible();
  await page.screenshot({ path: 'test-results/m0.25-notes.png', fullPage: true });
  await page.getByLabel('Notlarda ara').fill('çalışılacak');
  await expect(page.getByRole('button', { name: /İlk fikir/ })).toBeVisible();
  await page.getByLabel('İçerik').fill('Düzenlenmiş not');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByText('Not kaydedildi.')).toBeVisible();
  await page.getByLabel('Notlarda ara').fill('');
  await page.getByRole('button', { name: 'Sil', exact: true }).click();
  await expect(page.getByText('kalıcı olarak silinsin mi?', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Evet, sil' }).click();
  await expect(page.getByText('İlk notunu oluştur.')).toBeVisible();
  expect(rows.size).toBe(0);
});

test('projects keep descriptions and status across navigation', async ({ page }) => {
  const rows = await setup(page);
  await page.getByRole('button', { name: 'Projeler', exact: true }).click();
  await page.getByRole('button', { name: 'Yeni proje' }).click();
  await page.getByLabel('Proje adı').fill('Yeni uygulama');
  await page.getByLabel('Açıklama').fill('İlk sürümü hazırla');
  await page.getByLabel('Durum').selectOption('paused');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByText('Proje kaydedildi.')).toBeVisible();
  await page.getByLabel('Görünüm').selectOption('dark');
  await expect(page.getByText('1 proje')).toBeVisible();
  await page.screenshot({ path: 'test-results/m0.25-projects.png', fullPage: true });
  await page.getByRole('button', { name: 'Notlar', exact: true }).click();
  await page.getByRole('button', { name: 'Projeler', exact: true }).click();
  await page.getByRole('button', { name: /Yeni uygulama/ }).click();
  await expect(page.getByLabel('Durum')).toHaveValue('paused');
  await expect(page.getByLabel('Açıklama')).toHaveValue('İlk sürümü hazırla');
  await page.getByLabel('Açıklama').fill('Kaydedilmemiş değişiklik');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Notlar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projeler', exact: true })).toBeVisible();
  expect(rows.size).toBe(1);
});
