import { test, expect, type Locator, type Page } from '@playwright/test';

async function gotoPortfolio(page: Page) {
  const identityResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/public/identity'),
  );
  const cvResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/public/cv'),
  );
  const certificateResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/public/certificate'),
  );

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const [identity, cv, certificate] = await Promise.all([
    identityResponse,
    cvResponse,
    certificateResponse,
  ]);
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
    certificates,
  };
}

async function expectResumeDownload(
  page: Page,
  button: Locator,
  hasResumeData: boolean,
) {
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

test.describe('Public Portfolio', () => {
  test('public portfolio page loads', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('public portfolio shows the hero and main sections', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: /hi, i['’']m/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Full Stack Developer' })).toBeVisible();
    await expect(page.getByRole('button', { name: /download resume/i }).last()).toBeVisible();

    for (const section of [
      ['about', 'About Me'],
      ['skills', 'My Skills'],
      ['education', 'Education'],
      ['organization', 'Organization'],
      ['certificate', 'Certificates'],
      ['experience', 'Experience'],
    ]) {
      await expect(page.locator(`#${section[0]}`)).toBeAttached();
      await expect(page.getByRole('heading', { name: section[1] })).toBeAttached();
    }
  });

  test('desktop portfolio navigation scrolls to each section', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    for (const [sectionId, label] of [
      ['home', 'Home'],
      ['about', 'About'],
      ['skills', 'Skills'],
      ['education', 'Education'],
      ['organization', 'Organization'],
      ['certificate', 'Certificates'],
      ['experience', 'Experience'],
    ]) {
      const navigationButton = page.locator('nav button:visible').filter({ hasText: label });

      if (await navigationButton.count() > 0) {
        await navigationButton.click();
        await expect(page.locator(`#${sectionId}`)).toBeInViewport();
      }
    }
  });

  test('hero download resume button can be clicked', async ({ page }) => {
    const { hasResumeData } = await gotoPortfolio(page);
    const button = page.getByRole('button', { name: 'Download Resume' });

    await expect(button).toBeVisible();
    await expectResumeDownload(page, button, hasResumeData);
  });

  test('navbar resume button can be clicked on desktop', async ({ page }) => {
    const { hasResumeData } = await gotoPortfolio(page);
    const button = page.locator('nav').getByRole('button', { name: 'Resume' });

    if (!(await button.isVisible())) {
      test.skip();
    }

    await expectResumeDownload(page, button, hasResumeData);
  });

  test('social and contact links have the expected destinations', async ({ page }) => {
    const { email, socialLinks: identitySocialLinks } = await gotoPortfolio(page);

    const socialLinks = [
      ['GitHub', identitySocialLinks.github],
      ['LinkedIn', identitySocialLinks.linkedin],
      ['Instagram', identitySocialLinks.instagram],
    ];

    for (const [label, href] of socialLinks) {
      const link = page.getByRole('link', { name: label });

      if (href) {
        await expect(link).toHaveCount(1);
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute('href', href);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      } else {
        await expect(link).toHaveCount(0);
      }
    }

    const mailLink = page.locator('a[href^="mailto:"]');
    if (email) {
      await expect(mailLink).toBeVisible();
      await expect(mailLink).toHaveAttribute('href', `mailto:${email}`);
    } else {
      await expect(mailLink).toHaveCount(0);
    }
  });

  test('certificate cards link to their certificate URLs', async ({ page }) => {
    const { certificates } = await gotoPortfolio(page);
    const certificateSection = page.locator('#certificate');
    const certificatesWithUrls = certificates.filter((certificate: { url?: string | null }) => certificate.url);
    const certificateLinks = certificateSection.locator('a[target="_blank"]');

    await expect(certificateLinks).toHaveCount(certificatesWithUrls.length);

    for (const certificate of certificatesWithUrls) {
      const link = certificateSection.locator(`a[href="${certificate.url}"]`);

      await expect(link).toHaveCount(1);
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  test('public portfolio shows the empty skills fallback when no skills are available', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const skillsSection = page.locator('#skills');
    await skillsSection.scrollIntoViewIfNeeded();

    const skillCards = skillsSection.locator('div.border-3');
    if (await skillCards.count() === 0) {
      await expect(skillsSection.getByText('Belum ada data skill.')).toBeVisible();
    }
  });
});
