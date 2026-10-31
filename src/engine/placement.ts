// Helpers that work out model positions: deployment formations, moving a unit as a block, and
// charging / piling in towards enemy models. Used by the computer opponent and by the
// "place for me" buttons; every result is still checked by movement.checkMove.
import { add, dist, edgeDistance, len, scale, sub, type Vec } from './geometry';
import { checkMove, ENGAGEMENT_RANGE, obstaclesFor, pathLength, type MoveRules } from './movement';
import { aliveModels, onBoard, type GameState, type ModelState, type UnitState } from './state';

/** Models in a compact block around a centre point, rows along x, spaced so neighbours are in coherency. */
export function formation(unit: UnitState, centre: Vec, rowWidth?: number): Map<string, Vec> {
  const models = aliveModels(unit);
  const maxR = Math.max(...models.map((m) => m.r));
  const gap = Math.min(1.5, 0.4 + maxR * 0.2);
  const spacing = maxR * 2 + gap;
  // Keep the block narrow enough that the furthest models stay within 9" of each other (03.03).
  const perRow = rowWidth ?? Math.max(1, Math.min(models.length, Math.floor(7 / spacing) + 1, Math.ceil(Math.sqrt(models.length * 2.5))));
  const rows = Math.ceil(models.length / perRow);
  const out = new Map<string, Vec>();
  models.forEach((m, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const inRow = Math.min(perRow, models.length - row * perRow);
    out.set(m.id, {
      x: centre.x + (col - (inRow - 1) / 2) * spacing,
      y: centre.y + (row - (rows - 1) / 2) * spacing,
    });
  });
  return out;
}

export const translate = (unit: UnitState, delta: Vec): Map<string, Vec> =>
  new Map(aliveModels(unit).map((m) => [m.id, add(m, delta)]));

export function unitCentre(unit: UnitState): Vec {
  const alive = aliveModels(unit);
  return { x: alive.reduce((s, m) => s + m.x, 0) / alive.length, y: alive.reduce((s, m) => s + m.y, 0) / alive.length };
}

/**
 * Moves the unit as a block towards a point, as far as the move allows, trying slightly different
 * directions when the straight one is blocked. Returns null if nothing legal was found.
 */
export function moveToward(state: GameState, unit: UnitState, goal: Vec, rules: MoveRules, stopShort = 0): Map<string, Vec> | null {
  const centre = unitCentre(unit);
  const toGoal = sub(goal, centre);
  const full = len(toGoal);
  if (full < 0.05) return null;
  const max = Math.min(...aliveModels(unit).map((m) => rules.maxDistance(m)));
  const want = Math.max(0, Math.min(max - 0.05, full - stopShort));
  if (want < 0.1) return null;
  const angles = [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.2, -1.2];
  const fractions = [1, 0.8, 0.6, 0.4, 0.25];
  for (const f of fractions) {
    for (const a of angles) {
      const dir = scale(toGoal, 1 / full);
      const rotated = { x: dir.x * Math.cos(a) - dir.y * Math.sin(a), y: dir.x * Math.sin(a) + dir.y * Math.cos(a) };
      const positions = translate(unit, scale(rotated, want * f));
      if (checkMove(state, unit, positions, rules).ok) return positions;
    }
  }
  return null;
}

const enemyModels = (state: GameState, unit: UnitState, targetIds?: string[]) =>
  state.units
    .filter((u) => u.owner !== unit.owner && onBoard(u) && (!targetIds || targetIds.includes(u.id)))
    .flatMap((u) => aliveModels(u));

/**
 * Moves each model towards base contact with the closest model of the target units, as for a charge
 * or pile-in. Models are handled closest first; each tries spots around its target model.
 */
export function engagePositions(state: GameState, unit: UnitState, targetIds: string[], maxDistance: number, kind: 'charge' | 'pileIn' | 'consolidate' = 'charge'): Map<string, Vec> {
  const targets = enemyModels(state, unit, targetIds);
  const out = new Map<string, Vec>();
  if (targets.length === 0) return out;
  const blockers = state.units.filter((u) => onBoard(u)).flatMap((u) => aliveModels(u).filter((m) => !aliveModels(unit).includes(m)));
  const placed: { x: number; y: number; r: number }[] = [];
  // The real distance along the path around enemy models and walls, not just the straight line.
  const reach = (m: ModelState, p: Vec) =>
    pathLength(m, p, m.r, obstaclesFor(state, unit, m, kind, false), state.battlefield.width, state.battlefield.height, maxDistance + 0.5);
  const free = (p: Vec, r: number) =>
    p.x > r && p.y > r && p.x < state.battlefield.width - r && p.y < state.battlefield.height - r &&
    blockers.every((b) => dist(p, b) >= b.r + r - 1e-3) &&
    placed.every((b) => dist(p, b) >= b.r + r - 1e-3) &&
    state.battlefield.terrain.every((t) => t.walls.every((w) => {
      const ab = sub(w.b, w.a);
      const tt = Math.max(0, Math.min(1, ((p.x - w.a.x) * ab.x + (p.y - w.a.y) * ab.y) / (ab.x * ab.x + ab.y * ab.y)));
      return dist(p, { x: w.a.x + ab.x * tt, y: w.a.y + ab.y * tt }) >= r;
    }));
  const models = [...aliveModels(unit)].sort(
    (a, b) => Math.min(...targets.map((t) => edgeDistance(a, t))) - Math.min(...targets.map((t) => edgeDistance(b, t))),
  );
  for (const m of models) {
    const byDistance = [...targets].sort((a, b) => edgeDistance(m, a) - edgeDistance(m, b));
    let best: Vec | null = null;
    for (const t of byDistance.slice(0, 4)) {
      const base = Math.atan2(m.y - t.y, m.x - t.x);
      for (let k = 0; k < 24 && !best; k++) {
        const a = base + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
        const p = { x: t.x + Math.cos(a) * (t.r + m.r + 0.02), y: t.y + Math.sin(a) * (t.r + m.r + 0.02) };
        if (dist(m, p) <= maxDistance - 0.02 && free(p, m.r) && reach(m, p) <= maxDistance - 0.02) best = p;
      }
      if (best) break;
    }
    if (!best) {
      // Cannot reach contact: move straight towards the closest target as far as allowed.
      const t = byDistance[0];
      const d = dist(m, t);
      const step = Math.min(maxDistance - 0.02, Math.max(0, d - t.r - m.r - 0.05));
      for (const f of [1, 0.75, 0.5, 0.25, 0]) {
        const p = add(m, scale(sub(t, m), (step * f) / d));
        if (free(p, m.r) && (f === 0 || reach(m, p) <= maxDistance - 0.02)) {
          best = p;
          break;
        }
      }
    }
    const p = best ?? { x: m.x, y: m.y };
    placed.push({ ...p, r: m.r });
    out.set(m.id, p);
  }
  return out;
}

/** Whether any model of the unit is within engagement range of the given models at these positions. */
export const engagesAny = (positions: Map<string, Vec>, unit: UnitState, enemies: ModelState[]) =>
  aliveModels(unit).some((m) => {
    const p = positions.get(m.id) ?? m;
    return enemies.some((e) => edgeDistance({ ...p, r: m.r }, e) <= ENGAGEMENT_RANGE);
  });
