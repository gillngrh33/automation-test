import { test, expect, type Page, type Route } from '@playwright/test';

/* -------------------------------------------------------------------------- */
/*  Config & helpers                                                          */
/* -------------------------------------------------------------------------- */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const adminUsername = requiredEnv('ADMIN_USERNAME');
const adminPassword = requiredEnv('ADMIN_PASSWORD');

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MENU = [
  { label: 'Dashboard', path: '/admin/dashboard' },
  { label: 'Identitas', path: '/admin/identity' },
  { label: 'Pendidikan', path: '/admin/education' },
  { label: 'Organisasi', path: '/admin/organization' },
  { label: 'Sertifikat & Pelatihan', path: '/admin/certificate' },
  { label: 'Pengalaman', path: '/admin/experience' },
  { label: 'CV', path: '/admin/cv' },
];

async function gotoLogin(page: Page) {
  await page.goto('/admin/login', { waitUntil: 'domcontentloaded' });
}

const usernameInput = (page: Page) => page.getByPlaceholder(/masukkan username/i);
const passwordInput = (page: Page) => page.getByPlaceholder(/masukkan password/i);
const loginButton = (page: Page) => page.getByRole('button', { name: /^login$/i });
const loginFailedToast = (page: Page) => page.getByText('Login gagal', { exact: true });

async function fillCredentials(page: Page, username: string, password: string) {
  await usernameInput(page).fill(username);
  await passwordInput(page).fill(password);
}

async function login(page: Page) {
  await gotoLogin(page);
  await fillCredentials(page, adminUsername, adminPassword);
  await passwordInput(page).press('Enter');
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

const isMissing = (locator: ReturnType<Page['locator']>) =>
  locator.evaluate((el) => (el as HTMLInputElement).validity.valueMissing);

/**
 * Mocks POST /auth/login so error states and the pending state are
 * deterministic and do not hammer the real server (avoids rate limiting).
 */
type LoginMock = {
  status?: number;
  body?: unknown;
  delayMs?: number;
  abort?: boolean;
};

async function mockLogin(page: Page, opts: LoginMock = {}) {
  const requests: any[] = [];

  await page.route(
    (url) => /\/auth\/login\/?$/.test(url.pathname) && !url.pathname.startsWith('/admin'),
    async (route: Route) => {
      const request = route.request();
      if (!['fetch', 'xhr'].includes(request.resourceType())) return route.fallback();

      const origin = request.headers()['origin'] ?? '*';
      const cors = {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'POST,OPTIONS',
      };

      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

      requests.push(request.postDataJSON());
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.abort) return route.abort('failed');

      return route.fulfill({
        status: opts.status ?? 401,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify(opts.body ?? { message: 'Username atau password salah' }),
      });
    },
  );

  return { requests };
}

/* ========================================================================== */
/*  POSITIVE                                                                  */
/* ========================================================================== */

test.describe('Positive: login page', () => {
  test('login page renders all elements', async ({ page }) => {
    await gotoLogin(page);

    await expect(page.getByRole('heading', { name: /admin login/i })).toBeVisible();
    await expect(page.getByText(/masukkan kredensial untuk mengakses admin panel/i)).toBeVisible();
    await expect(usernameInput(page)).toBeVisible();
    await expect(passwordInput(page)).toBeVisible();
    await expect(loginButton(page)).toBeVisible();
    await expect(loginButton(page)).toBeEnabled();
  });

  test('both fields are required and empty by default', async ({ page }) => {
    await gotoLogin(page);

    await expect(usernameInput(page)).toHaveValue('');
    await expect(passwordInput(page)).toHaveValue('');
    await expect(usernameInput(page)).toHaveJSProperty('required', true);
    await expect(passwordInput(page)).toHaveJSProperty('required', true);
  });

  test('password field is masked', async ({ page }) => {
    await gotoLogin(page);
    await expect(passwordInput(page)).toHaveAttribute('type', 'password');
  });
});

test.describe('Positive: successful login', () => {
  test('valid credentials + Enter navigates to dashboard and greets the user', async ({ page }) => {
    await gotoLogin(page);
    await fillCredentials(page, adminUsername, adminPassword);
    await passwordInput(page).press('Enter');

    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.getByText(new RegExp(`welcome, ${escapeRegExp(adminUsername)}`, 'i'))).toBeVisible();
  });

  test('valid credentials + clicking Login navigates to dashboard', async ({ page }) => {
    await gotoLogin(page);
    await fillCredentials(page, adminUsername, adminPassword);
    await loginButton(page).click();

    await expect(page).toHaveURL(/\/admin\/dashboard/);
  });

  test('success toast "Login berhasil" is shown', async ({ page }) => {
    await gotoLogin(page);
    await fillCredentials(page, adminUsername, adminPassword);
    await loginButton(page).click();

    await expect(page.getByText('Login berhasil', { exact: true })).toBeVisible();
    await expect(page.getByText(/selamat datang di admin panel/i)).toBeVisible();
  });

  test('login request sends username and password in the payload', async ({ page }) => {
    const api = await mockLogin(page, { status: 401 });
    await gotoLogin(page);
    await fillCredentials(page, 'payload-user', 'payload-pass');
    await loginButton(page).click();

    await expect(loginFailedToast(page)).toBeVisible();
    expect(api.requests).toEqual([{ username: 'payload-user', password: 'payload-pass' }]);
  });

  test('button shows "Loading..." and is disabled while the request is pending', async ({ page }) => {
    await mockLogin(page, { status: 401, delayMs: 1000 });
    await gotoLogin(page);
    await fillCredentials(page, 'someone', 'something');
    await loginButton(page).click();

    const pending = page.getByRole('button', { name: /loading/i });
    await expect(pending).toBeVisible();
    await expect(pending).toBeDisabled();

    await expect(loginFailedToast(page)).toBeVisible();
    await expect(loginButton(page)).toBeEnabled();
  });
});

test.describe('Positive: admin layout after login', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('sidebar shows the brand, the user and every menu item', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^admin\.?$/i })).toBeVisible();
    await expect(page.getByText(new RegExp(`welcome, ${escapeRegExp(adminUsername)}`, 'i'))).toBeVisible();

    for (const item of MENU) {
      await expect(page.getByRole('link', { name: item.label, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: /logout/i })).toBeVisible();
  });

  test('Dashboard menu is highlighted as active on the dashboard', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toHaveClass(/text-emerald-400/);
    await expect(page.getByRole('link', { name: 'Pengalaman', exact: true })).not.toHaveClass(/text-emerald-400/);
  });

  for (const item of MENU) {
    test(`clicking "${item.label}" navigates to ${item.path} and highlights it`, async ({ page }) => {
      await page.getByRole('link', { name: item.label, exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`${escapeRegExp(item.path)}$`));
      await expect(page.getByRole('link', { name: item.label, exact: true })).toHaveClass(/text-emerald-400/);
    });
  }

  test('session survives a page reload', async ({ page }) => {
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.getByText(new RegExp(`welcome, ${escapeRegExp(adminUsername)}`, 'i'))).toBeVisible();
  });

  test('session survives direct navigation to another admin page', async ({ page }) => {
    await page.goto('/admin/experience', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/admin\/experience/);
    await expect(page.getByRole('heading', { name: 'Pengalaman', exact: true })).toBeVisible();
  });

  test('logout returns to the login page', async ({ page }) => {
    await page.getByRole('button', { name: /logout/i }).click();

    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole('heading', { name: /admin login/i })).toBeVisible();
  });

  test('mobile navigation opens as a drawer and closes after navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const menuButton = page.getByRole('button', { name: /buka menu navigasi/i });
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await menuButton.click();
    await expect(page.getByRole('button', { name: /tutup menu navigasi/i }).first()).toBeVisible();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');

    await page.getByRole('link', { name: 'Pengalaman', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/experience/);
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  });

  test('admin routes do not overflow horizontally on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const item of MENU) {
      await page.goto(item.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp(`${escapeRegExp(item.path)}$`));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, `${item.path} overflows horizontally`).toBe(false);
    }
  });

  test('user can log in again after logging out', async ({ page }) => {
    await page.getByRole('button', { name: /logout/i }).click();
    await expect(page).toHaveURL(/\/admin\/login/);

    await fillCredentials(page, adminUsername, adminPassword);
    await loginButton(page).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);
  });
});

/* ========================================================================== */
/*  NEGATIVE                                                                  */
/* ========================================================================== */

test.describe('Negative: client-side validation', () => {
  test('correct username and empty password is rejected', async ({ page }) => {
    const api = await mockLogin(page);
    await gotoLogin(page);
    await usernameInput(page).fill(adminUsername);
    await loginButton(page).click();

    expect(await isMissing(passwordInput(page))).toBe(true);
    expect(api.requests).toHaveLength(0);
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('empty username and correct password is rejected', async ({ page }) => {
    const api = await mockLogin(page);
    await gotoLogin(page);
    await passwordInput(page).fill(adminPassword);
    await loginButton(page).click();

    expect(await isMissing(usernameInput(page))).toBe(true);
    expect(api.requests).toHaveLength(0);
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('empty username and empty password is rejected', async ({ page }) => {
    const api = await mockLogin(page);
    await gotoLogin(page);
    await loginButton(page).click();

    expect(await isMissing(usernameInput(page))).toBe(true);
    expect(await isMissing(passwordInput(page))).toBe(true);
    expect(api.requests).toHaveLength(0);
  });

  test('pressing Enter on an empty form does not send a request', async ({ page }) => {
    const api = await mockLogin(page);
    await gotoLogin(page);
    await usernameInput(page).press('Enter');

    expect(api.requests).toHaveLength(0);
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

test.describe('Negative: invalid credentials (real backend)', () => {
  test('correct username with wrong password shows an error and stays on login', async ({ page }) => {
    await gotoLogin(page);
    await fillCredentials(page, adminUsername, 'wrong-password');
    await passwordInput(page).press('Enter');

    await expect(loginFailedToast(page)).toBeVisible();
    await expect(page.getByText('Invalid credentials', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('wrong username with correct password shows an error', async ({ page }) => {
    await gotoLogin(page);
    await fillCredentials(page, 'not-the-admin', adminPassword);
    await passwordInput(page).press('Enter');

    await expect(loginFailedToast(page)).toBeVisible();
    await expect(page.getByText('Invalid credentials', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('wrong username and wrong password shows an error', async ({ page }) => {
    await gotoLogin(page);
    await fillCredentials(page, 'nobody', 'nothing');
    await passwordInput(page).press('Enter');

    await expect(loginFailedToast(page)).toBeVisible();
    await expect(page.getByText('Invalid credentials', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('whitespace-only credentials are rejected by the server', async ({ page }) => {
    await gotoLogin(page);
    await fillCredentials(page, '     ', '     ');
    await passwordInput(page).press('Enter');

    await expect(loginFailedToast(page)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('username with leading/trailing spaces does not authenticate', async ({ page }) => {
    // The backend does an exact findUnique on username (no trim), so this must be rejected.
    await gotoLogin(page);
    await fillCredentials(page, ` ${adminUsername} `, adminPassword);
    await passwordInput(page).press('Enter');

    await expect(loginFailedToast(page)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('user can log in successfully after a failed attempt', async ({ page }) => {
    await gotoLogin(page);
    await fillCredentials(page, adminUsername, 'wrong-password');
    await passwordInput(page).press('Enter');
    await expect(loginFailedToast(page)).toBeVisible();

    await passwordInput(page).fill(adminPassword);
    await passwordInput(page).press('Enter');
    await expect(page).toHaveURL(/\/admin\/dashboard/);
  });
});

test.describe('Negative: API failures (mocked)', () => {
  test('server message from a 401 is shown in the error toast', async ({ page }) => {
    await mockLogin(page, { status: 401, body: { message: 'Akun dikunci sementara' } });
    await gotoLogin(page);
    await fillCredentials(page, 'someone', 'something');
    await loginButton(page).click();

    await expect(loginFailedToast(page)).toBeVisible();
    await expect(page.getByText('Akun dikunci sementara', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('500 from the server shows "Login gagal" and keeps the form usable', async ({ page }) => {
    await mockLogin(page, { status: 500, body: {} });
    await gotoLogin(page);
    await fillCredentials(page, 'someone', 'something');
    await loginButton(page).click();

    await expect(loginFailedToast(page)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(loginButton(page)).toBeEnabled();
    await expect(usernameInput(page)).toHaveValue('someone');
  });

  test('network failure shows "Login gagal" and does not crash the page', async ({ page }) => {
    await mockLogin(page, { abort: true });
    await gotoLogin(page);
    await fillCredentials(page, 'someone', 'something');
    await loginButton(page).click();

    await expect(loginFailedToast(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: /admin login/i })).toBeVisible();
    await expect(loginButton(page)).toBeEnabled();
  });

  test('double click on Login sends only one request', async ({ page }) => {
    const api = await mockLogin(page, { status: 401, delayMs: 800 });
    await gotoLogin(page);
    await fillCredentials(page, 'someone', 'something');
    await loginButton(page).dblclick();

    await expect(loginFailedToast(page)).toBeVisible();
    expect(api.requests).toHaveLength(1);
  });

  test('a successful-looking response without a token does not open the dashboard', async ({ page }) => {
    test.fail(true, 'Known gap: onSuccess trusts the response and navigates without validating it');
    await mockLogin(page, { status: 200, body: {} });
    await gotoLogin(page);
    await fillCredentials(page, 'someone', 'something');
    await loginButton(page).click();

    await expect(page).not.toHaveURL(/\/admin\/dashboard/);
  });
});

test.describe('Negative: hostile input', () => {
  const payloads: Array<[string, string]> = [
    ['SQL injection (OR 1=1)', `' OR '1'='1`],
    ['SQL comment injection', `admin'--`],
    ['NoSQL-style operator string', `{"$ne": null}`],
    ['script tag', `<script>alert(1)</script>`],
  ];

  for (const [name, payload] of payloads) {
    test(`${name} does not authenticate`, async ({ page }) => {
      let dialogFired = false;
      page.on('dialog', async (d) => {
        dialogFired = true;
        await d.dismiss();
      });

      await gotoLogin(page);
      await fillCredentials(page, payload, payload);
      await passwordInput(page).press('Enter');

      await expect(loginFailedToast(page)).toBeVisible();
      await expect(page).toHaveURL(/\/admin\/login/);
      expect(dialogFired).toBe(false);
    });
  }

  test('very long credentials are rejected without crashing the page', async ({ page }) => {
    await gotoLogin(page);
    await fillCredentials(page, 'a'.repeat(2000), 'b'.repeat(2000));
    await passwordInput(page).press('Enter');

    await expect(loginFailedToast(page)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(loginButton(page)).toBeEnabled();
  });

  test('password is never reflected in the page text after a failed login', async ({ page }) => {
    const secret = 'S3cret-Never-Show-Me';
    await gotoLogin(page);
    await fillCredentials(page, adminUsername, secret);
    await passwordInput(page).press('Enter');

    await expect(loginFailedToast(page)).toBeVisible();
    await expect(page.getByText(secret)).toHaveCount(0);
  });
});

test.describe('Negative: route protection (not logged in)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const item of MENU) {
    test(`${item.path} redirects to login`, async ({ page }) => {
      await page.goto(item.path, { waitUntil: 'domcontentloaded' });

      await expect(page).toHaveURL(/\/admin\/login/);
      await expect(page.getByRole('link', { name: item.label, exact: true })).toHaveCount(0);
    });
  }

  test('failed login does not grant access to the dashboard afterwards', async ({ page }) => {
    await gotoLogin(page);
    await fillCredentials(page, adminUsername, 'wrong-password');
    await passwordInput(page).press('Enter');
    await expect(loginFailedToast(page)).toBeVisible();

    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

test.describe('Negative: after logout', () => {
  test('protected pages are no longer accessible after logout', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /logout/i }).click();
    await expect(page).toHaveURL(/\/admin\/login/);

    await page.goto('/admin/experience', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('browser Back after logout does not reveal the dashboard', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /logout/i }).click();
    await expect(page).toHaveURL(/\/admin\/login/);

    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByText(new RegExp(`welcome, ${escapeRegExp(adminUsername)}`, 'i'))).toHaveCount(0);
  });

  test('logout clears the session across a reload', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /logout/i }).click();
    await expect(page).toHaveURL(/\/admin\/login/);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
