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
    if (endpoint === 'cv' && method === 'POST') {
      data = { ...body, id: (data as Row | null)?.id || 100 };
      return reply(200, data);
    }
    throw new Error('Unexpected CV API method: ' + method);
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

const endpoint = 'cv';
const heading = 'CV';
const titleField = 'Summary / Ringkasan';
const inputTitle = 'Updated summary';
const success = 'Data CV berhasil disimpan';
const deleteMessage = '';
const errorMessages: Record<string, string> = { GET: 'Error fetching CV data', POST: 'Error saving CV data' };
const seed = { id: 1, skills: ['React', 'Go'], summary: 'Seed summary', template: 'classic' };

async function fill(page: Page) {
  await expect(form(page).locator('textarea')).toHaveValue(/Seed summary|^$/);
  await field(page, titleField).fill(inputTitle);
}
const skill = (page: Page, name: string) => form(page).locator('div.rounded-md').filter({ hasText: new RegExp('^' + name + '$') });

test.describe('Positive: CV', () => {
  test('prefills existing data and displays information', async ({ page }) => {
    await open(page);
    await expect(field(page, titleField)).toHaveValue(seed.summary);
    await expect(form(page).locator('select')).toHaveValue('classic');
    await expect(skill(page, 'React')).toBeVisible();
    await expect(skill(page, 'Go')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Informasi' })).toBeVisible();
  });
  for (const template of ['modern', 'classic', 'minimal']) test('creates CV with template ' + template, async ({ page }) => {
    const api = await open(page, null);
    await expect(field(page, titleField)).toHaveValue('');
    await expect(form(page).locator('select')).toHaveValue('modern');
    await field(page, titleField).fill(inputTitle);
    await form(page).locator('select').selectOption(template);
    await submit(page);
    expect(api.calls.find(c => c.method === 'POST')?.body).toEqual({ skills: [], summary: inputTitle, template });
    await page.reload();
    await expect(field(page, titleField)).toHaveValue(inputTitle);
    await expect(form(page).locator('select')).toHaveValue(template);
  });
  test('updates the same CV, adds trimmed skills by button and Enter, removes only selected skill', async ({ page }) => {
    const api = await open(page);
    await expect(skill(page, 'React')).toBeVisible();
    const input = page.getByPlaceholder('Tambah skill');
    await input.fill('  Docker  ');
    await form(page).getByRole('button', { name: 'Tambah', exact: true }).click();
    await expect(input).toHaveValue('');
    await input.fill('TypeScript');
    await input.press('Enter');
    await expect(skill(page, 'TypeScript')).toBeVisible();
    expect(api.calls.filter(c => c.method === 'POST')).toHaveLength(0);
    await skill(page, 'Go').getByRole('button').click();
    await field(page, titleField).fill(inputTitle);
    await submit(page);
    expect(api.calls.find(c => c.method === 'POST')?.body).toEqual({ skills: ['React', 'Docker', 'TypeScript'], summary: inputTitle, template: 'classic' });
    const response = page.waitForResponse(r => r.request().method() === 'GET' && ['xhr', 'fetch'].includes(r.request().resourceType()) && r.url().endsWith('/cv'));
    await page.reload();
    expect((await (await response).json()).id).toBe(1);
    await expect(skill(page, 'Docker')).toBeVisible();
    await expect(skill(page, 'Go')).toHaveCount(0);
  });
  test('empty summary and skills can be saved', async ({ page }) => {
    const api = await open(page, null);
    await submit(page);
    expect(api.calls.find(c => c.method === 'POST')?.body).toEqual({ skills: [], summary: '', template: 'modern' });
  });
});

test.describe('Negative: skills', () => {
  for (const value of ['', '   ']) test('ignores skill ' + JSON.stringify(value), async ({ page }) => {
    const api = await open(page, null);
    await page.getByPlaceholder('Tambah skill').fill(value);
    await form(page).getByRole('button', { name: 'Tambah', exact: true }).click();
    await expect(form(page).locator('div.rounded-md')).toHaveCount(0);
    expect(api.calls.filter(c => c.method === 'POST')).toHaveLength(0);
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
  await expect(field(page, titleField)).toHaveValue(html);
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

// Known gap: save errors have no dedicated toast; duplicate skills are currently allowed.
test('mobile skill input can add and save a skill', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await open(page, null);
  await page.getByPlaceholder('Tambah skill').fill('Mobile Skill');
  await form(page).getByRole('button', { name: 'Tambah', exact: true }).click();
  await expect(skill(page, 'Mobile Skill')).toBeVisible();
  await submit(page);
  expect(api.calls.find(c => c.method === 'POST')?.body.skills).toEqual(['Mobile Skill']);
  await noOverflow(page);
});
