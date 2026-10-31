// Reading units: their datasheets, keywords and characteristics, and creating them from army lists.
import { BUNDLES, type FactionKey, type IndexedBundle } from '../data/bundles';
import type { Datasheet, Rich, Weapon } from '../data/types';
import { unitLabels, type ArmyList, type ListUnit } from '../rules/army';
import { cardsFor, unitModels } from '../rules/effects';
import { defaultLoadout, loadoutKinds, richText, weaponChoices, weaponKey, type Loadout } from '../rules/loadout';
import { strengthFrom, type Strength } from '../rules/strength';
import { baseRadius } from './geometry';
import { aliveModels, freshFlags, type ModelState, type PlayerId, type UnitMember, type UnitState } from './state';

export const bundleOf = (u: { faction: FactionKey }): IndexedBundle => BUNDLES[u.faction];

export function datasheetOf(u: UnitState, member: number): Datasheet {
  const d = bundleOf(u).datasheetById.get(u.members[member].datasheetId);
  if (!d) throw new Error(`Unknown datasheet ${u.members[member].datasheetId}`);
  return d;
}

export const modelDatasheet = (u: UnitState, m: ModelState) => datasheetOf(u, m.member);
export const modelProfile = (u: UnitState, m: ModelState) => modelDatasheet(u, m).models[m.profile] ?? modelDatasheet(u, m).models[0];

const norm = (k: string) => k.trim().toLowerCase();

export function modelHasKeyword(u: UnitState, m: ModelState, keyword: string): boolean {
  const d = modelDatasheet(u, m);
  const k = norm(keyword);
  return d.keywords.some((x) => norm(x) === k) || d.factionKeywords.some((x) => norm(x) === k);
}

/** 19.03: an attached unit has every keyword of its models. Destroyed members still count until gone. */
export function unitHasKeyword(u: UnitState, keyword: string): boolean {
  return aliveModels(u).some((m) => modelHasKeyword(u, m, keyword));
}

export const everyModelHas = (u: UnitState, keyword: string) => aliveModels(u).every((m) => modelHasKeyword(u, m, keyword));

export const isMonsterOrVehicle = (u: UnitState, m: ModelState) => modelHasKeyword(u, m, 'Monster') || modelHasKeyword(u, m, 'Vehicle');

/** Can move horizontally through dense terrain (13.06). */
export const movesThroughDense = (u: UnitState, m: ModelState) =>
  ['Infantry', 'Beasts', 'Beast', 'Swarm', 'Mobile'].some((k) => modelHasKeyword(u, m, k));

/** Gets cover simply by being in a terrain area (13.08). */
export const usesTerrainCover = (u: UnitState, m: ModelState) => ['Infantry', 'Beasts', 'Beast', 'Swarm'].some((k) => modelHasKeyword(u, m, k));

export const num = (v: string, fallback = 0) => {
  const n = Number(/-?\d+/.exec(v)?.[0]);
  return Number.isFinite(n) ? n : fallback;
};

export const moveOf = (u: UnitState, m: ModelState) => num(modelProfile(u, m).M, 0);
export const saveOf = (u: UnitState, m: ModelState) => num(modelProfile(u, m).Sv, 7);
export const invulnOf = (u: UnitState, m: ModelState) => {
  const v = modelProfile(u, m).invSv;
  return v && v !== '-' ? num(v, 7) : 7;
};
export const ocOf = (u: UnitState, m: ModelState) => num(modelProfile(u, m).OC, 0);
export const ldOf = (u: UnitState, m: ModelState) => num(modelProfile(u, m).Ld, 7);

/** 19.02: attacks against an attached unit use the bodyguard's highest T while any bodyguard is left. */
export function toughnessOf(u: UnitState): number {
  const alive = aliveModels(u);
  const bodyguards = alive.filter((m) => u.members[m.member].role !== 'leader');
  const pool = bodyguards.length > 0 ? bodyguards : alive;
  return Math.max(...pool.map((m) => num(modelProfile(u, m).T, 1)));
}

/** Best (lowest) Leadership in the unit: a leadership roll succeeds if it beats any of them (01.06). */
export const bestLeadership = (u: UnitState) => Math.min(...aliveModels(u).map((m) => ldOf(u, m)));

export function strengthOfUnit(u: UnitState): Strength {
  const alive = aliveModels(u);
  if (u.startingStrength === 1 && alive.length === 1) return strengthFrom(1, 1, { left: alive[0].w, max: alive[0].maxW });
  return strengthFrom(u.startingStrength, alive.length);
}

export const atOrBelowHalf = (u: UnitState) => {
  const s = strengthOfUnit(u);
  return s === 'half' || s === 'belowHalf';
};

export interface ModelWeapon {
  weapon: Weapon;
  key: string;
  ranged: boolean;
  count: number;
}

/** The weapon profiles a model carries (each profile of a multi-profile weapon is listed). */
export function modelWeapons(u: UnitState, m: ModelState): ModelWeapon[] {
  const d = modelDatasheet(u, m);
  const out: ModelWeapon[] = [];
  for (const [list, ranged] of [
    [d.ranged, true],
    [d.melee, false],
  ] as const) {
    for (const weapon of list) {
      const key = weaponKey(weapon.name);
      const count = m.weapons[key] ?? 0;
      if (count > 0) out.push({ weapon, key, ranged, count });
    }
  }
  return out;
}

// ---- Creating units from an army list ----------------------------------------------------

const plain = (nodes: Rich): string => richText(nodes);

/** How many models each stat line contributes, read from the unit composition. */
function profileCounts(d: Datasheet, modelCount: number): number[] {
  if (d.models.length <= 1) return [modelCount];
  const text = d.composition.map(plain);
  const counts = d.models.map((line) => {
    const singular = line.name.replace(/s$/i, '').replace(/[^\w\s'’-]/g, '');
    const m = text.map((t) => new RegExp('(\\d+)(?:-\\d+)?\\s+' + singular, 'i').exec(t)).find((x) => x !== null);
    return m ? Number(m[1]) : 0;
  });
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return [modelCount, ...d.models.slice(1).map(() => 0)];
  counts[counts.length - 1] += Math.max(0, modelCount - total);
  return counts;
}

/** Weapons per profile from sentences like "The Ravener Prime is equipped with: ...". */
function profileLoadouts(d: Datasheet): Map<number, Loadout> {
  const result = new Map<number, Loadout>();
  const keys = weaponChoices(d).map((c) => c.key);
  const text = plain(d.loadout);
  const sentence = /(?:The|Every|Each|\d+)\s+([^.:]*?)\s+(?:is|are|model is)\s+equipped with:\s*([^.]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = sentence.exec(text)) !== null) {
    const who = match[1].toLowerCase();
    const profile = d.models.findIndex((p) => who.includes(p.name.toLowerCase().replace(/s$/, '')));
    if (profile < 0) continue;
    const loadout = result.get(profile) ?? {};
    for (const part of match[2].split(/;|,(?![^(]*\))/)) {
      const q = /^\s*(\d+)\s+(.*)$/.exec(part);
      const name = (q ? q[2] : part).replace(/[*.]+$/g, '').trim().toLowerCase();
      const key = keys.find((k) => k === name || `${k}s` === name || k === `${name}s`);
      if (key) loadout[key] = (loadout[key] ?? 0) + (q ? Number(q[1]) : 1);
    }
    result.set(profile, loadout);
  }
  return result;
}

/** Splits a unit's loadout into one weapon set per model, with the profile each model uses. */
export function modelLoadouts(d: Datasheet, models: number, loadout: Loadout): { profile: number; weapons: Loadout }[] {
  const counts = profileCounts(d, models);
  if (counts.filter((c) => c > 0).length > 1) {
    const perProfile = profileLoadouts(d);
    if (perProfile.size > 0) {
      const out: { profile: number; weapons: Loadout }[] = [];
      counts.forEach((n, profile) => {
        for (let i = 0; i < n; i++) out.push({ profile, weapons: { ...(perProfile.get(profile) ?? {}) } });
      });
      return out;
    }
  }
  const kinds = loadoutKinds(d, models, loadout);
  if (kinds) return kinds.flatMap((k) => Array.from({ length: k.count }, () => ({ profile: 0, weapons: { ...k.carries } })));
  // Every model carries an equal share; weapons that do not divide evenly go to the first models.
  return Array.from({ length: models }, (_, i) => {
    const weapons: Loadout = {};
    for (const [key, n] of Object.entries(loadout)) {
      const each = Math.floor(n / models) + (i < n % models ? 1 : 0);
      if (each > 0) weapons[key] = each;
    }
    return { profile: 0, weapons };
  });
}

/** Turns an army list into game units: each leader joins the unit it leads (19.01). */
export function createUnits(list: ArmyList, faction: FactionKey, owner: PlayerId): UnitState[] {
  const bundle = BUNDLES[faction];
  const cards = cardsFor(bundle, list, unitLabels(bundle, list.units));
  return cards.map((card, ci) => {
    const members: UnitMember[] = card.members.map((m) => ({
      listUid: m.unit.uid,
      datasheetId: m.datasheet.id,
      role: m.role,
      enhancementId: m.unit.enhancementId,
      models: m.models,
    }));
    const models: ModelState[] = [];
    card.members.forEach((m, mi) => {
      const loadout = m.unit.loadout ?? defaultLoadout(m.datasheet, m.models);
      const isCharacter = m.datasheet.keywords.some((k) => /^character$/i.test(k));
      modelLoadouts(m.datasheet, m.models, loadout).forEach((ml, i) => {
        const profile = m.datasheet.models[ml.profile] ?? m.datasheet.models[0];
        const maxW = num(profile?.W ?? '1', 1);
        models.push({
          id: `${owner}-${ci}-${mi}-${i}`,
          member: mi,
          profile: ml.profile,
          name: profile?.name ?? m.datasheet.name,
          x: 0,
          y: 0,
          r: baseRadius(profile?.baseSize ?? '', m.datasheet.keywords.some((k) => /monster|vehicle/i.test(k)) ? 100 : 32),
          w: maxW,
          maxW,
          weapons: ml.weapons,
          character: isCharacter,
        });
      });
    });
    return {
      id: `${owner}-${ci}`,
      owner,
      faction,
      name: card.name,
      members,
      models,
      startingStrength: models.length,
      status: 'undeployed',
      deepStrike: false,
      battleShocked: false,
      flags: freshFlags(),
      lastShotTurn: -10,
      oneShotUsed: [],
      switches: {},
    } satisfies UnitState;
  });
}

export const listUnitModels = (u: ListUnit) => unitModels(u);

/** Every core ability name of the unit's models (e.g. "Deep Strike", "Scouts 6\""). */
export function coreAbilities(u: UnitState): { name: string; parameter: string; everyModel: boolean }[] {
  const out = new Map<string, { name: string; parameter: string; count: number }>();
  const alive = aliveModels(u);
  for (const m of alive) {
    for (const a of modelDatasheet(u, m).abilities.core) {
      const key = a.name;
      const entry = out.get(key) ?? { name: a.name, parameter: a.parameter, count: 0 };
      entry.count++;
      out.set(key, entry);
    }
  }
  return [...out.values()].map((e) => ({ name: e.name, parameter: e.parameter, everyModel: e.count === alive.length }));
}

export const hasCoreAbility = (u: UnitState, name: string, everyModel = true) =>
  coreAbilities(u).some((a) => a.name.toLowerCase() === name.toLowerCase() && (!everyModel || a.everyModel));

export const coreParameter = (u: UnitState, name: string) => coreAbilities(u).find((a) => a.name.toLowerCase() === name.toLowerCase())?.parameter ?? '';
