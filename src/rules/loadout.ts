// Weapon loadouts: what a unit carries by default, what its wargear options allow,
// and whether a chosen loadout fits those options. All of it is read from datasheet text.
import type { Datasheet, Rich, Weapon } from '../data/types';

/** Weapon name -> how many of it the unit carries. Keys are lower-case base names. */
export type Loadout = Record<string, number>;

export type OptionRule =
  /** `from` can be swapped for one of `to`; `per` limits it to 1 model in every `per` models. */
  | { kind: 'replace'; from: string; to: string[]; per: number | null; text: string }
  /** Extra weapon carried on top of the others. */
  | { kind: 'add'; weapon: string; text: string }
  /** A rule the app shows but cannot check. */
  | { kind: 'unparsed'; text: string };

const GENERIC_RANGED = 'ranged weapon';

/** "Massive scything talons – sweep" and "– strike" are two profiles of one weapon. */
export const weaponKey = (name: string) => name.split(/\s[–-]\s/)[0].trim().toLowerCase();

export function richText(nodes: Rich): string {
  return nodes
    .map((n): string => {
      switch (n.t) {
        case 'text':
          return n.v;
        case 'br':
          return ' ';
        case 'ul':
          return ' ' + n.items.map((i) => `• ${richText(i)}`).join(' ') + ' ';
        case 'table':
          return ' ' + n.rows.map((r) => r.map(richText).join(' ')).join(' ') + ' ';
        default:
          return richText(n.c);
      }
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface WeaponChoice {
  key: string;
  /** Display name, without the profile suffix. */
  name: string;
  ranged: boolean;
  melee: boolean;
}

/** Each distinct weapon on the datasheet, in datasheet order. */
export function weaponChoices(datasheet: Datasheet): WeaponChoice[] {
  const choices = new Map<string, WeaponChoice>();
  const add = (w: Weapon, ranged: boolean) => {
    const key = weaponKey(w.name);
    const existing = choices.get(key) ?? { key, name: w.name.split(/\s[–-]\s/)[0].trim(), ranged: false, melee: false };
    if (ranged) existing.ranged = true;
    else existing.melee = true;
    choices.set(key, existing);
  };
  datasheet.ranged.forEach((w) => add(w, true));
  datasheet.melee.forEach((w) => add(w, false));
  return [...choices.values()];
}

/** Matches text like "2 bio-cannons" or "1 heavy venom cannon*" to a weapon on the datasheet. */
function matchWeapon(text: string, keys: string[]): { key: string; quantity: number } | undefined {
  const m = /^(\d+)\s+(.*)$/.exec(text.trim());
  const quantity = m ? Number(m[1]) : 1;
  const name = (m ? m[2] : text).replace(/[*.]+$/g, '').trim().toLowerCase().replace(/’/g, "'");
  const normal = (k: string) => k.replace(/’/g, "'");
  const key = keys.find((k) => normal(k) === name) ?? keys.find((k) => `${normal(k)}s` === name || normal(k) === `${name}s`);
  return key ? { key, quantity } : undefined;
}

/** What the unit carries if no wargear option is taken. */
export function defaultLoadout(datasheet: Datasheet, models: number): Loadout {
  const keys = weaponChoices(datasheet).map((c) => c.key);
  const loadout: Loadout = {};
  const text = richText(datasheet.loadout);
  const sentence = /(Every model|This model|The [^.:]*?|(\d+) [^.:]*?) (?:is|are) equipped with:\s*([^.]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = sentence.exec(text)) !== null) {
    const multiplier = /^every model/i.test(m[1]) ? models : m[2] ? Number(m[2]) : 1;
    for (const part of m[3].split(';')) {
      // Most lists use semicolons; a few use commas. Weapon names can contain commas, so try whole first.
      const whole = matchWeapon(part, keys);
      const items = whole ? [whole] : part.split(',').map((p) => matchWeapon(p, keys));
      for (const item of items) {
        if (item) loadout[item.key] = (loadout[item.key] ?? 0) + item.quantity * multiplier;
      }
    }
  }
  return loadout;
}

/** Turns the datasheet's wargear option sentences into rules where they follow a known pattern. */
export function parseOptions(datasheet: Datasheet): OptionRule[] {
  const keys = weaponChoices(datasheet).map((c) => c.key);
  const targets = (text: string) =>
    (text.includes('•') ? text.split('•').slice(1) : [text.replace(/^one of the following:?/i, '')])
      .map((t) => matchWeapon(t, keys)?.key)
      .filter((k): k is string => k !== undefined);
  const source = (text: string) => (/^ranged weapon$/i.test(text.trim()) ? GENERIC_RANGED : matchWeapon(text, keys)?.key);

  const rules: OptionRule[] = [];
  for (const option of datasheet.options) {
    const text = richText(option);
    if (text === '' || /^none\.?$/i.test(text)) continue;
    let m: RegExpExecArray | null;
    let rule: OptionRule | undefined;
    if ((m = /^For every (\d+) models in this unit, 1 model[’']s (.+?) can be replaced with (.+)$/i.exec(text))) {
      const from = source(m[2]);
      const to = targets(m[3]);
      if (from && to.length > 0) rule = { kind: 'replace', from, to, per: Number(m[1]), text };
    } else if (
      (m = /^(?:This model[’']s|(?:Any number of models|All models in this unit) can each have their) (.+?) (?:can be )?replaced with (.+)$/i.exec(text))
    ) {
      const from = source(m[1]);
      const to = targets(m[2]);
      if (from && to.length > 0) rule = { kind: 'replace', from, to, per: null, text };
    } else if ((m = /^(?:Any number of models|All models in this unit) can each be equipped with (.+)$/i.exec(text))) {
      const weapon = matchWeapon(m[1], keys)?.key;
      if (weapon) rule = { kind: 'add', weapon, text };
    }
    rules.push(rule ?? { kind: 'unparsed', text });
  }
  return rules;
}

export interface LoadoutCheck {
  /** Problems with the chosen loadout. Empty when it fits every rule the app could read. */
  problems: string[];
  /** Wargear rules the app shows but cannot check. */
  unchecked: string[];
}

/**
 * Checks counts against the wargear options. Weapons that can replace each other form a group,
 * and each group must add up to what the unit started with.
 */
export function checkLoadout(datasheet: Datasheet, models: number, loadout: Loadout): LoadoutCheck {
  const choices = weaponChoices(datasheet);
  const name = (key: string) => choices.find((c) => c.key === key)?.name ?? key;
  const defaults = defaultLoadout(datasheet, models);
  const rules = parseOptions(datasheet);
  const problems: string[] = [];
  const count = (key: string) => loadout[key] ?? 0;

  // "ranged weapon" in an option means whichever ranged weapon the model has by default.
  const defaultRanged = choices.filter((c) => c.ranged && defaults[c.key]).map((c) => c.key);
  const sources = (from: string) => (from === GENERIC_RANGED ? defaultRanged : [from]);

  // Group weapons that can stand in for one another.
  const group = new Map<string, string>();
  const find = (k: string): string => {
    const parent = group.get(k) ?? k;
    if (parent === k) return k;
    const root = find(parent);
    group.set(k, root);
    return root;
  };
  const union = (a: string, b: string) => group.set(find(a), find(b));
  const addOns = new Set<string>();
  for (const rule of rules) {
    if (rule.kind === 'replace') for (const from of sources(rule.from)) rule.to.forEach((to) => union(from, to));
    if (rule.kind === 'add') addOns.add(rule.weapon);
  }

  const groups = new Map<string, string[]>();
  for (const c of choices) {
    if (addOns.has(c.key)) continue;
    const root = find(c.key);
    groups.set(root, [...(groups.get(root) ?? []), c.key]);
  }
  for (const members of groups.values()) {
    const expected = members.reduce((sum, k) => sum + (defaults[k] ?? 0), 0);
    const chosen = members.reduce((sum, k) => sum + count(k), 0);
    if (chosen === expected) continue;
    if (members.length === 1) {
      problems.push(`${name(members[0])}: this unit carries ${expected}, and it cannot be swapped. You have ${chosen}.`);
    } else {
      problems.push(
        `${members.map(name).join(' / ')}: these replace each other, so together they should total ${expected}. You have ${chosen}.`,
      );
    }
  }

  // Limits on individual weapons.
  const limits = new Map<string, number>();
  for (const rule of rules) {
    if (rule.kind === 'replace' && rule.per !== null) {
      for (const to of rule.to) limits.set(to, (limits.get(to) ?? 0) + Math.floor(models / rule.per));
    }
    if (rule.kind === 'add') limits.set(rule.weapon, models);
  }
  for (const [key, max] of limits) {
    if (count(key) > max) problems.push(`${name(key)}: at most ${max} in a unit of ${models}. You have ${count(key)}.`);
  }

  return { problems, unchecked: rules.filter((r) => r.kind === 'unparsed').map((r) => r.text) };
}

/** Whether this datasheet has any weapon choice to make. */
export const hasWeaponChoices = (datasheet: Datasheet) => parseOptions(datasheet).some((r) => r.kind !== 'unparsed');

export interface CarriedWeapon {
  weapon: Weapon;
  count: number;
}

/** The weapon profiles a unit actually has, given its loadout. */
export function carriedWeapons(datasheet: Datasheet, loadout: Loadout): { ranged: CarriedWeapon[]; melee: CarriedWeapon[] } {
  const pick = (weapons: Weapon[]) =>
    weapons.map((weapon) => ({ weapon, count: loadout[weaponKey(weapon.name)] ?? 0 })).filter((w) => w.count > 0);
  return { ranged: pick(datasheet.ranged), melee: pick(datasheet.melee) };
}

/** Models in a unit that all carry the same weapons, e.g. "7 Termagants with a Termagant devourer". */
export interface LoadoutKind {
  /** What sets these models apart, e.g. "Termagant devourer" or "no Spinemaws". */
  label: string;
  count: number;
  /** Weapons carried by each model of this kind. */
  carries: Loadout;
}

/** Splits a loadout into weapons every model has (`shared`, per model) and weapons only some models have. */
function splitLoadout(datasheet: Datasheet, models: number, loadout: Loadout) {
  const shared: Loadout = {};
  const partial: string[] = [];
  for (const c of weaponChoices(datasheet)) {
    const n = loadout[c.key] ?? 0;
    if (n <= 0) continue;
    if (n % models === 0) shared[c.key] = n / models;
    else partial.push(c.key);
  }
  return { shared, partial };
}

/**
 * Which models carry which weapons, when the loadout says so unambiguously: each model has at most
 * one of the weapons that only some models carry (a swapped gun, or an extra like Spinemaws).
 * Null when every model carries the same weapons, or when the counts allow more than one reading.
 */
export function loadoutKinds(datasheet: Datasheet, models: number, loadout: Loadout): LoadoutKind[] | null {
  if (models <= 1) return null;
  const { shared, partial } = splitLoadout(datasheet, models, loadout);
  if (partial.length === 0) return null;
  const total = partial.reduce((sum, k) => sum + loadout[k], 0);
  if (total > models) return null;
  const choices = weaponChoices(datasheet);
  const name = (key: string) => choices.find((c) => c.key === key)?.name ?? key;
  const kinds: LoadoutKind[] = partial.map((k) => ({ label: name(k), count: loadout[k], carries: { ...shared, [k]: 1 } }));
  if (total < models) kinds.push({ label: `no ${partial.map(name).join(' or ')}`, count: models - total, carries: { ...shared } });
  return kinds;
}

/** One weapon set per kind of model, as near as the loadout can tell. */
function modelSets(datasheet: Datasheet, models: number, loadout: Loadout): Loadout[] {
  const kinds = loadoutKinds(datasheet, models, loadout);
  if (kinds) return kinds.map((k) => k.carries);
  const { shared, partial } = splitLoadout(datasheet, Math.max(1, models), loadout);
  return partial.length === 0 ? [shared] : partial.map((k) => ({ ...shared, [k]: 1 }));
}

const hasKeyword = (w: Weapon, pattern: RegExp) => w.keywords.some((k) => pattern.test(k.trim()));
export const isCloseQuarters = (w: Weapon) => hasKeyword(w, /^(pistol|close-quarters)$/i);
export const isExtraAttacks = (w: Weapon) => hasKeyword(w, /^extra attacks$/i);
/** "Massive scything talons – strike" -> "strike". */
export const profileName = (name: string) => name.split(/\s[–-]\s/).slice(1).join(' – ').trim();

export interface AttackRules {
  /** Each model shoots with its [CLOSE-QUARTERS]/[PISTOL] weapons or its other ranged weapons, not both. */
  rangedEitherOr: boolean;
  /** Ranged weapons with more than one profile (pick one profile each time). */
  rangedProfiles: string[];
  /** Models carry more than one melee weapon (other than [EXTRA ATTACKS] ones) and must pick one. */
  meleePickOne: boolean;
  /** Melee weapons with more than one profile. */
  meleeProfiles: string[];
  /** [EXTRA ATTACKS] weapons, used on top of the chosen melee weapon. */
  extraAttacks: string[];
}

/**
 * How a unit uses its weapons (core rules 04.01): a model shoots with all of its ranged weapons, but
 * fights with only one melee weapon, plus any [EXTRA ATTACKS] weapons. A weapon with several profiles
 * uses one of them each time.
 */
export function attackRules(datasheet: Datasheet, models: number, loadout: Loadout): AttackRules {
  const sets = modelSets(datasheet, models, loadout);
  const profiles = (weapons: Weapon[], key: string) => weapons.filter((w) => weaponKey(w.name) === key);
  const carried = (weapons: Weapon[]) => [...new Set(weapons.map((w) => weaponKey(w.name)))].filter((k) => sets.some((s) => s[k]));
  const baseName = (weapons: Weapon[], key: string) => profiles(weapons, key)[0].name.split(/\s[–-]\s/)[0].trim();
  const bigModel = datasheet.keywords.some((k) => /^(monster|vehicle)$/i.test(k));

  const rangedKeys = carried(datasheet.ranged);
  const meleeKeys = carried(datasheet.melee);
  const extra = meleeKeys.filter((k) => profiles(datasheet.melee, k).every(isExtraAttacks));
  return {
    rangedEitherOr:
      !bigModel &&
      sets.some((s) => {
        const keys = rangedKeys.filter((k) => s[k]);
        const close = keys.filter((k) => profiles(datasheet.ranged, k).some(isCloseQuarters));
        return close.length > 0 && close.length < keys.length;
      }),
    rangedProfiles: rangedKeys.filter((k) => profiles(datasheet.ranged, k).length > 1).map((k) => baseName(datasheet.ranged, k)),
    meleePickOne: sets.some((s) => meleeKeys.filter((k) => s[k] && !extra.includes(k)).length > 1),
    meleeProfiles: meleeKeys.filter((k) => profiles(datasheet.melee, k).length > 1).map((k) => baseName(datasheet.melee, k)),
    extraAttacks: extra.map((k) => baseName(datasheet.melee, k)),
  };
}
