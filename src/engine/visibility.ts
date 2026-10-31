// Visibility (06.01) with the terrain rules: obscuring areas (13.10), solid walls (13.11),
// hidden models (13.09) and the benefit of cover (13.08). Other models never block sight here.
import type { TerrainArea } from './battlefield';
import { circleTouchesPolygon, edgeDistance, samplePoints, segmentCrossesPolygon, segmentsIntersect, type Circle, type Vec } from './geometry';
import { aliveModels, type GameState, type ModelState, type UnitState } from './state';
import { hasCoreAbility, coreParameter, unitHasKeyword, usesTerrainCover } from './units';

export const HIDDEN_DETECTION_RANGE = 15;

/** Terrain areas a base is within (any part of the base inside the footprint). */
export const areasContaining = (terrain: TerrainArea[], c: Circle) => terrain.filter((t) => circleTouchesPolygon(c, t.polygon));

export const inTerrainArea = (terrain: TerrainArea[], c: Circle) => areasContaining(terrain, c).length > 0;

/** Whether one straight line between two points is blocked by terrain, given the areas to ignore. */
function lineBlocked(a: Vec, b: Vec, terrain: TerrainArea[], ignore: Set<string>): boolean {
  for (const t of terrain) {
    for (const w of t.walls) if (segmentsIntersect(a, b, w.a, w.b)) return true;
    if (!ignore.has(t.id) && segmentCrossesPolygon(a, b, t.polygon)) return true;
  }
  return false;
}

export interface Sight {
  visible: boolean;
  /** Every part of the target base can be seen (no intervening terrain). */
  fully: boolean;
  /** A clear line, for drawing. */
  line: [Vec, Vec] | null;
}

/** Line of sight between two bases, ignoring hidden rules. */
export function modelSight(terrain: TerrainArea[], from: Circle, to: Circle): Sight {
  const ignore = new Set([...areasContaining(terrain, from), ...areasContaining(terrain, to)].map((t) => t.id));
  const fromPts = samplePoints(from);
  const toPts = samplePoints(to);
  let line: [Vec, Vec] | null = null;
  let clearTargets = 0;
  for (const tp of toPts) {
    let seen = false;
    for (const fp of fromPts) {
      if (!lineBlocked(fp, tp, terrain, ignore)) {
        seen = true;
        if (!line) line = [fp, tp];
        break;
      }
    }
    if (seen) clearTargets++;
  }
  return { visible: line !== null, fully: clearTargets === toPts.length, line };
}

/** 13.09: INFANTRY/BEASTS/SWARM in an area with dense terrain whose unit has not shot this turn or last. */
export function isHidden(state: GameState, unit: UnitState, m: ModelState): boolean {
  if (!usesTerrainCover(unit, m)) return false;
  if (unit.lastShotTurn >= state.turn - 1) return false;
  return areasContaining(state.battlefield.terrain, m).some((t) => t.category === 'dense');
}

/** Lone Operative (24.24): not visible beyond 12" (or X") unless part of an attached unit. */
function loneOperativeRange(unit: UnitState): number | null {
  if (unit.members.length > 1 || !hasCoreAbility(unit, 'Lone Operative')) return null;
  const x = Number(/\d+/.exec(coreParameter(unit, 'Lone Operative'))?.[0]);
  return Number.isFinite(x) ? x : 12;
}

/** Whether an observing model can see a target model, with hidden and Lone Operative rules. */
export function canSeeModel(state: GameState, observer: ModelState, targetUnit: UnitState, target: ModelState): Sight {
  const range = edgeDistance(observer, target);
  if (isHidden(state, targetUnit, target) && range > HIDDEN_DETECTION_RANGE) return { visible: false, fully: false, line: null };
  const lone = loneOperativeRange(targetUnit);
  if (lone !== null && range > lone) return { visible: false, fully: false, line: null };
  return modelSight(state.battlefield.terrain, observer, target);
}

export interface UnitSight {
  visible: boolean;
  /** Models of the target that the observer can see. */
  visibleModels: ModelState[];
  fully: boolean;
  line: [Vec, Vec] | null;
}

/** A unit is visible if one of its models is (06.01); fully visible if all of them are fully visible. */
export function canSeeUnit(state: GameState, observer: ModelState, targetUnit: UnitState): UnitSight {
  const visibleModels: ModelState[] = [];
  let fully = true;
  let line: [Vec, Vec] | null = null;
  for (const t of aliveModels(targetUnit)) {
    const s = canSeeModel(state, observer, targetUnit, t);
    if (s.visible) {
      visibleModels.push(t);
      if (!line) line = s.line;
    }
    if (!s.fully) fully = false;
  }
  return { visible: visibleModels.length > 0, visibleModels, fully, line };
}

/**
 * 13.08: the target has the benefit of cover against a ranged attack if every model in it is either
 * INFANTRY/BEASTS/SWARM within a terrain area, or not fully visible to the attacker because of terrain.
 * Stealth (24.33) also gives cover.
 */
export function hasCover(state: GameState, attacker: ModelState, targetUnit: UnitState): boolean {
  if (hasCoreAbility(targetUnit, 'Stealth')) return true;
  const terrain = state.battlefield.terrain;
  return aliveModels(targetUnit).every((t) => {
    if (usesTerrainCover(targetUnit, t) && inTerrainArea(terrain, t)) return true;
    return !canSeeModel(state, attacker, targetUnit, t).fully;
  });
}

/** Closest edge-to-edge distance between two units. */
export function unitDistance(a: UnitState, b: UnitState): number {
  let best = Infinity;
  for (const m of aliveModels(a)) for (const n of aliveModels(b)) best = Math.min(best, edgeDistance(m, n));
  return best;
}

export const modelUnitDistance = (m: Circle, u: UnitState) => Math.min(...aliveModels(u).map((n) => edgeDistance(m, n)));

export { unitHasKeyword };
