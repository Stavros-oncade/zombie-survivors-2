#!/usr/bin/env node
/*
 Checks image dimensions for manifest entries that provide pixel metadata.
 Currently supports PNG files. WebP and others are skipped unless a PNG URL is provided.
*/

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, 'public', 'content.manifest.json');
const PUBLIC_DIR = path.join(ROOT, 'public');

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function getPngSize(absPath) {
  const buf = fs.readFileSync(absPath);
  if (buf.length < 24) throw new Error('PNG too short');
  // PNG signature
  const sig = buf.slice(0, 8).toString('hex');
  const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('hex');
  if (sig !== expected) throw new Error('Not a PNG file');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

function readUInt24LE(buf, offset) {
  return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
}

function getWebPSize(absPath) {
  const buf = fs.readFileSync(absPath);
  if (buf.length < 30) throw new Error('WEBP too short');
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('Not a WEBP file');
  }
  // Iterate chunks: starting at offset 12
  let p = 12;
  while (p + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', p, p + 4);
    const chunkSize = buf.readUInt32LE(p + 4);
    const dataStart = p + 8;
    // VP8X (extended)
    if (chunkId === 'VP8X' && chunkSize >= 10) {
      // 10 bytes: 1 flags, 3 reserved, 3 width-1, 3 height-1 (little-endian 24-bit)
      const w = readUInt24LE(buf, dataStart + 4) + 1;
      const h = readUInt24LE(buf, dataStart + 7) + 1;
      return { width: w, height: h };
    }
    // VP8 (lossy)
    if (chunkId === 'VP8 ' && chunkSize >= 10) {
      // Search for start code 0x9d 0x01 0x2a inside first 32 bytes
      const maxScan = Math.min(32, chunkSize);
      for (let i = 0; i + 7 < maxScan; i++) {
        if (buf[dataStart + i] === 0x9d && buf[dataStart + i + 1] === 0x01 && buf[dataStart + i + 2] === 0x2a) {
          const w = buf.readUInt16LE(dataStart + i + 3) & 0x3fff;
          const h = buf.readUInt16LE(dataStart + i + 5) & 0x3fff;
          return { width: w, height: h };
        }
      }
      throw new Error('VP8 header not found');
    }
    // VP8L (lossless)
    if (chunkId === 'VP8L' && chunkSize >= 5) {
      // 1 byte signature (0x2f) + 4 bytes: 14-bit width-1, 14-bit height-1
      if (buf[dataStart] !== 0x2f) throw new Error('Invalid VP8L signature');
      const val = buf.readUInt32LE(dataStart + 1);
      const w = (val & 0x3fff) + 1;
      const h = ((val >> 14) & 0x3fff) + 1;
      return { width: w, height: h };
    }
    // Move to next chunk (padded to even)
    p = dataStart + chunkSize + (chunkSize % 2);
  }
  throw new Error('No WEBP size chunk found');
}

function main() {
  const manifest = readJSON(MANIFEST_PATH);
  if (!manifest || !Array.isArray(manifest.entries)) {
    console.error(`[check-dimensions] Failed to read manifest at ${MANIFEST_PATH}`);
    process.exitCode = 1;
    return;
  }

  let checked = 0;
  let mismatches = 0;
  let missing = 0;
  let skipped = 0;

  for (const e of manifest.entries) {
    if (e.status !== 'present') continue;
    if (!e.pixel || !e.urls) { skipped++; continue; }

    const rel = e.urls.png || e.urls.webp; // prefer PNG, fallback to WEBP
    if (!rel) { skipped++; continue; }
    const abs = path.isAbsolute(rel) ? rel : path.join(PUBLIC_DIR, rel);
    if (!fs.existsSync(abs)) { console.warn(`[check-dimensions] Missing file for id=${e.id} path=${rel}`); missing++; continue; }

    const ext = path.extname(abs).toLowerCase();
    try {
      let size;
      if (ext === '.png') {
        size = getPngSize(abs);
      } else if (ext === '.webp') {
        size = getWebPSize(abs);
      } else {
        // Not supported yet
        skipped++; continue;
      }
      checked++;
      const wantW = e.pixel.width;
      const wantH = e.pixel.height;
      if (typeof wantW === 'number' && typeof wantH === 'number') {
        if (size.width !== wantW || size.height !== wantH) {
          console.warn(`[check-dimensions] MISMATCH id=${e.id} got=${size.width}x${size.height} want=${wantW}x${wantH} file=${rel}`);
          mismatches++;
        }
      }
    } catch (err) {
      console.error(`[check-dimensions] Error reading ${abs}: ${err.message}`);
      process.exitCode = 1;
    }
  }

  console.log(`[check-dimensions] Checked=${checked}, Mismatches=${mismatches}, Missing=${missing}, Skipped=${skipped}`);
  if (mismatches > 0 || missing > 0) {
    process.exitCode = 2;
  }
}

main();
