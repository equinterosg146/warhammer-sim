// The game controller: runs deployment, the battle round (07), each phase (08-12), objectives (14),
// stratagems (15) and scoring. All rules decisions live here or in the modules it calls; the UI and the
// computer opponent only call these methods.
import { BUNDLES } from '../data/bundles';
import type { Stratagem } from '../data/types';
import { applyMortalWounds, hazardRolls, removeDestroyed, resolveGroup, weaponAbilities, type AttackContext, type AttackGroup } from './attacks';
import { objectiveAreas } from './battlefield';
import { parseDice, rollExpr, type DiceRequest, type Roller } from './dice';
import { circleTouchesPolygon, dist, edgeDistance, pointInPolygon, pointPolygonDistance, type Vec } from './geometry';
import { effectMods, modsFor, withinSynapseRange } from './modifiers';
import { checkMove, coherencyProblems, ENGAGEMENT_RANGE, engagedWith, isEngaged, type MoveCheck, type MoveRules } from './movement';
import { armyStratagems, fitsMoment, parseEffect, sectionOf, stratagemText, unitTargetedThisPhase, usedThisPhase, type Moment } from './stratagems';
import { copyNumbers, unitPoints } from '../rules/army';
import {
  aliveModels,
  freshFlags,
  onBoard,
  other,
  TURN_PHASES,
  unitById,
  type ActiveEffect,
  type GameState,
  type LogEntry,
  type ModelState,
  type MoveKind,
  type Phase,
  type PlayerId,
  type UnitState,
} from './state';
import {
  atOrBelowHalf,
  bestLeadership,
  hasCoreAbility,
  isMonsterOrVehicle,
  modelHasKeyword,
  modelWeapons,
  moveOf,
  ocOf,
  unitHasKeyword,
  type ModelWeapon,
} from './units';
import { canSeeModel, modelUnitDistance, unitDistance } from './visibility';

export const ROUNDS = 5;
export const CHARGE_RANGE = 12;
export const PILE_IN_DISTANCE = 3;
export const RESERVE_EDGE_DISTANCE = 6;
export const RESERVE_ENEMY_DISTANCE = 8;
export const VP_PER_OBJECTIVE = 5;
export const MAX_PRIMARY_PER_TURN = 15;

/** A moment when a player may react with a stratagem (e.g. just after an enemy unit selected targets). */
export interface ReactionWindow {
  player: PlayerId;
  moment: Moment;
  /** Short description for the player, e.g. "Hive Guard is about to shoot your Termagants". */
  prompt: string;
  /** Units of the reacting player the window is about (e.g. the unit being targeted). */
  unitIds: string[];
  /** The enemy unit that caused it, if any. */
  enemyUnitId?: string;
  stratagems: Stratagem[];
}

export interface GameHooks {
  roll: Roller;
  /** Called when a player can react with a stratagem; resolves when they have chosen (or passed). */
  react: (window: ReactionWindow) => Promise<void>;
  changed: () => void;
  /** Called when a unit can make a surge move; resolves once the player has moved (or skipped). */
  surge?: (unitId: string, maxDistance: number, label: string) => Promise<void>;
  /** Called just before an attacker resolves attacks against a target (for aim animations). */
  attack?: (attackerId: string, targetId: string) => Promise<void>;
}

export interface ShootAssignment {
  /** Weapon key carried by models (rules/loadout weaponKey). */
  key: string;
  /** Weapon profile name (for weapons with several profiles, the one chosen). */
  profile: string;
  targetId: string;
}

export interface FightAssignment {
  /** Melee weapon profile each model uses (besides [EXTRA ATTACKS] weapons), by model id; missing = best one. */
  profiles?: Record<string, string>;
  targetId: string;
}

export interface ChargeState {
  unitId: string;
  distance: number;
}

export type FightStep = 'pileIn' | 'fight' | 'consolidate' | 'done';

export interface FightState {
  step: FightStep;
  /** Players who have finished the current pile-in / consolidate step. */
  done: PlayerId[];
  /** Whose turn it is to pick a unit to fight. */
  picker: PlayerId;
  /** Players who passed in a row (11th ed: "eligible but unable to fight"). */
  passes: PlayerId[];
}

export class Game {
  state: GameState;
  hooks: GameHooks;
  busy = false;

  get charge(): ChargeState | null {
    return this.state.charge;
  }
  set charge(v: ChargeState | null) {
    this.state.charge = v;
  }
  get fight(): FightState | null {
    return this.state.fight;
  }
  set fight(v: FightState | null) {
    this.state.fight = v;
  }

  constructor(state: GameState, hooks: GameHooks) {
    this.state = state;
    this.hooks = hooks;
  }

  // ---- Utilities ------------------------------------------------------------------------

  log(text: string, kind: LogEntry['kind'] = 'info', player: PlayerId | null = null) {
    this.state.log.push({ turn: this.state.turn, phase: this.state.phase, player, text, kind });
    if (this.state.log.length > 600) this.state.log.splice(0, this.state.log.length - 600);
  }

  changed() {
    this.hooks.changed();
  }

  roll(req: DiceRequest) {
    return this.hooks.roll(req);
  }

  ctx(): AttackContext {
    return { state: this.state, roll: (r) => this.roll(r), log: (t, k) => this.log(t, k) };
  }

  unit(id: string): UnitState {
    const u = unitById(this.state, id);
    if (!u) throw new Error(`No unit ${id}`);
    return u;
  }

  unitsOf(player: PlayerId) {
    return this.state.units.filter((u) => u.owner === player);
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    this.busy = true;
    this.changed();
    try {
      return await fn();
    } finally {
      this.busy = false;
      await this.triggerDeadlyDemise();
      this.updateObjectives();
      this.checkGameOver();
      this.changed();
    }
  }

  /** Roll for Deadly Demise on any unit that was just removed from the board. */
  private async triggerDeadlyDemise(): Promise<void> {
    const gone = removeDestroyed(this.state);
    for (const u of gone) {
      for (let i = 0; i < u.members.length; i++) {
        const d = BUNDLES[u.faction]?.datasheetById.get(u.members[i].datasheetId);
        if (!d) continue;
        const dd = d.abilities.core.find((a) => a.name === 'Deadly Demise');
        if (!dd?.parameter) continue;
        for (const m of u.models.filter((x) => x.member === i)) {
          const [roll] = await this.roll({ who: u.owner, kind: 'other', label: `Deadly Demise ${dd.parameter}: ${m.name} destroyed`, count: 1 });
          if (roll >= 6) {
            this.log(`Deadly Demise! ${m.name} detonates (rolled ${roll}): units within 6" suffer ${dd.parameter} mortal wounds.`, 'warn', u.owner);
            for (const target of this.state.units.filter((t) => onBoard(t) && t.id !== u.id)) {
              if (!aliveModels(target).some((tm) => edgeDistance(m, tm) <= 6)) continue;
              const wounds = await rollExpr((r) => this.roll(r), parseDice(dd.parameter), { who: u.owner, kind: 'other', label: `Deadly Demise wounds on ${target.name}` });
              if (wounds > 0) await applyMortalWounds(this.ctx(), target, wounds, `Deadly Demise (${m.name})`);
            }
          } else {
            this.log(`Deadly Demise: ${m.name} rolled ${roll} (no explosion).`, 'info', u.owner);
          }
        }
      }
    }
  }

  // ---- Deployment ---------------------------------------------------------------------

  /** Units still to be set up, by player. */
  undeployed(player: PlayerId) {
    return this.unitsOf(player).filter((u) => u.status === 'undeployed');
  }

  /** Points of a game unit (all its members), from the army list. */
  unitPoints(unit: UnitState): number {
    const army = this.state.armies[unit.owner];
    const bundle = BUNDLES[army.faction];
    const copies = copyNumbers(army.list.units);
    return unit.members.reduce((sum, m) => {
      const lu = army.list.units.find((x) => x.uid === m.listUid);
      return sum + (lu ? unitPoints(bundle, lu, copies.get(lu.uid) ?? 1) : 0);
    }, 0);
  }

  /** 20.01: strategic reserves cannot exceed half the points limit; Fortifications cannot go in reserves. */
  canGoToReserves(unit: UnitState): boolean {
    if (unitHasKeyword(unit, 'Fortification')) return false;
    if (unitHasKeyword(unit, 'Aircraft')) return true;
    const army = this.state.armies[unit.owner];
    const already = this.unitsOf(unit.owner).filter((u) => u.status === 'reserves').reduce((sum, u) => sum + this.unitPoints(u), 0);
    return already + this.unitPoints(unit) <= army.list.pointsLimit / 2;
  }

  /** Places a unit in strategic reserves (20.01); Deep Strike units arrive anywhere > 8" from enemies. */
  putInReserves(unitId: string) {
    const u = this.unit(unitId);
    u.status = 'reserves';
    u.deepStrike = hasCoreAbility(u, 'Deep Strike');
    this.log(`${u.name} ${u.deepStrike ? 'will arrive by Deep Strike' : 'is placed in strategic reserves'}.`, 'info', u.owner);
    this.afterDeploy(u.owner);
  }

  deploymentCheck(unitId: string, positions: Map<string, Vec>): MoveCheck {
    const u = this.unit(unitId);
    const rules: MoveRules = { kind: 'deploy', maxDistance: () => Infinity, flying: false };
    const check = checkMove(this.state, u, positions, rules);
    const infiltrator = hasCoreAbility(u, 'Infiltrators');
    const zone = this.state.battlefield.deployment[u.owner];
    const enemyZone = this.state.battlefield.deployment[other(u.owner)];
    for (const m of aliveModels(u)) {
      const p = positions.get(m.id) ?? m;
      if (infiltrator) {
        const nearZone = pointInPolygon(p, enemyZone) || distanceToZone(p, enemyZone) - m.r < 9;
        const nearEnemy = this.state.units.some((e) => e.owner !== u.owner && onBoard(e) && aliveModels(e).some((n) => edgeDistance({ ...p, r: m.r }, n) < 9));
        if (nearZone || nearEnemy) check.problems.push({ modelId: m.id, message: `${m.name} must be more than 9" from the enemy deployment zone and enemy units (Infiltrators).` });
      } else if (!circleWhollyIn(p, m.r, zone)) {
        check.problems.push({ modelId: m.id, message: `${m.name} must be wholly within your deployment zone.` });
      }
    }
    check.ok = check.problems.length === 0;
    return check;
  }

  deploy(unitId: string, positions: Map<string, Vec>): MoveCheck {
    const check = this.deploymentCheck(unitId, positions);
    if (!check.ok) return check;
    const u = this.unit(unitId);
    for (const m of aliveModels(u)) {
      const p = positions.get(m.id) ?? m;
      m.x = p.x;
      m.y = p.y;
    }
    u.status = 'onBoard';
    this.log(`${u.name} is deployed.`, 'move', u.owner);
    this.afterDeploy(u.owner);
    return check;
  }

  private afterDeploy(player: PlayerId) {
    const next = other(player);
    this.state.deployer = this.undeployed(next).length > 0 ? next : player;
    this.changed();
  }

  deploymentFinished() {
    return this.undeployed('player').length === 0 && this.undeployed('ai').length === 0;
  }

  /** Ends deployment and starts battle round 1 (07.01). */
  async startBattle() {
    if (!this.deploymentFinished()) return;
    this.state.round = 1;
    this.state.turn = 0;
    this.state.active = this.state.firstPlayer;
    this.log(`Battle round 1 begins. ${this.state.firstPlayer === 'player' ? 'You take' : 'The Ultramarines take'} the first turn.`, 'info');
    await this.beginTurn();
  }

  // ---- Turn and phase flow ------------------------------------------------------------

  private async beginTurn() {
    for (const u of this.state.units) u.flags = freshFlags();
    this.state.checklist = [];
    this.state.phase = 'command';
    await this.beginPhase();
  }

  private async beginPhase() {
    const s = this.state;
    this.state.advance = {};
    this.charge = null;
    this.fight = null;
    // Effects that last until the start of the player's next Command phase.
    if (s.phase === 'command') s.effects = s.effects.filter((e) => !(e.until === 'nextCommand' && this.unit(e.unitId).owner === s.active));
    if (s.phase === 'command') {
      s.cp.player += 1;
      s.cp.ai += 1;
      this.log(`Command phase: both players gain 1 CP (you have ${s.cp.player} CP).`, 'info');
    }
    const whose = s.active === 'player' ? 'your' : 'the Ultramarines’';
    if (s.phase !== 'command') {
      await this.offerReactions(s.active, 'start', `Start of ${whose} ${phaseName(s.phase)} phase`, []);
      await this.offerReactions(other(s.active), 'start', `Start of ${whose} ${phaseName(s.phase)} phase`, []);
    }
    if (s.phase === 'fight') this.startFightPhase();
    this.changed();
  }

  /** Units that must take a battle-shock test in this Command phase (08.03). */
  battleShockDue(player: PlayerId = this.state.active): UnitState[] {
    if (this.state.phase !== 'command') return [];
    return this.unitsOf(player).filter((u) => onBoard(u) && (u.battleShocked || atOrBelowHalf(u)) && !this.state.checklist.includes(`shock:${u.id}`));
  }

  /** Reasons the current phase cannot end yet (shown by the coach). */
  phaseBlockers(): string[] {
    const s = this.state;
    const out: string[] = [];
    if (s.phase === 'command') {
      const due = this.battleShockDue();
      if (due.length > 0) out.push(`Battle-shock tests still to take: ${due.map((u) => u.name).join(', ')}.`);
    }
    if (s.phase === 'fight' && this.fight && this.fight.step !== 'done') out.push('The Fight phase is not finished yet.');
    if (this.charge) out.push('Finish or abandon the charge in progress.');
    return out;
  }

  async endPhase(): Promise<boolean> {
    if (this.busy || this.phaseBlockers().length > 0) return false;
    return this.run(async () => {
      const s = this.state;
      const ending = s.phase;
      const reactor = other(s.active);
      const whose = s.active === 'player' ? 'your' : 'the Ultramarines’';
      if (ending !== 'command') {
        await this.offerReactions(s.active, 'end', `End of ${whose} ${phaseName(ending)} phase`, []);
        await this.offerReactions(reactor, 'end', `End of ${whose} ${phaseName(ending)} phase`, []);
      }
      if (ending === 'command') this.scorePrimary();
      if (ending === 'movement') {
        for (const u of this.unitsOf(s.active)) if (onBoard(u) && u.flags.move === null) u.flags.move = 'stationary';
      }
      s.effects = s.effects.filter((e) => !(e.until === 'phase' && e.turn === s.turn && e.phase === ending));
      this.updateObjectives();
      const i = TURN_PHASES.indexOf(ending);
      if (i >= 0 && i < TURN_PHASES.length - 1) {
        s.phase = TURN_PHASES[i + 1];
        await this.beginPhase();
      } else {
        await this.endTurn();
      }
      return true;
    });
  }

  private async endTurn() {
    const s = this.state;
    // 03.03: units out of coherency lose models until they are in coherency again.
    for (const u of this.state.units.filter((x) => onBoard(x))) {
      let guard = 0;
      while (coherencyProblems(aliveModels(u)).length > 0 && guard++ < 40) {
        const alive = aliveModels(u);
        const loner = [...alive].sort((a, b) => nearestFriend(b, alive) - nearestFriend(a, alive))[0];
        loner.w = 0;
        this.log(`${u.name} was not in coherency: one ${loner.name} is removed.`, 'warn', u.owner);
      }
    }
    s.effects = s.effects.filter((e) => e.until !== 'turn' || e.turn !== s.turn);
    await this.triggerDeadlyDemise();
    this.updateObjectives();
    if (s.active !== s.firstPlayer) {
      // End of battle round.
      if (s.round === 3) {
        for (const u of this.state.units.filter((x) => x.status === 'reserves')) {
          u.status = 'destroyed';
          u.models.forEach((m) => (m.w = 0));
          this.log(`${u.name} never arrived from reserves and is destroyed (20.04).`, 'warn', u.owner);
        }
      }
      if (s.round >= ROUNDS) {
        this.finishGame();
        return;
      }
      s.round += 1;
      this.log(`Battle round ${s.round} begins.`, 'info');
    }
    s.turn += 1;
    s.active = other(s.active);
    await this.beginTurn();
  }

  private finishGame() {
    const s = this.state;
    s.phase = 'gameOver';
    s.winner = s.vp.player > s.vp.ai ? 'player' : s.vp.ai > s.vp.player ? 'ai' : 'draw';
    this.log(`The battle is over: Tyranids ${s.vp.player} VP, Ultramarines ${s.vp.ai} VP.`, 'score');
  }

  private checkGameOver() {
    const s = this.state;
    if (s.phase === 'gameOver' || s.phase === 'deployment') return;
    for (const p of ['player', 'ai'] as PlayerId[]) {
      const left = this.unitsOf(p).some((u) => u.status !== 'destroyed');
      if (!left) {
        s.phase = 'gameOver';
        s.winner = other(p);
        this.log(`${p === 'player' ? 'Your army' : 'The Ultramarines army'} has been wiped out.`, 'score');
      }
    }
  }

  // ---- Objectives (14) ------------------------------------------------------------------

  /** Level of control each player has over each objective right now. */
  objectiveLevels(): Record<PlayerId, number>[] {
    const areas = objectiveAreas(this.state.battlefield);
    return areas.map((area) => {
      const level: Record<PlayerId, number> = { player: 0, ai: 0 };
      for (const u of this.state.units.filter((x) => onBoard(x))) {
        if (u.battleShocked) continue;
        const ocBonus = effectMods(this.state, u).reduce((s, m) => s + (m.kind === 'oc' ? m.delta : 0), 0);
        for (const m of aliveModels(u)) if (circleTouchesPolygon(m, area.polygon)) level[u.owner] += Math.max(0, ocOf(u, m) + ocBonus);
      }
      return level;
    });
  }

  updateObjectives() {
    const levels = this.objectiveLevels();
    this.state.objectives = levels.map((l) => (l.player > l.ai ? 'player' : l.ai > l.player ? 'ai' : null));
  }

  /** Practice mission: end of each Command phase, 5 VP per objective controlled (max 15). */
  private scorePrimary() {
    const s = this.state;
    const held = s.objectives.filter((o) => o === s.active).length;
    const vp = Math.min(MAX_PRIMARY_PER_TURN, held * VP_PER_OBJECTIVE);
    if (vp === 0) {
      this.log(`${s.active === 'player' ? 'You score' : 'The Ultramarines score'} no primary VP (no objectives held).`, 'score', s.active);
      return;
    }
    s.vp[s.active] += vp;
    s.vpLog.push({ round: s.round, player: s.active, vp, reason: `${held} objective${held === 1 ? '' : 's'}` });
    this.log(`${s.active === 'player' ? 'You score' : 'The Ultramarines score'} ${vp} VP for holding ${held} objective${held === 1 ? '' : 's'}.`, 'score', s.active);
  }

  // ---- Command phase ----------------------------------------------------------------------

  /** 08.03 / 01.07: leadership roll on 2D6 (3D6 for Tyranids within Synapse Range). */
  async battleShockTest(unitId: string, autoPass = false): Promise<boolean> {
    return this.run(async () => this.doBattleShock(this.unit(unitId), autoPass, true));
  }

  /** Tyranids army rule: once per battle in either Command phase, every enemy unit takes a battle-shock test. */
  canUnleashShadow(player: PlayerId): boolean {
    const s = this.state;
    if (s.phase !== 'command' || s.usedOnce.includes(`${player}:shadow`) || s.armies[player].faction !== 'tyranids') return false;
    return this.unitsOf(player).some((u) => onBoard(u) && aliveModels(u).some((m) => modelDatasheetHas(u, m, 'Shadow in the Warp')));
  }

  async unleashShadow(player: PlayerId): Promise<void> {
    return this.run(async () => {
      if (!this.canUnleashShadow(player)) return;
      this.state.usedOnce.push(`${player}:shadow`);
      this.log(`${player === 'player' ? 'You unleash' : 'The enemy unleashes'} the Shadow in the Warp: every enemy unit takes a battle-shock test.`, 'stratagem', player);
      const synapse = this.unitsOf(player).filter((u) => onBoard(u) && unitHasKeyword(u, 'Synapse'));
      for (const e of this.unitsOf(other(player)).filter(onBoard)) {
        const near = synapse.some((sy) => unitDistance(sy, e) <= 6);
        await this.doBattleShock(e, false, false, near ? -1 : 0);
      }
    });
  }

  private async doBattleShock(u: UnitState, autoPass: boolean, commandStep: boolean, modifier = 0): Promise<boolean> {
    if (commandStep && u.owner === this.state.active) {
      await this.offerReactions(u.owner, 'beforeBattleshock', `${u.name} is about to take a battle-shock test`, [u.id]);
    }
    const insane = this.state.effects.some((e) => e.unitId === u.id && e.label === 'Insane Bravery');
    const dice = withinSynapseRange(this.state, u) ? 3 : 2;
    const ld = bestLeadership(u);
    let total = 0;
    if (autoPass || insane) {
      total = 99;
    } else {
      const rolls = await this.roll({ who: u.owner, kind: 'battleshock', label: `Battle-shock test for ${u.name} (${dice}D6${modifier ? ` ${modifier}` : ''}, Leadership ${ld}+)`, count: dice, need: `${ld - modifier}+ total` });
      total = rolls.reduce((a, b) => a + b, 0) + modifier;
    }
    const passed = total >= ld;
    if (commandStep) this.state.checklist.push(`shock:${u.id}`);
    const was = u.battleShocked;
    u.battleShocked = !passed;
    this.log(
      passed
        ? `${u.name} passes its battle-shock test${insane || autoPass ? ' automatically' : ` (${total} vs ${ld}+)`}${was ? ' and is no longer battle-shocked' : ''}.`
        : `${u.name} fails its battle-shock test (${total} vs ${ld}+) and is battle-shocked: OC counts as 0 and no stratagems can target it.`,
      passed ? 'info' : 'warn',
      u.owner,
    );
    return passed;
  }

  /** Returns {tervigon, targets} for each Tervigon that can restore Termagants this command phase (Spawn Termagants ability). */
  canSpawnTermagants(player: PlayerId): { tervigon: UnitState; targets: UnitState[] }[] {
    const s = this.state;
    if (s.phase !== 'command' || s.active !== player) return [];
    const out: { tervigon: UnitState; targets: UnitState[] }[] = [];
    for (const u of this.unitsOf(player).filter(onBoard)) {
      if (s.checklist.includes(`spawn:${u.id}`)) continue;
      if (!aliveModels(u).some((m) => modelDatasheetHas(u, m, 'Spawn Termagants'))) continue;
      const targets = this.unitsOf(player).filter(
        (t) => onBoard(t) && t.models.some((m) => m.w === 0) && isTermagantUnit(t) && unitDistance(u, t) <= 6,
      );
      if (targets.length > 0) out.push({ tervigon: u, targets });
    }
    return out;
  }

  /** Restores up to D3+3 destroyed Termagant models to a unit within 6" of the Tervigon. */
  async spawnTermagants(tervigonId: string, targetUnitId: string): Promise<void> {
    return this.run(async () => {
      const tervigon = this.unit(tervigonId);
      const target = this.unit(targetUnitId);
      if (!this.canSpawnTermagants(tervigon.owner).some((x) => x.tervigon.id === tervigonId && x.targets.some((t) => t.id === targetUnitId))) return;
      const [raw] = await this.roll({ who: tervigon.owner, kind: 'other', label: `Spawn Termagants: D3 roll for ${tervigon.name}`, count: 1 });
      const count = Math.ceil(raw / 2) + 3;
      const dead = target.models.filter((m) => m.w === 0).slice(0, count);
      const alive = aliveModels(target);
      if (alive.length > 0) {
        const cx = alive.reduce((s, a) => s + a.x, 0) / alive.length;
        const cy = alive.reduce((s, a) => s + a.y, 0) / alive.length;
        dead.forEach((m, i) => {
          const angle = (i / Math.max(1, dead.length)) * Math.PI * 2;
          m.x = cx + Math.cos(angle) * m.r * 2.5;
          m.y = cy + Math.sin(angle) * m.r * 2.5;
          m.w = m.maxW;
        });
      } else {
        dead.forEach((m) => { m.w = m.maxW; });
      }
      this.state.checklist.push(`spawn:${tervigonId}`);
      const restored = dead.length;
      const d3 = Math.ceil(raw / 2);
      this.log(
        `${tervigon.name} – Spawn Termagants: ${restored} model${restored === 1 ? '' : 's'} restored to ${target.name} (D3=${d3}+3=${count}${restored < count ? `, only ${restored} were available` : ''}).`,
        'info', tervigon.owner,
      );
    });
  }

  markChecklist(item: string) {
    if (!this.state.checklist.includes(item)) this.state.checklist.push(item);
    this.changed();
  }

  // ---- Movement phase -------------------------------------------------------------------

  moveOptions(unitId: string): MoveKind[] {
    const u = this.unit(unitId);
    const s = this.state;
    if (s.phase !== 'movement' || u.owner !== s.active) return [];
    if (u.status === 'reserves') return s.round >= 2 && u.flags.move === null ? ['ingress'] : [];
    if (!onBoard(u) || u.flags.move !== null) return [];
    if (u.flags.setUp) return [];
    const engaged = isEngaged(s, u);
    return engaged ? ['stationary', 'fallBack'] : ['stationary', 'normal', 'advance'];
  }

  canFly(u: UnitState) {
    return aliveModels(u).every((m) => modelHasKeyword(u, m, 'Fly'));
  }

  /** Maximum distance of a move for one model. */
  maxMove(u: UnitState, m: ModelState, kind: MoveKind, flying: boolean): number {
    const bonus = modsFor(this.state, u, m).reduce((s, x) => s + (x.kind === 'move' ? x.delta : 0), 0);
    let max = moveOf(u, m) + bonus;
    if (kind === 'advance') max += this.state.advance[u.id] ?? 0;
    if (kind === 'charge') max = this.charge?.distance ?? 0;
    if (kind === 'pileIn' || kind === 'consolidate') max = PILE_IN_DISTANCE;
    if (kind === 'surge') max = this.state.advance[`surge:${u.id}`] ?? 0;
    if (flying && !hasCoreAbility(u, 'Hover')) max -= 2;
    return Math.max(0, max);
  }

  async rollAdvance(unitId: string): Promise<number> {
    return this.run(async () => {
      const u = this.unit(unitId);
      if ((u.id in this.state.advance)) return this.state.advance[u.id];
      const [v] = await this.roll({ who: u.owner, kind: 'advance', label: `Advance roll for ${u.name}`, count: 1 });
      this.state.advance[u.id] = v;
      this.log(`${u.name} rolls ${v} to advance (moves up to ${moveOf(u, aliveModels(u)[0]) + v}").`, 'move', u.owner);
      return v;
    });
  }

  moveRules(u: UnitState, kind: MoveKind, flying: boolean): MoveRules {
    return {
      kind,
      flying,
      maxDistance: (m) => this.maxMove(u, m, kind, flying),
      endUnengaged: kind === 'normal' || kind === 'advance' || kind === 'fallBack',
    };
  }

  checkUnitMove(unitId: string, kind: MoveKind, positions: Map<string, Vec>, flying = false): MoveCheck {
    const u = this.unit(unitId);
    if (kind === 'ingress') return this.ingressCheck(u, positions);
    return checkMove(this.state, u, positions, this.moveRules(u, kind, flying));
  }

  /** Normal, advance or fall-back move (09.05-09.07). */
  async move(unitId: string, kind: MoveKind, positions: Map<string, Vec>, flying = false): Promise<MoveCheck> {
    return this.run(async () => {
      const u = this.unit(unitId);
      if (kind === 'stationary') {
        u.flags.move = 'stationary';
        this.log(`${u.name} remains stationary.`, 'move', u.owner);
        return { ok: true, problems: [], distances: new Map() };
      }
      if (kind === 'advance' && !(u.id in this.state.advance)) throw new Error('Roll to advance first');
      const check = this.checkUnitMove(unitId, kind, positions, flying);
      if (!check.ok) return check;
      if (kind === 'fallBack' && u.battleShocked) {
        // Desperate escape: a hazard roll for each model, then (if not battle-shocked) a battle-shock roll.
        await hazardRolls(this.ctx(), u, aliveModels(u).length);
      }
      this.place(u, positions, check);
      u.flags.move = kind;
      u.flags.flying = flying;
      if (kind === 'ingress') u.status = 'onBoard';
      this.log(`${u.name} makes ${({ fallBack: 'a fall-back', ingress: 'an ingress', advance: 'an advance', normal: 'a normal' } as Record<string, string>)[kind] ?? `a ${kind}`} move${flying ? ', taking to the skies' : ''}.`, 'move', u.owner);
      await this.offerReactions(other(u.owner), 'enemyMoved', `${u.name} just ended a move`, this.unitsOf(other(u.owner)).filter((x) => onBoard(x) && unitDistance(x, u) <= 9).map((x) => x.id), u.id);
      return check;
    });
  }

  private place(u: UnitState, positions: Map<string, Vec>, check?: MoveCheck) {
    for (const m of aliveModels(u)) {
      const p = positions.get(m.id);
      if (!p) continue;
      const moved = check?.distances.get(m.id) ?? dist(m, p);
      u.flags.maxMoved = Math.max(u.flags.maxMoved, moved);
      m.x = p.x;
      m.y = p.y;
    }
  }

  /**
   * Sets up a unit from reserves outside the Movement phase (Rapid Ingress). Called from inside a
   * reaction window, so it does not take the busy lock.
   */
  arriveNow(unitId: string, positions: Map<string, Vec>): MoveCheck {
    const u = this.unit(unitId);
    const check = this.ingressCheck(u, positions);
    if (!check.ok) return check;
    this.place(u, positions);
    u.status = 'onBoard';
    u.flags.move = 'ingress';
    u.flags.setUp = true;
    this.log(`${u.name} arrives from reserves.`, 'move', u.owner);
    this.changed();
    return check;
  }

  /** 20.04 ingress move (and Deep Strike, 24.09). */
  ingressCheck(u: UnitState, positions: Map<string, Vec>): MoveCheck {
    const check = checkMove(this.state, u, positions, { kind: 'deploy', maxDistance: () => Infinity, flying: false });
    const bf = this.state.battlefield;
    const enemyZone = bf.deployment[other(u.owner)];
    for (const m of aliveModels(u)) {
      const p = positions.get(m.id) ?? m;
      const c = { ...p, r: m.r };
      const nearEnemy = this.state.units.some((e) => e.owner !== u.owner && onBoard(e) && aliveModels(e).some((n) => edgeDistance(c, n) <= RESERVE_ENEMY_DISTANCE));
      if (nearEnemy) check.problems.push({ modelId: m.id, message: `${m.name} must be set up more than 8" from all enemy units.` });
      if (!u.deepStrike) {
        const edge = Math.min(p.x + m.r, p.y + m.r, bf.width - p.x + m.r, bf.height - p.y + m.r);
        if (edge > RESERVE_EDGE_DISTANCE + 1e-6) check.problems.push({ modelId: m.id, message: `${m.name} must be wholly within 6" of a battlefield edge.` });
        if (this.state.round < 3 && pointInPolygon(p, enemyZone)) check.problems.push({ modelId: m.id, message: `${m.name} cannot be set up in the enemy deployment zone before round 3.` });
      }
    }
    check.ok = check.problems.length === 0;
    return check;
  }

  // ---- Shooting phase (10) ----------------------------------------------------------------

  shootingTypes(u: UnitState): ('normal' | 'assault' | 'closeQuarters' | 'indirect')[] {
    const s = this.state;
    if (s.phase !== 'shooting' || u.owner !== s.active || !onBoard(u) || u.flags.shot) return [];
    if (u.flags.move === 'fallBack' && !effectMods(s, u).some((m) => m.kind === 'fallBackAndShoot')) return [];
    const engaged = isEngaged(s, u);
    const advanced = u.flags.move === 'advance';
    const weapons = aliveModels(u).flatMap((m) => modelWeapons(u, m)).filter((w) => w.ranged);
    if (weapons.length === 0) return [];
    const has = (name: string) => weapons.some((w) => weaponAbilities(w.weapon.keywords).has(name));
    const advanceAndShoot = effectMods(s, u).some((m) => m.kind === 'advanceAndShoot');
    const out: ('normal' | 'assault' | 'closeQuarters' | 'indirect')[] = [];
    if (!engaged && (!advanced || advanceAndShoot)) out.push('normal');
    if (!engaged && advanced && (has('assault') || effectMods(s, u).some((m) => m.kind === 'weaponKeyword' && m.keyword === 'assault'))) out.push('assault');
    if (engaged && !advanced && (has('pistol') || has('close-quarters') || aliveModels(u).some((m) => isMonsterOrVehicle(u, m)))) out.push('closeQuarters');
    if (!engaged && !advanced && has('indirect fire')) out.push('indirect');
    return out;
  }

  /** Enemy units a weapon profile could target, from at least one model carrying it. */
  weaponTargets(u: UnitState, key: string, profileName: string, type: 'normal' | 'assault' | 'closeQuarters' | 'indirect'): UnitState[] {
    const carriers = aliveModels(u).filter((m) => (m.weapons[key] ?? 0) > 0);
    const weapon = carriers.length > 0 ? modelWeapons(u, carriers[0]).find((w) => w.weapon.name === profileName)?.weapon : undefined;
    if (!weapon) return [];
    const range = parseRange(weapon.range);
    const abilities = weaponAbilities(weapon.keywords);
    const engagedWithMe = engagedWith(this.state, u);
    return this.unitsOf(other(u.owner)).filter((t) => {
      if (!onBoard(t)) return false;
      if (type === 'assault' && !abilities.has('assault')) return false;
      if (type === 'indirect' && !abilities.has('indirect fire')) return false;
      const engagedTarget = isEngaged(this.state, t);
      const bigTarget = aliveModels(t).some((m) => isMonsterOrVehicle(t, m));
      if (type === 'closeQuarters') {
        const cq = abilities.has('pistol') || abilities.has('close-quarters');
        const bigShooter = carriers.some((m) => isMonsterOrVehicle(u, m));
        if (!engagedWithMe.includes(t) && !(bigShooter && !engagedTarget)) return false;
        if (!cq && !bigShooter) return false;
        if (abilities.has('blast') && engagedWithMe.includes(t)) return false;
      } else if (engagedTarget && !bigTarget) return false;
      else if (engagedTarget && abilities.has('blast')) return false;
      return carriers.some((m) => {
        if (modelUnitDistance(m, t) > range + 1e-6) return false;
        if (type === 'indirect' && abilities.has('indirect fire')) return true;
        return aliveModels(t).some((tm) => canSeeModel(this.state, m, t, tm).visible);
      });
    });
  }

  /** Weapons a unit can shoot with (one entry per weapon key, with its profiles). */
  rangedWeapons(u: UnitState): { key: string; profiles: ModelWeapon[]; carriers: number }[] {
    const map = new Map<string, { key: string; profiles: ModelWeapon[]; carriers: number }>();
    for (const m of aliveModels(u)) {
      for (const w of modelWeapons(u, m).filter((x) => x.ranged)) {
        if (abilitiesOf(w).has('one shot') && u.oneShotUsed.includes(w.key)) continue;
        const entry = map.get(w.key) ?? { key: w.key, profiles: [], carriers: 0 };
        if (!entry.profiles.some((p) => p.weapon.name === w.weapon.name)) entry.profiles.push(w);
        map.set(w.key, entry);
      }
    }
    for (const entry of map.values()) entry.carriers = aliveModels(u).filter((m) => (m.weapons[entry.key] ?? 0) > 0).reduce((s, m) => s + (m.weapons[entry.key] ?? 0), 0);
    return [...map.values()];
  }

  /** Shoots with a unit (10.02, 04). Models fire each weapon at the target assigned to that weapon. */
  async shoot(unitId: string, type: 'normal' | 'assault' | 'closeQuarters' | 'indirect', assignments: ShootAssignment[]): Promise<void> {
    return this.run(async () => {
      const u = this.unit(unitId);
      if (!this.shootingTypes(u).includes(type)) throw new Error(`${u.name} cannot use ${type} shooting now`);
      u.flags.shot = true;
      const groups = this.shootingGroups(u, type, assignments);
      if (groups.length === 0) {
        this.log(`${u.name} has no targets in range and sight.`, 'info', u.owner);
        return;
      }
      u.lastShotTurn = this.state.turn;
      await this.resolveWithReactions(u, groups);
      let hazardous = 0;
      for (const g of groups) {
        const ab = weaponAbilities(g.weapon.keywords);
        if (ab.has('hazardous')) hazardous += g.models.length;
        if (ab.has('one shot')) u.oneShotUsed.push(g.key);
      }
      await hazardRolls(this.ctx(), u, hazardous);
    });
  }

  shootingGroups(u: UnitState, type: 'normal' | 'assault' | 'closeQuarters' | 'indirect', assignments: ShootAssignment[]): AttackGroup[] {
    const groups: AttackGroup[] = [];
    // [CLOSE-QUARTERS] (24.07): outside close-quarters shooting, a non-MONSTER/VEHICLE model fires either
    // its close-quarters weapons or its other guns. Use the other guns unless only close-quarters ones were assigned.
    for (const a of assignments) {
      const target = unitById(this.state, a.targetId);
      if (!target || !onBoard(target)) continue;
      const models = aliveModels(u).filter((m) => (m.weapons[a.key] ?? 0) > 0);
      const profile = models.length > 0 ? modelWeapons(u, models[0]).find((w) => w.weapon.name === a.profile) : undefined;
      if (!profile) continue;
      if (!this.weaponTargets(u, a.key, a.profile, type).includes(target)) continue;
      const range = parseRange(profile.weapon.range);
      const ab = weaponAbilities(profile.weapon.keywords);
      const eligible = models.filter((m) => {
        if (modelUnitDistance(m, target) > range + 1e-6) return false;
        if (type === 'closeQuarters' && !isMonsterOrVehicle(u, m) && !(ab.has('pistol') || ab.has('close-quarters'))) return false;
        if (type === 'normal' && !isMonsterOrVehicle(u, m) && (ab.has('pistol') || ab.has('close-quarters'))) {
          const hasOther = assignments.some((o) => o.key !== a.key && (m.weapons[o.key] ?? 0) > 0 && !isCloseQuarters(u, m, o.profile));
          if (hasOther) return false;
        }
        if (type === 'indirect' && ab.has('indirect fire')) return true;
        return aliveModels(target).some((tm) => canSeeModel(this.state, m, target, tm).visible);
      });
      if (eligible.length === 0) continue;
      groups.push({ attacker: u, models: eligible, weapon: profile.weapon, key: a.key, ranged: true, target, indirect: type === 'indirect' && ab.has('indirect fire') });
    }
    return groups;
  }

  /** Enemy units a unit could snap-shoot (Fire Overwatch, 15.08-15.09): visible and within 24". */
  snapTargets(u: UnitState): UnitState[] {
    return this.unitsOf(other(u.owner)).filter(
      (t) => onBoard(t) && aliveModels(u).some((m) => modelUnitDistance(m, t) <= 24 && aliveModels(t).some((tm) => canSeeModel(this.state, m, t, tm).visible)),
    );
  }

  /**
   * Snap shooting: every ranged weapon at one target within 24", hitting only on unmodified 6s.
   * Called from inside a reaction window, so it does not take the busy lock itself.
   */
  async snapShoot(unitId: string, targetId: string): Promise<void> {
    const u = this.unit(unitId);
    const target = this.unit(targetId);
    if (!this.snapTargets(u).includes(target)) return;
    const groups: AttackGroup[] = [];
    for (const w of this.rangedWeapons(u)) {
      const profile = w.profiles[0];
      const range = Math.min(24, parseRange(profile.weapon.range));
      const models = aliveModels(u).filter((m) => (m.weapons[w.key] ?? 0) > 0 && modelUnitDistance(m, target) <= range && aliveModels(target).some((tm) => canSeeModel(this.state, m, target, tm).visible));
      if (models.length > 0) groups.push({ attacker: u, models, weapon: profile.weapon, key: w.key, ranged: true, target, snap: true });
    }
    this.log(`${u.name} fires overwatch at ${target.name} (hits only on 6s).`, 'attack', u.owner);
    u.lastShotTurn = this.state.turn;
    const ctx = this.ctx();
    for (const g of groups) await resolveGroup(ctx, g);
    await this.triggerDeadlyDemise();
  }

  /** Resolves attack groups, giving the defender a chance to react once per target first. */
  private async resolveWithReactions(u: UnitState, groups: AttackGroup[]) {
    const targets = [...new Set(groups.map((g) => g.target.id))];
    for (const id of targets) {
      const target = this.unit(id);
      await this.offerReactions(target.owner, 'targeted', `${u.name} has selected ${target.name} as a target`, [target.id], u.id);
      if (this.hooks.attack) await this.hooks.attack(u.id, id);
    }
    // Track alive counts before resolving to detect kills for surge moves.
    const beforeCounts = new Map(targets.map((id) => [id, aliveModels(this.unit(id)).length]));
    const ctx = this.ctx();
    for (const g of groups) {
      if (aliveModels(g.target).length === 0) continue;
      g.models = g.models.filter((m) => m.w > 0);
      await resolveGroup(ctx, g);
    }
    // Effects that last "until that enemy unit has attacked".
    this.state.effects = this.state.effects.filter((e) => !e.label.endsWith('(until attacked)'));
    await this.triggerDeadlyDemise();
    // Surge moves: triggered after shooting kills models in qualifying units.
    if (this.hooks.surge && this.state.phase === 'shooting') {
      for (const id of targets) {
        const target = this.unit(id);
        if (!onBoard(target) || target.owner === u.owner) continue;
        const before = beforeCounts.get(id) ?? 0;
        if (aliveModels(target).length >= before) continue; // no kills
        const sa = this.surgeAbilityOf(target);
        if (!sa) continue;
        const [roll] = await this.roll({ who: target.owner, kind: 'other', label: `${sa.label} (${target.name}): D6 surge roll`, count: 1 });
        const maxDist = roll + sa.bonus;
        this.state.advance[`surge:${target.id}`] = maxDist;
        this.log(`${target.name} – ${sa.label}: can surge up to ${maxDist}" (rolled ${roll}${sa.bonus ? `+${sa.bonus}` : ''}).`, 'move', target.owner);
        await this.hooks.surge(target.id, maxDist, sa.label);
        delete this.state.advance[`surge:${target.id}`];
      }
    }
  }

  /** Returns surge ability info if a unit can make a surge move after taking fire. */
  private surgeAbilityOf(u: UnitState): { label: string; bonus: number } | null {
    if (aliveModels(u).some((m) => modelDatasheetHas(u, m, 'Blistering Assault'))) return { label: 'Blistering Assault', bonus: 2 };
    const hasInsurountableOdds = unitHasKeyword(u, 'Endless Multitude') && this.state.armies[u.owner].detachmentIds.some((id) => {
      const det = BUNDLES[u.faction]?.detachmentById.get(id);
      return det?.abilities.some((a) => a.name === 'Insurmountable Odds') ?? false;
    });
    if (hasInsurountableOdds) return { label: 'Insurmountable Odds', bonus: 0 };
    const hasAggressiveLeader = aliveModels(u).some((m) => modelDatasheetHas(u, m, 'Aggressive Leader-beast'));
    if (hasAggressiveLeader) return { label: 'Aggressive Leader-beast', bonus: 0 };
    return null;
  }

  // ---- Charge phase (11) ------------------------------------------------------------------

  canDeclareCharge(u: UnitState): boolean {
    const s = this.state;
    if (s.phase !== 'charge' || u.owner !== s.active || !onBoard(u) || u.flags.chargeDeclared) return false;
    if (unitHasKeyword(u, 'Aircraft')) return false;
    if (isEngaged(s, u)) return false;
    const mods = effectMods(s, u);
    if (u.flags.move === 'advance' && !mods.some((m) => m.kind === 'advanceAndCharge')) return false;
    if (u.flags.move === 'fallBack' && !mods.some((m) => m.kind === 'fallBackAndCharge')) return false;
    return this.chargeTargetsInRange(u).length > 0;
  }

  chargeTargetsInRange(u: UnitState, within = CHARGE_RANGE): UnitState[] {
    return this.unitsOf(other(u.owner)).filter((t) => onBoard(t) && !unitHasKeyword(t, 'Aircraft') && unitDistance(u, t) <= within + 1e-6);
  }

  /** Declares a charge and rolls 2D6 (11.02). */
  async declareCharge(unitId: string): Promise<number> {
    return this.run(async () => {
      const u = this.unit(unitId);
      if (!this.canDeclareCharge(u)) throw new Error(`${u.name} cannot declare a charge`);
      u.flags.chargeDeclared = true;
      const bonus = effectMods(this.state, u).reduce((s, m) => s + (m.kind === 'charge' ? m.delta : 0), 0);
      const rolls = await this.roll({ who: u.owner, kind: 'charge', label: `Charge roll for ${u.name} (2D6)`, count: 2 });
      const distance = rolls[0] + rolls[1] + bonus;
      this.charge = { unitId: u.id, distance };
      const reachable = this.chargeTargetsInRange(u, Math.min(CHARGE_RANGE, distance));
      this.log(`${u.name} declares a charge and rolls ${distance}". ${reachable.length > 0 ? `In reach: ${reachable.map((t) => t.name).join(', ')}.` : 'Nothing is in reach: the charge fails.'}`, 'move', u.owner);
      if (reachable.length === 0) this.charge = null;
      return distance;
    });
  }

  /** Units that can be charge targets for the charge in progress (within 12" and the roll). */
  chargeTargets(): UnitState[] {
    if (!this.charge) return [];
    const u = this.unit(this.charge.unitId);
    return this.chargeTargetsInRange(u, Math.min(CHARGE_RANGE, this.charge.distance));
  }

  checkCharge(targetIds: string[], positions: Map<string, Vec>): MoveCheck {
    if (!this.charge) return { ok: false, problems: [{ message: 'No charge in progress.' }], distances: new Map() };
    const u = this.unit(this.charge.unitId);
    const check = checkMove(this.state, u, positions, this.moveRules(u, 'charge', false));
    const targets = targetIds.map((id) => this.unit(id));
    if (targets.length === 0) check.problems.push({ message: 'Pick at least one charge target.' });
    const allowed = this.chargeTargets();
    for (const t of targets) if (!allowed.includes(t)) check.problems.push({ message: `${t.name} is not within reach of this charge.` });
    for (const m of aliveModels(u)) {
      const p = positions.get(m.id) ?? m;
      const before = Math.min(...targets.flatMap((t) => aliveModels(t).map((tm) => edgeDistance(m, tm))));
      const after = Math.min(...targets.flatMap((t) => aliveModels(t).map((tm) => edgeDistance({ ...p, r: m.r }, tm))));
      if (dist(m, p) > 1e-6 && after >= before - 1e-6) check.problems.push({ modelId: m.id, message: `${m.name} must end closer to a charge target.` });
    }
    const engaged = engagedWith(this.state, u, positions);
    for (const t of targets) if (!engaged.includes(t)) check.problems.push({ message: `The unit must end engaged with ${t.name}.` });
    for (const e of engaged) if (!targets.includes(e)) check.problems.push({ message: `The unit cannot end engaged with ${e.name}, which is not a charge target.` });
    check.ok = check.problems.length === 0;
    return check;
  }

  async chargeMove(targetIds: string[], positions: Map<string, Vec>): Promise<MoveCheck> {
    return this.run(async () => {
      const check = this.checkCharge(targetIds, positions);
      if (!check.ok || !this.charge) return check;
      const u = this.unit(this.charge.unitId);
      this.place(u, positions, check);
      u.flags.move = u.flags.move ?? 'stationary';
      u.flags.charged = true;
      u.flags.fightsFirst = true;
      this.charge = null;
      this.log(`${u.name} completes its charge into ${targetIds.map((id) => this.unit(id).name).join(' and ')}.`, 'move', u.owner);
      await this.offerReactions(u.owner, 'afterChargeMove', `${u.name} just ended a charge move`, [u.id]);
      return check;
    });
  }

  failCharge() {
    if (!this.charge) return;
    const u = this.unit(this.charge.unitId);
    this.log(`${u.name} does not make a charge move.`, 'move', u.owner);
    this.charge = null;
    this.changed();
  }

  // ---- Fight phase (12) -------------------------------------------------------------------

  private startFightPhase() {
    for (const u of this.state.units.filter((x) => onBoard(x))) {
      u.flags.fightEligible = isEngaged(this.state, u) || u.flags.charged;
      if (effectMods(this.state, u).some((m) => m.kind === 'fightsFirst')) u.flags.fightsFirst = true;
    }
    this.fight = { step: 'pileIn', done: [], picker: this.state.active, passes: [] };
    this.skipEmptyFightSteps();
  }

  /** Units of a player that may pile in now (12.03). */
  pileInUnits(player: PlayerId): UnitState[] {
    if (!this.fight || (this.fight.step !== 'pileIn' && this.fight.step !== 'fight')) return [];
    return this.unitsOf(player).filter((u) => onBoard(u) && (isEngaged(this.state, u) || u.flags.charged) && !u.flags.fought);
  }

  /** Whose pile-in / consolidate step it is (active player first). */
  stepPlayer(): PlayerId | null {
    if (!this.fight) return null;
    const active = this.state.active;
    if (this.fight.step === 'pileIn' || this.fight.step === 'consolidate') {
      if (!this.fight.done.includes(active)) return active;
      if (!this.fight.done.includes(other(active))) return other(active);
      return null;
    }
    return null;
  }

  pileInTargets(u: UnitState): UnitState[] {
    const engaged = engagedWith(this.state, u);
    if (engaged.length > 0) return engaged;
    return this.unitsOf(other(u.owner)).filter((t) => onBoard(t) && unitDistance(u, t) <= 5);
  }

  checkPileIn(unitId: string, positions: Map<string, Vec>, kind: 'pileIn' | 'consolidate' = 'pileIn'): MoveCheck {
    const u = this.unit(unitId);
    const check = checkMove(this.state, u, positions, this.moveRules(u, kind, false));
    const targets = this.pileInTargets(u);
    const startedEngaged = new Map(aliveModels(u).map((m) => [m.id, this.unitsOf(other(u.owner)).filter((e) => onBoard(e) && aliveModels(e).some((n) => edgeDistance(m, n) <= ENGAGEMENT_RANGE))]));
    for (const m of aliveModels(u)) {
      const p = positions.get(m.id) ?? m;
      if (dist(m, p) < 1e-6) continue;
      const inContact = this.unitsOf(other(u.owner)).some((e) => onBoard(e) && aliveModels(e).some((n) => edgeDistance(m, n) <= 0.01));
      if (inContact) check.problems.push({ modelId: m.id, message: `${m.name} is in base contact with an enemy and cannot move.` });
      if (targets.length > 0) {
        const closest = [...targets].sort((a, b) => modelUnitDistance(m, a) - modelUnitDistance(m, b))[0];
        if (modelUnitDistance({ ...p, r: m.r }, closest) >= modelUnitDistance(m, closest) - 1e-6) check.problems.push({ modelId: m.id, message: `${m.name} must end closer to ${closest.name}.` });
      }
      for (const e of startedEngaged.get(m.id) ?? []) {
        if (!aliveModels(e).some((n) => edgeDistance({ ...p, r: m.r }, n) <= ENGAGEMENT_RANGE)) check.problems.push({ modelId: m.id, message: `${m.name} must stay engaged with ${e.name}.` });
      }
    }
    if (kind === 'pileIn' && engagedWith(this.state, u, positions).length === 0) check.problems.push({ message: 'The unit must end engaged.' });
    check.ok = check.problems.length === 0;
    return check;
  }

  async pileIn(unitId: string, positions: Map<string, Vec>, kind: 'pileIn' | 'consolidate' = 'pileIn'): Promise<MoveCheck> {
    return this.run(async () => {
      const check = this.checkPileIn(unitId, positions, kind);
      if (!check.ok) return check;
      const u = this.unit(unitId);
      this.place(u, positions, check);
      this.log(`${u.name} ${kind === 'pileIn' ? 'piles in' : 'consolidates'}.`, 'move', u.owner);
      return check;
    });
  }

  /** Finishes a player's pile-in or consolidate step. */
  finishStep(player: PlayerId) {
    this.finishStepRaw(player);
    this.skipEmptyFightSteps();
    this.changed();
  }

  /** Players with nothing to pile in or consolidate are done with that step straight away. */
  private skipEmptyFightSteps() {
    for (let guard = 0; guard < 8 && this.fight; guard++) {
      const f = this.fight;
      if (f.step !== 'pileIn' && f.step !== 'consolidate') return;
      const p = this.stepPlayer();
      if (!p) return;
      const units = f.step === 'pileIn' ? this.pileInUnits(p) : this.consolidateUnits(p);
      if (units.length > 0) return;
      this.finishStepRaw(p);
    }
  }

  private finishStepRaw(player: PlayerId) {
    if (!this.fight) return;
    if (!this.fight.done.includes(player)) this.fight.done.push(player);
    if (this.fight.done.length === 2) {
      if (this.fight.step === 'pileIn') {
        this.fight.step = 'fight';
        this.fight.done = [];
        for (const u of this.state.units.filter((x) => onBoard(x))) if (isEngaged(this.state, u)) u.flags.fightEligible = true;
        this.fight.picker = this.nextPicker(this.state.active);
        if (this.fightStepOver()) this.startConsolidation();
      } else if (this.fight.step === 'consolidate') {
        this.fight.step = 'done';
      }
    }
  }

  fightableUnits(player: PlayerId): UnitState[] {
    return this.unitsOf(player).filter((u) => onBoard(u) && !u.flags.fought && (u.flags.fightEligible || isEngaged(this.state, u)));
  }

  private nextPicker(preferred: PlayerId): PlayerId {
    const ff = (p: PlayerId) => this.fightableUnits(p).filter((u) => u.flags.fightsFirst);
    if (ff(preferred).length > 0) return preferred;
    if (ff(other(preferred)).length > 0) return other(preferred);
    if (this.fightableUnits(preferred).length > 0) return preferred;
    return other(preferred);
  }

  /** Units the current picker may select now (Fights First units first, 12.04). */
  pickableUnits(): UnitState[] {
    if (!this.fight || this.fight.step !== 'fight') return [];
    const p = this.fight.picker;
    const all = this.fightableUnits(p);
    const anyFF = [...this.fightableUnits('player'), ...this.fightableUnits('ai')].some((u) => u.flags.fightsFirst);
    return anyFF ? all.filter((u) => u.flags.fightsFirst) : all;
  }

  fightStepOver(): boolean {
    return this.fightableUnits('player').length === 0 && this.fightableUnits('ai').length === 0;
  }

  /** Engaged enemy units a model could attack (12.04: each target must be engaged with the model). */
  meleeTargets(u: UnitState): UnitState[] {
    return this.unitsOf(other(u.owner)).filter((t) => onBoard(t) && aliveModels(u).some((m) => modelUnitDistance(m, t) <= ENGAGEMENT_RANGE + 1e-6));
  }

  /** Best melee profile for a model by expected damage (used when the player does not choose). */
  bestMelee(u: UnitState, m: ModelState): ModelWeapon | undefined {
    const melee = modelWeapons(u, m).filter((w) => !w.ranged && !weaponAbilities(w.weapon.keywords).has('extra attacks'));
    const score = (w: ModelWeapon) => {
      const a = averageNum(w.weapon.A);
      const d = averageNum(w.weapon.D);
      const s = Number(w.weapon.S) || 0;
      return a * d * (1 + s / 10) * (1 - (Number(w.weapon.skill) || 4) / 8);
    };
    return [...melee].sort((a, b) => score(b) - score(a))[0];
  }

  /** A unit fights (12.04): normal fight, or overrun fight (an extra pile-in first) when unengaged. */
  async fightWith(unitId: string, assignment: FightAssignment): Promise<void> {
    return this.run(async () => {
      const u = this.unit(unitId);
      if (!this.fight || this.fight.step !== 'fight' || !this.pickableUnits().includes(u)) throw new Error(`${u.name} cannot fight now`);
      u.flags.fought = true;
      const target = unitById(this.state, assignment.targetId);
      const groups: AttackGroup[] = [];
      if (target && onBoard(target)) {
        const byProfile = new Map<string, { w: ModelWeapon; models: ModelState[] }>();
        for (const m of aliveModels(u)) {
          if (modelUnitDistance(m, target) > ENGAGEMENT_RANGE + 1e-6) continue;
          const weapons = modelWeapons(u, m).filter((w) => !w.ranged);
          const chosenName = assignment.profiles?.[m.id];
          const main = (chosenName ? weapons.find((w) => w.weapon.name === chosenName) : undefined) ?? this.bestMelee(u, m);
          const extra = weapons.filter((w) => weaponAbilities(w.weapon.keywords).has('extra attacks'));
          for (const w of [main, ...extra]) {
            if (!w) continue;
            const entry = byProfile.get(w.weapon.name) ?? { w, models: [] };
            entry.models.push(m);
            byProfile.set(w.weapon.name, entry);
          }
        }
        for (const { w, models } of byProfile.values()) groups.push({ attacker: u, models, weapon: w.weapon, key: w.key, ranged: false, target });
      }
      if (groups.length === 0) this.log(`${u.name} has no enemy within reach and does not attack.`, 'info', u.owner);
      else await this.resolveWithReactions(u, groups);
      let hazardous = 0;
      for (const g of groups) if (weaponAbilities(g.weapon.keywords).has('hazardous')) hazardous += g.models.length;
      await hazardRolls(this.ctx(), u, hazardous);
      await this.triggerDeadlyDemise();
      if (this.fight) {
        this.fight.passes = [];
        await this.offerReactions(other(u.owner), 'enemyFought', `${u.name} has resolved its attacks`, this.fightableUnits(other(u.owner)).map((x) => x.id), u.id);
        this.fight.picker = this.nextPicker(other(u.owner));
        if (this.fightStepOver()) this.startConsolidation();
      }
    });
  }

  /** "Eligible to fight, but unable to fight": pass when all your eligible units are more than 5" away. */
  canPass(player: PlayerId): boolean {
    return this.fightableUnits(player).every((u) => this.unitsOf(other(player)).every((e) => !onBoard(e) || unitDistance(u, e) > 5));
  }

  passFight(player: PlayerId) {
    if (!this.fight || this.fight.picker !== player) return;
    this.fight.passes.push(player);
    if (this.fight.passes.length >= 2 || this.fightableUnits(other(player)).length === 0) {
      // Both players passed: the Fight step ends; units that did not fight still count as eligible (12.08).
      for (const u of this.state.units) if (onBoard(u) && this.fightableUnits(u.owner).includes(u)) u.flags.fought = true;
      this.startConsolidation();
    } else this.fight.picker = other(player);
    this.changed();
  }

  private startConsolidation() {
    if (!this.fight) return;
    this.fight.step = 'consolidate';
    this.fight.done = [];
    this.skipEmptyFightSteps();
  }

  /** Units that may consolidate (12.08): those that were eligible to fight this phase. */
  consolidateUnits(player: PlayerId): UnitState[] {
    if (!this.fight || this.fight.step !== 'consolidate') return [];
    // A unit can only consolidate towards an enemy or an objective within 3".
    const objectives = objectiveAreas(this.state.battlefield);
    return this.unitsOf(player).filter(
      (u) =>
        onBoard(u) &&
        (u.flags.fightEligible || u.flags.fought) &&
        (this.unitsOf(other(player)).some((e) => onBoard(e) && unitDistance(u, e) <= 3) ||
          objectives.some((a) => aliveModels(u).some((m) => pointPolygonDistance(m, a.polygon) - m.r <= 3))),
    );
  }

  // ---- Stratagems (15) ----------------------------------------------------------------------

  /** Stratagems a player can use at a moment, with their CP. */
  usableStratagems(player: PlayerId, moment: Moment): Stratagem[] {
    const cp = this.state.cp[player];
    return armyStratagems(this.state, player).filter((s) => (s.cp ?? 0) <= cp && !usedThisPhase(this.state, player, s.id) && fitsMoment(this.state, player, s, moment));
  }

  /** Units a stratagem may target: friendly, not battle-shocked, not already targeted this phase. */
  stratagemTargets(player: PlayerId, s: Stratagem, restrictTo?: string[]): UnitState[] {
    // "(excluding TITANIC units)" names units that cannot be picked, not a requirement.
    const target = (sTarget(s) || '').replace(/\(excluding[^)]*\)/gi, '').replace(/excluding [^.,;]*/gi, '');
    const text = target.toLowerCase();
    const fromReserves = /in strategic reserves/.test(text);
    const returnsModels = /return.*destroyed model/i.test(sEffect(s));
    return this.unitsOf(player).filter((u) => {
      if (returnsModels) {
        // Include onBoard units with casualties AND fully destroyed units.
        if (u.status !== 'onBoard' && u.status !== 'destroyed') return false;
        if (!u.models.some((m) => m.w === 0)) return false;
        // Must have ENDLESS MULTITUDE keyword (check datasheets directly for destroyed units).
        const hasKeyword = u.members.some((mem) => BUNDLES[u.faction]?.datasheetById.get(mem.datasheetId)?.keywords.some((k) => k === 'Endless Multitude'));
        if (!hasKeyword) return false;
        return true;
      }
      if (fromReserves ? u.status !== 'reserves' : u.status !== 'onBoard') return false;
      if (u.battleShocked) return false;
      if (unitTargetedThisPhase(this.state, player, u.id)) return false;
      if (restrictTo && restrictTo.length > 0 && !restrictTo.includes(u.id)) return false;
      if (/\bunengaged\b/.test(text) && isEngaged(this.state, u)) return false;
      // Stratagems that make the unit shoot need a unit with guns.
      if (/\bshoots\b/i.test(sEffect(s)) && !aliveModels(u).some((m) => modelWeapons(u, m).some((w) => w.ranged))) return false;
      // Keywords written in capitals just before "unit", e.g. "EXPLOSIVES/GRENADES unit".
      const keywordReq = /((?:[A-Z][A-Z'’-]+)(?:\s*\/\s*[A-Z][A-Z'’-]+|\s[A-Z][A-Z'’-]+)*)\s+unit\b/.exec(target);
      if (keywordReq) {
        const words = keywordReq[1]
          .replace(/\b(TYRANIDS|ADEPTUS ASTARTES)\b/g, '')
          .split('/')
          .map((w) => w.trim())
          .filter(Boolean);
        if (words.length > 0 && !words.some((w) => unitHasKeyword(u, w) || u.members.some((mm) => BUNDLES[u.faction].datasheetById.get(mm.datasheetId)?.name.toUpperCase() === w.toUpperCase()))) return false;
      }
      return true;
    });
  }

  /** Spends CP and applies whatever part of the effect the engine understands. */
  useStratagem(player: PlayerId, stratagemId: string, unitId: string | null): { applied: boolean; manual: string } {
    const s = armyStratagems(this.state, player).find((x) => x.id === stratagemId);
    if (!s) throw new Error('Unknown stratagem');
    const cost = s.cp ?? 0;
    if (this.state.cp[player] < cost) throw new Error('Not enough CP');
    this.state.cp[player] -= cost;
    this.state.stratagemUses.push({ player, stratagemId, turn: this.state.turn, phase: this.state.phase, unitId });
    const parsed = parseEffect(s);
    const unit = unitId ? this.unit(unitId) : null;
    let label = s.name.charAt(0) + s.name.slice(1).toLowerCase();
    if (/until that enemy unit has attacked|until the attacking unit has resolved/i.test(sEffect(s))) label += ' (until attacked)';
    if (unit && parsed.mods.length > 0) {
      const effect: ActiveEffect = { id: `${s.id}-${this.state.turn}-${this.state.log.length}`, unitId: unit.id, label, source: `${s.name} stratagem`, until: parsed.until, turn: this.state.turn, phase: this.state.phase, mods: parsed.mods };
      this.state.effects.push(effect);
      if (parsed.mods.some((m) => m.kind === 'fightsFirst')) unit.flags.fightsFirst = true;
    }
    if (/insane bravery/i.test(s.name) && unit) {
      this.state.effects.push({ id: `ib-${this.state.turn}`, unitId: unit.id, label: 'Insane Bravery', source: 'Insane Bravery stratagem', until: 'phase', turn: this.state.turn, phase: this.state.phase, mods: [] });
    }
    this.log(`${player === 'player' ? 'You use' : 'The Ultramarines use'} ${s.name} (${cost} CP)${unit ? ` on ${unit.name}` : ''}.`, 'stratagem', player);
    this.changed();
    return { applied: parsed.mods.length > 0, manual: parsed.complete ? '' : sEffect(s) };
  }

  /** Offers a reaction window to a player if they have any stratagem that fits. */
  async offerReactions(player: PlayerId, moment: Moment, prompt: string, unitIds: string[], enemyUnitId?: string) {
    const aboutUnits = moment === 'targeted' || moment === 'enemyMoved' || moment === 'enemyFought' || moment === 'beforeBattleshock' || moment === 'afterChargeMove';
    const stratagems = this.usableStratagems(player, moment).filter(
      (s) => !needsTarget(s) || this.stratagemTargets(player, s, aboutUnits ? unitIds : undefined).length > 0,
    );
    if (stratagems.length === 0) return;
    await this.hooks.react({ player, moment, prompt, unitIds, enemyUnitId, stratagems });
  }

  /** Inflicts mortal wounds outside attacks (e.g. from a stratagem resolved by hand). */
  async mortalWounds(unitId: string, amount: number, label: string) {
    return this.run(async () => {
      const u = this.unit(unitId);
      await applyMortalWounds(this.ctx(), u, amount, label);
      this.log(`${u.name} suffers ${amount} mortal wound${amount === 1 ? '' : 's'} (${label}).`, 'attack');
    });
  }

  /** Return dead models to a unit (e.g. Endless Swarm). Restores up to `count` dead models to maxW. */
  returnModels(unitId: string, count: number): number {
    const u = this.unit(unitId);
    if (u.status !== 'onBoard' && u.status !== 'destroyed') return 0;
    const dead = u.models.filter((m) => m.w === 0);
    const restore = dead.slice(0, count);
    for (const m of restore) m.w = m.maxW;
    if (u.status === 'destroyed' && restore.length > 0) u.status = 'onBoard';
    if (restore.length > 0) {
      this.log(`${restore.length} model${restore.length === 1 ? '' : 's'} returned to ${u.name}.`, 'info', u.owner);
      this.updateObjectives();
      this.changed();
    }
    return restore.length;
  }

  /** Rolls a dice expression for anything resolved by hand (e.g. "D3" mortal wounds). */
  async rollFor(player: PlayerId, expr: string, label: string) {
    return rollExpr((r) => this.roll(r), parseDice(expr), { who: player, kind: 'other', label });
  }

  // ---- Broodlord: Vicious Insight (start of Fight phase) ------------------------------------

  /** Enemy units the Broodlord can apply Vicious Insight to (engaged, not already debuffed). */
  viciousInsightTargets(player: PlayerId): UnitState[] {
    const s = this.state;
    if (s.phase !== 'fight') return [];
    const broodlordUnits = this.unitsOf(player).filter((u) => onBoard(u) && aliveModels(u).some((m) => modelDatasheetHas(u, m, 'Vicious Insight')));
    if (broodlordUnits.length === 0) return [];
    const used = s.checklist.includes(`viciousInsight:${s.turn}`);
    if (used) return [];
    const enemies = this.unitsOf(other(player)).filter((e) => onBoard(e));
    return enemies.filter((e) => broodlordUnits.some((b) => engagedWith(this.state, b).includes(e)));
  }

  applyViciousInsight(player: PlayerId, targetId: string) {
    const targets = this.viciousInsightTargets(player);
    const target = targets.find((t) => t.id === targetId);
    if (!target) return;
    this.state.checklist.push(`viciousInsight:${this.state.turn}`);
    const effect: ActiveEffect = {
      id: `vicious-insight-${this.state.turn}`,
      unitId: target.id,
      label: 'Vicious Insight (−1 to hit)',
      source: 'Broodlord',
      until: 'phase',
      turn: this.state.turn,
      phase: this.state.phase,
      mods: [{ kind: 'hit', delta: -1 }],
    };
    this.state.effects.push(effect);
    this.log(`Broodlord – Vicious Insight applied to ${target.name}: −1 to Hit rolls this phase.`, 'info', player);
    this.changed();
  }

  // ---- Neurotyrant: Neuroloids (Command phase) ----------------------------------------------

  neuroloidTargets(player: PlayerId): { neurotyrant: UnitState; available: UnitState[] } | null {
    const s = this.state;
    if (s.phase !== 'command' || s.active !== player) return null;
    const key = `neuroloid:${player}:${s.round}`;
    if (s.usedOnce.includes(key)) return null;
    const neurotyrant = this.unitsOf(player).find((u) => onBoard(u) && aliveModels(u).some((m) => modelDatasheetHas(u, m, 'Neuroloids')));
    if (!neurotyrant) return null;
    const granted = s.effects.filter((e) => e.source === 'Neuroloids').map((e) => e.unitId);
    const available = this.unitsOf(player).filter(
      (u) => onBoard(u) && u.id !== neurotyrant.id && !granted.includes(u.id) && unitDistance(neurotyrant, u) <= 18,
    );
    return { neurotyrant, available };
  }

  grantNeuroloid(player: PlayerId, targetId: string) {
    const info = this.neuroloidTargets(player);
    if (!info || !info.available.find((u) => u.id === targetId)) return;
    const target = this.unit(targetId);
    const key = `neuroloid:${player}:${this.state.round}`;
    const alreadyGranted = this.state.effects.filter((e) => e.source === 'Neuroloids').length;
    const effect: ActiveEffect = {
      id: `neuroloid-${targetId}-${this.state.round}`,
      unitId: target.id,
      label: 'Neuroloid (counts as within Synapse Range)',
      source: 'Neuroloids',
      until: 'nextCommand',
      turn: this.state.turn,
      phase: this.state.phase,
      mods: [],
    };
    this.state.effects.push(effect);
    if (alreadyGranted + 1 >= 2) this.state.usedOnce.push(key);
    this.log(`Neurotyrant – Neuroloids: ${target.name} counts as within Synapse Range until your next Command phase.`, 'info', player);
    this.changed();
  }
}

// ---- Helpers ------------------------------------------------------------------------------

export const phaseName = (p: Phase) => ({ deployment: 'Deployment', command: 'Command', movement: 'Movement', shooting: 'Shooting', charge: 'Charge', fight: 'Fight', gameOver: 'Game over' })[p];

export const parseRange = (range: string) => {
  const n = Number(/(\d+)/.exec(range)?.[1]);
  return Number.isFinite(n) ? n : 0;
};

const averageNum = (v: string) => {
  const e = parseDice(v);
  return e.dice * (e.sides === 3 ? 2 : 3.5) + e.plus;
};

const abilitiesOf = (w: ModelWeapon) => weaponAbilities(w.weapon.keywords);

function isCloseQuarters(u: UnitState, m: ModelState, profile: string): boolean {
  const w = modelWeapons(u, m).find((x) => x.weapon.name === profile);
  if (!w) return false;
  const ab = weaponAbilities(w.weapon.keywords);
  return ab.has('pistol') || ab.has('close-quarters');
}

const sTarget = (s: Stratagem) => sectionOf(stratagemText(s), 'TARGET');
/** Whether a stratagem is aimed at one of your units (rather than, say, the whole army). */
export const needsTarget = (s: Stratagem) => /one friendly|that .*unit|your unit|one .*unit/i.test(sTarget(s));
const sEffect = (s: Stratagem) => sectionOf(stratagemText(s), 'EFFECT');

function modelDatasheetHas(u: UnitState, m: ModelState, ability: string): boolean {
  const d = BUNDLES[u.faction].datasheetById.get(u.members[m.member].datasheetId);
  return d !== undefined && [...d.abilities.faction, ...d.abilities.datasheet, ...d.abilities.other].some((a) => a.name === ability);
}

function isTermagantUnit(u: UnitState): boolean {
  return u.members.some((mem) => BUNDLES[u.faction]?.datasheetById.get(mem.datasheetId)?.name === 'Termagants');
}

function nearestFriend(m: ModelState, all: ModelState[]): number {
  return Math.min(...all.filter((n) => n.id !== m.id).map((n) => edgeDistance(m, n)));
}

function distanceToZone(p: Vec, zone: Vec[]): number {
  if (pointInPolygon(p, zone)) return 0;
  const ys = zone.map((z) => z.y);
  return Math.min(Math.abs(p.y - Math.min(...ys)), Math.abs(p.y - Math.max(...ys)));
}

function circleWhollyIn(p: Vec, r: number, zone: Vec[]): boolean {
  const xs = zone.map((z) => z.x);
  const ys = zone.map((z) => z.y);
  return p.x - r >= Math.min(...xs) - 1e-6 && p.x + r <= Math.max(...xs) + 1e-6 && p.y - r >= Math.min(...ys) - 1e-6 && p.y + r <= Math.max(...ys) + 1e-6;
}

