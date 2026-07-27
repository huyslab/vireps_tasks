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
              window.__audioLog.push({ file: src.split('/').pop(), ok: true });
            } catch (error) {
              window.__audioLog.push({ file: src.split('/').pop(), ok: false, error: error.name });
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

  expect(log.length, 'a sound should play on each trial').toBeGreaterThanOrEqual(5);
  expect(repeats, 'at least one sound should have been used more than once').toBeGreaterThan(0);
  expect(failures, `playback failed: ${JSON.stringify(failures)}`).toEqual([]);
});
