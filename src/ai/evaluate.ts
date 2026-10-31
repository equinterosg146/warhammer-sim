// Expected-value estimates the computer opponent uses to compare options. They follow the same
// rules as engine/attacks.ts but average the dice instead of rolling them.
import { weaponAbilities, woundTarget } from '../engine/attacks';
import { averageOf, parseDice } from '../engine/dice';
import { parseRange } from '../engine/game';
import { edgeDistance } from '../engine/geometry';
import { aliveModels, onBoard, type GameState, type ModelState, type UnitState } from '../engine/state';
import { invulnOf, modelWeapons, num, saveOf, toughnessOf, unitHasKeyword, type ModelWeapon } from '../engine/units';
import { canSeeModel, hasCover } from '../engine/visibility';

const pAtLeast = (n: number) => Math.max(0, Math.min(1, (7 - Math.max(2, n)) / 6));

/** Expected wounds lost by the target from one weapon fired by `count` models. */
export function expectedDamage(w: ModelWeapon, shooters: number, target: UnitState, opts: { cover?: boolean; charged?: boolean } = {}): number {
  if (aliveModels(target).length === 0 || shooters === 0) return 0;
  const ab = weaponAbilities(w.weapon.keywords, target);
  const models = aliveModels(target).length;
  let attacks = averageOf(parseDice(w.weapon.A)) * shooters * w.count;
  if (ab.has('blast')) attacks += Math.floor(models / 5) * (ab.value('blast') ?? 1) * shooters;
  if (ab.has('rapid fire')) attacks += (ab.value('rapid fire') ?? 1) * shooters * 0.5;
  const skill = num(w.weapon.skill, 4) + (opts.cover && !ab.has('ignores cover') ? 1 : 0);
  const pHit = ab.has('torrent') ? 1 : pAtLeast(skill);
  const pCrit = ab.has('torrent') ? 0 : 1 / 6;
  let hits = attacks * pHit;
  if (ab.has('sustained hits')) hits += attacks * pCrit * (ab.value('sustained hits') ?? 1);
  const lethal = ab.has('lethal hits') ? attacks * pCrit : 0;
  hits -= lethal;
  const S = num(w.weapon.S, 4);
  const T = toughnessOf(target);
  let pWound = pAtLeast(woundTarget(S, T) - (opts.charged && ab.has('lance') ? 1 : 0));
  if (ab.has('twin-linked')) pWound = pWound + (1 - pWound) * pWound;
  const antiOn = Math.min(7, ...ab.anti.filter((a) => unitHasKeyword(target, a.keyword)).map((a) => a.on));
  const pCritWound = antiOn <= 6 ? pAtLeast(antiOn) : 1 / 6;
  const wounds = hits * Math.max(pWound, pCritWound) + lethal;
  const devastating = ab.has('devastating wounds') ? hits * pCritWound : 0;
  const sample = aliveModels(target)[0];
  const AP = num(w.weapon.AP, 0);
  const saveNeed = Math.min(invulnOf(target, sample), saveOf(target, sample) - AP);
  const pFail = 1 - pAtLeast(saveNeed);
  const dmg = averageOf(parseDice(w.weapon.D));
  const perModel = sample.maxW;
  const effectiveDmg = Math.min(dmg, perModel);
  return (wounds - devastating) * pFail * effectiveDmg + devastating * effectiveDmg;
}

/** Points-free value of a unit: how much it matters to kill (wounds left times how dangerous it is). */
export function unitValue(u: UnitState): number {
  const alive = aliveModels(u);
  const wounds = alive.reduce((s, m) => s + m.w, 0);
  const offence = alive.reduce((s, m) => s + modelWeapons(u, m).reduce((x, w) => x + averageOf(parseDice(w.weapon.A)) * averageOf(parseDice(w.weapon.D)) * w.count, 0), 0);
  const character = alive.some((m) => m.character) ? 1.4 : 1;
  return (wounds + offence) * character;
}

/** Fraction of the target destroyed by an expected amount of damage. */
export function killFraction(target: UnitState, damage: number): number {
  const total = aliveModels(target).reduce((s, m) => s + m.w, 0);
  return total === 0 ? 0 : Math.min(1, damage / total);
}

/** Expected damage a unit's ranged weapons could deal to a target from where its models stand now. */
export function shootingThreat(state: GameState, attacker: UnitState, target: UnitState, from?: Map<string, { x: number; y: number }>): number {
  let total = 0;
  const models = aliveModels(attacker).map((m) => ({ ...m, ...(from?.get(m.id) ?? {}) }) as ModelState);
  const cover = models.length > 0 && hasCover(state, models[0], target);
  const byKey = new Map<string, { w: ModelWeapon; count: number }>();
  for (const m of models) {
    for (const w of modelWeapons(attacker, m).filter((x) => x.ranged)) {
      const range = parseRange(w.weapon.range);
      const inRange = aliveModels(target).some((t) => edgeDistance(m, t) <= range);
      if (!inRange) continue;
      const seen = weaponAbilities(w.weapon.keywords).has('indirect fire') || aliveModels(target).some((t) => canSeeModel(state, m, target, t).visible);
      if (!seen) continue;
      const k = `${w.key}|${w.weapon.name}`;
      const entry = byKey.get(k) ?? { w, count: 0 };
      entry.count++;
      byKey.set(k, entry);
    }
  }
  // Weapons with several profiles: count only the best profile per key.
  const bestPerKey = new Map<string, number>();
  for (const { w, count } of byKey.values()) {
    const d = expectedDamage({ ...w, count: 1 }, count * w.count, target, { cover });
    bestPerKey.set(w.key, Math.max(bestPerKey.get(w.key) ?? 0, d));
  }
  for (const d of bestPerKey.values()) total += d;
  return total;
}

/** Expected damage in melee if every model fights with its best weapon (plus extra attacks). */
export function meleeThreat(attacker: UnitState, target: UnitState, charged = false): number {
  let total = 0;
  for (const m of aliveModels(attacker)) {
    const melee = modelWeapons(attacker, m).filter((w) => !w.ranged);
    const extra = melee.filter((w) => weaponAbilities(w.weapon.keywords).has('extra attacks'));
    const main = melee.filter((w) => !extra.includes(w));
    const best = Math.max(0, ...main.map((w) => expectedDamage({ ...w, count: 1 }, 1, target, { charged })));
    total += best + extra.reduce((s, w) => s + expectedDamage({ ...w, count: 1 }, 1, target, { charged }), 0);
  }
  return total;
}

/** Chance that 2D6 (+bonus) is at least `needed`. */
export function chargeChance(needed: number, bonus = 0): number {
  const n = Math.ceil(needed - bonus);
  if (n <= 2) return 1;
  if (n > 12) return 0;
  let ways = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b >= n) ways++;
  return ways / 36;
}

export const enemiesOf = (state: GameState, u: UnitState) => state.units.filter((x) => x.owner !== u.owner && onBoard(x));
export const friendsOf = (state: GameState, u: UnitState) => state.units.filter((x) => x.owner === u.owner && onBoard(x) && x.id !== u.id);

/** How much more a unit is built for melee than for shooting (positive = melee unit). */
export function meleeLean(u: UnitState, dummyTarget: UnitState): number {
  const ranged = aliveModels(u).reduce((s, m) => s + modelWeapons(u, m).filter((w) => w.ranged).reduce((x, w) => x + expectedDamage({ ...w, count: 1 }, 1, dummyTarget), 0), 0);
  return meleeThreat(u, dummyTarget) - ranged;
}
