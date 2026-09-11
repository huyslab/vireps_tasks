import { expect, test } from '@playwright/test';

/**
 * The installable-web-app manifest.
 *
 * The study tablet runs sessions from a home-screen icon rather than a browser tab:
 * launched that way the session opens with no address bar, tabs or status bar, which
 * is the only route to a genuinely full-screen session (nothing in the battery calls
 * the Fullscreen API, and Chrome on Android offers no manual way to force it).
 *
 * That depends on Chrome accepting the manifest as installable, which in turn depends
 * on details that are easy to break silently by moving a file: a linked manifest,
 * 192px and 512px icons that actually exist, and a display mode that hides browser UI.
 * A broken manifest does not fail loudly - the icon just quietly starts opening in a
 * tab again, mid-study.
 */

const ENTRY_PAGES = ['/index.html', '/experiment.html', '/device-enrollment.html'];

test('every entry page links the manifest', async ({ page }) => {
  for (const entry of ENTRY_PAGES) {
    await page.goto(entry);
    await expect(
      page.locator('link[rel=manifest]'),
      `${entry} should link the manifest, or launching it from the home screen falls back to a tab`
    ).toHaveCount(1);
    await expect(page.locator('meta[name=theme-color]')).toHaveCount(1);
  }
});

test('the manifest is installable and hides browser UI', async ({ page }) => {
  await page.goto('/index.html');
  const response = await page.request.get('/manifest.json');
  expect(response.status(), 'manifest should be served').toBe(200);

  const manifest = await response.json();

  expect(manifest.name, 'an installable app needs a name').toBeTruthy();
  expect(manifest.short_name, 'the home-screen label').toBeTruthy();
  expect(manifest.start_url, 'the page the icon opens').toBeTruthy();

  // Nothing weaker than fullscreen will do. 'standalone' still shows the status bar
  // and 'minimal-ui' still shows navigation controls, so both would pass a
  // "hides the address bar" check while breaking the promise this PR actually makes -
  // that the participant sees no browser or system furniture at all.
  //
  // display_override takes precedence over display, and its FIRST supported entry is
  // what the browser uses, so that is the value to assert. display is checked too, as
  // the fallback for browsers that ignore display_override.
  const effectiveDisplay = manifest.display_override?.[0] ?? manifest.display;
  expect(
    effectiveDisplay,
    'the effective display mode must be fullscreen, or sessions are not fully immersive'
  ).toBe('fullscreen');
  expect(
    manifest.display,
    'display is the fallback where display_override is unsupported, so it must be fullscreen too'
  ).toBe('fullscreen');

  // Relative so the app keeps working under the /vireps_tasks/ Pages subpath.
  expect(manifest.start_url.startsWith('./'), 'start_url must be relative to survive the Pages subpath').toBe(true);
  expect(manifest.scope.startsWith('./'), 'scope must be relative to survive the Pages subpath').toBe(true);

  // Tasks disagree about orientation - vigour wants portrait, most want landscape -
  // and the app gates it per task. Locking it here would fight that.
  expect(manifest.orientation, 'the manifest must not lock orientation').toBeUndefined();
});

test('the manifest icons exist at the paths it claims', async ({ page }) => {
  await page.goto('/index.html');
  const manifest = await (await page.request.get('/manifest.json')).json();

  // Sized AND usable as a normal icon. Checking sizes alone is not enough: a maskable
  // icon is also 512x512, so it satisfies a naive size check while leaving Chrome with
  // no general-purpose icon of that size at all.
  const purposesOf = (icon) => (icon.purpose || 'any').split(/\s+/);
  const anyIcons = manifest.icons.filter((icon) => purposesOf(icon).includes('any'));
  expect(
    anyIcons.map((icon) => icon.sizes),
    'Chrome requires a general-purpose 192px icon to offer an install'
  ).toContain('192x192');
  expect(
    anyIcons.map((icon) => icon.sizes),
    'Chrome requires a general-purpose 512px icon to offer an install'
  ).toContain('512x512');
  expect(
    manifest.icons.some((icon) => purposesOf(icon).includes('maskable')),
    'without a maskable icon Android crops the adaptive icon badly'
  ).toBe(true);

  for (const icon of manifest.icons) {
    const iconResponse = await page.request.get(icon.src.replace(/^\.\//, '/'));
    expect(iconResponse.status(), `${icon.src} is referenced by the manifest but missing`).toBe(200);
    expect(iconResponse.headers()['content-type']).toContain('image/png');
  }
});
