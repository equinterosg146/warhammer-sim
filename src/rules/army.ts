import type { IndexedBundle } from '../data/bundles';
import type { CostSize, CostTier, Datasheet } from '../data/types';
import { checkLoadout, type Loadout } from './loadout';

export const MAX_DETACHMENT_POINTS = 3;
export const POINTS_LIMITS = [1000, 2000, 3000];
export const DEFAULT_POINTS_LIMIT = 1000;

export interface ListUnit {
  uid: string;
  datasheetId: string;
  /** Label of the chosen unit size, e.g. "10 models". */
  size: string;
  wargearCounts: Record<string, number>;
  enhancementId: string | null;
  /** For a leader: the uid of the bodyguard unit it leads in battle. */
  attachedTo?: string | null;
  /** Chosen weapons and how many; absent means the datasheet's default loadout. */
  loadout?: Loadout | null;
}

export interface ArmyList {
  id: number;
  name: string;
  pointsLimit: number;
  isActive: boolean;
  detachmentIds: string[];
  units: ListUnit[];
  /** Situational buffs the player has switched on or off (see rules/effects.ts). */
  switches?: Record<string, boolean>;
}

export interface Warning {
  message: string;
  unitUid?: string;
}

/** Costs can change with how many of the same unit you take; copyNumber is 1 for the first. */
export function tierFor(datasheet: Datasheet, copyNumber: number): CostTier | undefined {
  const tiers = datasheet.costTiers.filter((t) => t.sizes.length > 0);
  return (
    tiers.find((t) => t.fromCopy <= copyNumber && (t.toCopy === null || copyNumber <= t.toCopy)) ??
    tiers[tiers.length - 1]
  );
}

export function sizeFor(tier: CostTier | undefined, label: string): CostSize | undefined {
  return tier?.sizes.find((s) => s.label === label) ?? tier?.sizes[0];
}

export function unitPoints(bundle: IndexedBundle, unit: ListUnit, copyNumber: number): number {
  const datasheet = bundle.datasheetById.get(unit.datasheetId);
  if (!datasheet) return 0;
  const base = sizeFor(tierFor(datasheet, copyNumber), unit.size)?.points ?? 0;
  const wargear = datasheet.wargearCosts.reduce((sum, w) => sum + w.points * (unit.wargearCounts[w.name] ?? 0), 0);
  const enhancement = unit.enhancementId ? (bundle.enhancementById.get(unit.enhancementId)?.cost ?? 0) : 0;
  return base + wargear + enhancement;
}

/** Copy number of each unit, counting units of the same datasheet in list order. */
export function copyNumbers(units: ListUnit[]): Map<string, number> {
  const seen = new Map<string, number>();
  const result = new Map<string, number>();
  for (const unit of units) {
    const n = (seen.get(unit.datasheetId) ?? 0) + 1;
    seen.set(unit.datasheetId, n);
    result.set(unit.uid, n);
  }
  return result;
}

export function listPoints(bundle: IndexedBundle, list: ArmyList): number {
  const copies = copyNumbers(list.units);
  return list.units.reduce((sum, unit) => sum + unitPoints(bundle, unit, copies.get(unit.uid) ?? 1), 0);
}

export function listDetachmentPoints(bundle: IndexedBundle, list: ArmyList): number {
  return list.detachmentIds.reduce((sum, id) => sum + (bundle.detachmentById.get(id)?.dp ?? 0), 0);
}

export function validateList(bundle: IndexedBundle, list: ArmyList): Warning[] {
  const warnings: Warning[] = [];

  const points = listPoints(bundle, list);
  if (points > list.pointsLimit) {
    warnings.push({ message: `${points - list.pointsLimit} pts over the ${list.pointsLimit} pts limit.` });
  }

  const dp = listDetachmentPoints(bundle, list);
  if (dp > MAX_DETACHMENT_POINTS) {
    warnings.push({ message: `Detachments cost ${dp} DP; the maximum is ${MAX_DETACHMENT_POINTS}.` });
  }
  for (const id of list.detachmentIds) {
    if (!bundle.detachmentById.has(id)) {
      warnings.push({ message: 'A detachment in this list no longer exists in the rules data.' });
    }
  }
  if (list.units.length > 0 && list.detachmentIds.length === 0) {
    warnings.push({ message: 'No detachment chosen yet.' });
  }

  const enhancementUses = new Map<string, number>();
  const epicHeroes = new Map<string, number>();
  for (const unit of list.units) {
    const datasheet = bundle.datasheetById.get(unit.datasheetId);
    if (!datasheet) {
      warnings.push({ message: 'This unit no longer exists in the rules data.', unitUid: unit.uid });
      continue;
    }
    if (/epic hero/i.test(datasheet.role)) {
      epicHeroes.set(datasheet.id, (epicHeroes.get(datasheet.id) ?? 0) + 1);
      if (epicHeroes.get(datasheet.id) === 2) {
        warnings.push({ message: `${datasheet.name} is an Epic Hero and can only be included once.`, unitUid: unit.uid });
      }
    }
    if (!unit.enhancementId) continue;
    const enhancement = bundle.enhancementById.get(unit.enhancementId);
    if (!enhancement) {
      warnings.push({ message: `${datasheet.name}: its enhancement no longer exists in the rules data.`, unitUid: unit.uid });
      continue;
    }
    if (!list.detachmentIds.includes(enhancement.detachmentId)) {
      const detachment = bundle.detachmentById.get(enhancement.detachmentId)?.name ?? 'a detachment';
      warnings.push({
        message: `${datasheet.name}: ${enhancement.name} needs ${detachment}, which is not in this list.`,
        unitUid: unit.uid,
      });
    }
    if (!enhancement.eligibleDatasheetIds.includes(datasheet.id)) {
      warnings.push({ message: `${datasheet.name} cannot take ${enhancement.name}.`, unitUid: unit.uid });
    }
    const uses = (enhancementUses.get(enhancement.id) ?? 0) + 1;
    enhancementUses.set(enhancement.id, uses);
    if (uses === 2) {
      warnings.push({ message: `${enhancement.name} is assigned to more than one unit.`, unitUid: unit.uid });
    }
  }

  // Leaders (19.01): each must lead a unit it is allowed to, and a bodyguard takes only one leader.
  const labels = unitLabels(bundle, list.units);
  for (const unit of list.units) {
    const datasheet = bundle.datasheetById.get(unit.datasheetId);
    if (!datasheet || !unit.loadout) continue;
    const models = Number(/^(\d+)/.exec(unit.size)?.[1] ?? 1);
    for (const problem of checkLoadout(datasheet, models, unit.loadout).problems) {
      warnings.push({ message: `${labels.get(unit.uid)} weapons: ${problem}`, unitUid: unit.uid });
    }
  }
  const leadersOf = new Map<string, string[]>();
  for (const unit of list.units) {
    if (!unit.attachedTo) continue;
    const bodyguard = list.units.find((u) => u.uid === unit.attachedTo);
    const name = labels.get(unit.uid) ?? 'A leader';
    if (!bodyguard) {
      warnings.push({ message: `${name} is attached to a unit that is no longer in this list.`, unitUid: unit.uid });
      continue;
    }
    if (!bodyguardChoices(bundle, list, unit).includes(bodyguard)) {
      warnings.push({ message: `${name} cannot lead ${labels.get(bodyguard.uid)}.`, unitUid: unit.uid });
    }
    leadersOf.set(bodyguard.uid, [...(leadersOf.get(bodyguard.uid) ?? []), name]);
  }
  for (const [uid, leaders] of leadersOf) {
    if (leaders.length > 1) {
      warnings.push({ message: `${labels.get(uid)} has more than one leader (${leaders.join(', ')}); it can only have one.`, unitUid: uid });
    }
  }

  return warnings;
}

/** Display names, numbered when a list has more than one of the same unit ("Termagants 2"). */
export function unitLabels(bundle: IndexedBundle, units: ListUnit[]): Map<string, string> {
  const totals = new Map<string, number>();
  units.forEach((u) => totals.set(u.datasheetId, (totals.get(u.datasheetId) ?? 0) + 1));
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const u of units) {
    const n = (seen.get(u.datasheetId) ?? 0) + 1;
    seen.set(u.datasheetId, n);
    const name = bundle.datasheetById.get(u.datasheetId)?.name ?? 'Unknown unit';
    labels.set(u.uid, (totals.get(u.datasheetId) ?? 1) > 1 ? `${name} ${n}` : name);
  }
  return labels;
}

/** Units in the list that this leader is allowed to lead. */
export function bodyguardChoices(bundle: IndexedBundle, list: ArmyList, leader: ListUnit): ListUnit[] {
  const leads = bundle.datasheetById.get(leader.datasheetId)?.leads ?? [];
  return list.units.filter((u) => u.uid !== leader.uid && leads.includes(u.datasheetId));
}

/** Enhancements a unit could take given the list's detachments. */
export function enhancementChoices(bundle: IndexedBundle, list: ArmyList, datasheetId: string) {
  return bundle.enhancements.filter(
    (e) => list.detachmentIds.includes(e.detachmentId) && e.eligibleDatasheetIds.includes(datasheetId),
  );
}
