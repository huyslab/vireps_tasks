import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { ACCURACY, N_PARTICIPANTS, SESSION_NUMBER, TASKS, simDataFilename } from '../sim-data-config.js';

/**
 * Generates simulated datasets for the analysis checks in validation/analysis/.
 *
 * Each task runs through experiment.html in jsPsych's visual simulate mode with a
 * biased simulated participant (sim_accuracy: the probability of the optimal / correct
 * response), so learning curves and condition effects show up in the plots. The full
 * jsPsych data (as saved to REDCap, minus `stimulus`) is written to the run directory
 * supplied by npm run sim:data. The R analysis reads the latest complete run.
 *
 * Run with: npm run sim:data   (then npm run sim:analyse)
 */

const OUT_DIR = process.env.SIM_DATA_DIR;

test.describe.configure({ mode: 'parallel' });

for (const { task, mainPhase } of TASKS) {
  for (let k = 1; k <= N_PARTICIPANTS; k++) {
    test(`simulate ${task} participant ${k}`, async ({ page }) => {
      test.setTimeout(10 * 60 * 1000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      // An unapproved device runs in demo mode, so nothing is queued or sent.
      await page.addInitScript(() => {
        window.__redcapDeviceStatusForTesting = { approved: false, reason: 'not-approved' };
      });
      await page.goto(
        `/experiment.html?task=${task}&participant_id=simulate_sim${k}` +
          `&session_number=${SESSION_NUMBER}&sim_accuracy=${ACCURACY}`
      );
      const demoContinue = page.locator('#demo-mode-continue');
      await demoContinue.waitFor({ state: 'visible', timeout: 30000 });
      await demoContinue.click();

      await expect
        .poll(() => page.evaluate(() => window.__simulationDone === true), {
          timeout: 9 * 60 * 1000,
          intervals: [2000],
        })
        .toBe(true);

      const trials = await page.evaluate(() => window.jsPsych.data.get().ignore('stimulus').values());
      expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
      const main = trials.filter((t) => t.trialphase === mainPhase);
      expect(main.length, `${task} recorded ${mainPhase} trials`).toBeGreaterThan(0);

      if (task === 'post_PILT_test') {
        expect(main.some(t => t.block === 'pavlovian'), 'Pavlovian trials ran').toBe(true);
        const preload = trials.find(t => t.trial_type === 'preload');
        expect(preload, 'PILT test preloaded the instrumental and Pavlovian images').toMatchObject({
          success: true,
          failed_images: [],
        });
      }

      if (task === 'go_no_go') {
        const responses = new Set(main.map((t) => t.response));
        expect(responses, 'simulated GNG presses on some trials').toContain('go');
        expect(responses, 'simulated GNG withholds on some trials').toContain('nogo');
      }

      if (OUT_DIR) {
        fs.writeFileSync(
          path.join(OUT_DIR, simDataFilename(task, k)),
          JSON.stringify({ task, participant: k, sim_accuracy: ACCURACY, session_number: SESSION_NUMBER, trials })
        );
      }
    });
  }
}
