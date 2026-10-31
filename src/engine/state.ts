// Game state: plain data only, so a game can be saved and loaded as JSON.
import type { FactionKey } from '../data/bundles';
import type { ArmyList } from '../rules/army';
import type { Battlefield, PlayerId } from './battlefield';

export type { PlayerId } from './battlefield';

export type Phase = 'deployment' | 'command' | 'movement' | 'shooting' | 'charge' | 'fight' | 'gameOver';

export const TURN_PHASES: Phase[] = ['command', 'movement', 'shooting', 'charge', 'fight'];

export type MoveKind = 'stationary' | 'normal' | 'advance' | 'fallBack' | 'charge' | 'pileIn' | 'consolidate' | 'deploy' | 'ingress' | 'scout' | 'surge';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type DiceMode = 'manual' | 'auto';

export interface ModelState {
  id: string;
  /** Index into the unit's members (which datasheet this model comes from). */
  member: number;
  /** Index into that datasheet's model profiles. */
  profile: number;
  name: string;
  x: number;
  y: number;
  /** Base radius in inches. */
  r: number;
  /** Wounds left; 0 means destroyed. */
  w: number;
  maxW: number;
  /** Weapon key (see rules/loadout weaponKey) -> how many this model carries. */
  weapons: Record<string, number>;
  character: boolean;
}

export interface UnitMember {
  /** uid of the unit in the army list. */
  listUid: string;
  datasheetId: string;
  role: 'solo' | 'bodyguard' | 'leader';
  enhancementId: string | null;
  /** Models this member started with. */
  models: number;
}

/** Things that happened to a unit this turn; reset at the start of each turn. */
export interface TurnFlags {
  move: MoveKind | null;
  /** Furthest any model moved this turn, for [HEAVY]. */
  maxMoved: number;
  setUp: boolean;
  shot: boolean;
  chargeDeclared: boolean;
  charged: boolean;
  fought: boolean;
  /** Eligible to fight this Fight phase (engaged at the start of the Fight step or charged). */
  fightEligible: boolean;
  fightsFirst: boolean;
  /** Took to the skies this move (21.03). */
  flying: boolean;
}

export const freshFlags = (): TurnFlags => ({
  move: null,
  maxMoved: 0,
  setUp: false,
  shot: false,
  chargeDeclared: false,
  charged: false,
  fought: false,
  fightEligible: false,
  fightsFirst: false,
  flying: false,
});

export interface UnitState {
  id: string;
  owner: PlayerId;
  faction: FactionKey;
  name: string;
  members: UnitMember[];
  models: ModelState[];
  startingStrength: number;
  status: 'undeployed' | 'reserves' | 'onBoard' | 'destroyed';
  /** Set up anywhere more than 9" from enemies when arriving (Deep Strike) — chosen at deployment. */
  deepStrike: boolean;
  battleShocked: boolean;
  flags: TurnFlags;
  /** Index of the last turn in which this unit made ranged attacks (for Hidden, 13.09). */
  lastShotTurn: number;
  /** [ONE SHOT] weapons already used. */
  oneShotUsed: string[];
  /** Situational buff switches turned on by the player (see rules/effects). */
  switches: Record<string, boolean>;
}

/** A temporary effect, e.g. from a stratagem: applies to a unit until the end of a phase or turn. */
export interface ActiveEffect {
  id: string;
  unitId: string;
  label: string;
  source: string;
  until: 'phase' | 'turn' | 'nextCommand';
  /** Turn index and phase it was applied in. */
  turn: number;
  phase: Phase;
  mods: EngineMod[];
}

/** Modifiers the attack and movement code understands. */
export type EngineMod =
  | { kind: 'hit'; delta: number; weapons?: 'ranged' | 'melee' }
  | { kind: 'wound'; delta: number; weapons?: 'ranged' | 'melee' }
  | { kind: 'rerollHits'; which: 'ones' | 'fails'; weapons?: 'ranged' | 'melee' }
  | { kind: 'rerollWounds'; which: 'ones' | 'fails'; weapons?: 'ranged' | 'melee' }
  | { kind: 'weaponKeyword'; keyword: string; weapons?: 'ranged' | 'melee' }
  | { kind: 'weaponStat'; stat: 'A' | 'S' | 'AP' | 'D'; delta: number; weapons?: 'ranged' | 'melee' }
  | { kind: 'critHit'; on: number; weapons?: 'ranged' | 'melee' }
  /** Defensive: attacks against this unit. */
  | { kind: 'enemyHit'; delta: number; weapons?: 'ranged' | 'melee' }
  | { kind: 'enemyWound'; delta: number; weapons?: 'ranged' | 'melee' }
  | { kind: 'damageReduction'; amount: number }
  | { kind: 'save'; delta: number }
  | { kind: 'invuln'; value: number }
  | { kind: 'fnp'; value: number }
  | { kind: 'cover' }
  | { kind: 'stealth' }
  | { kind: 'fightsFirst' }
  | { kind: 'advanceAndCharge' }
  | { kind: 'fallBackAndShoot' }
  | { kind: 'fallBackAndCharge' }
  | { kind: 'advanceAndShoot' }
  | { kind: 'move'; delta: number }
  | { kind: 'charge'; delta: number }
  | { kind: 'oc'; delta: number }
  | { kind: 'battleshock'; delta: number };

export interface LogEntry {
  turn: number;
  phase: Phase;
  player: PlayerId | null;
  text: string;
  kind?: 'info' | 'attack' | 'move' | 'score' | 'warn' | 'stratagem' | 'coach';
}

export interface ArmyInfo {
  faction: FactionKey;
  name: string;
  detachmentIds: string[];
  points: number;
  /** The list the army was built from (buffs are read from it). */
  list: ArmyList;
  /** Army-wide choices, e.g. which Hyper-adaptation is in effect (see rules/effects). */
  switches: Record<string, boolean>;
}

export interface StratagemUse {
  player: PlayerId;
  stratagemId: string;
  turn: number;
  phase: Phase;
  unitId: string | null;
}

export interface GameState {
  version: 1;
  battlefield: Battlefield;
  /** 1-5. */
  round: number;
  /** 0-based index over all player turns: round 1 first player = 0, second player = 1, ... */
  turn: number;
  firstPlayer: PlayerId;
  active: PlayerId;
  phase: Phase;
  /** Who is deploying next during deployment. */
  deployer: PlayerId;
  cp: Record<PlayerId, number>;
  vp: Record<PlayerId, number>;
  /** Primary VP scored in each round, for the summary. */
  vpLog: { round: number; player: PlayerId; vp: number; reason: string }[];
  units: UnitState[];
  armies: Record<PlayerId, ArmyInfo>;
  /** Controller of each objective, or null. */
  objectives: (PlayerId | null)[];
  effects: ActiveEffect[];
  stratagemUses: StratagemUse[];
  /** Once-per-battle things already used, e.g. "player:shadow-in-the-warp". */
  usedOnce: string[];
  /** Command phase steps the coach has seen ticked off this turn. */
  checklist: string[];
  log: LogEntry[];
  settings: {
    difficulty: Difficulty;
    dice: Record<PlayerId, DiceMode>;
  };
  winner: PlayerId | 'draw' | null;
}

export const other = (p: PlayerId): PlayerId => (p === 'player' ? 'ai' : 'player');

export const aliveModels = (u: UnitState) => u.models.filter((m) => m.w > 0);
export const onBoard = (u: UnitState) => u.status === 'onBoard' && aliveModels(u).length > 0;
export const unitById = (s: GameState, id: string) => s.units.find((u) => u.id === id);
