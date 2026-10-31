import { describe, expect, it } from 'vitest';

import { Opponent } from '../../ai/ai';
import { starterTyranidList, ultramarinesList } from '../../data/defaultLists';
import { autoRoller } from '../dice';
import { Game } from '../game';
import { formation } from '../placement';
import { newGame } from '../setup';
import type { Difficulty } from '../state';

/** A seeded random number generator so failures can be reproduced. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function playGame(difficulty: Difficulty, seed: number) {
  const rng = mulberry32(seed);
  const state = newGame({ playerList: starterTyranidList(), aiList: ultramarinesList(), difficulty, firstPlayer: seed % 2 === 0 ? 'player' : 'ai', dice: { player: 'auto', ai: 'auto' } });
  const ai = new Opponent(0, rng);
  const game: Game = new Game(state, { roll: autoRoller(rng), react: async (w) => (w.player === 'ai' ? ai.react(game, w) : undefined), changed: () => undefined });
  let steps = 0;
  while (state.phase !== 'gameOver' && steps++ < 4000) {
    if (await ai.act(game)) continue;
    // The player's side: deploy in a row, take battle-shock tests, never move or shoot.
    if (state.phase === 'deployment') {
      const u = game.undeployed('player')[0];
      if (u) {
        let placed = false;
        for (let x = 5; x < 56 && !placed; x += 4) {
          for (let y = 35; y < 42 && !placed; y += 2) {
            const p = formation(u, { x, y });
            if (game.deploymentCheck(u.id, p).ok) {
              game.deploy(u.id, p);
              placed = true;
            }
          }
        }
        if (!placed) game.putInReserves(u.id);
        continue;
      }
      if (game.deploymentFinished()) await game.startBattle();
      continue;
    }
    if (state.active === 'player' || (state.phase === 'fight' && game.fight)) {
      const due = game.battleShockDue('player');
      if (state.active === 'player' && due.length > 0) {
        await game.battleShockTest(due[0].id);
        continue;
      }
      if (game.fight && game.stepPlayer() === 'player') {
        game.finishStep('player');
        continue;
      }
      if (game.fight && game.fight.step === 'fight' && game.fight.picker === 'player' && !game.fightStepOver()) {
        const u = game.pickableUnits()[0];
        const t = u ? game.meleeTargets(u)[0] : undefined;
        if (u && t) await game.fightWith(u.id, { targetId: t.id });
        else game.passFight('player');
        continue;
      }
      if (state.active === 'player') {
        if (game.charge) game.failCharge();
        const ok = await game.endPhase();
        if (!ok) throw new Error(`Player could not end ${state.phase}: ${game.phaseBlockers().join(' ')}`);
        continue;
      }
    }
    throw new Error(`Nobody can act in ${state.phase} (active ${state.active}, fight ${JSON.stringify(game.fight)})`);
  }
  return { state, steps };
}

describe('a whole game', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as Difficulty[]) {
    it(`finishes against a passive player on ${difficulty}`, async () => {
      const { state, steps } = await playGame(difficulty, difficulty === 'easy' ? 1 : difficulty === 'normal' ? 2 : 3);
      expect(steps).toBeLessThan(4000);
      expect(state.phase).toBe('gameOver');
      // The computer should have scored and killed things against a player who does nothing.
      expect(state.vp.ai).toBeGreaterThan(state.vp.player);
    }, 120000);
  }
});
