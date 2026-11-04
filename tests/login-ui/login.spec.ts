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
  await page.getByRole('button', { name: 'Görevler Planlandı' }).click();
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
