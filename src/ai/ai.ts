// The computer opponent. It plays only through Game's public methods, so it follows the same rules
// as the player. Difficulty changes how carefully it thinks:
//  - Easy: walks at the nearest enemy, shoots the closest target, charges when close, no stratagems.
//  - Normal: plays the objectives, picks targets by expected damage, charges when the odds are fair,
//    keeps Heavy weapons still, uses a few defensive stratagems.
//  - Hard: also compares several destinations per unit (objectives, cover, firing lanes) against how
//    exposed each one is, focuses fire to finish units, and drops Deep Strike units on weak targets.
import { objectiveAreas, centreOf } from '../engine/battlefield';
import { weaponAbilities } from '../engine/attacks';
import type { Game, ReactionWindow, ShootAssignment } from '../engine/game';
import { dist, edgeDistance, pointInPolygon, type Vec } from '../engine/geometry';
import { ENGAGEMENT_RANGE } from '../engine/movement';
import { engagePositions, formation, moveToward, translate, unitCentre } from '../engine/placement';
import { aliveModels, onBoard, other, type GameState, type UnitState } from '../engine/state';
import { hasCoreAbility, modelWeapons, moveOf, ocOf, unitHasKeyword } from '../engine/units';
import { inTerrainArea, unitDistance } from '../engine/visibility';
import { chargeChance, enemiesOf, expectedDamage, killFraction, meleeThreat, shootingThreat, unitValue } from './evaluate';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Opponent {
  /** Milliseconds between actions so the player can follow what happens. */
  pace: number;
  private rng: () => number;

  constructor(pace = 350, rng: () => number = Math.random) {
    this.pace = pace;
    this.rng = rng;
  }

  private get difficulty(): 'easy' | 'normal' | 'hard' {
    return this.game?.state.settings.difficulty ?? 'normal';
  }

  private game: Game | null = null;

  /** Whether the computer has something to do right now. */
  hasDuty(game: Game): boolean {
    const s = game.state;
    if (game.busy || s.phase === 'gameOver') return false;
    if (s.phase === 'deployment') return game.undeployed('ai').length > 0 && (s.deployer === 'ai' || game.undeployed('player').length === 0);
    if (s.phase === 'fight' && game.fight) {
      const f = game.fight;
      if (f.step === 'pileIn' || f.step === 'consolidate') return game.stepPlayer() === 'ai';
      if (f.step === 'fight') return f.picker === 'ai' && !game.fightStepOver();
      return s.active === 'ai';
    }
    return s.active === 'ai';
  }

  /** Does the next thing the computer has to do. Returns false when there was nothing to do. */
  async act(game: Game): Promise<boolean> {
    this.game = game;
    if (!this.hasDuty(game)) return false;
    const s = game.state;
    if (s.phase === 'deployment') {
      this.deployOne(game);
      await sleep(this.pace / 2);
      return true;
    }
    if (s.phase === 'fight' && game.fight && (s.active === 'player' || game.fight.step !== 'done')) {
      if (await this.fightDuty(game)) return true;
    }
    if (s.active !== 'ai') return false;
    switch (s.phase) {
      case 'command':
        await this.commandPhase(game);
        break;
      case 'movement':
        await this.movementPhase(game);
        break;
      case 'shooting':
        await this.shootingPhase(game);
        break;
      case 'charge':
        await this.chargePhase(game);
        break;
      case 'fight':
        if (!game.fight || game.fight.step === 'done') await game.endPhase();
        break;
    }
    return true;
  }

  // ---- Deployment ---------------------------------------------------------------------------

  private deployOne(game: Game) {
    const s = game.state;
    const u = game.undeployed('ai')[0];
    if (!u) return;
    if (this.difficulty !== 'easy' && hasCoreAbility(u, 'Deep Strike') && game.canGoToReserves(u)) {
      game.putInReserves(u.id);
      return;
    }
    const zone = s.battlefield.deployment.ai;
    const ys = zone.map((p) => p.y);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    const ranged = this.isRanged(game, u);
    const candidates: Vec[] = [];
    for (let x = 4; x <= s.battlefield.width - 4; x += 3) {
      for (let y = top + 2; y <= bottom - 1.5; y += 2) candidates.push({ x, y });
    }
    const scored = candidates
      .map((c) => {
        let score = this.rng() * 2;
        const coverHere = s.battlefield.terrain.some((t) => pointInPolygon(c, t.polygon));
        if (this.difficulty !== 'easy') {
          if (ranged && coverHere) score += 6;
          if (!ranged) score += (c.y - top) * 0.8; // melee units at the front
          if (ranged) score -= Math.abs(c.y - (top + 4)) * 0.3;
          const objectives = objectiveAreas(s.battlefield).map((a) => centreOf(a.polygon));
          score -= Math.min(...objectives.map((o) => dist(o, c))) * 0.15;
        }
        return { c, score };
      })
      .sort((a, b) => b.score - a.score);
    for (const { c } of scored) {
      const positions = formation(u, c);
      if (game.deploymentCheck(u.id, positions).ok) {
        game.deploy(u.id, positions);
        return;
      }
    }
    if (game.canGoToReserves(u)) game.putInReserves(u.id);
  }

  private isRanged(game: Game, u: UnitState): boolean {
    const enemies = game.unitsOf('player');
    const dummy = enemies[0];
    if (!dummy) return true;
    let ranged = 0;
    for (const m of aliveModels(u)) for (const w of modelWeapons(u, m)) if (w.ranged) ranged += expectedDamage({ ...w, count: 1 }, 1, dummy);
    return ranged >= meleeThreat(u, dummy) * 0.8;
  }

  // ---- Command phase ------------------------------------------------------------------------

  private async commandPhase(game: Game) {
    for (const u of game.battleShockDue('ai')) {
      await game.battleShockTest(u.id);
      await sleep(this.pace / 2);
    }
    await game.endPhase();
  }

  // ---- Movement phase -----------------------------------------------------------------------

  private async movementPhase(game: Game) {
    const s = game.state;
    const units = game.unitsOf('ai').filter((u) => game.moveOptions(u.id).length > 0);
    for (const u of units) {
      if (s.phase !== 'movement' || s.active !== 'ai') return;
      await this.moveUnit(game, u);
      await sleep(this.pace);
    }
    await game.endPhase();
  }

  private objectivesToTake(s: GameState): Vec[] {
    return objectiveAreas(s.battlefield)
      .filter((a, i) => s.objectives[i] !== 'ai' || a.objective === 3)
      .map((a) => centreOf(a.polygon));
  }

  private async moveUnit(game: Game, u: UnitState) {
    const s = game.state;
    const options = game.moveOptions(u.id);
    if (options.includes('ingress')) {
      await this.arrive(game, u);
      return;
    }
    if (options.includes('fallBack')) {
      const enemies = enemiesOf(s, u).filter((e) => unitDistance(u, e) <= ENGAGEMENT_RANGE);
      const myMelee = Math.max(0, ...enemies.map((e) => meleeThreat(u, e)));
      const theirMelee = Math.max(0, ...enemies.map((e) => meleeThreat(e, u)));
      if (this.difficulty !== 'easy' && this.isRanged(game, u) && theirMelee >= myMelee * 0.7) {
        const away = this.retreatPoint(s, u, enemies);
        const positions = moveToward(s, u, away, game.moveRules(u, 'fallBack', false));
        if (positions) {
          await game.move(u.id, 'fallBack', positions);
          return;
        }
      }
      await game.move(u.id, 'stationary', new Map());
      return;
    }
    const ranged = this.isRanged(game, u);
    const enemies = enemiesOf(s, u);
    if (enemies.length === 0) {
      await game.move(u.id, 'stationary', new Map());
      return;
    }
    const nearest = [...enemies].sort((a, b) => unitDistance(u, a) - unitDistance(u, b))[0];
    // Heavy weapons stay still when they already have a target (normal and hard).
    if (ranged && this.difficulty !== 'easy') {
      const heavy = aliveModels(u).some((m) => modelWeapons(u, m).some((w) => w.ranged && weaponAbilities(w.weapon.keywords).has('heavy')));
      const threatNow = Math.max(0, ...enemies.map((e) => shootingThreat(s, u, e)));
      const onObjective = this.onObjective(s, u);
      if ((heavy && threatNow > 1.5) || (onObjective && threatNow > 0.5)) {
        await game.move(u.id, 'stationary', new Map());
        return;
      }
    }

    let goal: Vec;
    let stopShort = ENGAGEMENT_RANGE + 0.6;
    if (this.difficulty === 'easy') {
      goal = unitCentre(nearest);
    } else if (this.difficulty === 'hard') {
      goal = this.bestDestination(game, u, ranged);
      stopShort = 0;
    } else if (ranged) {
      const objectives = this.objectivesToTake(s);
      goal = objectives.length > 0 ? [...objectives].sort((a, b) => dist(a, unitCentre(u)) - dist(b, unitCentre(u)))[0] : unitCentre(nearest);
      stopShort = 0.5;
    } else {
      const target = this.bestMeleeTarget(u, enemies);
      goal = unitCentre(target);
    }

    // Advance when it cannot charge this turn anyway and has ground to cover.
    const m0 = aliveModels(u)[0];
    const far = dist(unitCentre(u), goal) > moveOf(u, m0) + 1;
    const couldChargeAfterNormal = !ranged && unitDistance(u, nearest) - moveOf(u, m0) <= 11;
    const assault = aliveModels(u).some((m) => modelWeapons(u, m).some((w) => w.ranged && weaponAbilities(w.weapon.keywords).has('assault')));
    const advance = far && !couldChargeAfterNormal && (!ranged || assault || this.difficulty === 'easy') && options.includes('advance');
    let kind: 'normal' | 'advance' = 'normal';
    if (advance) {
      await game.rollAdvance(u.id);
      kind = 'advance';
    }
    const flying = game.canFly(u) && this.difficulty !== 'easy' && this.pathBlocked(s, u, goal);
    const positions = moveToward(s, u, goal, game.moveRules(u, kind, flying), stopShort);
    if (positions) await game.move(u.id, kind, positions, flying);
    else await game.move(u.id, 'stationary', new Map());
  }

  private pathBlocked(s: GameState, u: UnitState, goal: Vec): boolean {
    const c = unitCentre(u);
    return s.battlefield.terrain.some((t) => t.walls.length > 0 && pointInPolygon({ x: (c.x + goal.x) / 2, y: (c.y + goal.y) / 2 }, t.polygon));
  }

  private onObjective(s: GameState, u: UnitState): boolean {
    return objectiveAreas(s.battlefield).some((a) => aliveModels(u).some((m) => pointInPolygon(m, a.polygon)));
  }

  private retreatPoint(s: GameState, u: UnitState, enemies: UnitState[]): Vec {
    const c = unitCentre(u);
    const e = enemies.length > 0 ? unitCentre(enemies[0]) : { x: c.x, y: c.y + 1 };
    const away = { x: c.x + (c.x - e.x), y: c.y + (c.y - e.y) - 4 };
    return { x: Math.max(2, Math.min(s.battlefield.width - 2, away.x)), y: Math.max(2, Math.min(s.battlefield.height - 2, away.y)) };
  }

  private bestMeleeTarget(u: UnitState, enemies: UnitState[]): UnitState {
    return [...enemies].sort((a, b) => {
      const score = (e: UnitState) => (killFraction(e, meleeThreat(u, e, true)) * unitValue(e)) / (1 + unitDistance(u, e) / 6);
      return score(b) - score(a);
    })[0];
  }

  /** Hard: compares objectives, cover and firing positions against how exposed each spot is. */
  private bestDestination(game: Game, u: UnitState, ranged: boolean): Vec {
    const s = game.state;
    const enemies = enemiesOf(s, u);
    const c = unitCentre(u);
    const goals: Vec[] = [...this.objectivesToTake(s)];
    for (const t of s.battlefield.terrain) goals.push(centreOf(t.polygon));
    for (const e of enemies.slice(0, 6)) goals.push(unitCentre(e));
    const rules = game.moveRules(u, 'normal', false);
    let best = { score: -Infinity, goal: goals[0] ?? c };
    for (const goal of goals) {
      if (dist(goal, c) > 30) continue;
      const positions = moveToward(s, u, goal, rules, ranged ? 0 : ENGAGEMENT_RANGE + 0.6);
      if (!positions) continue;
      const moved = aliveModels(u).map((m) => ({ ...m, ...positions.get(m.id) }));
      let score = 0;
      // Objectives: OC that would stand on an objective the AI does not hold.
      objectiveAreas(s.battlefield).forEach((a, i) => {
        if (s.objectives[i] === 'ai') return;
        const oc = moved.filter((m) => pointInPolygon(m, a.polygon)).reduce((x, m) => x + ocOf(u, m), 0);
        score += Math.min(oc, 6) * 2;
      });
      if (ranged) {
        score += Math.max(0, ...enemies.map((e) => shootingThreat(s, u, e, positions) * unitValue(e) / 20));
      } else {
        const nearestAfter = Math.min(...enemies.map((e) => Math.min(...moved.flatMap((m) => aliveModels(e).map((n) => edgeDistance(m, n))))));
        score += Math.max(0, 12 - nearestAfter) * 1.2;
      }
      // Exposure: how much the player could shoot this unit there.
      const exposure = enemies.reduce((x, e) => x + Math.min(8, shootingThreatAt(s, e, u, positions)), 0);
      score -= exposure * (ranged ? 0.8 : 0.4);
      if (moved.every((m) => inTerrainArea(s.battlefield.terrain, m))) score += 2;
      if (score > best.score) best = { score, goal };
    }
    return best.goal;
  }

  /** Arrival from reserves: Deep Strike near a juicy target, otherwise along an edge near an objective. */
  private async arrive(game: Game, u: UnitState) {
    const s = game.state;
    const enemies = game.unitsOf('player').filter(onBoard);
    const candidates: Vec[] = [];
    if (u.deepStrike) {
      for (const e of enemies) {
        const c = unitCentre(e);
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          candidates.push({ x: c.x + Math.cos(a) * 11, y: c.y + Math.sin(a) * 11 });
        }
      }
    }
    for (let x = 4; x < s.battlefield.width; x += 4) candidates.push({ x, y: 3 }, { x, y: s.battlefield.height - 3 });
    for (let y = 4; y < s.battlefield.height; y += 4) candidates.push({ x: 3, y }, { x: s.battlefield.width - 3, y });
    const scored = candidates
      .map((c) => {
        const positions = formation(u, c);
        if (!game.ingressCheck(u, positions).ok) return null;
        const threat = Math.max(0, ...enemies.map((e) => shootingThreat(s, u, e, positions) * (this.difficulty === 'hard' ? unitValue(e) / 10 : 1)));
        return { positions, score: threat + this.rng() };
      })
      .filter((x): x is { positions: Map<string, Vec>; score: number } => x !== null)
      .sort((a, b) => b.score - a.score);
    if (scored.length === 0) {
      await game.move(u.id, 'stationary', new Map());
      return;
    }
    await game.move(u.id, 'ingress', scored[0].positions);
  }

  // ---- Shooting phase -----------------------------------------------------------------------

  private async shootingPhase(game: Game) {
    const s = game.state;
    const shooters = game.unitsOf('ai').filter((u) => game.shootingTypes(u).length > 0);
    // Expected damage already aimed at each target this phase, to focus fire without overkill.
    const planned = new Map<string, number>();
    for (const u of shooters) {
      if (s.phase !== 'shooting' || s.active !== 'ai') return;
      const types = game.shootingTypes(u);
      if (types.length === 0) continue;
      const type = types.includes('normal') ? 'normal' : types[0];
      const assignments: ShootAssignment[] = [];
      for (const w of game.rangedWeapons(u)) {
        let best: { profile: string; target: UnitState; score: number } | null = null;
        for (const p of w.profiles) {
          const targets = game.weaponTargets(u, w.key, p.weapon.name, type);
          for (const t of targets) {
            const exp = expectedDamage(p, w.carriers / Math.max(1, p.count), t);
            const left = aliveModels(t).reduce((x, m) => x + m.w, 0) - (planned.get(t.id) ?? 0);
            let score: number;
            if (this.difficulty === 'easy') score = -unitDistance(u, t) + this.rng();
            else if (this.difficulty === 'normal') score = Math.min(exp, Math.max(0, left)) * (unitValue(t) / Math.max(1, left + 1));
            else score = Math.min(exp, Math.max(0, left)) * (unitValue(t) / Math.max(1, left + 1)) * (left <= exp * 1.2 ? 1.6 : 1);
            if (!best || score > best.score) best = { profile: p.weapon.name, target: t, score };
          }
        }
        if (best) {
          assignments.push({ key: w.key, profile: best.profile, targetId: best.target.id });
          const p = w.profiles.find((x) => x.weapon.name === best!.profile)!;
          planned.set(best.target.id, (planned.get(best.target.id) ?? 0) + expectedDamage(p, w.carriers, best.target));
        }
      }
      if (assignments.length === 0) continue;
      await game.shoot(u.id, type, assignments);
      await sleep(this.pace);
    }
    await game.endPhase();
  }

  // ---- Charge phase -------------------------------------------------------------------------

  private async chargePhase(game: Game) {
    const s = game.state;
    for (const u of game.unitsOf('ai').filter((x) => game.canDeclareCharge(x))) {
      if (s.phase !== 'charge' || s.active !== 'ai') return;
      const targets = game.chargeTargetsInRange(u);
      let best: { t: UnitState; score: number; chance: number } | null = null;
      for (const t of targets) {
        const needed = Math.max(0, unitDistance(u, t) - ENGAGEMENT_RANGE + 0.3);
        const chance = chargeChance(needed);
        const value = killFraction(t, meleeThreat(u, t, true)) * unitValue(t) - killFraction(u, meleeThreat(t, u)) * unitValue(u) * 0.5;
        const score = chance * value;
        if (!best || score > best.score) best = { t, score, chance };
      }
      if (!best) continue;
      const go =
        this.difficulty === 'easy' ? unitDistance(u, best.t) <= 9 : this.difficulty === 'normal' ? best.chance >= 0.35 && best.score > 0 : best.chance >= 0.3 && best.score > 0.5;
      if (!go) continue;
      const distance = await game.declareCharge(u.id);
      if (!game.charge) continue;
      const reachable = game.chargeTargets();
      const target = reachable.includes(best.t) ? best.t : reachable[0];
      if (!target) {
        game.failCharge();
        continue;
      }
      const positions = engagePositions(s, u, [target.id], distance);
      const check = game.checkCharge([target.id], positions);
      if (check.ok) await game.chargeMove([target.id], positions);
      else {
        // Try the whole unit as a block instead.
        const block = this.blockCharge(game, u, target, distance);
        if (block) await game.chargeMove([target.id], block);
        else game.failCharge();
      }
      await sleep(this.pace);
    }
    await game.endPhase();
  }

  private blockCharge(game: Game, u: UnitState, target: UnitState, distance: number): Map<string, Vec> | null {
    const c = unitCentre(u);
    const t = unitCentre(target);
    const d = dist(c, t);
    for (let k = distance; k > 0.5; k -= 0.5) {
      const positions = translate(u, { x: ((t.x - c.x) / d) * k, y: ((t.y - c.y) / d) * k });
      if (game.checkCharge([target.id], positions).ok) return positions;
    }
    return null;
  }

  // ---- Fight phase --------------------------------------------------------------------------

  private async fightDuty(game: Game): Promise<boolean> {
    const s = game.state;
    const f = game.fight;
    if (!f) return false;
    if ((f.step === 'pileIn' || f.step === 'consolidate') && game.stepPlayer() === 'ai') {
      const units = f.step === 'pileIn' ? game.pileInUnits('ai') : game.consolidateUnits('ai');
      for (const u of units) {
        const targets = game.pileInTargets(u);
        if (targets.length === 0) continue;
        const positions = engagePositions(s, u, targets.map((t) => t.id), 3);
        if (game.checkPileIn(u.id, positions, f.step === 'pileIn' ? 'pileIn' : 'consolidate').ok) {
          await game.pileIn(u.id, positions, f.step === 'pileIn' ? 'pileIn' : 'consolidate');
          await sleep(this.pace / 2);
        }
      }
      game.finishStep('ai');
      return true;
    }
    if (f.step === 'fight' && f.picker === 'ai' && !game.fightStepOver()) {
      const pickable = game.pickableUnits();
      if (pickable.length === 0) {
        game.passFight('ai');
        return true;
      }
      let best: { u: UnitState; t: UnitState; score: number } | null = null;
      for (const u of pickable) {
        for (const t of game.meleeTargets(u)) {
          const score = killFraction(t, meleeThreat(u, t, u.flags.charged)) * unitValue(t);
          if (!best || score > best.score) best = { u, t, score };
        }
      }
      if (!best) {
        if (game.canPass('ai')) game.passFight('ai');
        else {
          const u = pickable[0];
          await game.fightWith(u.id, { targetId: game.meleeTargets(u)[0]?.id ?? '' });
        }
        return true;
      }
      await game.fightWith(best.u.id, { targetId: best.t.id });
      await sleep(this.pace);
      return true;
    }
    if (f.step === 'done' && s.active === 'ai') {
      await game.endPhase();
      return true;
    }
    return false;
  }

  // ---- Reactions ----------------------------------------------------------------------------

  /** Decides whether to use a stratagem in a reaction window. */
  async react(game: Game, window: ReactionWindow): Promise<void> {
    this.game = game;
    if (this.difficulty === 'easy') return;
    const s = game.state;
    const keep = this.difficulty === 'hard' ? 1 : 2;
    if (s.cp.ai < keep) return;
    if (window.moment === 'targeted') {
      const target = window.unitIds.map((id) => game.unit(id))[0];
      const enemy = window.enemyUnitId ? game.unit(window.enemyUnitId) : undefined;
      if (!target || !enemy) return;
      const threat = s.phase === 'fight' ? meleeThreat(enemy, target) : shootingThreat(s, enemy, target);
      if (killFraction(target, threat) < 0.25 && unitValue(target) < 30) return;
      const pick =
        window.stratagems.find((x) => /armour of contempt/i.test(x.name)) ??
        window.stratagems.find((x) => /tactical foresight/i.test(x.name));
      if (pick && game.stratagemTargets('ai', pick, [target.id]).length > 0) game.useStratagem('ai', pick.id, target.id);
    }
    if (window.moment === 'afterChargeMove' || window.moment === 'enemyMoved' || window.moment === 'end') return;
  }
}

/** Expected damage the shooter could do to the unit if it stood at these positions. */
function shootingThreatAt(s: GameState, shooter: UnitState, target: UnitState, positions: Map<string, Vec>): number {
  const original = aliveModels(target).map((m) => ({ m, x: m.x, y: m.y }));
  for (const m of aliveModels(target)) {
    const p = positions.get(m.id);
    if (p) {
      m.x = p.x;
      m.y = p.y;
    }
  }
  try {
    return shootingThreat(s, shooter, target);
  } finally {
    for (const o of original) {
      o.m.x = o.x;
      o.m.y = o.y;
    }
  }
}

export const isEnemyOf = (a: UnitState, b: UnitState) => a.owner === other(b.owner);
export const hasKeyword = unitHasKeyword;
