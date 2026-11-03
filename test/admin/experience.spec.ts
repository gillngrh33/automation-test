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

const SUCCESS_SAVE = 'Data pengalaman berhasil disimpan';
const SUCCESS_DELETE = 'Data berhasil dihapus';
const ERROR_TEXT = /gagal|error|terjadi kesalahan|tidak dapat/i;

type Exp = {
  id: number;
  company: string;
  position: string;
  startDate: string;
  endDate: string | null;
  description: string;
  technologies: string[];
};

const SEED: Exp[] = [
  {
    id: 1,
    company: 'Seed Company A',
    position: 'Backend Developer',
    startDate: '2022-01-15T00:00:00.000Z',
    endDate: '2023-01-15T00:00:00.000Z',
    description: 'Seed A description',
    technologies: ['Go', 'PostgreSQL'],
  },
  {
    id: 2,
    company: 'Seed Company B',
    position: 'Frontend Developer',
    startDate: '2023-02-01T00:00:00.000Z',
    endDate: null,
    description: 'Seed B description',
    technologies: ['React'],
  },
];

async function login(page: Page) {
  await page.goto('/admin/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder(/masukkan username/i).fill(adminUsername);
  await page.getByPlaceholder(/masukkan password/i).fill(adminPassword);
  await page.getByPlaceholder(/masukkan password/i).press('Enter');
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

/**
 * In-memory mock of the /experience API so tests are deterministic and never
 * touch real data. Only fetch/xhr requests are intercepted, so navigation to
 * /admin/experience is unaffected.
 */
type MockOptions = {
  initial?: Exp[];
  failGet?: number;
  failPost?: number;
  failPut?: number;
  failDelete?: number;
  postDelayMs?: number;
};

async function mockExperienceApi(page: Page, opts: MockOptions = {}) {
  const items: Exp[] = JSON.parse(JSON.stringify(opts.initial ?? SEED));
  const calls = {
    posts: [] as any[],
    puts: [] as { id: number; body: any }[],
    deletes: [] as number[],
  };
  let nextId = 1000;

  const isApi = (url: URL) =>
    /\/experience(\/\d+)?\/?$/.test(url.pathname) && !url.pathname.startsWith('/admin');

  const toIso = (d?: string | null) => (d ? `${d}T00:00:00.000Z` : null);

  await page.route(isApi, async (route: Route) => {
    const request = route.request();
    if (!['fetch', 'xhr'].includes(request.resourceType())) return route.fallback();

    const origin = request.headers()['origin'] ?? '*';
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    };
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });

    const method = request.method();
    const id = Number(new URL(request.url()).pathname.split('/').pop());

    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

    if (method === 'GET') {
      if (opts.failGet) return json(opts.failGet, { message: 'error' });
      return json(200, items);
    }

    if (method === 'POST') {
      const body = request.postDataJSON();
      calls.posts.push(body);
      if (opts.postDelayMs) await new Promise((r) => setTimeout(r, opts.postDelayMs));
      if (opts.failPost) return json(opts.failPost, { message: 'error' });
      const created: Exp = {
        ...body,
        id: nextId++,
        startDate: toIso(body.startDate)!,
        endDate: toIso(body.endDate),
      };
      items.push(created);
      return json(200, created);
    }

    if (method === 'PUT') {
      const body = request.postDataJSON();
      calls.puts.push({ id, body });
      if (opts.failPut) return json(opts.failPut, { message: 'error' });
      const idx = items.findIndex((e) => e.id === id);
      if (idx >= 0) {
        items[idx] = {
          ...items[idx],
          ...body,
          startDate: toIso(body.startDate)!,
          endDate: toIso(body.endDate),
        };
      }
      return json(200, items[idx]);
    }

    if (method === 'DELETE') {
      calls.deletes.push(id);
      if (opts.failDelete) return json(opts.failDelete, { message: 'error' });
      const idx = items.findIndex((e) => e.id === id);
      if (idx >= 0) items.splice(idx, 1);
      return json(200, { message: 'Experience deleted' });
    }

    return route.fallback();
  });

  return { items, calls };
}

async function openExperience(page: Page, opts: MockOptions = {}) {
  await login(page);
  const api = await mockExperienceApi(page, opts);
  await page.goto('/admin/experience', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Pengalaman', exact: true })).toBeVisible();
  return api;
}

const form = (page: Page) => page.locator('form');
const addButton = (page: Page) => page.getByRole('button', { name: /tambah pengalaman/i });
const saveButton = (page: Page) => form(page).getByRole('button', { name: /^simpan$/i });
const cancelButton = (page: Page) => form(page).getByRole('button', { name: /^batal$/i });
const cardOf = (page: Page, text: string) => page.locator('div.rounded-xl').filter({ hasText: text });
const editBtn = (page: Page, company: string) => cardOf(page, company).locator('button').nth(0);
const deleteBtn = (page: Page, company: string) => cardOf(page, company).locator('button').nth(1);

async function fillForm(
  page: Page,
  v: { company: string; position: string; start: string; end?: string; ongoing?: boolean; description?: string },
) {
  const f = form(page);
  await f.locator('input').nth(0).fill(v.company);
  await f.locator('input').nth(1).fill(v.position);
  await f.locator('input[type="date"]').nth(0).fill(v.start);
  if (v.ongoing) {
    await f.getByText('Masih bekerja', { exact: true }).click();
  } else {
    await f.getByText('Sudah selesai', { exact: true }).click();
    if (v.end) await f.locator('input[type="date"]').nth(1).fill(v.end);
  }
  if (v.description) await f.locator('textarea').fill(v.description);
}

async function addTech(page: Page, name: string) {
  const input = form(page).getByPlaceholder('Tambah teknologi');
  await input.fill(name);
  await input.press('Enter');
}

/* ========================================================================== */
/*  POSITIVE                                                                  */
/* ========================================================================== */

test.describe('Positive: list & rendering', () => {
  test('page renders heading and add button', async ({ page }) => {
    await openExperience(page);
    await expect(page.getByRole('heading', { name: 'Pengalaman', exact: true })).toBeVisible();
    await expect(addButton(page)).toBeVisible();
    await expect(form(page)).toHaveCount(0);
  });

  test('existing experiences are listed with all details', async ({ page }) => {
    await openExperience(page);

    const a = cardOf(page, 'Seed Company A');
    await expect(a.getByText('Backend Developer', { exact: true })).toBeVisible();
    await expect(a.getByText('Seed A description', { exact: true })).toBeVisible();
    await expect(a.getByText('Go', { exact: true })).toBeVisible();
    await expect(a.getByText('PostgreSQL', { exact: true })).toBeVisible();
    await expect(a.getByText('Sekarang', { exact: true })).toHaveCount(0);
    await expect(a.getByText(/2022/)).toBeVisible();

    const b = cardOf(page, 'Seed Company B');
    await expect(b.getByText('Frontend Developer', { exact: true })).toBeVisible();
    await expect(b.getByText('React', { exact: true })).toBeVisible();
    await expect(b.getByText('Sekarang', { exact: true })).toBeVisible();
  });

  test('empty list shows no cards and add form still opens', async ({ page }) => {
    await openExperience(page, { initial: [] });
    await expect(page.locator('div.rounded-xl')).toHaveCount(0);
    await addButton(page).click();
    await expect(page.getByRole('heading', { name: 'Tambah Pengalaman', exact: true })).toBeVisible();
  });
});

test.describe('Positive: add experience', () => {
  test('add an ongoing experience with a technology', async ({ page }) => {
    const api = await openExperience(page);
    await addButton(page).click();
    await fillForm(page, {
      company: 'New Ongoing Co',
      position: 'Software Engineer',
      start: '2024-01-01',
      ongoing: true,
      description: 'Automated test experience',
    });
    await addTech(page, 'TypeScript');
    await saveButton(page).click();

    await expect(page.getByText(SUCCESS_SAVE)).toBeVisible();
    const card = cardOf(page, 'New Ongoing Co');
    await expect(card.getByText('Software Engineer', { exact: true })).toBeVisible();
    await expect(card.getByText('TypeScript', { exact: true })).toBeVisible();
    await expect(card.getByText('Automated test experience', { exact: true })).toBeVisible();
    await expect(card.getByText('Sekarang', { exact: true })).toBeVisible();

    expect(api.calls.posts).toHaveLength(1);
    expect(api.calls.posts[0]).toMatchObject({
      company: 'New Ongoing Co',
      position: 'Software Engineer',
      startDate: '2024-01-01',
      technologies: ['TypeScript'],
    });
  });

  test('add a completed experience with a valid end date', async ({ page }) => {
    const api = await openExperience(page);
    await addButton(page).click();
    await fillForm(page, {
      company: 'Finished Co',
      position: 'QA Engineer',
      start: '2020-03-01',
      end: '2021-09-30',
    });
    await saveButton(page).click();

    await expect(page.getByText(SUCCESS_SAVE)).toBeVisible();
    const card = cardOf(page, 'Finished Co');
    await expect(card).toBeVisible();
    await expect(card.getByText('Sekarang', { exact: true })).toHaveCount(0);
    await expect(card.getByText(/2021/)).toBeVisible();

    expect(api.calls.posts[0]).toMatchObject({ startDate: '2020-03-01', endDate: '2021-09-30' });
  });

  test('add multiple technologies using both Enter and the Tambah button', async ({ page }) => {
    const api = await openExperience(page);
    await addButton(page).click();
    await fillForm(page, { company: 'Multi Tech Co', position: 'Engineer', start: '2024-01-01', ongoing: true });

    await addTech(page, 'Node.js');
    await form(page).getByPlaceholder('Tambah teknologi').fill('Docker');
    await form(page).getByRole('button', { name: 'Tambah', exact: true }).click();
    await addTech(page, 'Kubernetes');

    for (const tech of ['Node.js', 'Docker', 'Kubernetes']) {
      await expect(form(page).getByText(tech, { exact: true })).toBeVisible();
    }
    await expect(form(page).getByPlaceholder('Tambah teknologi')).toHaveValue('');

    await saveButton(page).click();
    await expect(page.getByText(SUCCESS_SAVE)).toBeVisible();
    expect(api.calls.posts[0].technologies).toEqual(['Node.js', 'Docker', 'Kubernetes']);
  });

  test('description and technologies are optional', async ({ page }) => {
    const api = await openExperience(page);
    await addButton(page).click();
    await fillForm(page, { company: 'Minimal Co', position: 'Engineer', start: '2024-01-01', ongoing: true });
    await saveButton(page).click();

    await expect(page.getByText(SUCCESS_SAVE)).toBeVisible();
    await expect(cardOf(page, 'Minimal Co')).toBeVisible();
    expect(api.calls.posts[0].technologies).toEqual([]);
  });

  test('form closes and add button returns after a successful save', async ({ page }) => {
    await openExperience(page);
    await addButton(page).click();
    await fillForm(page, { company: 'Closing Co', position: 'Engineer', start: '2024-01-01', ongoing: true });
    await saveButton(page).click();

    await expect(page.getByText(SUCCESS_SAVE)).toBeVisible();
    await expect(form(page)).toHaveCount(0);
    await expect(addButton(page)).toBeVisible();
  });

  test('save button shows "Menyimpan..." and is disabled while the request is pending', async ({ page }) => {
    await openExperience(page, { postDelayMs: 1000 });
    await addButton(page).click();
    await fillForm(page, { company: 'Slow Co', position: 'Engineer', start: '2024-01-01', ongoing: true });
    await saveButton(page).click();

    const pending = form(page).getByRole('button', { name: /menyimpan/i });
    await expect(pending).toBeVisible();
    await expect(pending).toBeDisabled();
    await expect(page.getByText(SUCCESS_SAVE)).toBeVisible();
  });
});

test.describe('Positive: form behaviour', () => {
  test('ongoing status disables end date; completed status enables and requires it', async ({ page }) => {
    await openExperience(page);
    await addButton(page).click();
    const endDate = form(page).locator('input[type="date"]').nth(1);

    await form(page).getByText('Masih bekerja', { exact: true }).click();
    await expect(endDate).toBeDisabled();

    await form(page).getByText('Sudah selesai', { exact: true }).click();
    await expect(endDate).toBeEnabled();
    await expect(endDate).toHaveJSProperty('required', true);
  });

  test('technology can be removed before saving', async ({ page }) => {
    await openExperience(page);
    await addButton(page).click();
    await addTech(page, 'React');
    await expect(form(page).getByText('React', { exact: true })).toBeVisible();
    await form(page).getByText('React', { exact: true }).locator('..').getByRole('button').click();
    await expect(form(page).getByText('React', { exact: true })).toHaveCount(0);
  });

  test('cancel closes the add form and discards input', async ({ page }) => {
    const api = await openExperience(page);
    await addButton(page).click();
    await form(page).locator('input').nth(0).fill('Temporary Company');
    await cancelButton(page).click();

    await expect(addButton(page)).toBeVisible();
    await expect(form(page)).toHaveCount(0);
    await expect(page.getByText('Temporary Company', { exact: true })).toHaveCount(0);
    expect(api.calls.posts).toHaveLength(0);
  });
});

test.describe('Positive: edit experience', () => {
  test('edit mode is pre-filled with the ongoing experience data', async ({ page }) => {
    await openExperience(page);
    await editBtn(page, 'Seed Company B').click();

    await expect(page.getByRole('heading', { name: 'Edit Pengalaman', exact: true })).toBeVisible();
    await expect(form(page).locator('input').nth(0)).toHaveValue('Seed Company B');
    await expect(form(page).locator('input').nth(1)).toHaveValue('Frontend Developer');
    await expect(form(page).locator('input[type="date"]').nth(0)).toHaveValue('2023-02-01');
    await expect(form(page).locator('input[type="date"]').nth(1)).toBeDisabled();
    await expect(form(page).locator('input[type="date"]').nth(1)).toHaveValue('');
    await expect(form(page).getByRole('radio', { name: 'Masih bekerja' })).toBeChecked();
    await expect(form(page).locator('textarea')).toHaveValue('Seed B description');
    await expect(form(page).getByText('React', { exact: true })).toBeVisible();
    await expect(saveButton(page)).toBeVisible();
    await expect(cancelButton(page)).toBeVisible();
  });

  test('edit mode is pre-filled with the completed experience data', async ({ page }) => {
    await openExperience(page);
    await editBtn(page, 'Seed Company A').click();

    await expect(form(page).locator('input[type="date"]').nth(0)).toHaveValue('2022-01-15');
    await expect(form(page).locator('input[type="date"]').nth(1)).toHaveValue('2023-01-15');
    await expect(form(page).locator('input[type="date"]').nth(1)).toBeEnabled();
    await expect(form(page).getByRole('radio', { name: 'Sudah selesai' })).toBeChecked();
    await expect(form(page).getByText('Go', { exact: true })).toBeVisible();
    await expect(form(page).getByText('PostgreSQL', { exact: true })).toBeVisible();
  });

  test('edited data is saved and shown in the list', async ({ page }) => {
    const api = await openExperience(page);
    await editBtn(page, 'Seed Company A').click();

    await form(page).locator('input').nth(0).fill('Renamed Company');
    await addTech(page, 'Redis');
    await saveButton(page).click();

    await expect(page.getByText(SUCCESS_SAVE)).toBeVisible();
    await expect(form(page)).toHaveCount(0);
    await expect(cardOf(page, 'Renamed Company').getByText('Redis', { exact: true })).toBeVisible();
    await expect(page.getByText('Seed Company A', { exact: true })).toHaveCount(0);

    expect(api.calls.posts).toHaveLength(0);
    expect(api.calls.puts).toHaveLength(1);
    expect(api.calls.puts[0].id).toBe(1);
    expect(api.calls.puts[0].body).toMatchObject({
      company: 'Renamed Company',
      technologies: ['Go', 'PostgreSQL', 'Redis'],
    });
  });

  test('switching an ongoing experience to completed saves the end date', async ({ page }) => {
    const api = await openExperience(page);
    await editBtn(page, 'Seed Company B').click();

    await form(page).getByText('Sudah selesai', { exact: true }).click();
    await form(page).locator('input[type="date"]').nth(1).fill('2024-05-31');
    await saveButton(page).click();

    await expect(page.getByText(SUCCESS_SAVE)).toBeVisible();
    await expect(cardOf(page, 'Seed Company B').getByText('Sekarang', { exact: true })).toHaveCount(0);
    expect(api.calls.puts[0].body.endDate).toBe('2024-05-31');
  });

  test('cancel in edit mode keeps the original data', async ({ page }) => {
    const api = await openExperience(page);
    await editBtn(page, 'Seed Company A').click();
    await form(page).locator('input').nth(0).fill('Should Not Persist');
    await cancelButton(page).click();

    await expect(form(page)).toHaveCount(0);
    await expect(cardOf(page, 'Seed Company A')).toBeVisible();
    await expect(page.getByText('Should Not Persist')).toHaveCount(0);
    expect(api.calls.puts).toHaveLength(0);
  });
});

test.describe('Positive: delete experience', () => {
  test('deleting an experience removes only that card', async ({ page }) => {
    const api = await openExperience(page);
    await deleteBtn(page, 'Seed Company B').click();

    await expect(page.getByText(SUCCESS_DELETE)).toBeVisible();
    await expect(page.getByText('Seed Company B', { exact: true })).toHaveCount(0);
    await expect(cardOf(page, 'Seed Company A')).toBeVisible();
    expect(api.calls.deletes).toEqual([2]);
  });

  test('deleting all experiences leaves an empty list', async ({ page }) => {
    await openExperience(page);
    await deleteBtn(page, 'Seed Company A').click();
    await expect(page.getByText('Seed Company A', { exact: true })).toHaveCount(0);
    await deleteBtn(page, 'Seed Company B').click();
    await expect(page.getByText('Seed Company B', { exact: true })).toHaveCount(0);
    await expect(page.locator('div.rounded-xl')).toHaveCount(0);
  });
});

/* ========================================================================== */
/*  NEGATIVE                                                                  */
/* ========================================================================== */

test.describe('Negative: authentication', () => {
  test.describe('without login', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('unauthenticated user is redirected away from /admin/experience', async ({ page }) => {
      await page.goto('/admin/experience', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/admin\/login/);
      await expect(page.getByRole('button', { name: /tambah pengalaman/i })).toHaveCount(0);
    });
  });

  test('403 from API keeps the user on the page without showing stale data', async ({ page }) => {
    await login(page);
    await mockExperienceApi(page, { failGet: 403 });
    await page.goto('/admin/experience', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/admin\/experience/);
    await expect(addButton(page)).toBeVisible();
    await expect(page.locator('div.rounded-xl')).toHaveCount(0);
  });
});

test.describe('Negative: form validation', () => {
  test('required fields are validated by the browser', async ({ page }) => {
    const api = await openExperience(page);
    await addButton(page).click();
    await saveButton(page).click();

    for (const field of [
      form(page).locator('input').nth(0),
      form(page).locator('input').nth(1),
      form(page).locator('input[type="date"]').nth(0),
      form(page).locator('input[type="date"]').nth(1),
    ]) {
      await expect(field).toHaveJSProperty('validity.valueMissing', true);
    }
    expect(api.calls.posts).toHaveLength(0);
  });

  test('completed experience cannot be saved without an end date', async ({ page }) => {
    const api = await openExperience(page);
    await addButton(page).click();
    await fillForm(page, { company: 'Incomplete Company', position: 'Software Engineer', start: '2024-01-01' });
    await saveButton(page).click();

    await expect(form(page).locator('input[type="date"]').nth(1)).toHaveJSProperty('validity.valueMissing', true);
    await expect(page.getByText(SUCCESS_SAVE)).toHaveCount(0);
    expect(api.calls.posts).toHaveLength(0);
  });

  test('blank or whitespace technology is not added', async ({ page }) => {
    await openExperience(page);
    await addButton(page).click();
    const technology = form(page).getByPlaceholder('Tambah teknologi');

    await technology.fill('   ');
    await technology.press('Enter');

    await expect(form(page).locator('div.rounded-md').filter({ hasText: /\S/ })).toHaveCount(0);
    await expect(technology).toHaveValue('');
  });

  test('end date earlier than start date is rejected', async ({ page }) => {
    test.fail(true, 'Known gap: no date range validation in the form');
    const api = await openExperience(page);
    await addButton(page).click();
    await fillForm(page, {
      company: 'Time Travel Inc',
      position: 'Engineer',
      start: '2024-06-01',
      end: '2023-01-01',
    });
    await saveButton(page).click();

    expect(api.calls.posts).toHaveLength(0);
    await expect(page.getByText(SUCCESS_SAVE)).toHaveCount(0);
  });

  test('whitespace-only company and position are rejected', async ({ page }) => {
    test.fail(true, 'Known gap: values are not trimmed/validated before submit');
    const api = await openExperience(page);
    await addButton(page).click();
    await fillForm(page, { company: '     ', position: '     ', start: '2024-01-01', ongoing: true });
    await saveButton(page).click();

    expect(api.calls.posts).toHaveLength(0);
    await expect(page.getByText(SUCCESS_SAVE)).toHaveCount(0);
  });

  test('duplicate technologies are not added twice (case-insensitive)', async ({ page }) => {
    test.fail(true, 'Known gap: technologies are not de-duplicated');
    await openExperience(page);
    await addButton(page).click();
    await addTech(page, 'React');
    await addTech(page, 'React');
    await addTech(page, 'react');

    await expect(form(page).getByText(/^react$/i)).toHaveCount(1);
  });

  test('pressing Enter in technology input does not submit the form', async ({ page }) => {
    const api = await openExperience(page);
    await addButton(page).click();
    await form(page).locator('input').nth(0).fill('Enter Test Co');
    await addTech(page, 'Vue');

    expect(api.calls.posts).toHaveLength(0);
    await expect(form(page)).toBeVisible();
    await expect(form(page).getByText('Vue', { exact: true })).toBeVisible();
  });

  test('clearing a required field in edit mode blocks the update', async ({ page }) => {
    const api = await openExperience(page);
    await editBtn(page, 'Seed Company A').click();
    await expect(page.getByRole('heading', { name: 'Edit Pengalaman', exact: true })).toBeVisible();

    const company = form(page).locator('input').nth(0);
    await company.fill('');
    await saveButton(page).click();

    await expect(company).toHaveJSProperty('validity.valueMissing', true);
    expect(api.calls.puts).toHaveLength(0);
  });
});

test.describe('Negative: API failures', () => {
  test('save fails with 500: no success toast, form stays open, error is shown', async ({ page }) => {
    test.fail(true, 'Known gap: saveMutation has no onError handler');
    await openExperience(page, { failPost: 500 });
    await addButton(page).click();
    await fillForm(page, { company: 'Broken API Co', position: 'Engineer', start: '2024-01-01', ongoing: true });
    await saveButton(page).click();

    await expect(page.getByText(SUCCESS_SAVE)).toHaveCount(0);
    await expect(form(page)).toBeVisible();
    await expect(form(page).locator('input').nth(0)).toHaveValue('Broken API Co');
    await expect(page.getByText(ERROR_TEXT).first()).toBeVisible();
  });

  test('update fails with 500: data unchanged and error is shown', async ({ page }) => {
    test.fail(true, 'Known gap: saveMutation has no onError handler');
    await openExperience(page, { failPut: 500 });
    await editBtn(page, 'Seed Company A').click();
    await form(page).locator('input').nth(0).fill('Renamed Company');
    await saveButton(page).click();

    await expect(page.getByText(SUCCESS_SAVE)).toHaveCount(0);
    await expect(page.getByText(ERROR_TEXT).first()).toBeVisible();
  });

  test('delete fails with 500: item remains and error is shown', async ({ page }) => {
    test.fail(true, 'Known gap: deleteMutation has no onError handler');
    await openExperience(page, { failDelete: 500 });
    await deleteBtn(page, 'Seed Company A').click();

    await expect(page.getByText(SUCCESS_DELETE)).toHaveCount(0);
    await expect(cardOf(page, 'Seed Company A')).toBeVisible();
    await expect(page.getByText(ERROR_TEXT).first()).toBeVisible();
  });

  test('list fails to load (500): page does not crash and add button still works', async ({ page }) => {
    await openExperience(page, { failGet: 500 });
    await expect(addButton(page)).toBeVisible();
    await expect(page.locator('div.rounded-xl')).toHaveCount(0);
  });

  test('double click on Simpan sends only one request', async ({ page }) => {
    const api = await openExperience(page, { postDelayMs: 800 });
    await addButton(page).click();
    await fillForm(page, { company: 'Double Click Co', position: 'Engineer', start: '2024-01-01', ongoing: true });

    await saveButton(page).dblclick();
    await expect(page.getByText(SUCCESS_SAVE)).toBeVisible();

    expect(api.calls.posts).toHaveLength(1);
  });
});

test.describe('Negative: state leakage', () => {
  test('edit -> cancel -> add shows an empty "Tambah" form', async ({ page }) => {
    await openExperience(page);
    await editBtn(page, 'Seed Company A').click();
    await expect(form(page).locator('input').nth(0)).toHaveValue('Seed Company A');
    await cancelButton(page).click();

    await addButton(page).click();
    await expect(page.getByRole('heading', { name: 'Tambah Pengalaman', exact: true })).toBeVisible();
    await expect(form(page).locator('input').nth(0)).toHaveValue('');
    await expect(form(page).locator('input').nth(1)).toHaveValue('');
    await expect(form(page).locator('textarea')).toHaveValue('');
  });

  test('add after a successful edit does not overwrite the edited record', async ({ page }) => {
    const api = await openExperience(page);
    await editBtn(page, 'Seed Company A').click();
    await form(page).locator('input').nth(0).fill('Edited A');
    await saveButton(page).click();
    await expect(page.getByText(SUCCESS_SAVE)).toBeVisible();

    await addButton(page).click();
    await fillForm(page, { company: 'Brand New Co', position: 'Engineer', start: '2024-01-01', ongoing: true });
    await saveButton(page).click();

    await expect(cardOf(page, 'Edited A')).toBeVisible();
    await expect(cardOf(page, 'Brand New Co')).toBeVisible();
    expect(api.calls.posts).toHaveLength(1);
    expect(api.calls.puts).toHaveLength(1);
  });

  test('switching to "Masih bekerja" clears a previously typed end date', async ({ page }) => {
    await openExperience(page);
    await addButton(page).click();
    const endDate = form(page).locator('input[type="date"]').nth(1);

    await form(page).getByText('Sudah selesai', { exact: true }).click();
    await endDate.fill('2024-12-31');
    await form(page).getByText('Masih bekerja', { exact: true }).click();
    await expect(endDate).toBeDisabled();
    await expect(endDate).toHaveValue('');
  });

  test('ongoing experience is sent without an end date value', async ({ page }) => {
    const api = await openExperience(page);
    await addButton(page).click();
    await fillForm(page, { company: 'Payload Co', position: 'Engineer', start: '2024-01-01', ongoing: true });
    await saveButton(page).click();
    await expect(page.getByText(SUCCESS_SAVE)).toBeVisible();

    expect(api.calls.posts).toHaveLength(1);
    expect(['', null]).toContain(api.calls.posts[0].endDate);
  });
});

test.describe('Negative: hostile and extreme input', () => {
  test('HTML/script payloads are rendered as plain text, never executed', async ({ page }) => {
    let dialogFired = false;
    page.on('dialog', async (d) => {
      dialogFired = true;
      await d.dismiss();
    });

    await openExperience(page);
    await addButton(page).click();
    const xss = '<img src=x onerror=alert(1)>';
    await fillForm(page, {
      company: xss,
      position: '<script>alert(2)</script>',
      start: '2024-01-01',
      ongoing: true,
      description: '<svg onload=alert(3)>',
    });
    await addTech(page, '<b>bold</b>');
    await saveButton(page).click();
    await expect(page.getByText(SUCCESS_SAVE)).toBeVisible();

    await expect(page.getByText(xss, { exact: true })).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    await expect(page.locator('div.rounded-xl b')).toHaveCount(0);
    expect(dialogFired).toBe(false);
  });

  test('very long text does not break the card layout', async ({ page }) => {
    await openExperience(page);
    await addButton(page).click();
    await fillForm(page, {
      company: 'A'.repeat(500),
      position: 'Engineer',
      start: '2024-01-01',
      ongoing: true,
    });
    await saveButton(page).click();
    await expect(page.getByText(SUCCESS_SAVE)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test('SQL-like input is saved literally and does not affect the list', async ({ page }) => {
    const api = await openExperience(page);
    await addButton(page).click();
    const sql = `'; DROP TABLE experiences; --`;
    await fillForm(page, { company: sql, position: 'Engineer', start: '2024-01-01', ongoing: true });
    await saveButton(page).click();
    await expect(page.getByText(SUCCESS_SAVE)).toBeVisible();

    expect(api.calls.posts[0].company).toBe(sql);
    await expect(cardOf(page, 'Seed Company A')).toBeVisible();
    await expect(cardOf(page, 'Seed Company B')).toBeVisible();
  });
});
