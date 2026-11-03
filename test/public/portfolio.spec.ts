import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

/* -------------------------------------------------------------------------- */
/*  Fixtures                                                                  */
/* -------------------------------------------------------------------------- */

type Endpoint = 'identity' | 'education' | 'organization' | 'certificate' | 'experience' | 'cv';

// Mid-month / mid-year dates so that local timezone never shifts the displayed year.
const iso = (d: string) => `${d}T00:00:00.000Z`;

const FIXTURES: Record<Endpoint, unknown> = {
  identity: {
    id: 1,
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+62 812-3456-7890',
    address: 'Jakarta, Indonesia',
    githubUrl: 'https://github.com/janedoe',
    linkedinUrl: 'https://linkedin.com/in/janedoe',
    instagramUrl: 'https://instagram.com/janedoe',
    photo: null,
  },
  cv: { id: 1, summary: 'Mock summary: building reliable web applications.' },
  education: [
    {
      id: 1,
      institution: 'Universitas Contoh',
      degree: 'S1',
      field: 'Informatika',
      startDate: iso('2018-08-15'),
      endDate: iso('2022-07-15'),
      description: 'Line one\nLine two',
    },
    {
      id: 2,
      institution: 'Institut Teknologi Contoh',
      degree: 'S2',
      field: 'Teknik Komputer',
      startDate: iso('2023-08-15'),
      endDate: null,
      description: null,
    },
  ],
  organization: [
    {
      id: 1,
      name: 'Himpunan Mahasiswa Informatika',
      position: 'Ketua Divisi',
      startDate: iso('2019-06-15'),
      endDate: iso('2020-06-15'),
      description: 'Mengelola kegiatan divisi.',
    },
  ],
  certificate: [
    {
      id: 1,
      name: 'AWS Cloud Practitioner',
      issuer: 'Amazon Web Services',
      type: 'certificate',
      issueDate: iso('2023-05-10'),
      url: 'https://example.com/cert/aws',
      technologies: ['AWS', 'Cloud'],
      credentialId: 'ABC-123',
    },
    {
      id: 2,
      name: 'Bootcamp Fullstack',
      issuer: 'Dicoding',
      type: 'training',
      issueDate: iso('2022-03-10'),
      url: null,
      technologies: [],
      credentialId: null,
    },
  ],
  experience: [
    {
      id: 1,
      company: 'Acme Corp',
      position: 'Backend Engineer',
      startDate: iso('2022-08-15'),
      endDate: null,
      description: 'Built APIs.\nImproved performance.',
      technologies: ['Go', 'PostgreSQL', 'Docker'],
    },
    {
      id: 2,
      company: 'Beta Inc',
      position: 'Frontend Developer',
      startDate: iso('2020-03-15'),
      endDate: iso('2022-07-15'),
      description: 'Built dashboards.',
      technologies: ['React', 'Go'],
    },
    {
      id: 3,
      company: 'Gamma Studio',
      position: 'Intern',
      startDate: iso('2019-01-15'),
      endDate: iso('2019-06-15'),
      description: null,
      technologies: ['Node.js', 'Rust'],
    },
  ],
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const FALLBACK_TEXT = {
  skills: 'Belum ada data skill.',
  education: 'Belum ada data pendidikan.',
  organization: 'Belum ada data organisasi.',
  certificate: 'Belum ada data sertifikat atau pelatihan.',
  experience: 'Belum ada data pengalaman.',
};

const NAV: Array<[string, string]> = [
  ['home', 'Home'],
  ['about', 'About'],
  ['skills', 'Skills'],
  ['education', 'Education'],
  ['organization', 'Organization'],
  ['certificate', 'Certificates'],
  ['experience', 'Experience'],
];

// text-emerald-400 as its own class, not as part of "hover:text-emerald-400".
const ACTIVE_CLASS = /(^|\s)text-emerald-400(\s|$)/;

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/* -------------------------------------------------------------------------- */
/*  Mock API                                                                  */
/* -------------------------------------------------------------------------- */

type MockOptions = {
  data?: Partial<Record<Endpoint, unknown>>;
  fail?: Partial<Record<Endpoint, number>>;
  abort?: Endpoint[];
  delayMs?: Partial<Record<Endpoint, number>>;
  imageStatus?: number;
};

const PUBLIC_PATH = /\/public\/(identity|education|organization|certificate|experience|cv)\/?$/;

async function mockPublicApi(page: Page, opts: MockOptions = {}) {
  const data = { ...clone(FIXTURES), ...(opts.data ?? {}) } as Record<Endpoint, unknown>;
  const calls: Record<Endpoint, number> = {
    identity: 0,
    education: 0,
    organization: 0,
    certificate: 0,
    experience: 0,
    cv: 0,
  };

  await page.route(
    (url) => PUBLIC_PATH.test(url.pathname),
    async (route: Route) => {
      const request = route.request();
      if (!['fetch', 'xhr'].includes(request.resourceType())) return route.fallback();

      const origin = request.headers()['origin'] ?? '*';
      const cors = {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,OPTIONS',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

      const endpoint = new URL(request.url()).pathname.replace(/\/$/, '').split('/').pop() as Endpoint;
      calls[endpoint]++;

      const delay = opts.delayMs?.[endpoint];
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (opts.abort?.includes(endpoint)) return route.abort('failed');

      const status = opts.fail?.[endpoint];
      const body = status ? { message: 'error' } : data[endpoint];
      return route.fulfill({
        status: status ?? 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    },
  );

  // Profile photos (relative /api/uploads/* and the absolute cdn.example.com URL used in tests).
  await page.route(
    (url) => url.pathname.startsWith('/api/uploads/') || url.hostname === 'cdn.example.com',
    (route) =>
      (opts.imageStatus ?? 200) === 200
        ? route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 })
        : route.fulfill({ status: opts.imageStatus! }),
  );

  return { calls };
}

async function openPortfolio(page: Page, opts: MockOptions = {}) {
  const api = await mockPublicApi(page, opts);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /hi, i['’]m/i })).toBeVisible();
  return api;
}

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/* -------------------------------------------------------------------------- */
/*  Locator helpers                                                           */
/* -------------------------------------------------------------------------- */

const section = (page: Page, id: string) => page.locator(`#${id}`);
const cardsIn = (page: Page, id: string) => section(page, id).locator('div.rounded-xl');
const cardOf = (page: Page, id: string, text: string | RegExp) => cardsIn(page, id).filter({ hasText: text });
const navButton = (page: Page, label: string) =>
  page.locator('nav button:visible').filter({ hasText: new RegExp(`^${label}$`) });

/* ========================================================================== */
/*  POSITIVE (mocked data)                                                    */
/* ========================================================================== */

test.describe('Positive: hero, about and navbar', () => {
  test('hero shows name, role, summary and the resume button', async ({ page }) => {
    await openPortfolio(page);

    await expect(page.getByRole('heading', { name: /hi, i['’]m jane doe/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Full Stack Developer' })).toBeVisible();
    // Summary appears in the hero and in the About section.
    await expect(page.getByText('Mock summary: building reliable web applications.')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Download Resume' })).toBeVisible();
  });

  test('navbar brand shows the name followed by a dot', async ({ page }) => {
    await openPortfolio(page);
    await expect(page.locator('nav button').first()).toHaveText('Jane Doe.');
  });

  test('every main section and heading exists', async ({ page }) => {
    await openPortfolio(page);

    for (const [id, title] of [
      ['about', 'About Me'],
      ['skills', 'My Skills'],
      ['education', 'Education'],
      ['organization', 'Organization'],
      ['certificate', 'Certificates'],
      ['experience', 'Experience'],
    ]) {
      await expect(section(page, id)).toBeAttached();
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeAttached();
    }
  });

  test('about section shows name and contact details', async ({ page }) => {
    await openPortfolio(page);
    const about = section(page, 'about');

    await expect(about.getByRole('heading', { name: /i['’]m jane doe/i })).toBeVisible();
    await expect(about.getByText('jane@example.com', { exact: true })).toBeVisible();
    await expect(about.getByText('+62 812-3456-7890', { exact: true })).toBeVisible();
    await expect(about.getByText('Jakarta, Indonesia', { exact: true })).toBeVisible();
  });

  test('social and mail links point to the identity data', async ({ page }) => {
    await openPortfolio(page);

    for (const [label, href] of [
      ['GitHub', 'https://github.com/janedoe'],
      ['LinkedIn', 'https://linkedin.com/in/janedoe'],
      ['Instagram', 'https://instagram.com/janedoe'],
    ]) {
      const link = page.getByRole('link', { name: label });
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute('href', href);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }

    await expect(page.locator('a[href^="mailto:"]')).toHaveAttribute('href', 'mailto:jane@example.com');
  });

  test('relative photo path is served from /api/uploads', async ({ page }) => {
    await openPortfolio(page, { data: { identity: { ...(FIXTURES.identity as object), photo: 'me.png' } } });

    const photos = page.locator('img[alt="Jane Doe"]');
    await expect(photos).toHaveCount(2); // hero + about
    await expect(photos.first()).toHaveAttribute('src', '/api/uploads/me.png');
    await expect(photos.last()).toHaveAttribute('src', '/api/uploads/me.png');
  });

  test('absolute photo URL is used as-is', async ({ page }) => {
    await openPortfolio(page, {
      data: { identity: { ...(FIXTURES.identity as object), photo: 'https://cdn.example.com/me.png' } },
    });
    await expect(page.locator('img[alt="Jane Doe"]').first()).toHaveAttribute('src', 'https://cdn.example.com/me.png');
  });

  test('without a photo the first letter of the name is shown as avatar', async ({ page }) => {
    await openPortfolio(page);
    await expect(page.locator('img[alt="Jane Doe"]')).toHaveCount(0);
    await expect(page.getByText('J', { exact: true })).toHaveCount(2);
  });

  test('footer shows the current year', async ({ page }) => {
    await openPortfolio(page);
    await expect(page.locator('footer')).toContainText(`© ${new Date().getFullYear()} All rights reserved.`);
  });

  test('each public endpoint is requested exactly once and no script errors occur', async ({ page }) => {
    const errors = collectPageErrors(page);
    const api = await openPortfolio(page);

    expect(api.calls).toEqual({
      identity: 1,
      education: 1,
      organization: 1,
      certificate: 1,
      experience: 1,
      cv: 1,
    });
    expect(errors).toEqual([]);
  });
});

test.describe('Positive: skills', () => {
  test('skills are the unique technologies of all experiences', async ({ page }) => {
    await openPortfolio(page);
    const skills = section(page, 'skills');

    await expect(skills.locator('div.rounded-xl')).toHaveCount(6);
    for (const name of ['Go', 'PostgreSQL', 'Docker', 'React', 'Node.js', 'Rust']) {
      await expect(skills.getByText(name, { exact: true })).toHaveCount(1);
    }
  });

  test('known skills get a brand icon, unknown skills get the fallback icon', async ({ page }) => {
    await openPortfolio(page);
    const skills = section(page, 'skills');

    const go = skills.locator('div.rounded-xl').filter({ hasText: /^Go$/ });
    await expect(go.locator('svg')).toHaveAttribute('fill', /^#[0-9a-f]{6}$/i);

    const nodejs = skills.locator('div.rounded-xl').filter({ hasText: /^Node\.js$/ });
    await expect(nodejs.locator('svg')).toHaveAttribute('fill', /^#[0-9a-f]{6}$/i);

    const rust = skills.locator('div.rounded-xl').filter({ hasText: /^Rust$/ });
    await expect(rust.locator('svg')).toHaveClass(/text-black/);
  });
});

test.describe('Positive: education, organization, certificates, experience', () => {
  test('education cards show degree, institution, years and description', async ({ page }) => {
    await openPortfolio(page);

    const finished = cardOf(page, 'education', 'S1 - Informatika');
    await expect(finished.getByText('Universitas Contoh', { exact: true })).toBeVisible();
    await expect(finished.getByText('2018 - 2022', { exact: true })).toBeVisible();
    const description = finished.locator('p').filter({ hasText: 'Line one' });
    await expect(description).toContainText('Line two');
    await expect(description).toHaveCSS('white-space', 'pre-line');

    const ongoing = cardOf(page, 'education', 'S2 - Teknik Komputer');
    await expect(ongoing.getByText('2023 - Sekarang', { exact: true })).toBeVisible();
  });

  test('organization cards show name, position and years', async ({ page }) => {
    await openPortfolio(page);
    const card = cardOf(page, 'organization', 'Himpunan Mahasiswa Informatika');

    await expect(card.getByText('Ketua Divisi', { exact: true })).toBeVisible();
    await expect(card.getByText('2019 - 2020', { exact: true })).toBeVisible();
    await expect(card.getByText('Mengelola kegiatan divisi.', { exact: true })).toBeVisible();
  });

  test('certificate with URL shows type badge, date, tags, credential id and an external link', async ({ page }) => {
    await openPortfolio(page);
    const card = cardOf(page, 'certificate', 'AWS Cloud Practitioner');

    await expect(card.getByText('Amazon Web Services', { exact: true })).toBeVisible();
    await expect(card.getByText('Sertifikat', { exact: true })).toBeVisible();
    await expect(card).toContainText(/2023/);
    await expect(card.getByText('AWS', { exact: true })).toBeVisible();
    await expect(card.getByText('Cloud', { exact: true })).toBeVisible();
    await expect(card.getByText('ID: ABC-123', { exact: true })).toBeVisible();

    const link = card.locator('a');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('href', 'https://example.com/cert/aws');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('training without URL has the "Pelatihan" badge, no link and no credential id', async ({ page }) => {
    await openPortfolio(page);
    const card = cardOf(page, 'certificate', 'Bootcamp Fullstack');

    await expect(card.getByText('Pelatihan', { exact: true })).toBeVisible();
    await expect(card.locator('a')).toHaveCount(0);
    await expect(card.getByText(/^ID:/)).toHaveCount(0);
  });

  test('only certificates with a URL render an external link', async ({ page }) => {
    await openPortfolio(page);
    await expect(section(page, 'certificate').locator('a[target="_blank"]')).toHaveCount(1);
  });

  test('experience cards show position, company, period, description and technologies', async ({ page }) => {
    await openPortfolio(page);

    const ongoing = cardOf(page, 'experience', 'Backend Engineer');
    await expect(ongoing.getByText('Acme Corp', { exact: true })).toBeVisible();
    await expect(ongoing).toContainText(/2022 - Sekarang/);
    await expect(ongoing.locator('p').filter({ hasText: 'Built APIs.' })).toHaveCSS('white-space', 'pre-line');
    for (const tech of ['Go', 'PostgreSQL', 'Docker']) {
      await expect(ongoing.getByText(tech, { exact: true })).toBeVisible();
    }

    const finished = cardOf(page, 'experience', 'Frontend Developer');
    await expect(finished).toContainText(/2020 - .*2022/);
    await expect(finished).not.toContainText('Sekarang');
  });

  test('experience without description or technologies still renders', async ({ page }) => {
    await openPortfolio(page, {
      data: {
        experience: [
          {
            id: 9,
            company: 'Bare Co',
            position: 'Minimalist',
            startDate: iso('2021-05-15'),
            endDate: iso('2021-09-15'),
            description: null,
            technologies: [],
          },
        ],
      },
    });

    const card = cardOf(page, 'experience', 'Minimalist');
    await expect(card.getByText('Bare Co', { exact: true })).toBeVisible();
    await expect(card.locator('span.rounded-md')).toHaveCount(0);
  });
});

test.describe('Positive: navigation and scrolling', () => {
  test('desktop navigation scrolls to each section and highlights the active item', async ({ page }) => {
    await openPortfolio(page);

    for (const [id, label] of NAV) {
      const button = navButton(page, label);
      await expect(button).toHaveCount(1);
      await button.click();

      await expect(section(page, id)).toBeInViewport();
      await expect(button).toHaveClass(ACTIVE_CLASS);
    }
  });

  test('only one navigation item is highlighted at a time', async ({ page }) => {
    await openPortfolio(page);
    await navButton(page, 'Education').click();
    await expect(navButton(page, 'Education')).toHaveClass(ACTIVE_CLASS);

    for (const [, label] of NAV.filter(([, l]) => l !== 'Education')) {
      await expect(navButton(page, label)).not.toHaveClass(ACTIVE_CLASS);
    }
  });

  test('navigation works with the keyboard', async ({ page }) => {
    await openPortfolio(page);
    await navButton(page, 'Skills').focus();
    await page.keyboard.press('Enter');

    await expect(section(page, 'skills')).toBeInViewport();
  });

  test('clicking the brand scrolls back to the top', async ({ page }) => {
    await openPortfolio(page);
    await navButton(page, 'Experience').click();
    await expect(section(page, 'experience')).toBeInViewport();

    await page.locator('nav button').first().click();
    await expect(section(page, 'home')).toBeInViewport();
  });

  test('sections reveal on scroll', async ({ page }) => {
    await openPortfolio(page);
    const lastCard = page.locator('#experience .reveal').last();

    await expect(lastCard).not.toHaveClass(/reveal-visible/);
    await section(page, 'experience').scrollIntoViewIfNeeded();
    await expect(lastCard).toHaveClass(/reveal-visible/);
  });

  test('with reduced motion everything is visible immediately', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openPortfolio(page);

    await expect(page.locator('.reveal').first()).toBeAttached();
    await expect(page.locator('.reveal:not(.reveal-visible)')).toHaveCount(0);
  });
});

/* ========================================================================== */
/*  NEGATIVE (mocked data)                                                    */
/* ========================================================================== */

test.describe('Negative: empty data', () => {
  for (const key of ['education', 'organization', 'certificate', 'experience'] as const) {
    test(`empty ${key} shows its fallback message and other sections still render`, async ({ page }) => {
      await openPortfolio(page, { data: { [key]: [] } });

      await expect(section(page, key).getByText(FALLBACK_TEXT[key], { exact: true })).toBeVisible();
      await expect(section(page, key).locator('div.rounded-xl')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: /hi, i['’]m jane doe/i })).toBeVisible();
    });
  }

  test('empty experience also empties the derived skills section', async ({ page }) => {
    await openPortfolio(page, { data: { experience: [] } });
    await expect(section(page, 'skills').getByText(FALLBACK_TEXT.skills, { exact: true })).toBeVisible();
  });

  test('experience without technologies shows the skills fallback but keeps the experience cards', async ({ page }) => {
    const experiences = (clone(FIXTURES.experience) as any[]).map((e) => ({ ...e, technologies: [] }));
    await openPortfolio(page, { data: { experience: experiences } });

    await expect(section(page, 'skills').getByText(FALLBACK_TEXT.skills, { exact: true })).toBeVisible();
    await expect(cardsIn(page, 'experience')).toHaveCount(3);
  });

  test('no identity and no CV data falls back to default texts', async ({ page }) => {
    await openPortfolio(page, { data: { identity: null, cv: null } });

    await expect(page.getByRole('heading', { name: /hi, i['’]m developer/i })).toBeVisible();
    await expect(page.locator('nav button').first()).toHaveText('Portfolio.');
    await expect(page.getByText(/crafting modern, responsive, and user-friendly websites/i)).toHaveCount(1);
    await expect(page.getByText(/a software developer focused on building modern web applications/i)).toBeVisible();
    await expect(page.getByText('D', { exact: true })).toHaveCount(2);

    for (const label of ['GitHub', 'LinkedIn', 'Instagram']) {
      await expect(page.getByRole('link', { name: label })).toHaveCount(0);
    }
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  });

  test('partial identity only renders the links and contact rows that exist', async ({ page }) => {
    await openPortfolio(page, {
      data: {
        identity: {
          id: 1,
          name: 'Solo Dev',
          email: null,
          phone: null,
          address: null,
          githubUrl: 'https://github.com/solo',
          linkedinUrl: null,
          instagramUrl: null,
          photo: null,
        },
      },
    });

    await expect(page.getByRole('link', { name: 'GitHub' })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'LinkedIn' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Instagram' })).toHaveCount(0);
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
    await expect(section(page, 'about').locator('p.flex.items-center')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/\bnull\b|\bundefined\b/);
  });

  test('null optional fields do not crash the page', async ({ page }) => {
    const errors = collectPageErrors(page);
    await openPortfolio(page, {
      data: {
        education: [
          {
            id: 1,
            institution: 'X',
            degree: 'D3',
            field: 'Y',
            startDate: iso('2018-06-15'),
            endDate: null,
            description: null,
          },
        ],
        certificate: [
          {
            id: 1,
            name: 'Null Cert',
            issuer: 'Nobody',
            type: 'training',
            issueDate: iso('2022-06-15'),
            url: null,
            technologies: null,
            credentialId: null,
          },
        ],
        experience: [
          {
            id: 1,
            company: 'Null Co',
            position: 'Null Role',
            startDate: iso('2022-06-15'),
            endDate: null,
            description: null,
            technologies: null,
          },
        ],
      },
    });

    await expect(cardOf(page, 'certificate', 'Null Cert')).toBeVisible();
    await expect(cardOf(page, 'experience', 'Null Role')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Negative: API failures', () => {
  test('one failing endpoint only affects its own section', async ({ page }) => {
    const errors = collectPageErrors(page);
    await openPortfolio(page, { fail: { experience: 500 } });

    await expect(section(page, 'experience').getByText(FALLBACK_TEXT.experience, { exact: true })).toBeVisible();
    await expect(section(page, 'skills').getByText(FALLBACK_TEXT.skills, { exact: true })).toBeVisible();
    await expect(cardsIn(page, 'education')).toHaveCount(2);
    await expect(cardsIn(page, 'certificate')).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test('all endpoints returning 500 still renders the page with fallbacks', async ({ page }) => {
    const errors = collectPageErrors(page);
    await openPortfolio(page, {
      fail: { identity: 500, cv: 500, education: 500, organization: 500, certificate: 500, experience: 500 },
    });

    await expect(page.getByRole('heading', { name: /hi, i['’]m developer/i })).toBeVisible();
    for (const [id, text] of Object.entries(FALLBACK_TEXT)) {
      await expect(section(page, id).getByText(text, { exact: true })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('network failure on every endpoint does not crash the page', async ({ page }) => {
    const errors = collectPageErrors(page);
    await openPortfolio(page, {
      abort: ['identity', 'cv', 'education', 'organization', 'certificate', 'experience'],
    });

    await expect(page.getByRole('heading', { name: 'Full Stack Developer' })).toBeVisible();
    await expect(section(page, 'skills').getByText(FALLBACK_TEXT.skills, { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('slow identity request: defaults first, real data once it arrives', async ({ page }) => {
    await openPortfolio(page, { delayMs: { identity: 1500 } });

    await expect(page.getByRole('heading', { name: /hi, i['’]m developer/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /hi, i['’]m jane doe/i })).toBeVisible({ timeout: 8000 });
  });

  test('Download Resume without identity/CV data does nothing and does not crash', async ({ page }) => {
    const errors = collectPageErrors(page);
    await openPortfolio(page, { data: { identity: null, cv: null } });

    const download = page.waitForEvent('download', { timeout: 1500 }).catch(() => null);
    await page.getByRole('button', { name: 'Download Resume' }).click();

    expect(await download).toBeNull();
    await expect(page).toHaveURL(/\/$/);
    expect(errors).toEqual([]);
  });

  test('broken profile photo falls back to the avatar letter', async ({ page }) => {
    test.fail(true, 'Known gap: <img> has no onError fallback, a 404 photo shows a broken image');
    await openPortfolio(page, {
      imageStatus: 404,
      data: { identity: { ...(FIXTURES.identity as object), photo: 'missing.png' } },
    });

    await expect(page.getByText('J', { exact: true }).first()).toBeVisible();
  });
});

test.describe('Negative: hostile and extreme data', () => {
  test('HTML/script in data is rendered as text and never executed', async ({ page }) => {
    let dialogFired = false;
    page.on('dialog', async (d) => {
      dialogFired = true;
      await d.dismiss();
    });

    const xssName = '<img src=x onerror=alert(1)>';
    await openPortfolio(page, {
      data: {
        identity: { ...(FIXTURES.identity as object), name: xssName },
        experience: [
          {
            id: 1,
            company: '<script>alert(2)</script>',
            position: '<svg onload=alert(3)>',
            startDate: iso('2022-06-15'),
            endDate: null,
            description: '<b>bold?</b>',
            technologies: ['<i>italic</i>'],
          },
        ],
      },
    });

    await expect(page.getByText('<script>alert(2)</script>', { exact: true })).toBeVisible();
    await expect(page.getByText('<svg onload=alert(3)>', { exact: true })).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    await expect(page.locator('#experience b, #experience i')).toHaveCount(0);
    expect(dialogFired).toBe(false);
  });

  test('a very long unbroken position title stays inside its card', async ({ page }) => {
    await openPortfolio(page, {
      data: {
        experience: [
          {
            id: 1,
            company: 'Long Co',
            position: 'A'.repeat(300),
            startDate: iso('2022-06-15'),
            endDate: null,
            description: 'x',
            technologies: ['Go'],
          },
        ],
      },
    });

    const heading = cardsIn(page, 'experience').first().getByRole('heading', { level: 3 });
    const overflows = await heading.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflows).toBe(false);
  });

  test('skills that differ only by letter case are not duplicated', async ({ page }) => {
    test.fail(true, 'Known gap: skills are de-duplicated by exact string, so "Go"/"go"/"GO" appear 3 times');
    await openPortfolio(page, {
      data: {
        experience: [
          {
            id: 1,
            company: 'Case Co',
            position: 'Dev',
            startDate: iso('2022-06-15'),
            endDate: null,
            description: null,
            technologies: ['Go', 'go', 'GO'],
          },
        ],
      },
    });

    await expect(section(page, 'skills').locator('div.rounded-xl')).toHaveCount(1);
  });
});

test.describe('Negative: security and accessibility', () => {
  test('the public page does not expose any admin link', async ({ page }) => {
    await openPortfolio(page);

    await expect(page.locator('a[href*="/admin"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /admin|login/i })).toHaveCount(0);
  });

  test('icon-only links have an accessible name', async ({ page }) => {
    test.fail(true, 'Known gap: the mail icon link and certificate external links have no aria-label');
    await openPortfolio(page);

    await expect(page.locator('a[href^="mailto:"]').first()).toHaveAccessibleName(/\S/);
    await expect(page.locator('#certificate a[target="_blank"]').first()).toHaveAccessibleName(/\S/);
  });

  test('skill labels are readable against the dark card background', async ({ page }) => {
    test.fail(true, 'Known gap: SkillDots uses text-black on a near-black card (contrast ~1.1:1)');
    await openPortfolio(page);

    const color = await section(page, 'skills')
      .locator('div.rounded-xl span')
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = (color.match(/\d+/g) ?? ['0', '0', '0']).map(Number);

    const lum = (R: number, G: number, B: number) => {
      const f = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(R) + 0.7152 * f(G) + 0.0722 * f(B);
    };
    const text = lum(r, g, b);
    const background = lum(16, 16, 18); // #09090b with the card's 3% white overlay
    const ratio = (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);

    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe('Negative: mobile viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('desktop navigation and navbar resume button are hidden', async ({ page }) => {
    await openPortfolio(page);

    await expect(navButton(page, 'Skills')).toHaveCount(0);
    await expect(page.locator('nav').getByRole('button', { name: 'Resume', exact: true })).toBeHidden();
    await expect(page.locator('nav button').first()).toBeVisible();
  });

  test('hero resume button and hero photo are still available', async ({ page }) => {
    await openPortfolio(page, { data: { identity: { ...(FIXTURES.identity as object), photo: 'me.png' } } });

    await expect(page.getByRole('button', { name: 'Download Resume' })).toBeVisible();
    await expect(page.locator('#home img[alt="Jane Doe"]')).toBeVisible();
    await expect(page.locator('#about img[alt="Jane Doe"]')).toBeHidden();
  });

  test('page has no horizontal scroll', async ({ page }) => {
    await openPortfolio(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test('mobile users have a way to navigate between sections', async ({ page }) => {
    test.fail(true, 'Known gap: nav links are "hidden md:flex" and there is no hamburger/menu on mobile');
    await openPortfolio(page);

    await expect(page.getByRole('button', { name: /menu|navigation|navigasi/i })).toBeVisible();
  });
});

/* ========================================================================== */
/*  REAL BACKEND SMOKE (adapts to whatever data exists)                       */
/* ========================================================================== */

async function gotoPortfolioReal(page: Page) {
  const identityResponse = page.waitForResponse((r) => r.url().endsWith('/api/public/identity'));
  const cvResponse = page.waitForResponse((r) => r.url().endsWith('/api/public/cv'));
  const certificateResponse = page.waitForResponse((r) => r.url().endsWith('/api/public/certificate'));

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const [identity, cv, certificate] = await Promise.all([identityResponse, cvResponse, certificateResponse]);
  const identityData = identity.ok() ? await identity.json() : null;
  const cvData = cv.ok() ? await cv.json() : null;
  const certificates = certificate.ok() ? await certificate.json() : [];

  return {
    hasResumeData: Boolean(identityData && cvData),
    email: identityData?.email ?? null,
    socialLinks: {
      github: identityData?.githubUrl ?? null,
      linkedin: identityData?.linkedinUrl ?? null,
      instagram: identityData?.instagramUrl ?? null,
    },
    certificates: certificates as Array<{ url?: string | null }>,
  };
}

async function expectResumeDownload(page: Page, button: Locator, hasResumeData: boolean) {
  if (hasResumeData) {
    const downloadPromise = page.waitForEvent('download');
    await button.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^CV_.*\.pdf$/);
  } else {
    await button.click();
    await expect(page).toHaveURL(/\/$/);
  }
}

test.describe('Real backend smoke', () => {
  test('portfolio loads without script errors', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/', { waitUntil: 'networkidle' });

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: /hi, i['’]m/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('hero resume button downloads a CV_*.pdf when resume data exists', async ({ page }) => {
    const { hasResumeData } = await gotoPortfolioReal(page);
    const button = page.getByRole('button', { name: 'Download Resume' });

    await expect(button).toBeVisible();
    await expectResumeDownload(page, button, hasResumeData);
  });

  test('navbar resume button downloads a CV_*.pdf when resume data exists', async ({ page }) => {
    const { hasResumeData } = await gotoPortfolioReal(page);
    const button = page.locator('nav').getByRole('button', { name: 'Resume', exact: true });
    test.skip(!(await button.isVisible()), 'Navbar resume button is hidden at this viewport');

    await expectResumeDownload(page, button, hasResumeData);
  });

  test('social and contact links match the identity API data', async ({ page }) => {
    const { email, socialLinks } = await gotoPortfolioReal(page);

    for (const [label, href] of [
      ['GitHub', socialLinks.github],
      ['LinkedIn', socialLinks.linkedin],
      ['Instagram', socialLinks.instagram],
    ] as const) {
      const link = page.getByRole('link', { name: label });
      if (href) {
        await expect(link).toHaveCount(1);
        await expect(link).toHaveAttribute('href', href);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      } else {
        await expect(link).toHaveCount(0);
      }
    }

    const mailLink = page.locator('a[href^="mailto:"]');
    if (email) {
      await expect(mailLink).toHaveAttribute('href', `mailto:${email}`);
    } else {
      await expect(mailLink).toHaveCount(0);
    }
  });

  test('certificate links match the certificate API data', async ({ page }) => {
    const { certificates } = await gotoPortfolioReal(page);
    const withUrls = certificates.filter((c) => c.url);
    const certificateSection = section(page, 'certificate');

    await expect(certificateSection.locator('a[target="_blank"]')).toHaveCount(withUrls.length);
    for (const certificate of withUrls) {
      const link = certificateSection.locator(`a[href="${certificate.url}"]`);
      await expect(link.first()).toBeVisible();
      await expect(link.first()).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  test('navigation reaches every section on the real page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    for (const [id, label] of NAV) {
      const button = navButton(page, label);
      test.skip((await button.count()) === 0, 'Desktop navigation is hidden at this viewport');
      await button.click();
      await expect(section(page, id)).toBeInViewport();
    }
  });
});