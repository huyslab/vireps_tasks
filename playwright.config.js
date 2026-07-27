// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Devices under test, grouped by category. Names must match Playwright's built-in
 * device descriptors exactly (run `npx playwright list-devices` in doubt). Phones and
 * tablets get both portrait and landscape projects so the orientation-gate tests can
 * check both directions (vigour prefers portrait, reversal prefers landscape); desktop
 * has no orientation concept and no touch, so a single project is enough.
 *
 * Phones are the primary focus (mirrors the actual participant device mix), tablets and
 * desktop are secondary coverage.
 */
const PHONES = [
  'iPhone SE (3rd gen)', // small/no-notch iPhone still in common use
  'iPhone 14',           // mainstream notch iPhone
  'iPhone 15 Pro Max',   // large iPhone with Dynamic Island
  'Pixel 7',             // mainstream Android
  'Galaxy S24',          // flagship Samsung Android
  'Galaxy A55',          // mid-range Samsung Android (very common globally)
];

const TABLETS = [
  'iPad Mini',
  'iPad Pro 11',
  'Galaxy Tab S9',
];

const DESKTOPS = [
  'Desktop Chrome',
  'Desktop Safari',
  'Desktop Firefox',
];

// Broad, fast rendering matrix - simulate-mode driven, see support/render-check.js.
const deviceProjects = [
  ...PHONES.flatMap((name) => [name, `${name} landscape`]),
  ...TABLETS.flatMap((name) => [name, `${name} landscape`]),
  ...DESKTOPS,
].map((name) => ({
  name,
  use: { ...devices[name] },
  testMatch: /.*-rendering\.spec\.js$/,
}));

/**
 * Small curated subset for the real-interaction "journey" checks (instructions text +
 * in-task feedback/coins - see support/journey-check.js). These drive real clicks/taps/
 * keypresses through the actual instructions flow, which is slower and more per-device-flow
 * -specific than the simulate-mode rendering matrix above, so it isn't run on all 21 devices:
 * one small iPhone (touch/webkit), one Android (touch/chromium), one tablet (touch/webkit),
 * and both desktop engines (keyboard, no touch - exercises the non-touch instruction wording
 * and arrow-key path).
 */
const JOURNEY_DEVICES = ['iPhone 14', 'Galaxy A55', 'iPad Pro 11', 'Desktop Chrome', 'Desktop Safari'];
const journeyProjects = JOURNEY_DEVICES.map((name) => ({
  name: `${name} (journey)`,
  use: { ...devices[name] },
  testMatch: /.*-journey\.spec\.js$/,
}));

/**
 * Engine- and device-independent invariants about the data we record (see
 * data-properties.spec.js). Nothing here varies by viewport or input modality, so one
 * project is enough - running it across the device matrix would only duplicate work.
 *
 * The pattern is anchored on the path separator, not with ^: testMatch regexes are matched
 * against the ABSOLUTE file path, so /^data-/ anchors to the filesystem root and matches
 * nothing at all. [^\\/]* then keeps "data-" as a filename prefix rather than a substring,
 * so a future metadata-*.spec.js isn't silently pulled into this single-project run.
 */
const dataProjects = [
  {
    name: 'data invariants',
    use: { ...devices['Desktop Chrome'] },
    testMatch: /[\\/](data|go-no-go-audio)-?[^\\/]*\.spec\.js$/,
  },
];

export default defineConfig({
  testDir: './validation/playwright',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },

  projects: [...deviceProjects, ...journeyProjects, ...dataProjects],

  /* Serves the repo root statically - required since the app resolves absolute
     paths (/core, /tasks, /assets) and import maps against the server root. */
  webServer: {
    command: 'python3 -m http.server 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
