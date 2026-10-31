import type { CostTier, WargearCost } from '../../src/data/types';

export interface CostRow {
  description: string;
  cost: string;
}

export interface ParsedCosts {
  costTiers: CostTier[];
  wargearCosts: WargearCost[];
  warnings: string[];
}

// Wahapedia has written both "YOUR 3RD + UNIT COSTS" and "YOUR 3RD+ UNIT COSTS".
const TIER_HEADER = /^YOUR(?: (\d+)(?:ST|ND|RD|TH))?(?: TO (\d+)(?:ST|ND|RD|TH))?( ?\+)? UNITS? COSTS?$/i;

/**
 * Rows with an empty cost are headers. "YOUR ... UNIT(S) COST(S)" headers start a tier
 * that applies to a range of copies of the unit; "WARGEAR OPTIONS" starts per-item add-ons.
 */
export function parseCosts(rows: CostRow[]): ParsedCosts {
  const costTiers: CostTier[] = [];
  const wargearCosts: WargearCost[] = [];
  const warnings: string[] = [];
  let inWargear = false;

  for (const row of rows) {
    const description = row.description.trim();
    const cost = row.cost.trim();

    if (cost === '') {
      const m = TIER_HEADER.exec(description);
      if (m) {
        inWargear = false;
        const from = m[1] ? Number(m[1]) : 1;
        const toCopy = m[3] ? null : m[2] ? Number(m[2]) : m[1] ? from : null;
        costTiers.push({ fromCopy: from, toCopy, label: description, sizes: [] });
      } else if (/^WARGEAR OPTIONS$/i.test(description)) {
        inWargear = true;
      } else {
        inWargear = false;
        warnings.push(`Unrecognised cost header "${description}" treated as applying to every copy`);
        costTiers.push({ fromCopy: 1, toCopy: null, label: description, sizes: [] });
      }
      continue;
    }

    const points = Number(cost);
    if (!Number.isFinite(points)) {
      warnings.push(`Cost "${cost}" for "${description}" is not a number; row skipped`);
      continue;
    }

    if (inWargear) {
      wargearCosts.push({ name: description.replace(/^per\s+/i, ''), points });
      continue;
    }

    if (costTiers.length === 0) {
      costTiers.push({ fromCopy: 1, toCopy: null, label: 'YOUR UNIT COSTS', sizes: [] });
    }
    const models = /^(\d+) models?$/i.exec(description);
    costTiers[costTiers.length - 1].sizes.push({
      models: models ? Number(models[1]) : null,
      label: description,
      points,
    });
  }

  return { costTiers, wargearCosts, warnings };
}
