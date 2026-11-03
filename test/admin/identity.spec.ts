import { test, expect, type Page, type Response as PlaywrightResponse } from '@playwright/test';

const TEXT_FIELDS = ['name', 'address', 'email', 'phone', 'githubUrl', 'linkedinUrl', 'instagramUrl'] as const;
type Field = typeof TEXT_FIELDS[number];
type Identity = { id: number; photo: string | null } & Record<Field, string | null>;
type Upload = { name: string; mimeType: string; buffer: Buffer };
type ObservedPhoto = { name: string; mimeType: string; bytes: number[] };
type UploadWindow = Window & { __identityPhotos?: Promise<ObservedPhoto | null>[] };
type Post = { contentType: string; fields: Record<string, string>; photo?: Upload };
type Options = { initial?: Identity | null; failGet?: number; failPost?: number; abortPost?: boolean; pending?: boolean };

const seed: Identity = {
  id: 1, name: 'Jane Doe', address: 'Jakarta', email: 'jane@example.com', phone: '+628123456789',
  githubUrl: 'https://github.com/jane', linkedinUrl: 'https://linkedin.com/in/jane',
  instagramUrl: 'https://instagram.com/jane', photo: 'old.png',
};
const updated: Record<Field, string> = {
  name: 'Updated User', address: 'Bandung', email: 'updated@example.com', phone: '+628987654321',
  githubUrl: 'https://github.com/updated', linkedinUrl: 'https://linkedin.com/in/updated',
  instagramUrl: 'https://instagram.com/updated',
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const upload: Upload = { name: 'profile.png', mimeType: 'image/png', buffer: PNG };
const PHOTO_ORIGIN = 'https://identity-test.supabase.co';
const SUCCESS = 'Identitas berhasil disimpan';
const ERROR = 'Gagal menyimpan identitas';
const form = (page: Page) => page.locator('main form');
const field = (page: Page, id: Field | 'photo') => form(page).locator('#' + id);
const save = (page: Page) => form(page).getByRole('button', { name: 'Simpan', exact: true });
const currentPhoto = (page: Page) => form(page).getByRole('img', { name: 'Current', exact: true });
const isIdentityUrl = (url: URL) => /\/identity\/?$/.test(url.pathname) && !/\/(admin|public)\//.test(url.pathname);
const isResponse = (response: PlaywrightResponse, method: string) =>
  ['xhr', 'fetch'].includes(response.request().resourceType()) &&
  isIdentityUrl(new URL(response.url())) && response.request().method() === method;

async function open(page: Page, options: Options = {}) {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD are required');
  await page.goto('/admin/login');
  await page.getByPlaceholder(/masukkan username/i).fill(username);
  await page.getByPlaceholder(/masukkan password/i).fill(password);
  await page.getByPlaceholder(/masukkan password/i).press('Enter');
  await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 20000 });

  const isWebKit = page.context().browser()?.browserType().name() === 'webkit';
  if (isWebKit) await page.addInitScript(() => {
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      if (body instanceof FormData) {
        const photo = body.get('photo');
        const observed = photo instanceof File
          ? photo.arrayBuffer().then(buffer => ({
            name: photo.name, mimeType: photo.type, bytes: Array.from(new Uint8Array(buffer)),
          }))
          : Promise.resolve(null);
        ((window as UploadWindow).__identityPhotos ??= []).push(observed);
      }
      return originalSend.call(this, body);
    };
  });

  let data = structuredClone(options.initial === undefined ? seed : options.initial);
  const posts: Post[] = [];
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });

  await page.route(url => url.origin === PHOTO_ORIGIN || url.pathname.startsWith('/api/uploads/'), async route => {
    const url = new URL(route.request().url());
    // Do not mask the UI bug that prefixes absolute storage URLs with /api/uploads/.
    if (url.pathname.startsWith('/api/uploads/http')) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
  await page.route(isIdentityUrl, async route => {
    const request = route.request();
    if (!['xhr', 'fetch'].includes(request.resourceType())) return route.fallback();
    const method = request.method();
    const headers = {
      'access-control-allow-origin': request.headers().origin || '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    const reply = (status: number, json: unknown) => route.fulfill({ status, headers, json });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (method === 'GET') {
      if (options.failGet) return reply(options.failGet, {
        message: options.failGet === 401 ? 'Access token required' : 'Error fetching identity',
      });
      return reply(200, data);
    }
    if (method !== 'POST') throw new Error('Unexpected identity API method: ' + method);
    const contentType = request.headers()['content-type'];
    const raw = request.postDataBuffer();
    if (!raw) throw new Error('Identity POST has no multipart body');
    const multipart = await new Response(new Uint8Array(raw), { headers: { 'content-type': contentType } }).formData();
    const observedPhoto = isWebKit
      ? await page.evaluate(() => (window as UploadWindow).__identityPhotos?.shift())
      : undefined;
    const fields: Record<string, string> = {};
    let photo: Upload | undefined;
    for (const [key, value] of multipart.entries()) {
      if (typeof value === 'string') fields[key] = value;
      else {
        if (key !== 'photo') throw new Error('Unexpected file part: ' + key);
        photo = { name: value.name, mimeType: value.type, buffer: Buffer.from(await value.arrayBuffer()) };
        // shortcut: WebKit omits file bytes from intercepted multipart; inspect XHR FormData until the protocol exposes them.
        if (isWebKit && photo.buffer.length === 0) {
          if (!observedPhoto || observedPhoto.name !== photo.name || observedPhoto.mimeType !== photo.mimeType) {
            throw new Error('Multipart photo does not match the FormData passed to XHR.send');
          }
          photo.buffer = Buffer.from(observedPhoto.bytes);
        }
      }
    }
    posts.push({ contentType, fields, photo });
    if (options.pending) await gate;
    if (options.abortPost) return route.abort('failed');
    if (options.failPost) return reply(options.failPost, {
      message: options.failPost === 503 ? 'Photo storage is not configured' : 'Error saving identity',
    });
    data = {
      id: data?.id || 100,
      name: fields.name, address: fields.address, email: fields.email, phone: fields.phone,
      githubUrl: fields.githubUrl || null, linkedinUrl: fields.linkedinUrl || null, instagramUrl: fields.instagramUrl || null,
      photo: photo ? PHOTO_ORIGIN + '/storage/v1/object/public/photos/photos/photo_100_' + photo.name : data?.photo || null,
    };
    return reply(200, data);
  });

  const loaded = page.waitForResponse(response => isResponse(response, 'GET'));
  await page.goto('/admin/identity');
  await loaded;
  if (options.failGet !== 401) {
    await expect(page.getByRole('heading', { name: 'Identitas', exact: true })).toBeVisible();
    if (!options.failGet) {
      for (const id of TEXT_FIELDS) await expect(field(page, id)).toHaveValue(data?.[id] || '');
    }
  }
  return { posts, release };
}

async function fill(page: Page, values: Partial<Record<Field, string>> = updated) {
  for (const [key, value] of Object.entries(values)) await field(page, key as Field).fill(value);
}
async function submit(page: Page) {
  const posted = page.waitForResponse(response => isResponse(response, 'POST'));
  const refreshed = page.waitForResponse(response => isResponse(response, 'GET'));
  await save(page).click();
  const response = await posted;
  expect(response.status()).toBe(200);
  const data: Identity = await response.json();
  await refreshed;
  await expect(page.getByText(SUCCESS, { exact: true })).toBeVisible();
  await expect(save(page)).toBeEnabled();
  return data;
}
async function reloadAndExpect(page: Page, values: Partial<Record<Field, string>>) {
  const loaded = page.waitForResponse(response => isResponse(response, 'GET'));
  await page.reload();
  await loaded;
  for (const [id, value] of Object.entries(values)) await expect(field(page, id as Field)).toHaveValue(value);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test.describe('Positive: render and save', () => {
  test('renders all fields, saved data and legacy photo', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('heading', { name: 'Data Identitas' })).toBeVisible();
    await expect(form(page).locator('input:not([type="file"])')).toHaveCount(7);
    await expect(field(page, 'photo')).toHaveAttribute('accept', 'image/*');
    await expect(save(page)).toBeEnabled();
    await expect(currentPhoto(page)).toHaveAttribute('src', '/api/uploads/old.png');
    await expect.poll(() => currentPhoto(page).evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  });
  test('null identity renders an empty form without photo', async ({ page }) => {
    await open(page, { initial: null });
    for (const id of TEXT_FIELDS) await expect(field(page, id)).toHaveValue('');
    await expect(currentPhoto(page)).toHaveCount(0);
  });
  for (const initial of [null, seed]) test(initial ? 'updates all fields and retains ID on reload' : 'creates identity and persists after reload', async ({ page }) => {
    const api = await open(page, { initial });
    await fill(page);
    const saved = await submit(page);
    expect(saved.id).toBe(initial?.id || 100);
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0].contentType).toMatch(/^multipart\/form-data;.*boundary=/);
    expect(api.posts[0].fields).toEqual(updated);
    expect(api.posts[0].photo).toBeUndefined();
    await reloadAndExpect(page, updated);
  });
  test('changing one field preserves other fields and existing photo', async ({ page }) => {
    const api = await open(page);
    await fill(page, { name: 'Changed Name' });
    const saved = await submit(page);
    const expected = Object.fromEntries(TEXT_FIELDS.map(id => [id, id === 'name' ? 'Changed Name' : seed[id]]));
    expect(api.posts[0].fields).toEqual(expected);
    expect(api.posts[0].photo).toBeUndefined();
    expect(saved.photo).toBe(seed.photo);
    await expect(currentPhoto(page)).toHaveAttribute('src', '/api/uploads/old.png');
    await reloadAndExpect(page, expected as Record<Field, string>);
  });
  test('save without edits preserves existing values', async ({ page }) => {
    const api = await open(page);
    const saved = await submit(page);
    expect(saved).toEqual(seed);
    expect(api.posts[0].fields).toEqual(Object.fromEntries(TEXT_FIELDS.map(id => [id, seed[id]])));
  });
  test('new identity accepts empty fields and normalizes empty social URLs to null', async ({ page }) => {
    const api = await open(page, { initial: null });
    for (const id of TEXT_FIELDS) await expect(field(page, id)).toHaveJSProperty('required', false);
    const saved = await submit(page);
    expect(api.posts[0].fields).toEqual(Object.fromEntries(TEXT_FIELDS.map(id => [id, ''])));
    expect(saved).toMatchObject({ name: '', address: '', email: '', phone: '', githubUrl: null, linkedinUrl: null, instagramUrl: null, photo: null });
  });
});

test.describe('Positive: multipart photo upload', () => {
  test('PNG upload sends the exact filename, MIME type and bytes', async ({ page }) => {
    const api = await open(page);
    await field(page, 'photo').setInputFiles(upload);
    const saved = await submit(page);
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0].photo).toEqual(upload);
    expect(saved.photo).toBe(PHOTO_ORIGIN + '/storage/v1/object/public/photos/photos/photo_100_profile.png');
  });
  test('replacing selected file sends only the latest file', async ({ page }) => {
    const api = await open(page);
    await field(page, 'photo').setInputFiles(upload);
    const replacement = { ...upload, name: 'replacement.png' };
    await field(page, 'photo').setInputFiles(replacement);
    await submit(page);
    expect(api.posts[0].photo).toEqual(replacement);
  });
  test('clearing the file selection omits the photo part', async ({ page }) => {
    const api = await open(page);
    await field(page, 'photo').setInputFiles(upload);
    await field(page, 'photo').setInputFiles([]);
    const saved = await submit(page);
    expect(api.posts[0].photo).toBeUndefined();
    expect(saved.photo).toBe(seed.photo);
  });
});

test.describe('Negative: HTML validation', () => {
  for (const id of ['email', 'githubUrl', 'linkedinUrl', 'instagramUrl'] as const) test('invalid ' + id + ' blocks POST', async ({ page }) => {
    const api = await open(page);
    await field(page, id).fill('not-valid');
    await save(page).click();
    expect(await field(page, id).evaluate(input => (input as HTMLInputElement).validity.typeMismatch)).toBe(true);
    expect(api.posts).toHaveLength(0);
    await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(0);
  });
  test('HTML in name and address stays literal after save and reload', async ({ page }) => {
    await open(page);
    const html = '<img src=x onerror=alert(1)>';
    const dialogs: string[] = [];
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await fill(page, { name: html, address: html });
    await submit(page);
    await reloadAndExpect(page, { name: html, address: html });
    await expect(page.locator('main img[src="x"]')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });
});

test.describe('API failures and pending state', () => {
  test('GET 500 leaves the form usable', async ({ page }) => {
    await open(page, { failGet: 500 });
    await expect(save(page)).toBeEnabled();
    await field(page, 'name').fill('Still usable');
    await expect(field(page, 'name')).toHaveValue('Still usable');
    await expect(currentPhoto(page)).toHaveCount(0);
  });
  for (const failure of ['500', '503', 'network'] as const) test('POST ' + failure + ' shows error and retains input', async ({ page }) => {
    const api = await open(page, failure === 'network' ? { abortPost: true } : { failPost: Number(failure) });
    await fill(page);
    if (failure === '503') await field(page, 'photo').setInputFiles(upload);
    const failed = failure === 'network'
      ? page.waitForEvent('requestfailed', { predicate: r => r.method() === 'POST' && isIdentityUrl(new URL(r.url())) })
      : page.waitForResponse(r => isResponse(r, 'POST') && r.status() === Number(failure));
    await save(page).click();
    await failed;
    await expect(page.getByText(ERROR, { exact: true })).toBeVisible();
    await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(0);
    await expect(save(page)).toBeEnabled();
    for (const id of TEXT_FIELDS) await expect(field(page, id)).toHaveValue(updated[id]);
    expect(api.posts).toHaveLength(1);
    if (failure === '503') expect(api.posts[0].photo).toEqual(upload);
    await reloadAndExpect(page, Object.fromEntries(TEXT_FIELDS.map(id => [id, seed[id]])) as Record<Field, string>);
  });
  test('pending save disables resubmission and sends one POST', async ({ page }) => {
    const api = await open(page, { pending: true });
    await fill(page);
    try {
      await save(page).click();
      const pending = form(page).getByRole('button', { name: 'Menyimpan...', exact: true });
      await expect(pending).toBeDisabled();
      await expect.poll(() => api.posts.length).toBe(1);
      await field(page, 'name').press('Enter');
      expect(api.posts).toHaveLength(1);
    } finally { api.release(); }
    await expect(page.getByText(SUCCESS, { exact: true })).toBeVisible();
    await expect(save(page)).toBeEnabled();
    expect(api.posts).toHaveLength(1);
  });
});

test.describe('Authentication', () => {
  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/admin/identity');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
  test('GET 401 redirects to login', async ({ page }) => {
    await open(page, { failGet: 401 });
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

test.describe('Known implementation gaps', () => {
  test('clearing a saved social URL should persist the empty value', async ({ page }) => {
    const api = await open(page);
    await field(page, 'githubUrl').fill('');
    await expect(field(page, 'githubUrl')).toHaveValue('');
    await submit(page);
    expect(api.posts).toHaveLength(1);
    const sent = api.posts[0].fields.githubUrl;
    test.info().annotations.push({ type: 'observed payload', description: 'githubUrl=' + sent });
    test.fail(true, 'handleSubmit uses editedValue || savedValue, so clearing a field restores its old value');
    expect(sent).toBe('');
  });
  test('uploaded absolute storage URL should load as the current photo', async ({ page }) => {
    const api = await open(page);
    await field(page, 'photo').setInputFiles(upload);
    const saved = await submit(page);
    expect(api.posts[0].photo).toEqual(upload);
    expect(saved.photo).toMatch(/^https:\/\//);
    await expect(currentPhoto(page)).toBeAttached();
    test.fail(true, 'Identity prefixes absolute storage URLs with /api/uploads/');
    await expect(currentPhoto(page)).toHaveAttribute('src', saved.photo!);
    await expect.poll(() => currentPhoto(page).evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  });
});

// accept=image/* is a picker hint. Backend MIME/size rejection and real Supabase storage are not tested by these mocks.
test.describe('Mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('fill, select a photo, save and reload without horizontal overflow', async ({ page }) => {
    const api = await open(page);
    await expect(currentPhoto(page)).toBeVisible();
    await noOverflow(page);
    await fill(page);
    await field(page, 'photo').setInputFiles(upload);
    await noOverflow(page);
    await submit(page);
    expect(api.posts[0].fields).toEqual(updated);
    expect(api.posts[0].photo).toEqual(upload);
    await reloadAndExpect(page, updated);
    await expect(currentPhoto(page)).toBeAttached();
    await noOverflow(page);
  });
});
