import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { effectiveRules } from '../src/proposals/proposals.js';
import { buildDataset, toJsonl, toCsv } from '../src/learning/export.js';
import { ensureDir } from '../src/utils/store.js';

const config = loadConfig({});
config.rules = effectiveRules(config);

const args = process.argv.slice(2);
const arg = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const format = arg('format', 'jsonl');
if (!['jsonl', 'csv'].includes(format)) {
  console.error('Unknown --format, use jsonl or csv');
  process.exit(1);
}

const outDir = path.join(config.dataDir, 'export');
ensureDir(outDir);
const outFile = arg('out', path.join(outDir, `training_data.${format}`));

const rows = buildDataset(config.dataDir, config.rules);
fs.writeFileSync(outFile, format === 'csv' ? toCsv(rows) : toJsonl(rows));

const traded = rows.filter((r) => r.is_traded).length;
const with6h = rows.filter((r) => r.forward_return_6h_pct !== null).length;

console.log(`Exported ${rows.length} rows to ${outFile}`);
console.log(`  ${traded} traded, ${rows.length - traded} shadow-only`);
console.log(`  ${with6h} rows have a full 6h forward return so far; the rest are too recent and will fill in as the bot keeps running`);
