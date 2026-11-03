import { test, expect, type Page } from '@playwright/test';

type Row = { id: number; [key: string]: unknown };
type Call = { method: string; id: number; body: Record<string, unknown> };
const form = (page: Page) => page.locator('main form');
const field = (page: Page, label: string) =>
  form(page).locator('div.space-y-2').filter({ has: page.locator('label').filter({ hasText: new RegExp('^' + label + '$') }) }).locator('input, textarea, select').first();
const card = (page: Page, title: string) => page.locator('main div.rounded-xl').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const save = (page: Page) => form(page).getByRole('button', { name: /^Simpan( Data CV)?$/ });

async function open(page: Page, initial: Row[] | Row | null = seed, failure?: { method: string; status?: number; abort?: boolean }, pending = false) {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD are required');
  await page.goto('/admin/login');
  await page.getByPlaceholder(/masukkan username/i).fill(username);
  await page.getByPlaceholder(/masukkan password/i).fill(password);
  await page.getByRole('button', { name: /^Login$/ }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 20000 });

  let data = structuredClone(initial);
  const calls: Call[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(url => new RegExp('/' + endpoint + '(/\\d+)?/?$').test(url.pathname) && !/^\/(admin|api\/public)\//.test(url.pathname), async route => {
    const request = route.request();
    if (!['xhr', 'fetch'].includes(request.resourceType())) return route.fallback();
    const method = request.method();
    const id = Number(new URL(request.url()).pathname.replace(/\/$/, '').split('/').pop());
    const body = ['POST', 'PUT'].includes(method) ? request.postDataJSON() : {};
    const headers = { 'access-control-allow-origin': request.headers()['origin'] || '*', 'access-control-allow-headers': '*' };
    const reply = (status: number, value: unknown) => route.fulfill({ status, headers, json: value });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    calls.push({ method, id, body });
    if (pending && method === 'POST') await gate;
    if (failure?.method === method) {
      if (failure.abort) return route.abort('failed');
      const message = failure.status === 401 ? 'Access token required' : errorMessages[method];
      return reply(failure.status || 500, { message });
    }
    if (method === 'GET') return reply(200, data);
    const rows = data as Row[];
    if (method === 'DELETE') {
      const index = rows.findIndex(row => row.id === id);
      if (index < 0) return reply(500, { message: errorMessages.DELETE });
      rows.splice(index, 1);
      return reply(200, { message: deleteMessage });
    }
    const normalized = { ...body };
    for (const key of ['startDate', 'endDate', 'issueDate', 'expiryDate']) {
      if (key in normalized) normalized[key] = normalized[key] ? new Date(String(normalized[key])).toISOString() : null;
    }
    const row = { ...normalized, id: method === 'POST' ? 100 + rows.length : id };
    if (method === 'POST') rows.push(row);
    else if (method === 'PUT') {
      const index = rows.findIndex(item => item.id === id);
      if (index < 0) return reply(500, { message: errorMessages.PUT });
      rows[index] = row;
    } else throw new Error('Unexpected API method: ' + method);
    rows.sort((a, b) => String(b.startDate || b.issueDate).localeCompare(String(a.startDate || a.issueDate)));
    return reply(200, row);
  });
  const loaded = page.waitForResponse(r => ['xhr', 'fetch'].includes(r.request().resourceType()) && new URL(r.url()).pathname.endsWith('/' + endpoint) && r.request().method() === 'GET');
  await page.goto('/admin/' + endpoint);
  await loaded;
  if (failure?.status !== 401) await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  return { calls, release };
}

async function submit(page: Page, method = 'POST') {
  const response = page.waitForResponse(r => r.request().method() === method && new URL(r.url()).pathname.includes('/' + endpoint));
  await save(page).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByText(success, { exact: true })).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}
const endpoint = "organization";
const heading = "Organisasi";
const titleField = "Nama Organisasi";
const requiredFields = ["Nama Organisasi","Posisi","Tahun Mulai"];
const payload = {"name":"New Organization","position":"Member","startDate":"2020-01-01","endDate":"2022-01-01","description":"Test description"};
const seed = [{"name":"Seed Organization","position":"Member","startDate":"2020-01-01","endDate":"2022-01-01","description":"Test description","id":1},{"name":"Other Organization","position":"Member","startDate":"2020-01-01","endDate":null,"description":"Test description","id":2}];
const seedTitle = "Seed Organization";
const otherTitle = "Other Organization";
const newTitle = "New Organization";
const inputTitle = "New Organization";
const success = "Data organisasi berhasil disimpan";
const deleteMessage = "Organization deleted";
const errorMessages: Record<string, string> = {"GET":"Error fetching organizations","POST":"Error creating organization","PUT":"Error updating organization","DELETE":"Error deleting organization"};

async function fill(page: Page) {
  await page.getByRole('button', { name: 'Tambah ' + heading, exact: true }).click();
  for (const [label, value] of Object.entries({"Nama Organisasi":"New Organization","Posisi":"Member","Tahun Mulai":"2020","Tahun Selesai":"2022","Deskripsi":"Test description"})) await field(page, label).fill(value);
}

test.describe('Positive: CRUD', () => {
  test('renders seeded records and ongoing dates', async ({ page }) => {
    await open(page);
    await expect(card(page, seedTitle)).toBeVisible();
    await expect(page.locator('main').getByText(/Sekarang/)).toBeVisible();
  });
  test('empty list can create a completed record with the exact payload', async ({ page }) => {
    const api = await open(page, []);
    await fill(page);
    await submit(page);
    expect(api.calls.filter(c => c.method === 'POST').map(c => c.body)).toEqual([payload]);
    await expect(card(page, newTitle)).toBeVisible();
    await expect(form(page)).toHaveCount(0);
  });
  test('optional end year and description can be empty', async ({ page }) => {
    const api = await open(page, []);
    await fill(page);
    await field(page, 'Tahun Selesai').fill('');
    await field(page, 'Deskripsi').fill('');
    await submit(page);
    expect(api.calls.find(c => c.method === 'POST')?.body.endDate).toBe('');
    await expect(card(page, newTitle)).toContainText('Sekarang');
  });
  test('edit prefills years and updates only the selected record', async ({ page }) => {
    const api = await open(page);
    await card(page, seedTitle).getByRole('button').nth(0).click();
    await expect(field(page, 'Tahun Mulai')).toHaveValue('2020');
    await expect(field(page, 'Tahun Selesai')).toHaveValue('2022');
    await field(page, titleField).fill('Updated');
    await submit(page, 'PUT');
    expect(api.calls.filter(c => c.method === 'PUT')).toHaveLength(1);
    expect(api.calls.find(c => c.method === 'PUT')?.id).toBe(1);
    await expect(page.locator('main').getByText(/Updated/)).toBeVisible();
    await expect(card(page, otherTitle)).toBeVisible();
  });
  test('delete targets only the selected record', async ({ page }) => {
    const api = await open(page);
    const response = page.waitForResponse(r => r.request().method() === 'DELETE');
    await card(page, seedTitle).getByRole('button').nth(1).click();
    expect(await (await response).json()).toEqual({ message: deleteMessage });
    await expect(page.getByText('Data berhasil dihapus', { exact: true })).toBeVisible();
    await expect(card(page, seedTitle)).toHaveCount(0);
    await expect(card(page, otherTitle)).toBeVisible();
    expect(api.calls.filter(c => c.method === 'DELETE').map(c => c.id)).toEqual([1]);
  });
  test('cancel edit then add resets fields and does not send an update', async ({ page }) => {
    const api = await open(page);
    await card(page, seedTitle).getByRole('button').nth(0).click();
    await field(page, titleField).fill('Discard');
    await form(page).getByRole('button', { name: 'Batal' }).click();
    await page.getByRole('button', { name: 'Tambah ' + heading, exact: true }).click();
    for (const label of requiredFields) await expect(field(page, label)).toHaveValue('');
    expect(api.calls.filter(c => c.method !== 'GET')).toHaveLength(0);
  });
});

test.describe('Negative: validation', () => {
  for (const label of requiredFields) test('rejects empty ' + label, async ({ page }) => {
    const api = await open(page);
    await fill(page);
    const input = field(page, label);
    await input.fill('');
    await save(page).click();
    expect(await input.evaluate(el => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
    expect(api.calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });
  for (const label of ['Tahun Mulai', 'Tahun Selesai']) {
    for (const value of ['1899', String(new Date().getFullYear() + 11), '2020.5']) test(label + ' rejects ' + value, async ({ page }) => {
      const api = await open(page);
      await fill(page);
      const input = field(page, label);
      await input.fill(value);
      await save(page).click();
      expect(await input.evaluate(el => (el as HTMLInputElement).validity.valid)).toBe(false);
      expect(api.calls.filter(c => c.method === 'POST')).toHaveLength(0);
    });
  }
  test('clearing required input blocks edit', async ({ page }) => {
    const api = await open(page);
    await card(page, seedTitle).getByRole('button').nth(0).click();
    await field(page, titleField).fill('');
    await save(page).click();
    expect(await field(page, titleField).evaluate(el => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
    expect(api.calls.filter(c => c.method === 'PUT')).toHaveLength(0);
  });
});

test.describe('API failures and pending state', () => {
  test('GET 500 leaves the page usable', async ({ page }) => {
    await open(page, seed, { method: 'GET', status: 500 });
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await fill(page);
    await expect(save(page)).toBeEnabled();
  });
  test('401 redirects to login', async ({ page }) => {
    await open(page, seed, { method: 'GET', status: 401 });
    await expect(page).toHaveURL(/\/admin\/login/);
  });
  for (const abort of [false, true]) test(abort ? 'network failure preserves input' : 'POST 500 preserves input', async ({ page }) => {
    await open(page, seed, { method: 'POST', status: 500, abort });
    await fill(page);
    const failed = abort
      ? page.waitForEvent('requestfailed', { predicate: r => r.method() === 'POST' && r.url().includes('/' + endpoint) })
      : page.waitForResponse(r => r.request().method() === 'POST' && r.status() === 500);
    await save(page).click();
    await failed;
    await expect(save(page)).toBeEnabled();
    await expect(form(page)).toBeVisible();
    await expect(field(page, titleField)).toHaveValue(inputTitle);
    await expect(page.getByText(success, { exact: true })).toHaveCount(0);
  });
  test('pending save disables the button and sends one POST', async ({ page }) => {
    const api = await open(page, seed, undefined, true);
    await fill(page);
    try {
      await save(page).click();
      await expect(form(page).getByRole('button', { name: 'Menyimpan...' })).toBeDisabled();
      await expect.poll(() => api.calls.filter(c => c.method === 'POST').length).toBe(1);
    } finally { api.release(); }
    await expect(page.getByText(success, { exact: true })).toBeVisible();
    expect(api.calls.filter(c => c.method === 'POST')).toHaveLength(1);
  });
});
test('unauthenticated access redirects to login', async ({ page }) => {
  await page.goto('/admin/' + endpoint);
  await expect(page).toHaveURL(/\/admin\/login/);
});
test('HTML input is rendered literally', async ({ page }) => {
  await open(page, seed);
  await fill(page);
  const html = '<img src=x onerror=alert(1)>';
  await field(page, titleField).fill(html);
  await submit(page);
  await expect(page.locator('main').getByText(html, { exact: true })).toBeVisible();
  await expect(page.locator('main img[src="x"]')).toHaveCount(0);
});
test.describe('Mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('form and saved data fit the viewport', async ({ page }) => {
    await open(page);
    await fill(page);
    await noOverflow(page);
    await submit(page);
    await noOverflow(page);
  });
});

test.describe('Failed updates preserve existing records', () => {
  for (const method of ['PUT', 'DELETE']) test(method + ' 500 preserves data', async ({ page }) => {
    await open(page, seed, { method, status: 500 });
    const selected = card(page, seedTitle);
    const response = page.waitForResponse(r => r.request().method() === method && r.status() === 500);
    if (method === 'PUT') {
      await selected.getByRole('button').nth(0).click();
      await field(page, titleField).fill('Failed change');
      await save(page).click();
    } else await selected.getByRole('button').nth(1).click();
    await response;
    await expect(selected).toBeVisible();
    await expect(page.getByText(method === 'PUT' ? success : 'Data berhasil dihapus', { exact: true })).toHaveCount(0);
    if (method === 'PUT') {
      await expect(save(page)).toBeEnabled();
      await expect(field(page, titleField)).toHaveValue('Failed change');
    }
  });
});
test('mobile edit remains usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await card(page, seedTitle).getByRole('button').nth(0).click();
  await field(page, titleField).fill('Mobile edit');
  await noOverflow(page);
  await submit(page, 'PUT');
  await expect(page.locator('main').getByText('Mobile edit', { exact: true })).toBeVisible();
  await noOverflow(page);
});
// Known gaps: date ordering, whitespace-only required text, and mutation error toasts are not validated by the current page.
