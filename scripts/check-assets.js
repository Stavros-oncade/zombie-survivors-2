#!/usr/bin/env node
/*
 Checks local asset files against the size budgets defined in public/content.manifest.json.
 Prints warnings for over-budget files and for manifest entries marked "present" whose files are missing.
*/

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, 'public', 'content.manifest.json');
const PUBLIC_DIR = path.join(ROOT, 'public');

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function toKB(bytes) { return Math.round(bytes / 1024); }

function main() {
  const manifest = readJSON(MANIFEST_PATH);
  if (!manifest || !Array.isArray(manifest.entries)) {
    console.error(`[check-assets] Failed to read manifest at ${MANIFEST_PATH}`);
    process.exitCode = 1;
    return;
  }

  let overBudget = 0;
  let missing = 0;
  let ok = 0;

  for (const e of manifest.entries) {
    if (e.status !== 'present') continue; // only check files that should exist locally right now
    if (!e.urls) continue;
    const rel = e.urls.webp || e.urls.png || e.urls.atlas || e.urls.json;
    if (!rel) continue;
    const abs = path.isAbsolute(rel) ? rel : path.join(PUBLIC_DIR, rel);

    if (!fs.existsSync(abs)) {
      console.warn(`[check-assets] Missing file for present entry: id=${e.id} path=${rel}`);
      missing++;
      continue;
    }

    try {
      const st = fs.statSync(abs);
      const sizeKB = toKB(st.size);
      const cap = typeof e.sizeKB === 'number' ? Math.round(e.sizeKB) : null;
      const capStr = cap ? `${cap} KB` : 'n/a';
      if (cap && sizeKB > cap) {
        console.warn(`[check-assets] OVER BUDGET: id=${e.id} size=${sizeKB} KB > cap=${capStr} file=${rel}`);
        overBudget++;
      } else {
        ok++;
      }
    } catch (err) {
      console.error(`[check-assets] Error reading file: ${abs}: ${err.message}`);
      process.exitCode = 1;
    }
  }

  const total = ok + overBudget + missing;
  console.log(`[check-assets] Checked ${total} present entries. OK=${ok}, OverBudget=${overBudget}, Missing=${missing}`);
  if (overBudget > 0 || missing > 0) {
    process.exitCode = 2;
  }
}

main();

