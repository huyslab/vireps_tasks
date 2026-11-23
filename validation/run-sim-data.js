import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCURACY, N_PARTICIPANTS, SESSION_NUMBER, TASKS, simDataFilename } from './sim-data-config.js';

const args = process.argv.slice(2);
const playwrightCli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const command = [playwrightCli, 'test', 'data-sim-analysis', '--project=data invariants', ...args];
const output = fileURLToPath(new URL('./sim-data/', import.meta.url));
const listOnly = args.includes('--list');
let runDir;

if (!listOnly) {
  fs.mkdirSync(output, { recursive: true });
  runDir = fs.mkdtempSync(path.join(output, 'run-'));
}

try {
  const result = spawnSync(process.execPath, command, {
    stdio: 'inherit',
    env: { ...process.env, SIM_DATA_DIR: runDir ?? '' },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;

  if (result.status === 0 && runDir) {
    const expected = TASKS.flatMap(({ task }) =>
      Array.from({ length: N_PARTICIPANTS }, (_, i) => simDataFilename(task, i + 1))
    );
    const missing = expected.filter(file => !fs.existsSync(path.join(runDir, file)));
    if (missing.length) throw new Error(`Simulation is incomplete. Missing datasets: ${missing.join(', ')}`);

    // Publish atomically after all tests and datasets are present. Each run has its own
    // directory, so concurrent runs cannot overwrite the data named by this manifest.
    const manifest = path.join(runDir, 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({
      run: path.basename(runDir),
      participants: N_PARTICIPANTS,
      sim_accuracy: ACCURACY,
      session_number: SESSION_NUMBER,
    }));
    fs.renameSync(manifest, path.join(output, 'latest.json'));
    console.log(`Published ${expected.length} datasets in ${path.relative(process.cwd(), runDir)}`);
    runDir = undefined;
  }
} finally {
  if (runDir) fs.rmSync(runDir, { recursive: true, force: true });
}
