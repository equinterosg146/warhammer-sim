// Buffs that change what a unit's card shows: an attached leader, the army's detachment, an
// enhancement, a nearby aura or the army rule. The rules data is free text, so these tables are
// written by hand from it. Each entry names the rule it comes from, and is ignored if that rule's
// wording has changed since it was written (see data/curation.ts).
import type { IndexedBundle } from '../data/bundles';
import { abilityKey, armyKey, detachmentKey, enhancementKey, type Curation } from '../data/curation';
import type { Datasheet, Weapon } from '../data/types';
import type { ArmyList, ListUnit } from './army';
import type { Strength } from './strength';
import { carriedWeapons, defaultLoadout, type Loadout } from './loadout';

export type WeaponScope = 'all' | 'melee' | 'ranged' | 'psychic';

export type Mod =
  /** Changes a weapon characteristic. AP and skill improve with a negative delta. */
  | { kind: 'weaponStat'; stat: 'A' | 'S' | 'AP' | 'skill'; delta: number; weapons: WeaponScope }
  | { kind: 'weaponKeyword'; keyword: string; weapons: WeaponScope }
  | { kind: 'stat'; stat: 'M' | 'T' | 'OC'; delta: number }
  | { kind: 'invuln'; value: number }
  | { kind: 'fnp'; value: number }
  | { kind: 'keyword'; keyword: string }
  /** Something that cannot be shown as a changed number, such as a re-roll or a Hit roll modifier. */
  | { kind: 'note'; text: string; debuff?: boolean };

/** 'always' buffs apply as soon as their cause is in the list; a switch is turned on by the player. */
/** Conditions the battle sheet can work out from the wounds it tracks. */
export type AutoCondition = 'atStarting' | 'belowStarting' | 'belowHalf';

export type Condition =
  | 'always'
  | {
      switch: string;
      defaultOn?: boolean;
      group?: string;
      requires?: string;
      /** When the unit's strength is known, this decides the switch instead of the player. */
      auto?: AutoCondition;
    };

/** A switch the player flips by hand (not always-on, and not worked out from wounds). */
export const isManual = (e: { condition: Condition }) => e.condition !== 'always' && e.condition.auto === undefined;

interface EffectSpec {
  id: string;
  label: string;
  condition: Condition;
  mods: Mod[];
}

const kw = (keyword: string, weapons: WeaponScope = 'all'): Mod => ({ kind: 'weaponKeyword', keyword, weapons });
const note = (text: string): Mod => ({ kind: 'note', text });

// ---- Curated tables ----------------------------------------------------------------------

/** "While this model is leading a unit": applies to the whole attached unit. */
const LEADING: Record<string, EffectSpec[]> = {
  Broodlord: [{ id: 'vicious-insight', label: 'Vicious Insight', condition: 'always', mods: [kw('devastating wounds')] }],
  Neurotyrant: [
    {
      id: 'node-lash',
      label: 'Node Lash (Psychic)',
      condition: 'always',
      mods: [note('Add 1 to the Hit roll; add 1 to the Wound roll as well against Battle-shocked targets')],
    },
  ],
  'Old One Eye': [{ id: 'alpha-leader', label: 'Alpha Leader', condition: 'always', mods: [note('Can re-roll the Hit roll')] }],
  'Winged Tyranid Prime': [{ id: 'alpha-warrior', label: 'Alpha Warrior', condition: 'always', mods: [kw('sustained hits 1')] }],
  Malanthrope: [
    { id: 'enhanced-miasma', label: 'Enhanced Toxic Miasma', condition: 'always', mods: [note('Foul Spores aura reaches 9" instead of 6"')] },
  ],
};

/** A bodyguard unit's ability that buffs the character leading it. */
const BODYGUARD: Record<string, EffectSpec[]> = {
  'Tyrant Guard': [{ id: 'guardian-organism', label: 'Guardian Organism', condition: 'always', mods: [{ kind: 'fnp', value: 5 }] }],
};

/** A unit's own ability that changes its numbers, for itself and any unit it is part of. */
const SELF: Record<string, EffectSpec[]> = {
  'Hyperadapted Raveners': [{ id: 'alpha-invader', label: 'Alpha Invader', condition: 'always', mods: [kw('sustained hits 1')] }],
  'Tyranid Prime with Lash Whip': [{ id: 'alpha-warrior', label: 'Alpha Warrior', condition: 'always', mods: [kw('sustained hits 1')] }],
  'Tyranid Warriors With Melee Bio-weapons': [
    {
      id: 'adaptive-strength',
      label: 'Adaptive Instincts (Once per turn, per unit)',
      condition: { switch: 'Adaptive Instincts: +1 Strength', group: 'adaptive-instincts' },
      mods: [{ kind: 'weaponStat', stat: 'S', delta: 1, weapons: 'melee' }],
    },
    {
      id: 'adaptive-toughness',
      label: 'Adaptive Instincts (Once per turn, per unit)',
      condition: { switch: 'Adaptive Instincts: +1 Toughness', group: 'adaptive-instincts' },
      mods: [{ kind: 'stat', stat: 'T', delta: 1 }],
    },
  ],
  Malanthrope: ['sustained hits 1', 'lance', 'lethal hits'].map((keyword) => ({
    id: `prey-adaptation-${keyword.replace(/\s/g, '-')}`,
    label: 'Prey Adaptation',
    condition: { switch: `Prey Adaptation: ${keyword}`, group: 'prey-adaptation' },
    mods: [kw(keyword, 'melee')],
  })),
  'Norn Emissary': [
    {
      id: 'singular-purpose-objective',
      label: 'Singular Purpose',
      condition: { switch: 'In range of the chosen objective' },
      mods: [{ kind: 'fnp', value: 5 }, note('Objective Control 15')],
    },
  ],
  'Norn Assimilator': [
    {
      id: 'singular-purpose-objective',
      label: 'Singular Purpose',
      condition: { switch: 'In range of the chosen objective' },
      mods: [{ kind: 'fnp', value: 5 }, note('Objective Control 15')],
    },
  ],
};

interface DetachmentSpec extends EffectSpec {
  /** Which units the rule affects. */
  applies: (datasheet: Datasheet) => boolean;
}

const named = (...names: string[]) => (d: Datasheet) => names.includes(d.name);
const hasKeyword = (keyword: string) => (d: Datasheet) => d.keywords.some((k) => k.toLowerCase() === keyword.toLowerCase());
const everyone = () => true;
const WARRIORS = ['Tyranid Warriors With Melee Bio-weapons', 'Tyranid Warriors With Ranged Bio-weapons'];
const SYNAPSE = 'synapse-range';

/** Keyed by detachment rule name. */
const DETACHMENT: Record<string, DetachmentSpec[]> = {
  'Leader-beasts': [
    {
      id: 'leader-beasts-invuln',
      label: 'Leader-beasts',
      applies: named(...WARRIORS, 'Tyranid Prime with Lash Whip', 'Winged Tyranid Prime'),
      condition: 'always',
      mods: [{ kind: 'invuln', value: 5 }],
    },
    {
      id: 'leader-beasts-keywords',
      label: 'Leader-beasts',
      applies: named(...WARRIORS),
      condition: 'always',
      mods: [
        { kind: 'keyword', keyword: 'Tyranid Warriors' },
        { kind: 'keyword', keyword: 'Battleline' },
      ],
    },
  ],
  Mindhunger: [
    { id: 'mindhunger-deep-strike', label: 'Mindhunger', applies: named('Deathleaper', 'Lictor', 'Neurolictor'), condition: 'always', mods: [note('Has Deep Strike')] },
    {
      id: 'mindhunger-reroll',
      label: 'Mindhunger',
      applies: named('Lictor', 'Neurolictor'),
      condition: 'always',
      mods: [note('Re-roll a Hit roll of 1 against CHARACTER units')],
    },
  ],
  'Enraged Behemoths': [
    {
      id: 'behemoths-oc',
      label: 'Enraged Behemoths',
      applies: hasKeyword('Monster'),
      condition: { switch: 'At Starting Strength and not Battle-shocked', defaultOn: true, auto: 'atStarting' },
      mods: [{ kind: 'stat', stat: 'OC', delta: 2 }],
    },
    {
      id: 'behemoths-hit',
      label: 'Enraged Behemoths',
      applies: hasKeyword('Monster'),
      condition: { switch: 'Below Starting Strength', auto: 'belowStarting' },
      mods: [note('Add 1 to the Hit roll')],
    },
    {
      id: 'behemoths-wound',
      label: 'Enraged Behemoths',
      applies: hasKeyword('Monster'),
      condition: { switch: 'Below Half-strength', auto: 'belowHalf' },
      mods: [note('Add 1 to the Wound roll')],
    },
  ],
  'Hyper-adaptations': [
    {
      id: 'hyper-swarming',
      label: 'Hyper-adaptations: Swarming Instincts',
      applies: everyone,
      condition: { switch: 'Hyper-adaptation: Swarming Instincts', group: 'hyper-adaptation' },
      mods: [kw('sustained hits 1 (vs infantry, swarm)')],
    },
    {
      id: 'hyper-aggression',
      label: 'Hyper-adaptations: Hyper-aggression',
      applies: everyone,
      condition: { switch: 'Hyper-adaptation: Hyper-aggression', group: 'hyper-adaptation' },
      mods: [kw('lethal hits (vs monster, vehicle)')],
    },
    {
      id: 'hyper-predators',
      label: 'Hyper-adaptations: Hive Predators',
      applies: everyone,
      condition: { switch: 'Hyper-adaptation: Hive Predators', group: 'hyper-adaptation' },
      mods: [kw('precision on critical hits (vs character)')],
    },
  ],
  'Surprise Assault': [
    { id: 'surprise-reroll', label: 'Surprise Assault', applies: everyone, condition: 'always', mods: [note('Re-roll a Hit roll of 1')] },
    { id: 'surprise-burrower', label: 'Surprise Assault', applies: named('Mawloc', 'Trygon'), condition: 'always', mods: [{ kind: 'keyword', keyword: 'Burrower' }] },
  ],
  'Synaptic Imperatives': [
    {
      id: 'imperative-augmentation',
      label: 'Synaptic Imperatives: Synaptic Augmentation',
      applies: everyone,
      condition: { switch: 'Imperative: Synaptic Augmentation', group: 'synaptic-imperative', requires: SYNAPSE },
      mods: [{ kind: 'invuln', value: 5 }],
    },
    {
      id: 'imperative-vitality',
      label: 'Synaptic Imperatives: Surging Vitality',
      applies: everyone,
      condition: { switch: 'Imperative: Surging Vitality', group: 'synaptic-imperative', requires: SYNAPSE },
      mods: [note('Add 1 to Advance and Charge rolls')],
    },
    {
      id: 'imperative-slaughter',
      label: 'Synaptic Imperatives: Goaded to Slaughter',
      applies: everyone,
      condition: { switch: 'Imperative: Goaded to Slaughter', group: 'synaptic-imperative', requires: SYNAPSE },
      mods: [note('Add 1 to the Hit roll for melee attacks')],
    },
  ],
  'Higher Imperatives': [
    {
      id: 'protean-purpose',
      label: 'Higher Imperatives',
      applies: named('Norn Emissary', 'Norn Assimilator'),
      condition: 'always',
      mods: [note('Protean Purpose: once per battle, in your Command phase, choose Singular Purpose again')],
    },
  ],
  'Insurmountable Odds': [
    {
      id: 'insurmountable-odds',
      label: 'Insurmountable Odds',
      applies: hasKeyword('Endless Multitude'),
      condition: 'always',
      mods: [note('Can surge D6" when enemy shooting destroys one of its models')],
    },
  ],
  'Questing Tendrils': [
    { id: 'questing-fall-back', label: 'Questing Tendrils', applies: everyone, condition: 'always', mods: [note('Can charge after Falling Back')] },
    {
      id: 'questing-advance',
      label: 'Questing Tendrils',
      applies: hasKeyword('Vanguard Invader'),
      condition: 'always',
      mods: [note('Can charge after Advancing')],
    },
  ],
  'Feed the Swarm': [
    {
      id: 'feed-the-swarm',
      label: 'Feed the Swarm',
      applies: hasKeyword('Harvester'),
      condition: 'always',
      mods: [note('In your Command phase, can regenerate one friendly Tyranids unit within 6"')],
    },
  ],
};

interface EnhancementSpec extends EffectSpec {
  /** Whether the buff is for the model carrying it or its whole unit. */
  target: 'bearer' | 'unit';
}

/** Keyed by enhancement name. Enhancements that change no numbers are left to their own text. */
const ENHANCEMENT: Record<string, EnhancementSpec[]> = {
  'Destabilising Predation': [{ id: 'e', label: 'Destabilising Predation', target: 'unit', condition: 'always', mods: [kw('anti-character 2+', 'ranged')] }],
  'Power of the Hive Mind': [
    {
      id: 'e',
      label: 'Power of the Hive Mind',
      target: 'bearer',
      condition: 'always',
      mods: [
        { kind: 'weaponStat', stat: 'S', delta: 1, weapons: 'psychic' },
        { kind: 'weaponStat', stat: 'AP', delta: -1, weapons: 'psychic' },
      ],
    },
  ],
  'Elevated Might': [
    {
      id: 'e',
      label: 'Elevated Might',
      target: 'bearer',
      condition: 'always',
      mods: [{ kind: 'weaponStat', stat: 'AP', delta: -1, weapons: 'melee' }, note('Melee attacks can re-roll the Wound roll')],
    },
  ],
  'Ominous Presence': [{ id: 'e', label: 'Ominous Presence', target: 'bearer', condition: 'always', mods: [{ kind: 'stat', stat: 'OC', delta: 3 }] }],
  'Relentless Hunger': [{ id: 'e', label: 'Relentless Hunger', target: 'unit', condition: 'always', mods: [{ kind: 'stat', stat: 'M', delta: 2 }] }],
  'Ocular Adaptation': [{ id: 'e', label: 'Ocular Adaptation', target: 'unit', condition: 'always', mods: [note('Add 1 to the Hit roll for melee attacks')] }],
  Chameleonic: [{ id: 'e', label: 'Chameleonic', target: 'unit', condition: 'always', mods: [note('Has Stealth')] }],
  Synaptoprescience: [{ id: 'e', label: 'Synaptoprescience', target: 'unit', condition: 'always', mods: [{ kind: 'invuln', value: 4 }] }],
  'Adaptive Biology': [
    { id: 'e', label: 'Adaptive Biology', target: 'bearer', condition: 'always', mods: [{ kind: 'fnp', value: 5 }] },
    { id: 'e-wounded', label: 'Adaptive Biology', target: 'bearer', condition: { switch: 'Adaptive Biology: has lost a wound' }, mods: [{ kind: 'fnp', value: 4 }] },
  ],
  'Trygon Prime': [
    {
      id: 'e',
      label: 'Trygon Prime',
      target: 'bearer',
      condition: 'always',
      mods: [
        { kind: 'keyword', keyword: 'Synapse' },
        { kind: 'weaponStat', stat: 'S', delta: 1, weapons: 'melee' },
        { kind: 'weaponStat', stat: 'skill', delta: -1, weapons: 'melee' },
      ],
    },
  ],
  'Parasitic Biomorphology': [
    { id: 'e', label: 'Parasitic Biomorphology', target: 'unit', condition: 'always', mods: [{ kind: 'weaponStat', stat: 'S', delta: 1, weapons: 'melee' }] },
    {
      id: 'e-fed',
      label: 'Parasitic Biomorphology',
      target: 'unit',
      condition: { switch: 'Parasitic Biomorphology: destroyed a unit in melee near a Harvester' },
      mods: [{ kind: 'weaponStat', stat: 'A', delta: 1, weapons: 'melee' }],
    },
  ],
  'Synaptic Control': [{ id: 'e', label: 'Synaptic Control', target: 'bearer', condition: 'always', mods: [note('Subtract 1 from the Damage characteristic of each attack allocated to this model')] }],
  'Monstrous Nemesis': [{ id: 'e', label: 'Monstrous Nemesis', target: 'bearer', condition: 'always', mods: [note('Add 1 to the Wound roll for melee attacks against MONSTERS and VEHICLES')] }],
  Stalker: [{ id: 'e', label: 'Stalker', target: 'bearer', condition: 'always', mods: [note('Add 1 to the Hit roll and the Wound roll against the enemy unit chosen at the start of the battle')] }],
  'Piercing Talons': [{ id: 'e', label: 'Piercing Talons', target: 'unit', condition: 'always', mods: [note('On a Critical Wound, improve the attack’s Armour Penetration characteristic by 1')] }],
  'Perfectly Adapted': [{ id: 'e', label: 'Perfectly Adapted', target: 'bearer', condition: 'always', mods: [note('Once per turn, re-roll one Hit roll, Wound roll, Damage roll, Advance roll, Charge roll or saving throw')] }],
};

interface AuraSpec {
  /** Datasheet whose ability projects the aura. */
  source: string;
  ability: string;
  range: string;
  applies: (datasheet: Datasheet) => boolean;
  mods: Mod[];
}

const AURAS: AuraSpec[] = [
  { source: 'Hive Tyrant', ability: 'Onslaught (Aura, Psychic)', range: '6"', applies: everyone, mods: [kw('assault', 'ranged'), kw('lethal hits', 'ranged')] },
  { source: 'Tervigon', ability: 'Brood Progenitor (Aura, Psychic)', range: '6"', applies: named('Termagants'), mods: [kw('lethal hits', 'ranged')] },
  { source: 'Zoanthropes', ability: 'Warp Field (Aura, Psychic)', range: '6"', applies: everyone, mods: [{ kind: 'invuln', value: 6 }] },
  { source: 'Venomthropes', ability: 'Foul Spores (Aura)', range: '6"', applies: everyone, mods: [note('Has Stealth')] },
];

// ---- Working out a card's buffs ---------------------------------------------------------

/** One unit in the list, or a bodyguard unit together with the leaders attached to it. */
export interface Card {
  /** uid of the first member; identifies the card. */
  uid: string;
  name: string;
  members: CardMember[];
}

export interface CardMember {
  unit: ListUnit;
  datasheet: Datasheet;
  role: 'solo' | 'bodyguard' | 'leader';
  models: number;
  loadout: Loadout;
  /** Weapons still carried by the models left on the battlefield (battle sheet only). */
  live?: Loadout;
}

export const unitModels = (unit: ListUnit) => Number(/^(\d+)/.exec(unit.size)?.[1] ?? 1);

/** Groups a list's units into cards: leaders join the unit they are attached to. */
export function cardsFor(bundle: IndexedBundle, list: ArmyList, labels: Map<string, string>): Card[] {
  const member = (unit: ListUnit, role: CardMember['role']): CardMember | undefined => {
    const datasheet = bundle.datasheetById.get(unit.datasheetId);
    if (!datasheet) return undefined;
    const models = unitModels(unit);
    return { unit, datasheet, role, models, loadout: unit.loadout ?? defaultLoadout(datasheet, models) };
  };
  const attachedTo = (uid: string) => list.units.filter((u) => u.attachedTo === uid);
  const cards: Card[] = [];
  for (const unit of list.units) {
    const isAttached = unit.attachedTo && list.units.some((u) => u.uid === unit.attachedTo);
    if (isAttached) continue;
    const leaders = attachedTo(unit.uid);
    const members = [member(unit, leaders.length > 0 ? 'bodyguard' : 'solo'), ...leaders.map((l) => member(l, 'leader'))].filter(
      (m) => m !== undefined,
    );
    if (members.length === 0) continue;
    cards.push({
      uid: unit.uid,
      name: [unit, ...leaders].map((u) => labels.get(u.uid) ?? '').join(' + '),
      members,
    });
  }
  return cards;
}

export interface Effect {
  /** Unique within a card; used as the key for its switch. */
  id: string;
  /** The rule's name, e.g. "Vicious Insight". */
  label: string;
  /** Where it comes from, e.g. "Broodlord, leading this unit". */
  source: string;
  condition: Condition;
  mods: Mod[];
  /** uids of the members it changes. */
  targets: string[];
  /** Detachment and army-wide switches are shared by every card in the list. */
  listWide: boolean;
}

export function cardEffects(bundle: IndexedBundle, curation: Curation, list: ArmyList, card: Card): Effect[] {
  const effects: Effect[] = [];
  const everyoneOnCard = card.members.map((m) => m.unit.uid);
  const push = (spec: EffectSpec, key: string, id: string, source: string, targets: string[], listWide = false) => {
    if (targets.length === 0 || !curation.isCurrent(key)) return;
    effects.push({ id, label: spec.label, source, condition: spec.condition, mods: spec.mods, targets, listWide });
  };

  for (const m of card.members) {
    const name = m.datasheet.name;
    const key = (label: string) => abilityKey(name, label);
    for (const spec of SELF[name] ?? []) push(spec, key(spec.label), `self:${name}:${spec.id}`, `${name}’s own ability`, everyoneOnCard);
    if (m.role === 'leader') {
      for (const spec of LEADING[name] ?? []) push(spec, key(spec.label), `lead:${name}:${spec.id}`, `${name}, leading this unit`, everyoneOnCard);
    }
    if (m.role === 'bodyguard') {
      const leaders = card.members.filter((x) => x.role === 'leader').map((x) => x.unit.uid);
      for (const spec of BODYGUARD[name] ?? []) push(spec, key(spec.label), `guard:${name}:${spec.id}`, `${name}, the unit being led`, leaders);
    }
    const enhancement = m.unit.enhancementId ? bundle.enhancementById.get(m.unit.enhancementId) : undefined;
    if (enhancement) {
      for (const spec of ENHANCEMENT[enhancement.name] ?? []) {
        push(spec, enhancementKey(enhancement.name), `enh:${m.unit.uid}:${enhancement.name}:${spec.id}`, `Enhancement on ${name}`, spec.target === 'unit' ? everyoneOnCard : [m.unit.uid]);
      }
    }
  }

  for (const detachmentId of list.detachmentIds) {
    const detachment = bundle.detachmentById.get(detachmentId);
    for (const rule of detachment?.abilities ?? []) {
      for (const spec of DETACHMENT[rule.name] ?? []) {
        const targets = card.members.filter((m) => spec.applies(m.datasheet)).map((m) => m.unit.uid);
        push(spec, detachmentKey(rule.name), `det:${spec.id}`, `${detachment?.name} detachment`, targets, true);
      }
    }
  }

  // Auras from units in the list. The unit projecting an aura is always inside it.
  for (const aura of AURAS) {
    const sources = list.units.filter((u) => bundle.datasheetById.get(u.datasheetId)?.name === aura.source);
    if (sources.length === 0) continue;
    const onCard = card.members.some((m) => m.datasheet.name === aura.source);
    const targets = card.members.filter((m) => aura.applies(m.datasheet)).map((m) => m.unit.uid);
    push(
      { id: aura.ability, label: aura.ability, condition: onCard ? 'always' : { switch: `Within ${aura.range} of ${aura.source}` }, mods: aura.mods },
      abilityKey(aura.source, aura.ability),
      `aura:${aura.source}`,
      onCard ? `${aura.source}’s aura` : `${aura.source}’s aura, while within ${aura.range}`,
      targets,
    );
  }

  // Army rule: Synapse.
  const synapseUnit = card.members.some((m) => hasKeyword('Synapse')(m.datasheet));
  push(
    {
      id: SYNAPSE,
      label: 'Synapse',
      condition: { switch: 'Within Synapse Range', defaultOn: synapseUnit },
      mods: [{ kind: 'weaponStat', stat: 'S', delta: 1, weapons: 'melee' }],
    },
    armyKey('Synapse'),
    SYNAPSE,
    'Army rule, while within Synapse Range',
    everyoneOnCard,
  );

  return effects;
}

/** Key under which a switch's state is saved on the list. */
export const switchKey = (card: Card, effect: Effect) => (effect.listWide ? effect.id : `${card.uid}|${effect.id}`);

/** Whether a strength condition holds. Strength terms follow the core rules appendix. */
export function strengthMeets(condition: AutoCondition, strength: Strength): boolean {
  if (condition === 'atStarting') return strength === 'full';
  if (condition === 'belowHalf') return strength === 'belowHalf';
  return strength === 'belowStarting' || strength === 'half' || strength === 'belowHalf';
}

/**
 * Whether a buff applies. Pass the unit's strength (from tracked wounds) and buffs that depend on it
 * decide themselves; without it they fall back to their switch.
 */
export function isActive(effect: Effect, card: Card, all: Effect[], switches: Record<string, boolean>, strength?: Strength): boolean {
  if (effect.condition === 'always') return true;
  if (effect.condition.auto && strength) return strengthMeets(effect.condition.auto, strength);
  const on = switches[switchKey(card, effect)] ?? effect.condition.defaultOn ?? false;
  if (!on) return false;
  const requires = effect.condition.requires;
  if (!requires) return true;
  const needed = all.find((e) => e.id === requires);
  return needed !== undefined && isActive(needed, card, all, switches, strength);
}

/** Turns a switch on or off. Switches in the same group are alternatives, so turning one on turns the others off. */
export function toggleSwitch(switches: Record<string, boolean>, card: Card, effect: Effect, all: Effect[]): Record<string, boolean> {
  if (effect.condition === 'always') return switches;
  const key = switchKey(card, effect);
  const next = { ...switches, [key]: !(switches[key] ?? effect.condition.defaultOn ?? false) };
  const group = effect.condition.group;
  if (next[key] && group) {
    for (const other of all) {
      if (other !== effect && other.condition !== 'always' && other.condition.group === group) next[switchKey(card, other)] = false;
    }
  }
  return next;
}

// ---- Applying buffs to a profile --------------------------------------------------------

/** A displayed value, with the rules that changed it (empty when it is the printed value). */
export interface Shown {
  value: string;
  sources: string[];
  /** A penalty rather than a buff (e.g. a damaged profile). */
  debuff?: boolean;
}

export interface ShownModel {
  name: string;
  M: Shown;
  T: Shown;
  Sv: Shown;
  W: Shown;
  Ld: Shown;
  OC: Shown;
  invuln: Shown;
}

export interface ShownWeapon {
  name: string;
  count: number;
  ranged: boolean;
  range: string;
  A: Shown;
  skill: Shown;
  S: Shown;
  AP: Shown;
  D: Shown;
  keywords: Shown[];
}

export interface ShownMember {
  member: CardMember;
  models: ShownModel[];
  feelNoPain: Shown | null;
  weapons: ShownWeapon[];
  /** Keywords gained from buffs. */
  keywords: Shown[];
  notes: Shown[];
}

/** Adds to a printed characteristic: 6" -> 8", 10 -> 11, D6+3 -> D6+4, D6 -> D6+1. */
export function addTo(value: string, delta: number): string {
  if (delta === 0) return value;
  const inches = value.endsWith('"') ? '"' : '';
  const core = inches ? value.slice(0, -1) : value;
  if (/^-?\d+$/.test(core)) return `${Number(core) + delta}${inches}`;
  const dice = /^(\d*D\d+)(?:\+(\d+))?$/i.exec(core);
  if (dice) {
    const bonus = Number(dice[2] ?? 0) + delta;
    return `${dice[1]}${bonus > 0 ? `+${bonus}` : bonus < 0 ? `${bonus}` : ''}${inches}`;
  }
  return value;
}

const inScope = (scope: WeaponScope, weapon: Weapon, ranged: boolean) =>
  scope === 'all' || (scope === 'ranged' && ranged) || (scope === 'melee' && !ranged) || (scope === 'psychic' && weapon.keywords.some((k) => k.toLowerCase() === 'psychic'));

const why = (e: Effect) => `${e.label} (${e.source})`;

/** The numbers to show for one member of a card once the active buffs are applied. */
export function showMember(member: CardMember, active: Effect[]): ShownMember {
  const mine = active.filter((e) => e.targets.includes(member.unit.uid));
  const mods = mine.flatMap((e) => e.mods.map((mod) => ({ mod, source: why(e) })));

  const stat = (base: string, key: 'M' | 'T' | 'OC'): Shown => {
    const applied = mods.filter((m) => m.mod.kind === 'stat' && m.mod.stat === key);
    const delta = applied.reduce((sum, m) => sum + (m.mod.kind === 'stat' ? m.mod.delta : 0), 0);
    return { value: addTo(base, delta), sources: applied.map((m) => m.source) };
  };
  const best = (base: string, kind: 'invuln' | 'fnp'): Shown | null => {
    const printed = /^\d+/.exec(base)?.[0];
    let value = printed ? Number(printed) : 7;
    let sources: string[] = [];
    for (const m of mods) {
      if (m.mod.kind === kind && m.mod.value < value) {
        value = m.mod.value;
        sources = [m.source];
      }
    }
    return value === 7 ? null : { value: `${value}+`, sources };
  };
  const plain = (value: string): Shown => ({ value, sources: [] });

  const models = member.datasheet.models.map((m): ShownModel => ({
    name: m.name,
    M: stat(m.M, 'M'),
    T: stat(m.T, 'T'),
    Sv: plain(m.Sv),
    W: plain(m.W),
    Ld: plain(m.Ld),
    OC: stat(m.OC, 'OC'),
    invuln: best(m.invSv, 'invuln') ?? plain('-'),
  }));

  const printedFnp = member.datasheet.abilities.core.find((a) => /^feel no pain/i.test(a.name))?.parameter ?? '';
  const carried = carriedWeapons(member.datasheet, member.live ?? member.loadout);
  const weapon = ({ weapon: w, count }: { weapon: Weapon; count: number }, ranged: boolean): ShownWeapon => {
    const relevant = mods.filter((m) => (m.mod.kind === 'weaponStat' || m.mod.kind === 'weaponKeyword') && inScope(m.mod.weapons, w, ranged));
    const value = (base: string, key: 'A' | 'S' | 'AP' | 'skill'): Shown => {
      const applied = relevant.filter((m) => m.mod.kind === 'weaponStat' && m.mod.stat === key);
      const delta = applied.reduce((sum, m) => sum + (m.mod.kind === 'weaponStat' ? m.mod.delta : 0), 0);
      return { value: addTo(base, delta), sources: applied.map((m) => m.source) };
    };
    const gained = relevant
      .filter((m) => m.mod.kind === 'weaponKeyword')
      .map((m) => ({ value: m.mod.kind === 'weaponKeyword' ? m.mod.keyword : '', sources: [m.source] }))
      .filter((k) => !w.keywords.some((own) => own.toLowerCase() === k.value.toLowerCase()));
    return {
      name: w.name,
      count,
      ranged,
      range: w.range,
      A: value(w.A, 'A'),
      skill: value(w.skill, 'skill'),
      S: value(w.S, 'S'),
      AP: value(w.AP, 'AP'),
      D: plain(w.D),
      keywords: [...w.keywords.map(plain), ...gained],
    };
  };

  return {
    member,
    models,
    feelNoPain: best(printedFnp, 'fnp'),
    weapons: [...carried.ranged.map((w) => weapon(w, true)), ...carried.melee.map((w) => weapon(w, false))],
    keywords: mods.filter((m) => m.mod.kind === 'keyword').map((m) => ({ value: m.mod.kind === 'keyword' ? m.mod.keyword : '', sources: [m.source] })),
    notes: mods
      .filter((m) => m.mod.kind === 'note')
      .map((m) => ({ value: m.mod.kind === 'note' ? m.mod.text : '', sources: [m.source], debuff: m.mod.kind === 'note' && m.mod.debuff === true })),
  };
}

const SCOPE_LABEL: Record<WeaponScope, string> = { all: 'all weapons', melee: 'melee weapons', ranged: 'ranged weapons', psychic: 'psychic weapons' };

/** A buff's effect in words, for the "what changed and why" list. */
export function describeMod(mod: Mod): string {
  switch (mod.kind) {
    case 'weaponStat': {
      if (mod.stat === 'AP') return `Improve the Armour Penetration characteristic of ${SCOPE_LABEL[mod.weapons]} by ${Math.abs(mod.delta)}`;
      if (mod.stat === 'skill') return `Improve the Ballistic/Weapon Skill characteristic of ${SCOPE_LABEL[mod.weapons]} by ${Math.abs(mod.delta)}`;
      const name = mod.stat === 'A' ? 'Attacks' : 'Strength';
      return `${mod.delta > 0 ? 'Add' : 'Subtract'} ${Math.abs(mod.delta)} ${mod.delta > 0 ? 'to' : 'from'} the ${name} characteristic of ${SCOPE_LABEL[mod.weapons]}`;
    }
    case 'weaponKeyword':
      return `${SCOPE_LABEL[mod.weapons][0].toUpperCase()}${SCOPE_LABEL[mod.weapons].slice(1)} gain ${mod.keyword.toUpperCase()}`;
    case 'stat':
      return `${mod.delta > 0 ? 'Add' : 'Subtract'} ${Math.abs(mod.delta)}${mod.stat === 'M' ? '"' : ''} ${mod.delta > 0 ? 'to' : 'from'} the ${{ M: 'Move', T: 'Toughness', OC: 'Objective Control' }[mod.stat]} characteristic`;
    case 'invuln':
      return `${mod.value}+ invulnerable save`;
    case 'fnp':
      return `Feel No Pain ${mod.value}+`;
    case 'keyword':
      return `Gains the ${mod.keyword.toUpperCase()} keyword`;
    case 'note':
      return mod.text;
  }
}
