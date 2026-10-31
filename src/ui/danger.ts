// "Who can shoot here?" map for deployment practice: for each 2" square, how many enemy units could
// see a model standing there and have a ranged weapon that reaches it. Uses one centre-to-centre
// line per unit, so it is a quick guide rather than an exact check.
import { parseRange } from '../engine/game';
import { circleTouchesPolygon, dist, pointInPolygon, segmentCrossesPolygon, segmentsIntersect, type Vec } from '../engine/geometry';
import { aliveModels, onBoard, type GameState, type PlayerId } from '../engine/state';
import { modelWeapons } from '../engine/units';

export function dangerMap(state: GameState, enemy: PlayerId): number[][] {
  const bf = state.battlefield;
  const shooters = state.units
    .filter((u) => u.owner === enemy && onBoard(u))
    .map((u) => {
      const models = aliveModels(u);
      const range = Math.max(0, ...models.flatMap((m) => modelWeapons(u, m).filter((w) => w.ranged).map((w) => parseRange(w.weapon.range))));
      // A few models spread across the unit stand in for all of them.
      const picks = models.length <= 3 ? models : [models[0], models[Math.floor(models.length / 2)], models[models.length - 1]];
      return { range, picks };
    })
    .filter((s) => s.range > 0);
  const rows = Math.ceil(bf.height / 2);
  const cols = Math.ceil(bf.width / 2);
  const out: number[][] = [];
  for (let yi = 0; yi < rows; yi++) {
    const row: number[] = [];
    for (let xi = 0; xi < cols; xi++) {
      const p: Vec = { x: xi * 2 + 1, y: yi * 2 + 1 };
      const here = { ...p, r: 0.6 };
      const inside = new Set(bf.terrain.filter((t) => circleTouchesPolygon(here, t.polygon)).map((t) => t.id));
      let n = 0;
      for (const s of shooters) {
        const sees = s.picks.some((m) => {
          if (dist(m, p) - m.r - 0.6 > s.range) return false;
          return !bf.terrain.some((t) => {
            if (t.walls.some((w) => segmentsIntersect(m, p, w.a, w.b))) return true;
            if (inside.has(t.id) || pointInPolygon(m, t.polygon)) return false;
            return segmentCrossesPolygon(m, p, t.polygon);
          });
        });
        if (sees) n++;
      }
      row.push(n);
    }
    out.push(row);
  }
  return out;
}
