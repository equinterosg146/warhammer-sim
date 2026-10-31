// Moving models (03): measured paths around what a model cannot move through, and the checks every
// move must pass when it ends (coherency 03.03, engagement 03.04, no overlapping models or walls).
import type { TerrainArea } from './battlefield';
import { dist, edgeDistance, pointSegmentDistance, segmentSegmentDistance, type Circle, type Segment, type Vec } from './geometry';
import { aliveModels, onBoard, type GameState, type ModelState, type MoveKind, type UnitState } from './state';
import { isMonsterOrVehicle, movesThroughDense } from './units';

export const ENGAGEMENT_RANGE = 2;
export const COHERENCY_RANGE = 2;
export const COHERENCY_SPREAD = 9;

interface Obstacles {
  circles: Circle[];
  walls: Segment[];
}

/** What a model cannot move through during a move (03.01, 13.06, 17.01, 21.03). */
export function obstaclesFor(state: GameState, unit: UnitState, model: ModelState, kind: MoveKind, flying: boolean): Obstacles {
  if (flying) return { circles: [], walls: [] };
  const big = isMonsterOrVehicle(unit, model);
  const throughModels = big && (kind === 'normal' || kind === 'advance');
  const desperate = kind === 'fallBack' && unit.battleShocked;
  const circles: Circle[] = [];
  for (const u of state.units) {
    if (u.owner === unit.owner || !onBoard(u) || desperate) continue;
    for (const m of aliveModels(u)) {
      if (throughModels && !isMonsterOrVehicle(u, m)) continue;
      circles.push(m);
    }
  }
  const walls = movesThroughDense(unit, model) ? [] : state.battlefield.terrain.flatMap((t) => t.walls);
  return { circles, walls };
}

/** Whether a model of radius r can move in a straight line from a to b. */
function clearLine(a: Vec, b: Vec, r: number, obs: Obstacles): boolean {
  for (const c of obs.circles) if (pointSegmentDistance(c, a, b) < c.r + r - 1e-3) return false;
  for (const w of obs.walls) if (segmentSegmentDistance(a, b, w.a, w.b) < r - 1e-3) return false;
  return true;
}

function blockedPoint(p: Vec, r: number, obs: Obstacles): boolean {
  for (const c of obs.circles) if (dist(p, c) < c.r + r - 1e-3) return true;
  for (const w of obs.walls) if (pointSegmentDistance(p, w.a, w.b) < r - 1e-3) return true;
  return false;
}

/**
 * Length of the shortest path a model can take from a to b (Theta* on a 0.25" grid with straight-line
 * shortcuts). Returns Infinity when there is no way through.
 */
export function pathLength(a: Vec, b: Vec, r: number, obs: Obstacles, width: number, height: number, limit = Infinity): number {
  if (clearLine(a, b, r, obs)) return dist(a, b);
  if (blockedPoint(b, r, obs)) return Infinity;
  const step = 0.25;
  const cols = Math.ceil(width / step) + 1;
  const rows = Math.ceil(height / step) + 1;
  const idx = (cx: number, cy: number) => cy * cols + cx;
  const toPoint = (i: number): Vec => ({ x: (i % cols) * step, y: Math.floor(i / cols) * step });
  const cell = (p: Vec) => idx(Math.round(Math.min(width, Math.max(0, p.x)) / step), Math.round(Math.min(height, Math.max(0, p.y)) / step));
  const start = -1;
  const goal = cell(b);
  const g = new Map<number, number>();
  const parent = new Map<number, number>();
  const pos = (i: number) => (i === start ? a : toPoint(i));
  const blockedCache = new Map<number, boolean>();
  const blocked = (i: number) => {
    let v = blockedCache.get(i);
    if (v === undefined) {
      const p = toPoint(i);
      v = p.x < r || p.y < r || p.x > width - r || p.y > height - r || blockedPoint(p, r, obs);
      blockedCache.set(i, v);
    }
    return v;
  };
  // Binary heap on f = g + h.
  const heap: [number, number][] = [];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = (): [number, number] | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const rr = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  g.set(start, 0);
  push(dist(a, b), start);
  const closed = new Set<number>();
  let expansions = 0;
  for (let item = pop(); item; item = pop()) {
    const [, i] = item;
    if (closed.has(i)) continue;
    closed.add(i);
    const here = pos(i);
    const gi = g.get(i)!;
    if (gi > limit) return Infinity;
    // Finish with a straight line to the exact destination once one is clear.
    if (i === goal || (dist(here, b) < 3 && clearLine(here, b, r, obs))) return gi + dist(here, b);
    if (++expansions > 60000) return Infinity;
    const cx = i === start ? Math.round(a.x / step) : i % cols;
    const cy = i === start ? Math.round(a.y / step) : Math.floor(i / cols);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = idx(nx, ny);
        if (closed.has(n) || blocked(n)) continue;
        const np = toPoint(n);
        // Theta*: connect straight to the grandparent when the line is clear.
        const pi = parent.get(i);
        let from = i;
        if (pi !== undefined && clearLine(pos(pi), np, r, obs)) from = pi;
        else if (!clearLine(here, np, r, obs)) continue;
        const cost = g.get(from)! + dist(pos(from), np);
        if (cost < (g.get(n) ?? Infinity)) {
          g.set(n, cost);
          parent.set(n, from);
          push(cost + dist(np, b), n);
        }
      }
    }
  }
  return Infinity;
}

export interface MoveProblem {
  modelId?: string;
  message: string;
}

/** Engaged: within engagement range of an enemy model (03.04). */
export function engagedWith(state: GameState, unit: UnitState, positions?: Map<string, Vec>): UnitState[] {
  const models = aliveModels(unit).map((m) => ({ ...m, ...(positions?.get(m.id) ?? {}) }));
  return state.units.filter(
    (u) => u.owner !== unit.owner && onBoard(u) && aliveModels(u).some((e) => models.some((m) => edgeDistance(m, e) <= ENGAGEMENT_RANGE + 1e-6)),
  );
}

export const isEngaged = (state: GameState, unit: UnitState) => engagedWith(state, unit).length > 0;

/** Coherency (03.03): within 2" of another model in the unit, and within 9" of every other model. */
export function coherencyProblems(models: Circle[]): string[] {
  if (models.length < 2) return [];
  const problems: string[] = [];
  const lonely = models.filter((m, i) => !models.some((n, j) => i !== j && edgeDistance(m, n) <= COHERENCY_RANGE + 1e-6));
  if (lonely.length > 0) problems.push(`${lonely.length} model${lonely.length === 1 ? ' is' : 's are'} more than 2" from every other model in the unit.`);
  const spread = models.some((m, i) => models.some((n, j) => j > i && edgeDistance(m, n) > COHERENCY_SPREAD + 1e-6));
  if (spread) problems.push('Some models are more than 9" from another model in the unit.');
  return problems;
}

/** A base may not end on another model or partway through a wall (03.01 Ending a Move). */
function placementProblems(state: GameState, unit: UnitState, model: ModelState, p: Vec): string | null {
  const bf = state.battlefield;
  if (p.x < model.r - 1e-6 || p.y < model.r - 1e-6 || p.x > bf.width - model.r + 1e-6 || p.y > bf.height - model.r + 1e-6) return 'off the battlefield';
  for (const t of bf.terrain) for (const w of t.walls) if (pointSegmentDistance(p, w.a, w.b) < model.r - 1e-3) return 'on a wall';
  for (const u of state.units) {
    if (!onBoard(u) && u.id !== unit.id) continue;
    for (const m of aliveModels(u)) {
      if (m.id === model.id) continue;
      if (u.id === unit.id) continue; // checked separately against the new positions
      if (dist(p, m) < m.r + model.r - 1e-3) return 'on another model';
    }
  }
  return null;
}

export interface MoveCheck {
  ok: boolean;
  problems: MoveProblem[];
  /** Distance each model travels along its path. */
  distances: Map<string, number>;
}

export interface MoveRules {
  kind: MoveKind;
  /** Maximum distance per model, by model id (different M characteristics). */
  maxDistance: (m: ModelState) => number;
  flying: boolean;
  /** Must the unit end unengaged (normal, advance, fall back)? */
  endUnengaged?: boolean;
}

/** Checks a proposed set of end positions for one unit. */
export function checkMove(state: GameState, unit: UnitState, positions: Map<string, Vec>, rules: MoveRules): MoveCheck {
  const problems: MoveProblem[] = [];
  const distances = new Map<string, number>();
  const bf = state.battlefield;
  const alive = aliveModels(unit);
  for (const m of alive) {
    const p = positions.get(m.id) ?? m;
    const where = placementProblems(state, unit, m, p);
    if (where) problems.push({ modelId: m.id, message: `${m.name} would end ${where}.` });
    // Other models of the same unit at their new positions.
    for (const n of alive) {
      if (n.id <= m.id) continue;
      const q = positions.get(n.id) ?? n;
      if (dist(p, q) < m.r + n.r - 1e-3) problems.push({ modelId: m.id, message: `${m.name} overlaps another model in the unit.` });
    }
    if (rules.kind === 'deploy') continue;
    const max = rules.maxDistance(m);
    const obs = obstaclesFor(state, unit, m, rules.kind, rules.flying);
    const d = dist(m, p) < 1e-6 ? 0 : pathLength(m, p, m.r, obs, bf.width, bf.height, max + 0.01);
    distances.set(m.id, d);
    if (d > max + 1e-3) {
      problems.push({ modelId: m.id, message: d === Infinity ? `${m.name} has no way through to that spot.` : `${m.name} would move ${d.toFixed(1)}" (maximum ${max.toFixed(1)}").` });
    }
  }
  const newCircles = alive.map((m) => ({ ...m, ...(positions.get(m.id) ?? {}) }));
  for (const c of coherencyProblems(newCircles)) problems.push({ message: `Not in coherency: ${c}` });
  if (rules.endUnengaged && engagedWith(state, unit, positions).length > 0) problems.push({ message: 'The unit would end engaged (within 2" of an enemy model).' });
  return { ok: problems.length === 0, problems, distances };
}

/** Terrain areas as used by other modules. */
export type { TerrainArea };
