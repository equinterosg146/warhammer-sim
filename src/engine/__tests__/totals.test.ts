import { describe, expect, it } from 'vitest';

import { starterTyranidList, ultramarinesList } from '../../data/defaultLists';
import { resolveGroup } from '../attacks';
import { valuesFromCounts, type DiceRequest, type Roller } from '../dice';
import { formation } from '../placement';
import { newGame } from '../setup';
import { aliveModels } from '../state';
import { modelWeapons } from '../units';

describe('entering dice as totals', () => {
  it('turns totals into dice the rules read the same way', () => {
    const req: DiceRequest = { who: 'player', kind: 'hit', label: '', count: 24, need: '4+', critOn: 6 };
    const values = valuesFromCounts(req, { successes: 14, crits: 3, ones: 0 });
    expect(values).toHaveLength(24);
    expect(values.filter((v) => v >= 4)).toHaveLength(14);
    expect(values.filter((v) => v === 6)).toHaveLength(3);
  });

  it('keeps misses below an [ANTI] critical threshold', () => {
    const req: DiceRequest = { who: 'player', kind: 'wound', label: '', count: 10, need: '5+', critOn: 4 };
    const values = valuesFromCounts(req, { successes: 6, crits: 2, ones: 0 });
    expect(values.filter((v) => v >= 4)).toHaveLength(6);
    expect(values.filter((v) => v < 4)).toHaveLength(4);
  });

  it('reports 1s separately when they will be re-rolled', () => {
    const req: DiceRequest = { who: 'player', kind: 'hit', label: '', count: 10, need: '3+', rerollOnes: true };
    expect(valuesFromCounts(req, { successes: 6, crits: 1, ones: 2 }).filter((v) => v === 1)).toHaveLength(2);
  });

  it('drives a real attack: criticals set off Sustained Hits', async () => {
    const s = newGame({ playerList: starterTyranidList(), aiList: ultramarinesList(), difficulty: 'normal', firstPlayer: 'player', dice: { player: 'manual', ai: 'manual' } });
    const gaunts = s.units.find((u) => u.name.startsWith('Termagants 1'))!;
    const target = s.units.find((u) => u.name.startsWith('Heavy Intercessor'))!;
    for (const [u, c] of [[gaunts, { x: 20, y: 30 }], [target, { x: 20, y: 18 }]] as const) {
      const spots = formation(u, c);
      for (const m of aliveModels(u)) Object.assign(m, spots.get(m.id));
      u.status = 'onBoard';
    }
    const fleshborer = modelWeapons(gaunts, gaunts.models[0]).find((w) => w.ranged)!;
    const weapon = { ...fleshborer.weapon, keywords: [...fleshborer.weapon.keywords, 'sustained hits 1'] };
    const asked: DiceRequest[] = [];
    const roller: Roller = async (req) => {
      asked.push(req);
      if (req.kind === 'hit') return valuesFromCounts(req, { successes: 10, crits: 4, ones: 0 });
      if (req.kind === 'wound') return valuesFromCounts(req, { successes: 5, crits: 0, ones: 0 });
      if (req.kind === 'save') return valuesFromCounts(req, { successes: req.count - 2, crits: 0, ones: 0 });
      return Array(req.count).fill(1);
    };
    const r = await resolveGroup({ state: s, roll: roller, log: () => undefined }, { attacker: gaunts, models: aliveModels(gaunts), weapon, key: fleshborer.key, ranged: true, target });
    expect(r.attacks).toBe(20);
    expect(r.hits).toBe(14); // 10 hits plus 4 from Sustained Hits 1
    expect(asked.find((q) => q.kind === 'wound')!.count).toBe(14);
    expect(r.unsaved).toBe(2);
  });
});
