/**
 * Selects CFD face stimuli for the go/no-go task and stages the images.
 *
 * Run:
 *   node tasks/go-no-go/sequences/select-cfd-stimuli.mjs \
 *     --images "<path>/CFD Version 3.0/Images/CFD" \
 *     --norming "tasks/go-no-go/sequences/CFD 3.0 Norming Data and Codebook.xlsx" \
 *     [--out assets/images/go-no-go/faces] [--width 500] [--dry-run]
 *
 * ---------------------------------------------------------------------------
 * Licensing - why the images are not in this repository
 * ---------------------------------------------------------------------------
 * The CFD terms forbid redistribution ("shall not be re-distributed to third
 * parties") and publication ("shall not be published ... without written
 * consent"). This repository is public, so neither the norming workbook nor the
 * face images may be committed. Both are gitignored. This script reads them from
 * paths you supply and writes the images to an ignored directory; only
 * stimuli-manifest.json - a list of filenames and their design roles - is
 * committed. Deployment has to run this script against a local CFD copy.
 *
 * ---------------------------------------------------------------------------
 * Selection rules
 * ---------------------------------------------------------------------------
 * 1. Each model is used exactly once, across all sessions.
 * 2. Happy uses the closed-mouth image (HC). Open-mouth shows teeth, a
 *    high-contrast feature anger lacks, which would make "affect" partly a
 *    low-level image difference.
 * 3. Within each gender x ethnicity cell, models assigned to HAPPY are the ones
 *    rated most Trustworthy and those assigned to ANGRY the ones rated most
 *    Threatening. Because a model can only take one role, this is a joint
 *    choice, not two independent top-N lists: models are ranked by
 *    z(Threatening) - z(Trustworthy) within cell, the top taking angry and the
 *    bottom happy, which maximises the separation between the two sets.
 * 4. Scores are balanced across sessions by serpentine assignment down the
 *    ranked list, so no session gets systematically more threatening or more
 *    trustworthy faces.
 * 5. As many sessions as the subset supports are produced.
 *
 * Practice faces are chosen separately, 4 per session, one from each of the four
 * gender x ethnicity cells - which is what gives 2 male / 2 female and 2 Black /
 * 2 White. They are NEUTRAL images from models used nowhere else, drawn
 * preferentially from outside the both-expressions subset so that models capable
 * of carrying angry and happy are not spent on practice. Within each cell the
 * models closest to the cell mean on Threatening and Trustworthy are taken, so a
 * participant's first exposure to the task is not an unusually threatening or
 * unusually warm face.
 *
 * Note the design consequence of rule 3: affect is now a property of the
 * identity, chosen deliberately to strengthen the manipulation. It cannot also
 * be randomised per participant, so any idiosyncratic face effect sits inside
 * the affect contrast for the whole sample. That is a real trade - a stronger
 * manipulation bought with a fixed face-to-affect mapping.
 */

import { readdirSync, statSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

// ---------------------------------------------------------------- args

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const IMAGES = opt('images');
const NORMING = opt('norming', 'tasks/go-no-go/sequences/CFD 3.0 Norming Data and Codebook.xlsx');
const OUT = opt('out', 'assets/images/go-no-go/faces');
const WIDTH = parseInt(opt('width', '500'), 10);
const DRY = args.includes('--dry-run');

if (!IMAGES) {
  console.error('required: --images <path to CFD Images/CFD>');
  process.exit(2);
}

const CUES_PER_SESSION = 24; // 12 per block x 2 blocks

// White-background removal. See the staging step for why 0.10 is the ceiling.
const KEY_SIMILARITY = 0.10;
const KEY_BLEND = 0.02;

// Output format. Transparency rules out JPEG, but PNG is a poor fit for
// photographs with alpha: the same face is 168 KB as PNG and 17 KB as WebP q90,
// visually indistinguishable at display size. Across a session that is 4 MB of
// preload versus 0.4 MB, which matters on a tablet over wi-fi and matters even
// more to the test suite, where several browsers preload simultaneously from one
// static server. WebP with alpha is supported by every browser this battery
// targets (Chrome/Android, Safari 14+).
const WEBP_QUALITY = 90;
const CELLS = 4; // Black/White x F/M - the only groups with expression images
const PER_CELL_PER_SESSION = CUES_PER_SESSION / CELLS; // 6 = 3 angry + 3 happy

// ---------------------------------------------------------------- xlsx

/** Minimal xlsx reader: enough to pull one sheet out as objects. */
function readSheet(path, sheetName) {
  const buf = readFileSync(path);
  const files = unzip(buf);
  const xml = (name) => files[name]?.toString('utf8');

  const strings = [];
  const ssXml = xml('xl/sharedStrings.xml');
  if (ssXml) {
    for (const si of ssXml.split('<si>').slice(1)) {
      strings.push(
        (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
          .map((t) => t.replace(/<[^>]+>/g, ''))
          .join('')
      );
    }
  }

  const wbXml = xml('xl/workbook.xml');
  const relsXml = xml('xl/_rels/workbook.xml.rels');
  const relTargets = {};
  for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relTargets[m[1]] = m[2];
  let target = null;
  for (const m of wbXml.matchAll(/<sheet([^>]+)\/>/g)) {
    const attrs = m[1];
    const name = /name="([^"]+)"/.exec(attrs)?.[1];
    const rid = /r:id="([^"]+)"/.exec(attrs)?.[1];
    if (name === sheetName) target = relTargets[rid];
  }
  if (!target) throw new Error(`sheet "${sheetName}" not found`);
  const sheetXml = xml('xl/' + target.replace(/^\/?xl\//, ''));

  const rows = [];
  for (const rowM of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const cM of rowM[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const [, col, attrs, body] = cM;
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const isInline = /t="inlineStr"/.test(attrs);
      let val = '';
      if (/t="s"/.test(attrs) && v !== undefined) val = strings[parseInt(v, 10)];
      else if (isInline) val = (body.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('');
      else if (v !== undefined) val = v;
      cells[col] = val;
    }
    rows.push(cells);
  }
  return rows;
}

/** Extracts a zip archive into { name: Buffer } using only zlib. */
function unzip(buf) {
  const out = {};
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip file');
  let offset = buf.readUInt32LE(end + 16);
  const count = buf.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOff = buf.readUInt32LE(offset + 42);
    const name = buf.slice(offset + 46, offset + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(dataStart, dataStart + compSize);
    out[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------------------------------------------------------------- data

console.log('Reading norming data...');
const rows = readSheet(NORMING, 'CFD U.S. Norming Data');

// Locate the header by content rather than by row number. The sheet has several
// title rows above it, and self-closing <row/> elements mean the parsed index
// does not line up with the spreadsheet's own row numbers.
const headerIdx = rows.findIndex((r) => Object.values(r).includes('Model') && Object.values(r).includes('EthnicitySelf'));
if (headerIdx < 0) throw new Error('could not find the header row (expected cells "Model" and "EthnicitySelf")');
const header = rows[headerIdx];
const colOf = {};
for (const [col, name] of Object.entries(header)) colOf[name] = col;
for (const needed of ['Model', 'EthnicitySelf', 'GenderSelf', 'Threatening', 'Trustworthy']) {
  if (!colOf[needed]) throw new Error(`norming sheet is missing column "${needed}"`);
}

const norms = new Map();
for (const r of rows.slice(headerIdx + 1)) {
  const model = r[colOf.Model];
  // Data rows only: model ids look like "AF-200". Skips the sub-header row.
  if (!model || !/^[A-Z]{2}-\d+$/.test(model)) continue;
  norms.set(model, {
    ethnicity: r[colOf.EthnicitySelf],
    gender: r[colOf.GenderSelf],
    threatening: parseFloat(r[colOf.Threatening]),
    trustworthy: parseFloat(r[colOf.Trustworthy]),
  });
}
console.log(`  ${norms.size} models with norming data`);

// ---------------------------------------------------------------- images

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const imagesByModel = new Map();
for (const path of walk(IMAGES)) {
  const m = basename(path).match(/^CFD-([ABLWMI][FM])-(\d+)-(\d+)-([A-Z]{1,2})\.(jpg|jpeg|png)$/i);
  if (!m) continue;
  const model = `${m[1]}-${m[2]}`;
  const expr = m[4].toUpperCase();
  if (!imagesByModel.has(model)) imagesByModel.set(model, {});
  imagesByModel.get(model)[expr] = path;
}

// Eligible = has BOTH an angry and a closed-mouth happy image, and has norms.
const eligible = [];
for (const [model, imgs] of imagesByModel) {
  if (!imgs.A || !imgs.HC) continue;
  const n = norms.get(model);
  if (!n || Number.isNaN(n.threatening) || Number.isNaN(n.trustworthy)) continue;
  eligible.push({ model, ...n, angry: imgs.A, happy: imgs.HC });
}
console.log(`  ${eligible.length} models with both A and HC images plus norms`);

// ---------------------------------------------------------------- selection

const byCell = {};
for (const m of eligible) {
  const key = `${m.ethnicity}${m.gender}`;
  (byCell[key] = byCell[key] || []).push(m);
}

const cellKeys = Object.keys(byCell).sort();
const SESSIONS = Math.min(
  ...cellKeys.map((k) => Math.floor(byCell[k].length / PER_CELL_PER_SESSION))
);
console.log(`\nCell sizes: ${cellKeys.map((k) => `${k}=${byCell[k].length}`).join('  ')}`);
console.log(`Sessions supported: ${SESSIONS} (each needs ${PER_CELL_PER_SESSION} per cell)\n`);

const zscore = (values) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1;
  return (x) => (x - mean) / sd;
};

const selected = [];
for (const key of cellKeys) {
  const pool = byCell[key];
  const zThreat = zscore(pool.map((m) => m.threatening));
  const zTrust = zscore(pool.map((m) => m.trustworthy));

  // Rule 3: rank by how much more threatening than trustworthy a face reads.
  // Top of the list becomes angry, bottom becomes happy, middle goes unused.
  const ranked = [...pool].sort(
    (a, b) => zThreat(b.threatening) - zTrust(b.trustworthy) - (zThreat(a.threatening) - zTrust(a.trustworthy))
  );

  const nPerAffect = (SESSIONS * PER_CELL_PER_SESSION) / 2; // half angry, half happy
  const angry = ranked.slice(0, nPerAffect);
  const happy = ranked.slice(-nPerAffect).reverse(); // most trustworthy first

  // Rule 4: serpentine down each ranked list so sessions get matched scores.
  const assign = (list, affect) =>
    list.forEach((m, i) => {
      const cycle = Math.floor(i / SESSIONS);
      const pos = i % SESSIONS;
      const session = cycle % 2 === 0 ? pos : SESSIONS - 1 - pos;
      selected.push({ ...m, affect, session, cell: key });
    });

  assign(angry, 'negative');
  assign(happy, 'positive');
}

// ---------------------------------------------------------------- practice

// Practice uses neutral faces from models that appear nowhere else, so nothing a
// participant learns in training transfers to a real cue.
const usedModels = new Set(selected.map((m) => m.model));
const expressionCapable = new Set(eligible.map((m) => m.model));


const practiceCandidates = [];
for (const [model, imgs] of imagesByModel) {
  if (usedModels.has(model)) continue;
  if (!imgs.N) continue;
  const n = norms.get(model);
  if (!n || Number.isNaN(n.threatening) || Number.isNaN(n.trustworthy)) continue;
  if (!['B', 'W'].includes(n.ethnicity)) continue; // match the task faces
  practiceCandidates.push({ model, ...n, neutral: imgs.N, reserved: expressionCapable.has(model) });
}

const practiceByCell = {};
for (const m of practiceCandidates) {
  const key = `${m.ethnicity}${m.gender}`;
  (practiceByCell[key] = practiceByCell[key] || []).push(m);
}

const PRACTICE_CELLS = ['BF', 'BM', 'WF', 'WM']; // 2 female / 2 male, 2 Black / 2 White
const practicePerCell = {};
for (const key of PRACTICE_CELLS) {
  const pool = practiceByCell[key] || [];
  if (pool.length < SESSIONS) {
    throw new Error(`only ${pool.length} unused neutral ${key} models, need ${SESSIONS}`);
  }
  const zThreat = zscore(pool.map((m) => m.threatening));
  const zTrust = zscore(pool.map((m) => m.trustworthy));
  // Closest to the cell mean on both dimensions, and models that cannot carry
  // expressions first so the A+HC subset is preserved for real cues.
  practicePerCell[key] = [...pool]
    .sort((a, b) => {
      if (a.reserved !== b.reserved) return a.reserved ? 1 : -1;
      const d = (m) => Math.hypot(zThreat(m.threatening), zTrust(m.trustworthy));
      return d(a) - d(b);
    })
    .slice(0, SESSIONS);
}

const practiceBySession = [];
for (let s = 0; s < SESSIONS; s++) {
  // Rotate cell order by session so the first training face is not always drawn
  // from the same gender x ethnicity cell.
  const order = PRACTICE_CELLS.map((_, i) => PRACTICE_CELLS[(i + s) % PRACTICE_CELLS.length]);
  practiceBySession.push(order.map((key) => ({ ...practicePerCell[key][s], cell: key })));
}

// ---------------------------------------------------------------- report

console.log('Balance across sessions (mean rating, 1-7):');
console.log('  session   angry:Threatening   happy:Trustworthy   n');
for (let s = 0; s < SESSIONS; s++) {
  const inSession = selected.filter((m) => m.session === s);
  const ang = inSession.filter((m) => m.affect === 'negative');
  const hap = inSession.filter((m) => m.affect === 'positive');
  const mean = (xs, f) => (xs.reduce((a, b) => a + f(b), 0) / xs.length).toFixed(2);
  console.log(
    `  ${String(s + 1).padStart(7)}${mean(ang, (m) => m.threatening).padStart(20)}${mean(hap, (m) => m.trustworthy).padStart(20)}${String(inSession.length).padStart(4)}`
  );
}

const allAngry = selected.filter((m) => m.affect === 'negative');
const allHappy = selected.filter((m) => m.affect === 'positive');
const mean = (xs, f) => xs.reduce((a, b) => a + f(b), 0) / xs.length;
console.log('\nSeparation achieved (all sessions pooled):');
console.log(`  Threatening   angry ${mean(allAngry, (m) => m.threatening).toFixed(2)}  vs happy ${mean(allHappy, (m) => m.threatening).toFixed(2)}`);
console.log(`  Trustworthy   angry ${mean(allAngry, (m) => m.trustworthy).toFixed(2)}  vs happy ${mean(allHappy, (m) => m.trustworthy).toFixed(2)}`);

console.log(`\nModels used for cues: ${selected.length} (${usedModels.size} distinct - each used once: ${usedModels.size === selected.length ? 'YES' : 'NO'})`);

const practiceModels = practiceBySession.flat().map((m) => m.model);
console.log(`Practice models: ${practiceModels.length} (${new Set(practiceModels).size} distinct), neutral expression`);
console.log(`  overlap with cue models: ${practiceModels.filter((m) => usedModels.has(m)).length}`);
console.log(`  drawn from the expression subset: ${practiceBySession.flat().filter((m) => m.reserved).length}`);
practiceBySession.forEach((faces, i) =>
  console.log(`  session ${i + 1}: ${faces.map((f) => `${f.cell}:${f.model}`).join('  ')}`)
);

// ---------------------------------------------------------------- stage

if (DRY) {
  console.log('\n--dry-run: no images copied, no manifest written.');
  process.exit(0);
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

const manifest = { sessions: [], generated: new Date().toISOString().slice(0, 10), width: WIDTH, format: 'webp-transparent' };
for (let s = 0; s < SESSIONS; s++) {
  const entries = selected
    .filter((m) => m.session === s)
    .map((m) => {
      const src = m.affect === 'negative' ? m.angry : m.happy;
      const file = `s${s + 1}_${m.affect === 'negative' ? 'ang' : 'hap'}_${m.model}.webp`;
      // Transparent PNG, not JPEG: the task tints the whole background on
      // feedback, so the face has to sit on nothing rather than on CFD's white
      // rectangle. CFD backgrounds are pure #FFFFFF, which colorkey removes
      // cleanly.
      //
      // similarity 0.10 is an empirical ceiling, not a guess. The models wear a
      // light grey shirt (#b9bec2); at 0.16 the key starts eating it and at 0.24
      // it is visibly shredded. 0.10 leaves the shirt intact and only mild
      // fringing around fine hair.
      execFileSync(
        'ffmpeg',
        ['-v', 'error', '-y', '-i', src,
         '-vf', `scale=${WIDTH}:-1,colorkey=0xFFFFFF:${KEY_SIMILARITY}:${KEY_BLEND},format=rgba`,
         '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(WEBP_QUALITY), '-pix_fmt', 'yuva420p',
         join(OUT, file)],
        { stdio: 'ignore' }
      );
      return {
        file,
        model: m.model,
        ethnicity: m.ethnicity,
        gender: m.gender,
        affect: m.affect,
      };
    });
  const practice = practiceBySession[s].map((m) => {
    const file = `s${s + 1}_prac_${m.model}.webp`;
    execFileSync(
      'ffmpeg',
      ['-v', 'error', '-y', '-i', m.neutral,
       '-vf', `scale=${WIDTH}:-1,colorkey=0xFFFFFF:${KEY_SIMILARITY}:${KEY_BLEND},format=rgba`,
       '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(WEBP_QUALITY), '-pix_fmt', 'yuva420p',
       join(OUT, file)],
      { stdio: 'ignore' }
    );
    return {
      file,
      model: m.model,
      ethnicity: m.ethnicity,
      gender: m.gender,
      affect: 'neutral',
    };
  });

  manifest.sessions.push({ session: s + 1, faces: entries, practice });
  console.log(`session ${s + 1}: staged ${entries.length} cue images + ${practice.length} practice`);
}

writeFileSync(
  join('tasks/go-no-go/sequences', 'stimuli-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);
console.log(`\nwrote tasks/go-no-go/sequences/stimuli-manifest.json`);
console.log(`images staged in ${OUT} (gitignored - CFD terms forbid redistribution)`);
