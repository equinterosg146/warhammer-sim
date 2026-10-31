import { describe, expect, it } from 'vitest';

import { starterTyranidList, ultramarinesList } from '../../data/defaultLists';
import { autoRoller } from '../dice';
import { Game } from '../game';
import { newGame } from '../setup';
import { armyStratagems, parseEffect, timingOf } from '../stratagems';

describe('stratagems', () => {
  const s = newGame({ playerList: starterTyranidList(), aiList: ultramarinesList(), difficulty: 'normal', firstPlayer: 'player', dice: { player: 'auto', ai: 'auto' } });
  s.units.forEach((u) => (u.status = 'onBoard'));
  const g = new Game(s, { roll: autoRoller(), react: async () => undefined, changed: () => undefined });
  const find = (name: string) => armyStratagems(s, 'player').find((x) => x.name === name)!;

  it('only offers keyword-restricted stratagems to units with that keyword', () => {
    expect(g.stratagemTargets('player', find('EXPLOSIVES'))).toEqual([]);
    expect(g.stratagemTargets('player', find('CRUSHING IMPACT')).map((u) => u.name)).toEqual(['Hive Tyrant', 'Zoanthropes + Neurotyrant', 'Carnifexes', 'Maleceptor', 'Exocrine']);
  });

  it('reads stratagem timing', () => {
    expect(timingOf(find('FIRE OVERWATCH'))).toMatchObject({ turn: 'opponents', moment: 'end' });
    expect(timingOf(find('COMMAND RE-ROLL')).moment).toBe('afterRoll');
    expect(timingOf(find('HEROIC INTERVENTION'))).toMatchObject({ turn: 'opponents', moment: 'end' });
    expect(parseEffect(find('COUNTEROFFENSIVE')).mods.some((m) => m.kind === 'fightsFirst')).toBe(true);
  });
});

describe('stratagem targets', () => {
  const s = newGame({ playerList: starterTyranidList(), aiList: ultramarinesList(), difficulty: 'normal', firstPlayer: 'player', dice: { player: 'auto', ai: 'auto' } });
  s.units.forEach((u) => (u.status = 'onBoard'));
  s.units.forEach((u, i) => u.models.forEach((m, j) => ((m.x = 3 + (i % 8) * 7 + (j % 5) * 1.3), (m.y = (u.owner === 'player' ? 36 : 4) + Math.floor(i / 8) * 4 + Math.floor(j / 5) * 1.3))));
  const g = new Game(s, { roll: autoRoller(), react: async () => undefined, changed: () => undefined });
  const find = (name: string) => armyStratagems(s, 'player').find((x) => x.name === name)!;

  it('Fire Overwatch can target ordinary units; exclusions are not requirements', () => {
    expect(g.stratagemTargets('player', find('FIRE OVERWATCH')).length).toBeGreaterThan(5);
  });

  it('Rapid Ingress only targets units in strategic reserves', () => {
    expect(g.stratagemTargets('player', find('RAPID INGRESS'))).toEqual([]);
    s.units[0].status = 'reserves';
    expect(g.stratagemTargets('player', find('RAPID INGRESS')).map((u) => u.id)).toEqual([s.units[0].id]);
  });
});
