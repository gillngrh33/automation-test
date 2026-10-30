import { test, expect, type Page } from '@playwright/test';

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const adminUsername = requiredEnv('ADMIN_USERNAME');
const adminPassword = requiredEnv('ADMIN_PASSWORD');

async function gotoLogin(page: Page) {
  await page.goto('/admin/login', { waitUntil: 'domcontentloaded' });
}

test.describe('Portfolio Application', () => {
  test('admin login page renders', async ({ page }) => {
    await gotoLogin(page);

    await expect(page.getByRole('heading', { name: /admin login/i })).toBeVisible();
    await expect(page.getByPlaceholder(/masukkan username/i)).toBeVisible();
    await expect(page.getByPlaceholder(/masukkan password/i)).toBeVisible();
  });

  test('admin login with wrong credentials shows error', async ({ page }) => {
    await gotoLogin(page);

    await page.getByPlaceholder(/masukkan username/i).fill(adminUsername);
    await page.getByPlaceholder(/masukkan password/i).fill('wrong-password');
    await page.getByPlaceholder(/masukkan password/i).press('Enter');

    await expect(page.getByText('Login gagal', { exact: true })).toBeVisible();
  });

  test('admin login with correct username and empty password is rejected', async ({ page }) => {
    await gotoLogin(page);

    const password = page.getByPlaceholder(/masukkan password/i);
    await page.getByPlaceholder(/masukkan username/i).fill(adminUsername);
    await page.getByRole('button', { name: /^login$/i }).click();

    expect(await password.evaluate((input) => (input as HTMLInputElement).validity.valueMissing)).toBe(true);
  });

  test('admin login with empty username and correct password is rejected', async ({ page }) => {
    await gotoLogin(page);

    const username = page.getByPlaceholder(/masukkan username/i);
    await page.getByPlaceholder(/masukkan password/i).fill(adminPassword);
    await page.getByRole('button', { name: /^login$/i }).click();

    expect(await username.evaluate((input) => (input as HTMLInputElement).validity.valueMissing)).toBe(true);
  });

  test('admin login with empty username and empty password is rejected', async ({ page }) => {
    await gotoLogin(page);

    const username = page.getByPlaceholder(/masukkan username/i);
    const password = page.getByPlaceholder(/masukkan password/i);
    await page.getByRole('button', { name: /^login$/i }).click();

    expect(await username.evaluate((input) => (input as HTMLInputElement).validity.valueMissing)).toBe(true);
    expect(await password.evaluate((input) => (input as HTMLInputElement).validity.valueMissing)).toBe(true);
  });

  test('admin login with valid credentials navigates to dashboard', async ({ page }) => {
    await gotoLogin(page);

    await page.getByPlaceholder(/masukkan username/i).fill(adminUsername);
    await page.getByPlaceholder(/masukkan password/i).fill(adminPassword);
    await page.getByPlaceholder(/masukkan password/i).press('Enter');

    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.getByText(/welcome, admin/i)).toBeVisible();
  });
});
