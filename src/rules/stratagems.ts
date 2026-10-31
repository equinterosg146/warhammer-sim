import type { Stratagem, StratagemCategory } from '../data/types';

export const PHASE_ORDER = ['Command', 'Movement', 'Shooting', 'Charge', 'Fight', 'Any'] as const;
export type Phase = (typeof PHASE_ORDER)[number];

export type TurnFilter = 'all' | 'yours' | 'opponents';

/** "Shooting or Fight phase" -> [Shooting, Fight]; core action cards map by what they do. */
export function phasesOf(stratagem: Stratagem): Phase[] {
  const text = stratagem.phase;
  if (/any phase/i.test(text)) return ['Any'];
  if (/"Move"/i.test(text)) return ['Movement'];
  if (/"Shoot"/i.test(text)) return ['Shooting'];
  if (/"Fight"/i.test(text)) return ['Fight'];
  const found = PHASE_ORDER.filter((p) => p !== 'Any' && new RegExp(`\\b${p}\\b`, 'i').test(text));
  return found.length > 0 ? found : ['Any'];
}

export function matchesTurn(stratagem: Stratagem, turn: TurnFilter): boolean {
  if (turn === 'all' || stratagem.turn === '' || /either/i.test(stratagem.turn)) return true;
  return turn === 'yours' ? /^your/i.test(stratagem.turn) : /^opponent/i.test(stratagem.turn);
}

export interface StratagemFilter {
  categories: StratagemCategory[];
  /** Detachment stratagems are shown only for these detachments. */
  detachmentIds: string[];
  turn: TurnFilter;
}

export function filterStratagems(all: Stratagem[], filter: StratagemFilter): Stratagem[] {
  return all.filter((s) => {
    if (!matchesTurn(s, filter.turn)) return false;
    if (s.category === 'detachment') return s.detachmentId !== null && filter.detachmentIds.includes(s.detachmentId);
    return filter.categories.includes(s.category);
  });
}

export function groupByPhase(stratagems: Stratagem[]): { phase: Phase; items: Stratagem[] }[] {
  return PHASE_ORDER.map((phase) => ({
    phase,
    items: stratagems.filter((s) => phasesOf(s).includes(phase)),
  })).filter((group) => group.items.length > 0);
}
