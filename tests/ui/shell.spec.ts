import { test, expect } from '@playwright/test';

test('connects to the real local API and renders the foundation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Yerel API bağlı' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Her şey için bir başlangıç.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hesap bağlantısı kurulmadı' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Masaüstünde kullanılabilir' })).toBeVisible();
  await expect(page.getByText('Bu önizlemede veri kaydedilmiyor')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/m0.3-browser-light.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('shows failure honestly and recovers on retry', async ({ page }) => {
  await page.route('**/health', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Yerel API kapalı' })).toBeVisible();
  await page.unroute('**/health');
  await page.getByRole('button', { name: 'Yeniden kontrol et' }).click();
  await expect(page.getByRole('heading', { name: 'Yerel API bağlı' })).toBeVisible();
});

test('module navigation and dark appearance work without fake records', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Görevler Planlandı' }).click();
  await expect(page.getByRole('heading', { name: 'Görevler için yerimiz hazır.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Görevler', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Genel bakışa dön' }).click();
  await page.getByLabel('Görünüm', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'Yerel API bağlı' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/m0.3-browser-dark.png', fullPage: true });
});

test('native storage failure is visible and a manual retry recovers (mock bridge)', async ({ page }) => {
  await page.addInitScript(() => {
    let count = 0;
    Object.assign(window, { __TAURI__: { core: { invoke: async () => {
      if (++count <= 2) throw 'newerSchema'; // React StrictMode's two initial effect calls.
      return { engine: 'sqlite', schemaVersion: 1, migrationCount: 1,
        storageId: '0123456789abcdef0123456789abcdef', createdAt: '2026-11-04T08:00:00.000Z' };
    } } } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Yerel alan kullanılamıyor' })).toBeVisible();
  await expect(page.getByText('Bu veri alanı daha yeni bir sürüme ait. Uygulamayı güncelle.')).toBeVisible();
  await page.getByRole('button', { name: 'Yerel alanı kontrol et' }).click();
  await expect(page.getByRole('heading', { name: 'Yerel alan hazır' })).toBeVisible();
});

test('compact layout keeps navigation reachable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Menüyü aç' }).click();
  await page.getByRole('button', { name: 'Notlar Planlandı' }).click();
  await expect(page.getByRole('heading', { name: 'Notlar için yerimiz hazır.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('account connection failure is visible and recovers without a fake user', async ({ page }) => {
  await page.route('**/api/v1/auth/status', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hesap servisine ulaşılamıyor' })).toBeVisible();
  await page.unroute('**/api/v1/auth/status');
  await page.getByRole('button', { name: 'Hesap durumunu kontrol et' }).click();
  await expect(page.getByRole('heading', { name: 'Hesap bağlantısı kurulmadı' })).toBeVisible();
});
