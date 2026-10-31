// Dice. Every roll goes through a Roller so the player can roll real dice and type the results,
// or let the game roll. D3 is a D6 halved, rounding up (01.05).
import type { PlayerId } from './state';

export type RollKind =
  | 'hit'
  | 'wound'
  | 'save'
  | 'damage'
  | 'attacks'
  | 'charge'
  | 'advance'
  | 'battleshock'
  | 'hazard'
  | 'fnp'
  | 'mortal'
  | 'other';

export interface DiceRequest {
  /** Who rolls these dice. */
  who: PlayerId;
  kind: RollKind;
  /** What the roll is for, e.g. "Hit rolls for 7 Termagant devourers". */
  label: string;
  count: number;
  /** What counts as a success, for the dice entry screen (e.g. "4+"). */
  need?: string;
  /** True when these dice are a re-roll of earlier ones. */
  reroll?: boolean;
  /** Hit and wound rolls: the unmodified result that is a critical (6, or less with [ANTI] and similar). */
  critOn?: number;
  /** Rolls of 1 will be re-rolled, so the dice entry asks how many 1s there were. */
  rerollOnes?: boolean;
}

/** Totals the player reads off a big handful of dice instead of typing every die. */
export interface DiceCounts {
  /** Hit/wound rolls: successes including criticals. Saves: saves passed. FNP: wounds ignored. Hazard: rolls passed. */
  successes: number;
  /** Hit/wound rolls: how many of the successes were criticals. */
  crits: number;
  /** Rolls of 1 among the failures (only asked when 1s get re-rolled). */
  ones: number;
}

/** Roll kinds that can be entered as totals. */
export const COUNTABLE: RollKind[] = ['hit', 'wound', 'save', 'fnp', 'hazard'];

export const needNumber = (need?: string) => {
  const n = Number(/(\d)/.exec(need ?? '')?.[1]);
  return Number.isFinite(n) ? n : 4;
};

/**
 * Turns totals back into dice results the rules can read: criticals become the critical value,
 * other successes the lowest passing roll, and failures a 1 or the highest failing roll.
 */
export function valuesFromCounts(req: DiceRequest, c: DiceCounts): number[] {
  const out: number[] = [];
  const push = (v: number, n: number) => {
    for (let i = 0; i < n; i++) out.push(v);
  };
  if (req.kind === 'hit' || req.kind === 'wound') {
    const need = needNumber(req.need);
    const crit = req.critOn ?? 6;
    // When the critical threshold is at or below what is needed (e.g. [ANTI-X 4+] against a 5+), every success is a critical.
    const crits = need >= crit ? c.successes : Math.min(c.crits, c.successes);
    const normal = c.successes - crits;
    const fails = req.count - c.successes;
    const ones = Math.min(c.ones, fails);
    const highFail = Math.min(need - 1, crit - 1);
    push(crit, crits);
    push(Math.max(2, Math.min(need, crit - 1)), normal);
    push(1, ones);
    push(highFail >= 2 ? highFail : 1, fails - ones);
    return out;
  }
  // Saves, Feel No Pain and hazard rolls: a pass is a 6, a failure a 1.
  push(6, c.successes);
  push(1, req.count - c.successes);
  return out;
}

export type Roller = (request: DiceRequest) => Promise<number[]>;

export const d6 = (rng: () => number = Math.random) => 1 + Math.floor(rng() * 6);

export function autoRoller(rng: () => number = Math.random): Roller {
  return async (req) => Array.from({ length: req.count }, () => d6(rng));
}

/** For tests: hands out the given values in order and throws if they run out. */
export function scriptedRoller(values: number[]): Roller & { remaining: () => number } {
  let i = 0;
  const roller = (async (req: DiceRequest) => {
    const out = values.slice(i, i + req.count);
    if (out.length < req.count) throw new Error(`Scripted dice ran out at "${req.label}" (needed ${req.count})`);
    i += req.count;
    return out;
  }) as Roller & { remaining: () => number };
  roller.remaining = () => values.length - i;
  return roller;
}

export interface DiceExpr {
  dice: number;
  sides: 3 | 6;
  plus: number;
}

/** "D6+3" -> 1D6+3, "2D6" -> 2D6, "D3" -> 1D3, "4" -> 0 dice + 4. Unknown text counts as 0. */
export function parseDice(text: string): DiceExpr {
  const t = text.replace(/\s+/g, '').toUpperCase();
  const m = /^(\d*)D(3|6)(?:\+(\d+))?$/.exec(t);
  if (m) return { dice: m[1] ? Number(m[1]) : 1, sides: Number(m[2]) as 3 | 6, plus: m[3] ? Number(m[3]) : 0 };
  const n = Number(/-?\d+/.exec(t)?.[0]);
  return { dice: 0, sides: 6, plus: Number.isFinite(n) ? n : 0 };
}

export const isRandom = (text: string) => parseDice(text).dice > 0;
export const averageOf = (e: DiceExpr) => e.dice * (e.sides === 3 ? 2 : 3.5) + e.plus;

/** Rolls a dice expression (one request for all its dice). */
export async function rollExpr(roll: Roller, expr: DiceExpr, req: Omit<DiceRequest, 'count'>): Promise<number> {
  if (expr.dice === 0) return expr.plus;
  const values = await roll({ ...req, count: expr.dice });
  const total = values.reduce((s, v) => s + (expr.sides === 3 ? Math.ceil(v / 2) : v), 0);
  return total + expr.plus;
}
