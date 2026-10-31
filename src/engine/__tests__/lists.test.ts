import { describe, expect, it } from 'vitest';

import { spaceMarines, tyranids } from '../../data/bundles';
import { starterTyranidList, ultramarinesList } from '../../data/defaultLists';
import { listPoints, validateList } from '../../rules/army';
import { createUnits } from '../units';

describe('default lists', () => {
  it('the Ultramarines list is exactly 2000 points and valid', () => {
    const list = ultramarinesList();
    expect(listPoints(spaceMarines, list)).toBe(2000);
    expect(validateList(spaceMarines, list).map((w) => w.message)).toEqual([]);
  });

  it('turns leaders and bodyguards into single units', () => {
    const units = createUnits(ultramarinesList(), 'spaceMarines', 'ai');
    const calgar = units.find((u) => u.name.includes('Marneus Calgar'))!;
    expect(calgar.members.map((m) => m.role)).toEqual(['bodyguard', 'leader']);
    expect(calgar.models).toHaveLength(11);
    expect(units).toHaveLength(13);
  });

  it('the Tyranid starter list fits 2000 points', () => {
    const list = starterTyranidList();
    const points = listPoints(tyranids, list);
    expect(points).toBeLessThanOrEqual(2000);
    expect(validateList(tyranids, list).filter((w) => /over|leader|cannot/i.test(w.message))).toEqual([]);
  });

  it('gives every model its base size and weapons', () => {
    const units = createUnits(starterTyranidList(), 'tyranids', 'player');
    const gaunts = units.find((u) => u.name.startsWith('Termagants'))!;
    const base = tyranids.datasheetById.get(gaunts.members[0].datasheetId)!.models[0].baseSize;
    expect(gaunts.models[0].r).toBeCloseTo(Number.parseFloat(base) / 25.4 / 2, 3);
    expect(gaunts.models.every((m) => (m.weapons['fleshborer'] ?? 0) === 1)).toBe(true);
  });
});
