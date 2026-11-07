import { test, expect, type Page } from '@playwright/test';

async function fixtures(page: Page) {
  // Every external/auth request is intercepted. Never use a real account in automated UI tests.
  await page.route('https://**/*', route => route.abort());
  await page.route('**/health', route => route.fulfill({ json: { status: 'Healthy', service: 'personal-os-api', scope: 'process-only' } }));
  await page.route('**/api/v1/auth/status', route => route.fulfill({ json: {
    status: 'verificationConfigured', provider: 'supabase', signInAvailable: false, sessionPersistence: 'none',
    issuer: 'https://test-project.supabase.co/auth/v1',
  } }));
  await page.route('https://test-project.supabase.co/auth/v1/token?grant_type=password', route => route.fulfill({ json: {
    access_token: 'ui-test-token', refresh_token: 'unused-test-value', token_type: 'bearer', expires_in: 3600,
  } }));
  await page.route('**/api/v1/auth/session', route => route.fulfill({ json: {
    authenticated: true, state: 'signedIn', user: { id: '11111111-1111-4111-8111-111111111111', displayName: null },
  } }));
  await page.route('https://test-project.supabase.co/auth/v1/logout?scope=local', route => route.fulfill({ status: 204 }));
  await page.goto('/');
}

test('Metis login persists across navigation, clears on logout and never persists across reload', async ({ page }) => {
  await fixtures(page);
  await expect(page).toHaveTitle('Genel bakış · Metis');
  await expect(page.getByRole('heading', { name: 'Metis’e giriş yap' })).toBeVisible();
  await page.getByLabel('E-posta', { exact: true }).fill('test@example.test');
  await page.getByLabel('Parola', { exact: true }).fill('fake-test-password');
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Oturum açık', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Görevler' }).click();
  await page.getByRole('button', { name: 'Genel bakışa dön' }).click();
  await expect(page.getByRole('heading', { name: 'Oturum açık', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bu cihazdan çıkış yap' }).click();
  await expect(page.getByRole('heading', { name: 'Metis’e giriş yap' })).toBeVisible();
  await expect(page.getByLabel('Parola', { exact: true })).toHaveValue('');
  await page.getByLabel('E-posta', { exact: true }).fill('test@example.test');
  await page.getByLabel('Parola', { exact: true }).fill('fake-test-password');
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Oturum açık', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Metis’e giriş yap' })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.screenshot({ path: 'test-results/m0.5-login.png', fullPage: true });
});

test('API rejection shows a safe error and clears the password', async ({ page }) => {
  await fixtures(page);
  await page.route('**/api/v1/auth/session', route => route.fulfill({ status: 401, json: { authenticated: false, user: null } }));
  await page.getByLabel('E-posta', { exact: true }).fill('test@example.test');
  await page.getByLabel('Parola', { exact: true }).fill('fake-test-password');
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  await expect(page.getByText('Metis oturumu doğrulayamadı. API bağlantısını ve hesap ayarlarını kontrol et.')).toBeVisible();
  await expect(page.getByLabel('Parola', { exact: true })).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Oturum açık', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 780, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('explicit remember restores after reload through mocked native vault and fresh API verification', async ({ page }) => {
  let saved: string | null = null;
  await page.exposeFunction('testVault', (command: string, args: { token?: string }) => {
    if (command === 'session_vault_write') { saved = args.token!; return; }
    if (command === 'session_vault_clear') { saved = null; return; }
    if (command === 'session_vault_read') return saved;
    return { engine: 'sqlite', schemaVersion: 2, migrationCount: 2, storageId: '0123456789abcdef0123456789abcdef', createdAt: '2026-11-04T08:00:00.000Z' };
  });
  await page.addInitScript(() => Object.assign(window, { __TAURI__: { core: {
    invoke: (command: string, args: unknown) => (window as unknown as { testVault: (command: string, args: unknown) => Promise<unknown> }).testVault(command, args),
  } } }));
  await fixtures(page);
  await page.route('https://test-project.supabase.co/auth/v1/token?grant_type=refresh_token', route => route.fulfill({ json: {
    access_token: 'renewed-ui-token', refresh_token: 'rotated-ui-refresh', token_type: 'bearer', expires_in: 3600,
  } }));
  await page.getByLabel('E-posta', { exact: true }).fill('test@example.test');
  await page.getByLabel('Parola', { exact: true }).fill('fake-test-password');
  await page.getByLabel('Bu cihazda oturumumu hatırla').check();
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Oturum açık', exact: true })).toBeVisible();
  expect(saved).toBe('unused-test-value');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Oturum açık', exact: true })).toBeVisible();
  expect(saved).toBe('rotated-ui-refresh');
  await page.getByRole('button', { name: 'Bu cihazdan çıkış yap' }).click();
  await expect(page.getByRole('heading', { name: 'Metis’e giriş yap' })).toBeVisible();
  expect(saved).toBeNull();
});
