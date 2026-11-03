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

const endpoint = 'certificate';
const heading = 'Sertifikat & Pelatihan';
const titleField = 'Nama';
const inputTitle = 'New Certificate';
const success = 'Data berhasil disimpan';
const deleteMessage = 'Certificate deleted';
const errorMessages: Record<string, string> = { GET: 'Error fetching certificates', POST: 'Error creating certificate', PUT: 'Error updating certificate', DELETE: 'Error deleting certificate' };
const seed = [
  { id: 1, name: 'Seed Certificate', issuer: 'Issuer', issueDate: '2020-06-15T00:00:00.000Z', expiryDate: '2025-06-15T00:00:00.000Z', credentialId: 'ABC', url: 'https://example.com/cert', type: 'certificate', technologies: ['React'] },
  { id: 2, name: 'Seed Training', issuer: 'Trainer', issueDate: '2021-06-15T00:00:00.000Z', expiryDate: null, credentialId: null, url: null, type: 'training', technologies: [] },
];
const panel = (page: Page) => page.getByRole('tabpanel');
const certCard = (page: Page, title: string) => panel(page).locator('div.rounded-xl').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
async function fill(page: Page) {
  await page.getByRole('button', { name: 'Tambah Data', exact: true }).click();
  await field(page, 'Nama').fill(inputTitle);
  await field(page, 'Penerbit').fill('Test Issuer');
  await field(page, 'Tanggal Terbit').fill('2024-06-15');
  await field(page, 'Tanggal Kadaluarsa').fill('2026-06-15');
}
test.describe('Positive: certificates and training', () => {
  test('tabs separate records and display certificate details', async ({ page }) => {
    await open(page);
    await expect(certCard(page, 'Seed Certificate')).toContainText('Credential ID: ABC');
    await expect(certCard(page, 'Seed Certificate')).toContainText('Kadaluarsa:');
    await expect(certCard(page, 'Seed Training')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Pelatihan' }).click();
    await expect(certCard(page, 'Seed Training')).toBeVisible();
    await expect(certCard(page, 'Seed Certificate')).toHaveCount(0);
  });
  for (const type of ['certificate', 'training']) test('creates ' + type + ' with exact payload', async ({ page }) => {
    const api = await open(page, []);
    await fill(page);
    await field(page, 'Tipe').selectOption(type);
    await submit(page);
    expect(api.calls.find(c => c.method === 'POST')?.body).toEqual({
      name: inputTitle, issuer: 'Test Issuer', issueDate: '2024-06-15', expiryDate: '2026-06-15',
      credentialId: '', url: '', type, technologies: [],
    });
    await page.getByRole('tab', { name: type === 'training' ? 'Pelatihan' : 'Sertifikat', exact: true }).click();
    await expect(certCard(page, inputTitle)).toBeVisible();
  });
  test('no expiry clears date, disables it, and saves an empty value', async ({ page }) => {
    const api = await open(page);
    await fill(page);
    await form(page).getByRole('radio', { name: 'Tidak ada kadaluwarsa' }).check();
    await expect(field(page, 'Tanggal Kadaluarsa')).toBeDisabled();
    await expect(field(page, 'Tanggal Kadaluarsa')).toHaveValue('');
    await submit(page);
    expect(api.calls.find(c => c.method === 'POST')?.body.expiryDate).toBe('');
    await certCard(page, inputTitle).getByRole('button').nth(0).click();
    await expect(form(page).getByRole('radio', { name: 'Tidak ada kadaluwarsa' })).toBeChecked();
  });
  test('edit prefills fields and changing type moves record to training tab', async ({ page }) => {
    const api = await open(page);
    await certCard(page, 'Seed Certificate').getByRole('button').nth(0).click();
    await expect(field(page, 'Tanggal Terbit')).toHaveValue('2020-06-15');
    await expect(field(page, 'Tanggal Kadaluarsa')).toHaveValue('2025-06-15');
    await expect(field(page, 'Credential ID')).toHaveValue('ABC');
    await expect(field(page, 'URL')).toHaveValue('https://example.com/cert');
    await field(page, 'Tipe').selectOption('training');
    await submit(page, 'PUT');
    expect(api.calls.find(c => c.method === 'PUT')?.id).toBe(1);
    expect(api.calls.find(c => c.method === 'PUT')?.body.type).toBe('training');
    await expect(certCard(page, 'Seed Certificate')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Pelatihan' }).click();
    await expect(certCard(page, 'Seed Certificate')).toBeVisible();
    await expect(certCard(page, 'Seed Training')).toBeVisible();
  });
  test('delete selected certificate leaves training intact', async ({ page }) => {
    const api = await open(page);
    const response = page.waitForResponse(r => r.request().method() === 'DELETE');
    await certCard(page, 'Seed Certificate').getByRole('button').nth(1).click();
    expect(await (await response).json()).toEqual({ message: deleteMessage });
    await expect(page.getByText('Data berhasil dihapus', { exact: true })).toBeVisible();
    await expect(certCard(page, 'Seed Certificate')).toHaveCount(0);
    expect(api.calls.find(c => c.method === 'DELETE')?.id).toBe(1);
    await page.getByRole('tab', { name: 'Pelatihan' }).click();
    await expect(certCard(page, 'Seed Training')).toBeVisible();
  });
  test('technology button and Enter trim input without submitting; removal targets one tag', async ({ page }) => {
    const api = await open(page);
    await fill(page);
    const input = page.getByPlaceholder('Contoh: React, Python');
    await input.fill('  React  ');
    await form(page).getByRole('button', { name: 'Tambah', exact: true }).click();
    await expect(input).toHaveValue('');
    await input.fill('Go');
    await input.press('Enter');
    await expect(form(page).getByRole('button', { name: 'Hapus Go', exact: true })).toBeVisible();
    expect(api.calls.filter(c => c.method === 'POST')).toHaveLength(0);
    await form(page).getByRole('button', { name: 'Hapus React', exact: true }).click();
    await submit(page);
    expect(api.calls.find(c => c.method === 'POST')?.body.technologies).toEqual(['Go']);
  });
  test('cancel edit resets type, dates and technology draft', async ({ page }) => {
    const api = await open(page);
    await certCard(page, 'Seed Certificate').getByRole('button').nth(0).click();
    await page.getByPlaceholder('Contoh: React, Python').fill('Draft');
    await form(page).getByRole('button', { name: 'Batal' }).click();
    await page.getByRole('button', { name: 'Tambah Data', exact: true }).click();
    await expect(field(page, 'Nama')).toHaveValue('');
    await expect(field(page, 'Tipe')).toHaveValue('certificate');
    await expect(field(page, 'Tanggal Kadaluarsa')).toBeEnabled();
    await expect(page.getByPlaceholder('Contoh: React, Python')).toHaveValue('');
    await expect(form(page).getByRole('button', { name: /^Hapus / })).toHaveCount(0);
    expect(api.calls.filter(c => c.method !== 'GET')).toHaveLength(0);
  });
});
test.describe('Negative: validation', () => {
  for (const label of ['Nama', 'Penerbit', 'Tanggal Terbit', 'Tanggal Kadaluarsa']) test('required ' + label, async ({ page }) => {
    const api = await open(page);
    await fill(page);
    await field(page, label).fill('');
    await save(page).click();
    expect(await field(page, label).evaluate(el => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
    expect(api.calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });
  test('switching back to expiring requires a new date', async ({ page }) => {
    const api = await open(page);
    await fill(page);
    await form(page).getByRole('radio', { name: 'Tidak ada kadaluwarsa' }).check();
    await form(page).getByRole('radio', { name: 'Memiliki kadaluwarsa' }).check();
    await expect(field(page, 'Tanggal Kadaluarsa')).toBeEnabled();
    await save(page).click();
    expect(await field(page, 'Tanggal Kadaluarsa').evaluate(el => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
    expect(api.calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });
  test('empty and exact duplicate technologies are ignored; case variants remain distinct', async ({ page }) => {
    const api = await open(page);
    await fill(page);
    const input = page.getByPlaceholder('Contoh: React, Python');
    for (const value of ['', '   ', 'React', 'React', 'react']) {
      await input.fill(value);
      await input.press('Enter');
    }
    await expect(form(page).getByRole('button', { name: 'Hapus React', exact: true })).toHaveCount(1);
    await expect(form(page).getByRole('button', { name: 'Hapus react', exact: true })).toHaveCount(1);
    await submit(page);
    expect(api.calls.find(c => c.method === 'POST')?.body.technologies).toEqual(['React', 'react']);
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
    const selected = card(page, 'Seed Certificate');
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
  await card(page, 'Seed Certificate').getByRole('button').nth(0).click();
  await field(page, titleField).fill('Mobile edit');
  await noOverflow(page);
  await submit(page, 'PUT');
  await expect(page.locator('main').getByText('Mobile edit', { exact: true })).toBeVisible();
  await noOverflow(page);
});
// Known gaps: date ordering, whitespace-only required text, and mutation error toasts are not validated by the current page.

test('mobile tabs expose training and permit editing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole('tab', { name: 'Pelatihan' }).click();
  await certCard(page, 'Seed Training').getByRole('button').nth(0).click();
  await field(page, 'Nama').fill('Mobile Training');
  await submit(page, 'PUT');
  await expect(certCard(page, 'Mobile Training')).toBeVisible();
  await noOverflow(page);
});
