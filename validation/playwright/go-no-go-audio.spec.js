import { expect, test } from '@playwright/test';

/**
 * Outcome sounds must play on EVERY trial, not just the first use of each file.
 *
 * jsPsych caches one AudioPlayer per source and, under Web Audio, play() calls
 * start() on an AudioBufferSourceNode - which may only be started once. Without
 * resetting the node the second use throws InvalidStateError, which the plugin
 * swallows, and the sound is silently never heard again. That is invisible in a
 * screenshot and easy to reintroduce, so it is asserted here.
 */
test('outcome sounds replay on every trial', async ({ page }) => {
  await page.addInitScript(() => {
    window.__audioLog = [];
    const poll = setInterval(() => {
      if (!window.jsPsych?.pluginAPI?.getAudioPlayer) return;
      clearInterval(poll);
      const original = window.jsPsych.pluginAPI.getAudioPlayer.bind(window.jsPsych.pluginAPI);
      const wrapped = new WeakSet();
      window.jsPsych.pluginAPI.getAudioPlayer = async (src) => {
        const player = await original(src);
        if (!wrapped.has(player)) {
          wrapped.add(player);
          const play = player.play.bind(player);
          player.play = () => {
            try {
              play();
              window.__audioLog.push({
                file: new URL(src, window.location.href).pathname.split('/').pop(),
                ok: true
              });
            } catch (error) {
              window.__audioLog.push({
                file: new URL(src, window.location.href).pathname.split('/').pop(),
                ok: false,
                error: error.name
              });
            }
          };
        }
        return player;
      };
    }, 30);
  });

  await page.goto('/examples/go-no-go.html?participant_id=debug_audio&skip_instructions=1');
  await page.locator('#gng-stimulus').waitFor({ timeout: 30000 });

  // Respond on several consecutive trials so at least one sound is used twice.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press(' ').catch(() => {});
    await page.waitForTimeout(2600);
  }

  const log = await page.evaluate(() => window.__audioLog);
  const failures = log.filter((entry) => !entry.ok);
  const repeats = log.length - new Set(log.map((entry) => entry.file)).size;
  const playedFiles = new Set(log.map((entry) => entry.file));

  expect(log.length, 'a sound should play on each trial').toBeGreaterThanOrEqual(5);
  expect(repeats, 'at least one sound should have been used more than once').toBeGreaterThan(0);
  expect([...playedFiles], 'both avoid-loss outcomes should select their sound').toEqual(
    expect.arrayContaining(['loss_small.mp3', 'loss_large.mp3'])
  );
  expect(failures, `playback failed: ${JSON.stringify(failures)}`).toEqual([]);
});

test('avoid-loss sounds have enough level for tablet speakers', async ({ page }) => {
  await page.goto('/index.html');

  const levels = await page.evaluate(async () => {
    const context = new AudioContext();
    const result = {};

    for (const file of ['loss_small.mp3', 'loss_large.mp3']) {
      const response = await fetch(`/assets/sounds/go-no-go/${file}`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      const samples = buffer.getChannelData(0);
      let sumSquares = 0;
      let peak = 0;
      for (const sample of samples) {
        const magnitude = Math.abs(sample);
        peak = Math.max(peak, magnitude);
        sumSquares += sample * sample;
      }
      result[file] = {
        peak,
        rms: Math.sqrt(sumSquares / samples.length)
      };
    }

    await context.close();
    return result;
  });

  for (const [file, level] of Object.entries(levels)) {
    expect(level.peak, `${file} peak level is too quiet`).toBeGreaterThan(0.25);
    expect(level.rms, `${file} average level is too quiet`).toBeGreaterThan(0.12);
  }
});
