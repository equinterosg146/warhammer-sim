// Turns the Wahapedia CSV export in data/raw into one rules bundle per faction in src/data/generated.
// Points: the CSV points, unless data/points/<faction>.json lists newer ones (taken from the
// Munitorum Field Manual through the Tyranid phone app).
// Usage: npm run build-data
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Bundle, CostTier, WargearCost } from '../src/data/types';
import { buildBundle, REQUIRED } from './lib/build';
import { parseCsv, type Table } from './lib/csv';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = join(root, 'data', 'raw');
const outDir = join(root, 'src', 'data', 'generated');

const FACTIONS = [
  { name: 'Tyranids', file: 'tyranids' },
  { name: 'Space Marines', file: 'spaceMarines' },
];

interface PointsFile {
  source: string;
  units: Record<string, { costTiers: CostTier[]; wargearCosts: WargearCost[] }>;
  enhancements: Record<string, number>;
}

function applyPoints(bundle: Bundle, file: string): string[] {
  const path = join(root, 'data', 'points', `${file}.json`);
  if (!existsSync(path)) return [];
  const points = JSON.parse(readFileSync(path, 'utf8')) as PointsFile;
  const notes: string[] = [];
  for (const d of bundle.datasheets) {
    const p = points.units[d.name];
    if (!p) continue;
    d.costTiers = p.costTiers;
    d.wargearCosts = p.wargearCosts;
  }
  for (const e of bundle.enhancements) {
    const cost = points.enhancements[e.name];
    if (cost !== undefined) e.cost = cost;
  }
  bundle.meta.pointsSource = points.source;
  notes.push(`points from ${points.source}`);
  return notes;
}

function main() {
  const tables: Record<string, Table> = {};
  for (const name of Object.keys(REQUIRED)) {
    const file = join(rawDir, `${name}.csv`);
    if (!existsSync(file)) throw new Error(`Missing ${file}. Download it from the Wahapedia data export page.`);
    tables[name] = parseCsv(`${name}.csv`, readFileSync(file, 'utf8'));
  }
  mkdirSync(outDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  for (const faction of FACTIONS) {
    const { bundle, warnings } = buildBundle(tables, generatedAt, faction.name);
    const notes = applyPoints(bundle, faction.file);
    writeFileSync(join(outDir, `${faction.file}.json`), JSON.stringify(bundle));
    console.log(
      `${faction.name}: ${bundle.datasheets.length} datasheets, ${bundle.detachments.length} detachments, ` +
        `${bundle.stratagems.filter((s) => s.category === 'detachment').length} detachment stratagems${notes.length ? `; ${notes.join('; ')}` : ''}`,
    );
    for (const w of warnings.slice(0, 10)) console.log(`  warning: ${w}`);
    if (warnings.length > 10) console.log(`  ...and ${warnings.length - 10} more warnings`);
  }
}

main();
