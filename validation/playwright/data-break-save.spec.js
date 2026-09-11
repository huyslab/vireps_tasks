import { expect, test } from '@playwright/test';

/**
 * Module 2's breaks must persist what came before them.
 *
 * Each break follows an acceptability block, and acceptability writes no snapshot of
 * its own - it has no saveDataREDCap or updateState hook. Without a save on entry to
 * the break, those three ratings live only in jsPsych's in-memory data while the
 * participant sits on a screen designed to be sat on: a page killed by Android,
 * refreshed, or closed during the pause would leave nothing containing them in the
 * IndexedDB outbox.
 *
 * The break is the one screen in the module where the participant is invited to stop
 * paying attention, which is exactly when a session is most likely to be interrupted.
 */
test('a break persists the ratings that preceded it', async ({ page }) => {
  // The outbox suppresses storage entirely on localhost (isDevHost), so without this
  // the queue would stay empty whether or not the break saves, and the test would
  // pass for the wrong reason.
  await page.addInitScript(() => { window.__forceOnlineRedcapForTesting = true; });

  // An invalid ID stops experiment.html before it runs a timeline, while still loading
  // the import map, jsPsych, and the API - so the break trial can be built and fired
  // in isolation rather than by playing 40 minutes of Module 2 to reach one.
  await page.goto('/experiment.html?participant_id=invalid%20participant');

  const result = await page.evaluate(async () => {
    const { getMessage } = await import(`/api/utils.js?v=${Date.now()}`);
    const { getPendingCount, listQueuedRecords } = await import(`/core/utils/data-queue.js?v=${Date.now()}`);

    // Enough context for a snapshot to be built and addressed.
    window.participantID = 'break_save_check';
    window.module_start_time = '2026-01-01 00:00:00';
    window.session = 'wk0';
    window.module = 'module_2';

    // Stand in for the acceptability block that always precedes a break.
    jsPsych.data.get().push({
      trial_type: 'self-report-item',
      trialphase: 'acceptability_PILT',
      item_id: 'PILT_difficulty',
      response: 2,
    });

    const before = await getPendingCount();
    const breakTrial = getMessage('module_2', 'break_message', { session: 'wk0' });
    if (typeof breakTrial.on_start !== 'function') {
      return { error: 'the break trial has no on_start hook, so nothing is saved when it opens' };
    }

    breakTrial.on_start();
    // The save is async; give the outbox write a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const after = await getPendingCount();
    const queued = await listQueuedRecords();
    const payloads = queued.map((record) => JSON.stringify(record)).join(' ');

    return {
      before,
      after,
      mentionsRating: payloads.includes('PILT_difficulty'),
    };
  });

  expect(result.error).toBeUndefined();
  expect(
    result.after,
    'entering a break should leave a snapshot in the outbox'
  ).toBeGreaterThan(result.before);
  expect(
    result.mentionsRating,
    'the snapshot should contain the ratings collected before the break, not just any data'
  ).toBe(true);
});
