/**
 * generate-vendors-sql.mjs
 * Reads verified_vendors_data.dart and writes vendors_seed.sql
 * Usage: node scripts/generate-vendors-sql.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const dartFile = join(__dir, '../../roadassist_pro/lib/features/vendors/data/verified_vendors_data.dart');
const outFile  = join(__dir, '../supabase/vendors_seed.sql');

const src = readFileSync(dartFile, 'utf8');

const categoryMap = {
  '_fuel':     'Fuel',
  '_tyre':     'Tyre',
  '_mechanic': 'Mechanic',
  '_battery':  'Battery',
  '_accident': 'Accident',
  '_towing':   'Towing',
};

function esc(str) {
  if (str === null || str === undefined || str === '') return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

const rows = [];

for (const [dartKey, category] of Object.entries(categoryMap)) {
  const blockRe = new RegExp(`${dartKey}\\s*=\\s*\\[([\\s\\S]*?)\\];`);
  const blockMatch = src.match(blockRe);
  if (!blockMatch) { console.warn(`Section not found: ${dartKey}`); continue; }

  const block = blockMatch[1];
  const entryRe = /\{([^}]+)\}/g;
  let m;
  while ((m = entryRe.exec(block)) !== null) {
    const text = m[1];
    const getStr = (key) => {
      const r = new RegExp(`'${key}'\\s*:\\s*'([^']*)'`);
      return text.match(r)?.[1] ?? null;
    };
    const getNum = (key) => {
      const r = new RegExp(`'${key}'\\s*:\\s*([\\d.]+)`);
      const v = text.match(r)?.[1];
      return v !== undefined ? parseFloat(v) : null;
    };

    const seedId    = getStr('id');
    const name      = getStr('name');
    const lat       = getNum('lat');
    const lng       = getNum('lng');
    const rating    = getNum('rating');
    const revCount  = getNum('reviewCount');
    const phone     = getStr('phone');
    const whatsapp  = getStr('whatsapp');
    const costRange = getStr('costRange');

    if (!seedId || !name || lat === null || lng === null) continue;

    rows.push({ seedId, name, category, lat, lng,
      rating: rating ?? 0, reviewCount: revCount ?? 0,
      phone: phone ?? '', whatsapp: whatsapp || null, costRange: costRange || null });
  }
}

console.log(`Parsed ${rows.length} vendors`);

const CHUNK = 200;
const chunks = [];
for (let i = 0; i < rows.length; i += CHUNK) chunks.push(rows.slice(i, i + CHUNK));

const cols = [
  'seed_id','name','category','city','lat','lng',
  'rating','review_count','phone','whatsapp','cost_range',
  'is_open','is_verified','kyc','status','source',
  'verified_at','created_at','updated_at',
];

let sql = `-- ============================================================
-- RoadAssist Pro — Verified Vendor Seed Data (${rows.length} vendors)
-- Run AFTER schema.sql in: Supabase Dashboard → SQL Editor
-- ============================================================\n\n`;

for (let ci = 0; ci < chunks.length; ci++) {
  const chunk = chunks[ci];
  sql += `-- Chunk ${ci + 1}/${chunks.length}\n`;
  sql += `INSERT INTO public.vendors (${cols.join(', ')})\nVALUES\n`;

  const valueRows = chunk.map(r =>
    `  (${[
      esc(r.seedId), esc(r.name), esc(r.category), esc('Karachi'),
      r.lat, r.lng, r.rating, r.reviewCount,
      esc(r.phone), esc(r.whatsapp), esc(r.costRange),
      true, true, esc('approved'), esc('verified'), esc('seed'),
      'now()', 'now()', 'now()',
    ].join(', ')})`
  );

  sql += valueRows.join(',\n');
  sql += `\nON CONFLICT (seed_id) DO UPDATE SET\n`;
  sql += `  name = EXCLUDED.name, rating = EXCLUDED.rating,\n`;
  sql += `  review_count = EXCLUDED.review_count, updated_at = now();\n\n`;
}

sql += `-- Verify counts per category\nSELECT category, COUNT(*) FROM public.vendors GROUP BY category ORDER BY category;\n`;

writeFileSync(outFile, sql);
console.log(`Written to: ${outFile}`);
