// Making attacks (04) and the attack sequence (05): hit rolls, wound rolls, save rolls and damage,
// with the weapon abilities from section 24.
import type { Weapon } from '../data/types';
import { parseDice, rollExpr, type Roller, type RollKind } from './dice';
import { edgeDistance } from './geometry';
import { modsFor, psychicBuffs, toughnessBonus } from './modifiers';
import { isEngaged } from './movement';
import { aliveModels, type EngineMod, type GameState, type LogEntry, type ModelState, type PlayerId, type UnitState } from './state';
import { canSeeModel, hasCover } from './visibility';
import { invulnOf, isMonsterOrVehicle, modelDatasheet, modelHasKeyword, num, saveOf, toughnessOf, unitHasKeyword } from './units';

export interface AttackContext {
  state: GameState;
  roll: Roller;
  log: (text: string, kind?: LogEntry['kind']) => void;
}

/** One weapon profile fired (or swung) by some models of a unit at one target. */
export interface AttackGroup {
  attacker: UnitState;
  models: ModelState[];
  weapon: Weapon;
  key: string;
  ranged: boolean;
  target: UnitState;
  /** Indirect shooting (10.07). */
  indirect?: boolean;
  /** Snap shooting (Fire Overwatch, 15.09): hits only on unmodified 6s. */
  snap?: boolean;
}

export interface AttackResult {
  attacks: number;
  hits: number;
  wounds: number;
  unsaved: number;
  mortal: number;
  modelsDestroyed: number;
  damage: number;
}

// ---- Weapon abilities ---------------------------------------------------------------------

export interface WeaponAbilities {
  list: string[];
  has: (name: string) => boolean;
  /** Number after the ability, e.g. 2 for "sustained hits 2" or "blast 2" (default 1 when absent). */
  value: (name: string) => number | null;
  /** Anti-X Y+ entries. */
  anti: { keyword: string; on: number }[];
}

/** Abilities that apply against this target; "lethal hits: vehicle" only counts against VEHICLE units (24.01). */
export function weaponAbilities(keywords: string[], target?: UnitState): WeaponAbilities {
  const list = keywords
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .filter((k) => {
      const parts = k.split(':');
      if (parts.length < 2 || !target) return true;
      return parts[1].split('/').some((kw) => unitHasKeyword(target, kw.trim()));
    })
    .map((k) => k.split(':')[0].trim());
  const find = (name: string) => list.find((k) => k === name || k.startsWith(`${name} `));
  const anti = list
    .map((k) => /^anti-(.+?)\s+(\d)\+$/.exec(k))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ keyword: m[1], on: Number(m[2]) }));
  return {
    list,
    has: (name) => find(name) !== undefined,
    value: (name) => {
      const k = find(name);
      if (k === undefined) return null;
      const n = Number(/(\d+)/.exec(k.slice(name.length))?.[1]);
      return Number.isFinite(n) ? n : 1;
    },
    anti,
  };
}

const scoped = (mods: EngineMod[], ranged: boolean) =>
  mods.filter((m) => !('weapons' in m) || m.weapons === undefined || m.weapons === (ranged ? 'ranged' : 'melee'));

const sumOf = (mods: EngineMod[], kind: EngineMod['kind']) =>
  mods.reduce((s, m) => s + (m.kind === kind && 'delta' in m ? m.delta : 0), 0);

const clamp1 = (n: number) => Math.max(-1, Math.min(1, n));

/** 05.02 wound roll needed for Strength against Toughness. */
export function woundTarget(s: number, t: number): number {
  if (s >= t * 2) return 2;
  if (s > t) return 3;
  if (s === t) return 4;
  if (s * 2 <= t) return 6;
  return 5;
}

// ---- Allocation (05.03) and damage ----------------------------------------------------------

interface AllocationGroup {
  models: ModelState[];
  character: boolean;
}

function allocationGroups(target: UnitState): AllocationGroup[] {
  const alive = aliveModels(target);
  const groups: AllocationGroup[] = [];
  for (const m of alive) {
    if (m.character) {
      groups.push({ models: [m], character: true });
      continue;
    }
    const key = `${m.maxW}|${saveOf(target, m)}|${invulnOf(target, m)}`;
    const existing = groups.find((g) => !g.character && `${g.models[0].maxW}|${saveOf(target, g.models[0])}|${invulnOf(target, g.models[0])}` === key);
    if (existing) existing.models.push(m);
    else groups.push({ models: [m], character: false });
  }
  const wounded = (g: AllocationGroup) => g.models.some((m) => m.w > 0 && m.w < m.maxW);
  // Non-characters first (wounded ones first), then characters (wounded ones first).
  return groups.sort((a, b) => Number(a.character) - Number(b.character) || Number(wounded(b)) - Number(wounded(a)));
}

/** The model that takes the next attack from a group: one that has lost wounds if possible. */
function pickModel(group: AllocationGroup): ModelState | undefined {
  const alive = group.models.filter((m) => m.w > 0);
  return alive.find((m) => m.w < m.maxW) ?? alive[0];
}

function invulnFor(state: GameState, unit: UnitState, m: ModelState): number {
  let best = invulnOf(unit, m);
  for (const mod of modsFor(state, unit, m)) if (mod.kind === 'invuln' && mod.value < best) best = mod.value;
  return best;
}

function fnpFor(state: GameState, unit: UnitState, m: ModelState): number {
  let best = 7;
  for (const a of modelDatasheet(unit, m).abilities.core) {
    if (/^feel no pain/i.test(a.name)) best = Math.min(best, num(a.parameter, 7));
  }
  for (const mod of modsFor(state, unit, m)) if (mod.kind === 'fnp' && mod.value < best) best = mod.value;
  return best;
}

/** Applies damage to one model, rolling Feel No Pain for each wound. Returns wounds actually lost. */
async function inflict(ctx: AttackContext, target: UnitState, m: ModelState, damage: number, label: string): Promise<number> {
  const fnp = fnpFor(ctx.state, target, m);
  let lost = damage;
  if (fnp <= 6 && damage > 0) {
    const rolls = await ctx.roll({ who: target.owner, kind: 'fnp', label: `Feel No Pain ${fnp}+ for ${m.name} (${label})`, count: damage, need: `${fnp}+` });
    const ignored = rolls.filter((r) => r >= fnp).length;
    lost = damage - ignored;
    if (ignored > 0) ctx.log(`${m.name} ignores ${ignored} wound${ignored === 1 ? '' : 's'} (Feel No Pain).`);
  }
  const before = m.w;
  m.w = Math.max(0, m.w - lost);
  return before - m.w;
}

/** 06.02: mortal wounds go to wounded non-characters first, then other non-characters, then characters. */
export async function applyMortalWounds(ctx: AttackContext, target: UnitState, amount: number, label: string, perModelCap?: number): Promise<number> {
  let destroyed = 0;
  let remaining = amount;
  while (remaining > 0) {
    const alive = aliveModels(target);
    if (alive.length === 0) break;
    const nonChar = alive.filter((m) => !m.character);
    const pool = nonChar.length > 0 ? nonChar : alive;
    const m = pool.find((x) => x.w < x.maxW) ?? pool[0];
    const chunk = perModelCap !== undefined ? Math.min(remaining, perModelCap) : 1;
    await inflict(ctx, target, m, Math.min(chunk, m.w), label);
    if (m.w === 0) destroyed++;
    remaining -= perModelCap !== undefined ? chunk : 1;
  }
  return destroyed;
}

// ---- The attack sequence --------------------------------------------------------------------

interface Profile {
  weapon: Weapon;
  abilities: WeaponAbilities;
  attacksPerModel: string;
  aBonus: number;
  skill: number;
  torrent: boolean;
  S: number;
  AP: number;
  D: string;
  dBonus: number;
  hitMod: number;
  woundMod: number;
  critHitOn: number;
  rerollHits: 'ones' | 'fails' | null;
  rerollWounds: 'ones' | 'fails' | null;
}

function profileFor(ctx: AttackContext, g: AttackGroup, model: ModelState): Profile {
  const { state } = ctx;
  const mods = scoped(modsFor(state, g.attacker, model), g.ranged);
  const extraKeywords = mods.filter((m) => m.kind === 'weaponKeyword').map((m) => (m as { keyword: string }).keyword);
  const abilities = weaponAbilities([...g.weapon.keywords, ...extraKeywords], g.target);
  const psychic = abilities.has('psychic') ? psychicBuffs(state, g.attacker, model) : { S: 0, AP: 0 };
  const targetMods = scoped(state.effects.filter((e) => e.unitId === g.target.id).flatMap((e) => e.mods), g.ranged);
  const weaponStat = (stat: 'A' | 'S' | 'AP' | 'D') => mods.reduce((s, m) => s + (m.kind === 'weaponStat' && m.stat === stat ? m.delta : 0), 0);
  const reroll = (kind: 'rerollHits' | 'rerollWounds') => {
    const found = mods.filter((m) => m.kind === kind) as { which: 'ones' | 'fails' }[];
    if (found.some((f) => f.which === 'fails')) return 'fails' as const;
    return found.length > 0 ? ('ones' as const) : null;
  };
  const critMods = mods.filter((m) => m.kind === 'critHit') as { on: number }[];
  return {
    weapon: g.weapon,
    abilities,
    attacksPerModel: g.weapon.A,
    aBonus: weaponStat('A'),
    skill: num(g.weapon.skill, 0),
    torrent: abilities.has('torrent'),
    S: num(g.weapon.S, 1) + weaponStat('S') + psychic.S,
    AP: num(g.weapon.AP, 0) + weaponStat('AP') + psychic.AP,
    D: g.weapon.D,
    dBonus: weaponStat('D'),
    hitMod: sumOf(mods, 'hit') + sumOf(targetMods, 'enemyHit'),
    woundMod: sumOf(mods, 'wound') + sumOf(targetMods, 'enemyWound'),
    critHitOn: Math.min(6, ...critMods.map((c) => c.on)),
    rerollHits: reroll('rerollHits'),
    rerollWounds: reroll('rerollWounds'),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function rollWithReroll(
  ctx: AttackContext,
  who: PlayerId,
  kind: RollKind,
  label: string,
  count: number,
  need: string,
  fails: (v: number) => boolean,
  reroll: 'ones' | 'fails' | null,
): Promise<number[]> {
  if (count === 0) return [];
  const first = await ctx.roll({ who, kind, label, count, need });
  if (!reroll) return first;
  const redo = first.map((v, i) => ({ v, i })).filter(({ v }) => (reroll === 'ones' ? v === 1 : fails(v)));
  if (redo.length === 0) return first;
  const again = await ctx.roll({ who, kind, label: `Re-roll ${label.charAt(0).toLowerCase()}${label.slice(1)}`, count: redo.length, need, reroll: true });
  const out = [...first];
  redo.forEach(({ i }, k) => (out[i] = again[k]));
  return out;
}

/** Resolves one weapon profile's attacks against its target (04.03 steps 2-3 and the attack sequence). */
export async function resolveGroup(ctx: AttackContext, g: AttackGroup): Promise<AttackResult> {
  const { state } = ctx;
  const result: AttackResult = { attacks: 0, hits: 0, wounds: 0, unsaved: 0, mortal: 0, modelsDestroyed: 0, damage: 0 };
  if (aliveModels(g.target).length === 0 || g.models.length === 0) return result;
  const first = g.models[0];
  const p = profileFor(ctx, g, first);
  const range = num(g.weapon.range, 0);
  const targetModels = aliveModels(g.target).length;
  const engagedAttacker = g.ranged && isEngaged(state, g.attacker);

  // Gather attack dice: per model, with Rapid Fire / Melta measured from that model.
  let attacks = 0;
  let meltaModels = 0;
  for (const m of g.models) {
    const count = m.weapons[g.key] ?? 1;
    const near = g.ranged && range > 0 && Math.min(...aliveModels(g.target).map((t) => edgeDistance(m, t))) <= range / 2;
    for (let i = 0; i < count; i++) {
      const expr = parseDice(p.attacksPerModel);
      let a = expr.dice > 0 ? -1 : expr.plus;
      if (a < 0) a = await rollExpr(ctx.roll, expr, { who: g.attacker.owner, kind: 'attacks', label: `Number of attacks for ${g.weapon.name} (${p.attacksPerModel})` });
      a += p.aBonus;
      if (near && p.abilities.has('rapid fire')) a += p.abilities.value('rapid fire') ?? 1;
      if (p.abilities.has('blast')) a += Math.floor(targetModels / 5) * (p.abilities.value('blast') ?? 1);
      if (!g.ranged && p.abilities.has('cleave')) a += Math.floor(targetModels / 5) * (p.abilities.value('cleave') ?? 1);
      attacks += Math.max(0, a);
      if (near && p.abilities.has('melta')) meltaModels++;
    }
  }
  result.attacks = attacks;
  if (attacks === 0) return result;
  const who = g.attacker.owner;
  const what = `${plural(attacks, 'attack')} with ${g.weapon.name} at ${g.target.name}`;

  // 1. Hit rolls.
  let hits = 0;
  let autoWounds = 0;
  if (p.torrent) {
    hits = attacks;
  } else {
    let skill = p.skill;
    const cover = g.ranged && !p.abilities.has('ignores cover') && (hasCover(state, first, g.target) || g.indirect);
    if (cover) skill += 1;
    let hitMod = p.hitMod;
    if (g.ranged && p.abilities.has('heavy') && !engagedAttacker && !g.attacker.flags.setUp && g.attacker.flags.maxMoved <= 3) hitMod += 1;
    const closeQuarters = p.abilities.has('pistol') || p.abilities.has('close-quarters');
    // 17.03 / 10.06: shooting at an engaged MONSTER/VEHICLE, or a MONSTER/VEHICLE shooting while engaged.
    const targetEngagedBig = isEngaged(state, g.target) && aliveModels(g.target).some((t) => isMonsterOrVehicle(g.target, t));
    if (g.ranged && targetEngagedBig && !(closeQuarters && engagedAttacker)) hitMod -= 1;
    else if (engagedAttacker && isMonsterOrVehicle(g.attacker, first) && !closeQuarters) hitMod -= 1;
    if (p.abilities.has('psychic')) {
      // [PSYCHIC]: modifiers to BS/WS and the hit roll can be ignored; ignore the bad ones.
      if (cover) skill -= 1;
      hitMod = Math.max(0, hitMod);
    }
    hitMod = clamp1(hitMod);
    const snap = g.snap === true;
    const indirectFailUpTo = g.indirect ? (g.attacker.flags.move === 'stationary' ? 3 : 5) : 0;
    const isHit = (v: number) => {
      if (v === 1) return false;
      if (snap) return v === 6;
      if (v <= indirectFailUpTo) return false;
      if (v >= p.critHitOn) return true;
      return v + hitMod >= skill;
    };
    const need = snap ? '6' : `${skill - hitMod}+${hitMod !== 0 ? ` (BS/WS ${skill}+${hitMod > 0 ? ', +1' : ', -1'})` : ''}${cover ? ', target in cover' : ''}`;
    const rolls = await rollWithReroll(ctx, who, 'hit', `Hit rolls: ${what}`, attacks, need, (v) => !isHit(v), g.indirect || snap ? null : p.rerollHits);
    const sustained = p.abilities.value('sustained hits');
    const lethal = p.abilities.has('lethal hits') && !p.abilities.has('devastating wounds');
    for (const v of rolls) {
      if (!isHit(v)) continue;
      const crit = v >= p.critHitOn && !snap;
      if (crit && lethal) autoWounds++;
      else hits++;
      if (crit && sustained) hits += sustained;
    }
    ctx.log(`${g.attacker.name}: ${plural(attacks, 'attack')} with ${g.weapon.name} → ${hits + autoWounds} hit${hits + autoWounds === 1 ? '' : 's'}${autoWounds ? ` (${autoWounds} Lethal Hits)` : ''}${cover ? ' (target has cover)' : ''}.`, 'attack');
  }
  result.hits = hits + autoWounds;

  // 2. Wound rolls.
  const T = toughnessOf(g.target) + toughnessBonus(state, g.target);
  const needed = woundTarget(p.S, T);
  let woundMod = p.woundMod;
  if (!g.ranged && p.abilities.has('lance') && g.attacker.flags.charged) woundMod += 1;
  woundMod = clamp1(woundMod);
  const critWoundOn = Math.min(6, ...p.abilities.anti.filter((a) => unitHasKeyword(g.target, a.keyword)).map((a) => a.on));
  const isWound = (v: number) => v !== 1 && (v >= critWoundOn || v + woundMod >= needed);
  const rerollWounds = p.abilities.has('twin-linked') ? 'fails' : p.rerollWounds;
  const woundRolls = await rollWithReroll(ctx, who, 'wound', `Wound rolls: ${plural(hits, 'hit')} from ${g.weapon.name} (S${p.S} vs T${T})`, hits, `${needed - woundMod}+`, (v) => !isWound(v), rerollWounds);
  let wounds = autoWounds;
  let devastating = 0;
  for (const v of woundRolls) {
    if (!isWound(v)) continue;
    if (v >= critWoundOn && p.abilities.has('devastating wounds')) devastating++;
    else wounds++;
  }
  result.wounds = wounds + devastating;
  if (hits > 0) ctx.log(`→ ${plural(wounds + devastating, 'wound')}${devastating ? ` (${devastating} Devastating Wounds)` : ''} (${needed - woundMod}+ needed).`, 'attack');

  // 3-4. Save rolls and damage, lowest results first.
  const groups = allocationGroups(g.target);
  if (p.abilities.has('precision')) {
    const visibleCharacter = groups.findIndex((gr) => gr.character && g.models.some((m) => canSeeModel(state, m, g.target, gr.models[0]).visible));
    if (visibleCharacter > 0) groups.unshift(...groups.splice(visibleCharacter, 1));
  }
  if (wounds > 0) {
    const saveMod = sumOf(state.effects.filter((e) => e.unitId === g.target.id).flatMap((e) => e.mods), 'save');
    const sample = groups[0]?.models[0];
    const sv = sample ? saveOf(g.target, sample) : 7;
    const inv = sample ? invulnFor(state, g.target, sample) : 7;
    const saveNeed = Math.min(inv, sv - p.AP - saveMod);
    const saves = (await ctx.roll({ who: g.target.owner, kind: 'save', label: `Save rolls for ${g.target.name} against ${g.weapon.name} (AP${p.AP})`, count: wounds, need: `${saveNeed}+` })).sort((a, b) => a - b);
    const reduction = Math.max(0, ...state.effects.filter((e) => e.unitId === g.target.id).flatMap((e) => e.mods).map((m) => (m.kind === 'damageReduction' ? m.amount : 0)));
    let gi = 0;
    for (const v of saves) {
      while (gi < groups.length && groups[gi].models.every((m) => m.w === 0)) gi++;
      if (gi >= groups.length) break;
      const model = pickModel(groups[gi])!;
      const groupInv = invulnFor(state, g.target, model);
      const groupSv = saveOf(g.target, model);
      const saved = v !== 1 && (v >= groupInv || v + p.AP + saveMod >= groupSv);
      if (saved) continue;
      result.unsaved++;
      let dmg = await rollExpr(ctx.roll, parseDice(p.D), { who, kind: 'damage', label: `Damage roll for ${g.weapon.name} (${p.D})` });
      dmg += p.dBonus;
      if (meltaModels > 0 && p.abilities.has('melta')) dmg += p.abilities.value('melta') ?? 0;
      if (reduction > 0) dmg = Math.max(1, dmg - reduction);
      const lost = await inflict(ctx, g.target, model, Math.min(dmg, model.w), g.weapon.name);
      result.damage += lost;
      if (model.w === 0) result.modelsDestroyed++;
    }
  }

  // Devastating Wounds: mortal wounds after normal damage, each crit damaging at most one model (24.10).
  if (devastating > 0) {
    for (let i = 0; i < devastating; i++) {
      const dmg = (await rollExpr(ctx.roll, parseDice(p.D), { who, kind: 'damage', label: `Damage for Devastating Wounds (${p.D})` })) + p.dBonus;
      const before = aliveModels(g.target).length;
      await applyMortalWounds(ctx, g.target, dmg, `Devastating Wounds from ${g.weapon.name}`, dmg);
      result.mortal += dmg;
      result.modelsDestroyed += before - aliveModels(g.target).length;
    }
  }
  if (result.wounds > 0) {
    ctx.log(`→ ${plural(result.unsaved, 'failed save')}, ${plural(result.damage + result.mortal, 'wound')} lost, ${plural(result.modelsDestroyed, 'model')} destroyed.`, 'attack');
  }
  return result;
}

/** Hazard rolls (06.03) after a unit's attacks, one per [HAZARDOUS] weapon used. */
export async function hazardRolls(ctx: AttackContext, unit: UnitState, count: number): Promise<void> {
  if (count === 0) return;
  const rolls = await ctx.roll({ who: unit.owner, kind: 'hazard', label: `Hazard rolls for ${unit.name}`, count, need: '3+' });
  const failed = rolls.filter((v) => v <= 2).length;
  if (failed === 0) return;
  const big = aliveModels(unit).every((m) => isMonsterOrVehicle(unit, m));
  await applyMortalWounds(ctx, unit, failed * (big ? 3 : 1), 'hazard roll');
  ctx.log(`${unit.name} failed ${plural(failed, 'hazard roll')}.`, 'warn');
}

/** Marks units with no models left as destroyed. */
export function removeDestroyed(state: GameState): UnitState[] {
  const gone: UnitState[] = [];
  for (const u of state.units) {
    if (u.status === 'onBoard' && aliveModels(u).length === 0) {
      u.status = 'destroyed';
      gone.push(u);
    }
  }
  return gone;
}

export const modelIsPsyker = (u: UnitState, m: ModelState) => modelHasKeyword(u, m, 'Psyker');
