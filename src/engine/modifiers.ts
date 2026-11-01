// What changes a unit's numbers right now: buffs from the Tyranid buff tables (leaders, auras,
// Synapse, detachment rules, enhancements; see rules/effects) and temporary effects such as stratagems.
import { BUNDLES, tyranidCuration } from '../data/bundles';
import type { Card, CardMember, Effect, Mod } from '../rules/effects';
import { cardEffects, strengthMeets } from '../rules/effects';
import { edgeDistance } from './geometry';
import { aliveModels, onBoard, type EngineMod, type GameState, type ModelState, type UnitState } from './state';
import { datasheetOf, modelHasKeyword, strengthOfUnit } from './units';

export const SYNAPSE_RANGE = 6;

/** Tyranids army rule: within 6" of a friendly SYNAPSE model. */
export function withinSynapseRange(state: GameState, unit: UnitState): boolean {
  if (unit.faction !== 'tyranids') return false;
  if (state.effects.some((e) => e.unitId === unit.id && e.source === 'Neuroloids')) return true;
  const synapseModels = state.units
    .filter((u) => u.owner === unit.owner && onBoard(u))
    .flatMap((u) => aliveModels(u).filter((m) => modelHasKeyword(u, m, 'Synapse')).map((m) => ({ u, m })));
  return aliveModels(unit).some((m) => synapseModels.some((s) => s.u.id === unit.id || edgeDistance(m, s.m) <= SYNAPSE_RANGE));
}

/** A rules/effects card for a game unit, so the phone app's buff tables can be reused. */
function cardFor(unit: UnitState): Card {
  const members: CardMember[] = unit.members.map((m, i) => {
    const list = { uid: m.listUid, datasheetId: m.datasheetId, size: `${m.models} models`, wargearCounts: {}, enhancementId: m.enhancementId };
    return { unit: list, datasheet: datasheetOf(unit, i), role: m.role, models: m.models, loadout: {} };
  });
  return { uid: unit.members[0].listUid, name: unit.name, members };
}

export interface BuffState {
  effect: Effect;
  active: boolean;
  /** Why it is on or off when the game decides (e.g. "within 6\" of Hive Tyrant"). */
  decidedBy: 'always' | 'strength' | 'distance' | 'synapse' | 'player';
}

/** Every buff that could apply to the unit, and whether it applies right now. */
export function unitBuffs(state: GameState, unit: UnitState): BuffState[] {
  if (unit.faction !== 'tyranids') return [];
  const army = state.armies[unit.owner];
  const card = cardFor(unit);
  const effects = cardEffects(BUNDLES.tyranids, tyranidCuration, army.list, card);
  const strength = strengthOfUnit(unit);
  const memo = new Map<string, BuffState>();
  const evaluate = (e: Effect): BuffState => {
    const cached = memo.get(e.id);
    if (cached) return cached;
    let result: BuffState;
    if (e.condition === 'always') result = { effect: e, active: true, decidedBy: 'always' };
    else if (e.condition.auto) result = { effect: e, active: strengthMeets(e.condition.auto, strength), decidedBy: 'strength' };
    else if (e.condition.switch === 'Within Synapse Range') result = { effect: e, active: withinSynapseRange(state, unit), decidedBy: 'synapse' };
    else {
      const near = /^Within (\d+)" of (.+)$/.exec(e.condition.switch);
      if (near) {
        const range = Number(near[1]);
        const sourceName = near[2];
        const active = state.units.some(
          (u) =>
            u.owner === unit.owner &&
            u.id !== unit.id &&
            onBoard(u) &&
            aliveModels(u).some((s) => datasheetOf(u, s.member).name === sourceName && aliveModels(unit).some((m) => edgeDistance(m, s) <= range)),
        );
        result = { effect: e, active, decidedBy: 'distance' };
      } else {
        const on = (e.listWide ? army.switches[e.id] : unit.switches[e.id]) ?? e.condition.defaultOn ?? false;
        result = { effect: e, active: on, decidedBy: 'player' };
      }
      const requires = e.condition.requires;
      if (result.active && requires) {
        const needed = effects.find((x) => x.id === requires);
        result = { ...result, active: needed !== undefined && evaluate(needed).active };
      }
    }
    memo.set(e.id, result);
    return result;
  };
  return effects.map(evaluate);
}

/** The buff mods that apply to one model now (a buff targets members of the card by list uid). */
export function buffModsFor(state: GameState, unit: UnitState, model: ModelState): Mod[] {
  const uid = unit.members[model.member].listUid;
  return unitBuffs(state, unit)
    .filter((b) => b.active && b.effect.targets.includes(uid))
    .flatMap((b) => b.effect.mods);
}

/** Temporary effects (stratagems etc.) on a unit right now. */
export function effectMods(state: GameState, unit: UnitState): EngineMod[] {
  return state.effects.filter((e) => e.unitId === unit.id).flatMap((e) => e.mods);
}

/** All modifiers on a model, with buff mods converted to engine mods. */
export function modsFor(state: GameState, unit: UnitState, model: ModelState): EngineMod[] {
  const out: EngineMod[] = [...effectMods(state, unit)];
  for (const mod of buffModsFor(state, unit, model)) {
    const scope = mod.kind === 'weaponStat' || mod.kind === 'weaponKeyword' ? mod.weapons : 'all';
    const weapons = scope === 'melee' ? 'melee' : scope === 'ranged' ? 'ranged' : undefined;
    if (scope === 'psychic') {
      // Psychic-only buffs are applied in attacks.ts by keyword; skip here.
      continue;
    }
    switch (mod.kind) {
      case 'weaponStat':
        if (mod.stat === 'skill') out.push({ kind: 'hit', delta: -mod.delta, weapons });
        else out.push({ kind: 'weaponStat', stat: mod.stat, delta: mod.delta, weapons });
        break;
      case 'weaponKeyword':
        out.push({ kind: 'weaponKeyword', keyword: mod.keyword, weapons });
        break;
      case 'invuln':
        out.push({ kind: 'invuln', value: mod.value });
        break;
      case 'fnp':
        out.push({ kind: 'fnp', value: mod.value });
        break;
      case 'stat':
        if (mod.stat === 'M') out.push({ kind: 'move', delta: mod.delta });
        if (mod.stat === 'OC') out.push({ kind: 'oc', delta: mod.delta });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Psychic-weapon buffs (e.g. +1 S and -1 AP to psychic weapons) for a model. */
export function psychicBuffs(state: GameState, unit: UnitState, model: ModelState): { S: number; AP: number } {
  let S = 0;
  let AP = 0;
  for (const mod of buffModsFor(state, unit, model)) {
    if (mod.kind === 'weaponStat' && mod.weapons === 'psychic') {
      if (mod.stat === 'S') S += mod.delta;
      if (mod.stat === 'AP') AP += mod.delta;
    }
  }
  return { S, AP };
}

/** Toughness changes from buffs (e.g. a leader giving +1 T). */
export function toughnessBonus(state: GameState, unit: UnitState): number {
  const model = aliveModels(unit)[0];
  if (!model) return 0;
  return buffModsFor(state, unit, model).reduce((sum, mod) => sum + (mod.kind === 'stat' && mod.stat === 'T' ? mod.delta : 0), 0);
}

/** Text notes from buffs that the engine does not apply itself (shown to the player). */
export function buffNotes(state: GameState, unit: UnitState): string[] {
  return unitBuffs(state, unit)
    .filter((b) => b.active)
    .flatMap((b) => b.effect.mods.filter((m) => m.kind === 'note').map((m) => `${b.effect.label}: ${(m as { text: string }).text}`));
}
