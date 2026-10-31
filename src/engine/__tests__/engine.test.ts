import { describe, expect, it } from 'vitest';

import { starterTyranidList, ultramarinesList } from '../../data/defaultLists';
import { resolveGroup, woundTarget, type AttackContext } from '../attacks';
import { scriptedRoller } from '../dice';
import { Game } from '../game';
import { rect, segmentCrossesPolygon } from '../geometry';
import { checkMove, coherencyProblems, pathLength } from '../movement';
import { formation } from '../placement';
import { newGame } from '../setup';
import { aliveModels, type GameState, type UnitState } from '../state';
import { modelWeapons } from '../units';
import { modelSight } from '../visibility';

function game(): GameState {
  return newGame({ playerList: starterTyranidList(), aiList: ultramarinesList(), difficulty: 'normal', firstPlayer: 'player', dice: { player: 'auto', ai: 'auto' } });
}

/** Puts a unit on the battlefield in a block centred on (x, y). */
function place(u: UnitState, x: number, y: number) {
  const spots = formation(u, { x, y });
  for (const m of aliveModels(u)) Object.assign(m, spots.get(m.id));
  u.status = 'onBoard';
}

const byName = (s: GameState, name: string) => s.units.find((u) => u.name.startsWith(name))!;

describe('geometry', () => {
  it('knows when a line passes through a terrain footprint', () => {
    const box = rect(10, 10, 4, 4);
    expect(segmentCrossesPolygon({ x: 0, y: 12 }, { x: 20, y: 12 }, box)).toBe(true);
    expect(segmentCrossesPolygon({ x: 0, y: 5 }, { x: 20, y: 5 }, box)).toBe(false);
  });

  it('wound rolls follow the Strength against Toughness table', () => {
    expect([woundTarget(8, 4), woundTarget(5, 4), woundTarget(4, 4), woundTarget(3, 4), woundTarget(2, 4)]).toEqual([2, 3, 4, 5, 6]);
  });
});

describe('visibility', () => {
  it('ruins between two models block sight, unless one of them is inside', () => {
    const s = game();
    const ruin = s.battlefield.terrain.find((t) => t.id === 'ruin-nw')!;
    const left = { x: 10, y: 14, r: 0.6 };
    const right = { x: 27, y: 14, r: 0.6 };
    expect(modelSight([ruin], left, right).visible).toBe(false);
    const inside = { x: 18.5, y: 14, r: 0.6 };
    expect(modelSight([{ ...ruin, walls: [] }], left, inside).visible).toBe(true);
  });
});

describe('movement', () => {
  it('measures the way around an enemy model', () => {
    const blocker = { x: 5, y: 5, r: 1 };
    const straight = pathLength({ x: 0, y: 5 }, { x: 10, y: 5 }, 0.5, { circles: [], walls: [] }, 60, 44);
    const around = pathLength({ x: 0.6, y: 5 }, { x: 10, y: 5 }, 0.5, { circles: [blocker], walls: [] }, 60, 44);
    expect(straight).toBeCloseTo(10, 5);
    expect(around).toBeGreaterThan(9.4);
    expect(around).toBeLessThan(10.5);
  });

  it('checks coherency', () => {
    expect(coherencyProblems([{ x: 0, y: 0, r: 0.5 }, { x: 2, y: 0, r: 0.5 }])).toEqual([]);
    expect(coherencyProblems([{ x: 0, y: 0, r: 0.5 }, { x: 5, y: 0, r: 0.5 }])).toHaveLength(1);
  });

  it('stops a normal move longer than the Move characteristic', () => {
    const s = game();
    const gaunts = byName(s, 'Termagants');
    place(gaunts, 20, 30);
    const far = new Map(aliveModels(gaunts).map((m) => [m.id, { x: m.x, y: m.y - 8 }]));
    const check = checkMove(s, gaunts, far, { kind: 'normal', maxDistance: () => 6, flying: false });
    expect(check.ok).toBe(false);
    const near = new Map(aliveModels(gaunts).map((m) => [m.id, { x: m.x, y: m.y - 5.9 }]));
    expect(checkMove(s, gaunts, near, { kind: 'normal', maxDistance: () => 6, flying: false }).ok).toBe(true);
  });
});

describe('attacks', () => {
  it('resolves hits, wounds, saves and damage in order', async () => {
    const s = game();
    const guard = byName(s, 'Hive Guard');
    const target = byName(s, 'Heavy Intercessor Squad');
    place(guard, 20, 30);
    place(target, 20, 20);
    const weapon = modelWeapons(guard, guard.models[0]).find((w) => w.ranged)!;
    // 3 models x 2 attacks: hits on 3+ (in the open, no modifiers).
    const roller = scriptedRoller([
      6, 5, 3, 2, 1, 4, // hit rolls: 4 hits
      6, 6, 6, 6, // wound rolls (S7 vs T6 -> 3+)
      1, 1, 6, 6, // saves: two failures
      3, 3, // damage would be rolled if random; shockcannon D is fixed so these stay unused
    ]);
    const ctx: AttackContext = { state: s, roll: roller, log: () => undefined };
    const result = await resolveGroup(ctx, { attacker: guard, models: aliveModels(guard), weapon: weapon.weapon, key: weapon.key, ranged: true, target });
    expect(result.attacks).toBe(6);
    expect(result.hits).toBe(4);
    expect(result.wounds).toBe(4);
    expect(result.unsaved).toBe(2);
    expect(result.damage).toBeGreaterThan(0);
  });

  it('runs a full turn of phases with CP and scoring', async () => {
    const s = game();
    s.units.filter((u) => u.owner === 'player').forEach((u, i) => place(u, 5 + (i % 7) * 8, 36 + Math.floor(i / 7) * 5));
    s.units.filter((u) => u.owner === 'ai').forEach((u, i) => place(u, 5 + (i % 7) * 8, 4 + Math.floor(i / 7) * 5));
    const g = new Game(s, { roll: scriptedRoller(Array(500).fill(4)), react: async () => undefined, changed: () => undefined });
    await g.startBattle();
    expect(s.phase).toBe('command');
    expect(s.cp.player).toBe(1);
    for (const phase of ['movement', 'shooting', 'charge', 'fight']) {
      if (g.fight) {
        g.finishStep('player');
        g.finishStep('ai');
        if (g.fight.step === 'fight') g.passFight(g.fight.picker);
        if (g.fight.step === 'consolidate') {
          g.finishStep('player');
          g.finishStep('ai');
        }
      }
      await g.endPhase();
      void phase;
    }
    while (g.battleShockDue().length > 0) await g.battleShockTest(g.battleShockDue()[0].id);
    if (g.fight) {
      g.finishStep('player');
      g.finishStep('ai');
      if (g.fight.step === 'fight') g.passFight(g.fight.picker);
      g.finishStep('player');
      g.finishStep('ai');
    }
    await g.endPhase();
    expect(s.active).toBe('ai');
    expect(s.phase).toBe('command');
    expect(s.cp.ai).toBe(2);
  });
});
