// The battlefield: size, terrain areas (13.01), deployment zones and terrain objectives (14.01).
import { rect, type Polygon, type Segment, type Vec } from './geometry';

export const BOARD_WIDTH = 60;
export const BOARD_HEIGHT = 44;

/** 13.02: exposed terrain does nothing here; light and dense areas are obscuring (13.10). */
export type TerrainCategory = 'light' | 'dense';

export interface TerrainArea {
  id: string;
  name: string;
  category: TerrainCategory;
  polygon: Polygon;
  /** Ruin walls inside a dense area: block movement for models that cannot move through dense terrain. */
  walls: Segment[];
  /** Set when this area is a terrain objective. */
  objective?: number;
}

export type PlayerId = 'player' | 'ai';

export interface Battlefield {
  width: number;
  height: number;
  terrain: TerrainArea[];
  deployment: Record<PlayerId, Polygon>;
  /** Number of terrain objectives (their areas carry the `objective` index). */
  objectives: number;
}

/** An L-shaped ruin: a rectangular area with two walls along adjoining sides, leaving gaps to walk in. */
function ruin(id: string, name: string, x: number, y: number, w: number, h: number, corner: 'tl' | 'tr' | 'bl' | 'br', objective?: number): TerrainArea {
  const left = x + 0.3;
  const right = x + w - 0.3;
  const top = y + 0.3;
  const bottom = y + h - 0.3;
  const horizontalY = corner[0] === 't' ? top : bottom;
  const verticalX = corner[1] === 'l' ? left : right;
  const hLen = w * 0.65;
  const vLen = h * 0.65;
  const hStart = corner[1] === 'l' ? left : right - hLen;
  const vStart = corner[0] === 't' ? top : bottom - vLen;
  const walls: Segment[] = [
    { a: { x: hStart, y: horizontalY }, b: { x: hStart + hLen, y: horizontalY } },
    { a: { x: verticalX, y: vStart }, b: { x: verticalX, y: vStart + vLen } },
  ];
  return { id, name, category: 'dense', polygon: rect(x, y, w, h), walls, objective };
}

function light(id: string, name: string, x: number, y: number, w: number, h: number, objective?: number): TerrainArea {
  return { id, name, category: 'light', polygon: rect(x, y, w, h), walls: [], objective };
}

/**
 * The practice battlefield: 60" × 44", the AI deploys along the top long edge and the player along the
 * bottom, 12" deep. Five terrain objectives: one in each deployment zone, one on each flank and one in
 * the centre, with ruins between them to block sight lines.
 */
export function practiceBattlefield(): Battlefield {
  const terrain: TerrainArea[] = [
    ruin('obj-centre', 'Centre ruin (objective)', 26, 19, 8, 6, 'tl', 0),
    light('obj-west', 'West crater field (objective)', 6, 19.5, 7, 5, 1),
    light('obj-east', 'East crater field (objective)', 47, 19.5, 7, 5, 2),
    light('obj-ai-home', 'Barricades (Ultramarines home objective)', 26.5, 3, 7, 4.5, 3),
    light('obj-player-home', 'Barricades (Tyranid home objective)', 26.5, 36.5, 7, 4.5, 4),
    ruin('ruin-nw', 'North-west ruin', 15, 11, 7, 6, 'tr'),
    ruin('ruin-ne', 'North-east ruin', 38, 11, 7, 6, 'tl'),
    ruin('ruin-sw', 'South-west ruin', 15, 27, 7, 6, 'br'),
    ruin('ruin-se', 'South-east ruin', 38, 27, 7, 6, 'bl'),
    ruin('ruin-w-deep', 'West deployment ruin', 3, 4, 6, 5, 'tl'),
    ruin('ruin-e-deep', 'East deployment ruin', 51, 35, 6, 5, 'br'),
    light('woods-ai', 'Low walls', 46, 6, 5, 3),
    light('woods-player', 'Low walls', 9, 35, 5, 3),
  ];
  return {
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
    terrain,
    deployment: {
      ai: rect(0, 0, BOARD_WIDTH, 12),
      player: rect(0, BOARD_HEIGHT - 12, BOARD_WIDTH, 12),
    },
    objectives: 5,
  };
}

export const objectiveAreas = (bf: Battlefield) =>
  bf.terrain.filter((t) => t.objective !== undefined).sort((a, b) => (a.objective ?? 0) - (b.objective ?? 0));

export const centreOf = (poly: Polygon): Vec => ({
  x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
  y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
});
