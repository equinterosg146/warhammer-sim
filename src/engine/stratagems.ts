// When each stratagem can be used, and which of its effects the engine can apply by itself.
import { BUNDLES } from '../data/bundles';
import type { Rich, Stratagem } from '../data/types';
import { richText } from '../rules/loadout';
import type { EngineMod, GameState, Phase, PlayerId } from './state';

export type Moment =
  /** Any time during the phase, by the player whose window it is (e.g. "Your Shooting phase"). */
  | 'during'
  | 'start'
  | 'end'
  /** Just after an enemy unit has selected its targets (or targets a friendly unit). */
  | 'targeted'
  /** Just after an enemy unit ends a move. */
  | 'enemyMoved'
  /** Just after an enemy unit has resolved its attacks in the Fight phase. */
  | 'enemyFought'
  /** Just after one of your own rolls (Command Re-roll). */
  | 'afterRoll'
  | 'beforeBattleshock'
  | 'afterChargeMove'
  | 'unitDestroyed'
  | 'enemyDestroyed'
  | 'other';

export interface Timing {
  phases: Phase[] | 'any';
  turn: 'yours' | 'opponents' | 'either';
  moment: Moment;
  when: string;
}

export const stratagemText = (s: Stratagem) => richText(s.text as Rich);

export function sectionOf(text: string, name: 'WHEN' | 'TARGET' | 'EFFECT' | 'RESTRICTIONS'): string {
  const order = ['WHEN', 'TARGET', 'EFFECT', 'RESTRICTIONS'];
  const start = text.search(new RegExp(`${name}:`, 'i'));
  if (start < 0) return '';
  const rest = text.slice(start + name.length + 1);
  const next = order
    .filter((n) => n !== name)
    .map((n) => rest.search(new RegExp(`\\b${n}:`, 'i')))
    .filter((i) => i >= 0);
  return (next.length > 0 ? rest.slice(0, Math.min(...next)) : rest).trim();
}

const PHASE_WORDS: [RegExp, Phase][] = [
  [/command phase/i, 'command'],
  [/movement phase/i, 'movement'],
  [/shooting phase/i, 'shooting'],
  [/charge phase/i, 'charge'],
  [/fight (phase|step)/i, 'fight'],
];

export function timingOf(s: Stratagem): Timing {
  const text = stratagemText(s);
  const when = sectionOf(text, 'WHEN') || s.phase;
  const phases = /any phase/i.test(when) ? 'any' : PHASE_WORDS.filter(([re]) => re.test(when)).map(([, p]) => p);
  // "Your opponent's Shooting phase or the Fight phase" includes the Fight phase of either turn
  // (enemy units fight back in yours), so it counts as either turn.
  let turn: Timing['turn'] = 'either';
  if (!/ or the fight phase/i.test(when)) {
    if (/^\s*(start of |end of |battle-shock step of |fight step of )?your opponent[’']s/i.test(when)) turn = 'opponents';
    else if (/^\s*(start of |end of |battle-shock step of )?your /i.test(when)) turn = 'yours';
  }
  let moment: Moment = 'during';
  if (/just after you make one of the following rolls/i.test(when)) moment = 'afterRoll';
  else if (/selected its targets|targets a friendly|an enemy unit targets/i.test(when)) moment = 'targeted';
  else if (/just after an enemy unit ends a|enemy unit ends a move/i.test(when)) moment = 'enemyMoved';
  else if (/enemy unit has resolved its attacks/i.test(when)) moment = 'enemyFought';
  else if (/just before you make a battle-shock roll/i.test(when)) moment = 'beforeBattleshock';
  else if (/ends a charge move/i.test(when)) moment = 'afterChargeMove';
  else if (/from your army is destroyed|is destroyed, before/i.test(when)) moment = 'unitDestroyed';
  else if (/destroys an enemy unit|enemy warlord is destroyed/i.test(when)) moment = 'enemyDestroyed';
  else if (/^\s*start of/i.test(when)) moment = 'start';
  else if (/^\s*end of/i.test(when)) moment = 'end';
  else if (/hatchway|reinforcements step|fails a battle-shock|surge move|suffers a mortal|deadly demise/i.test(when)) moment = 'other';
  if (phases !== 'any' && phases.length === 0) return { phases: 'any', turn, moment: moment === 'during' ? 'other' : moment, when };
  return { phases, turn, moment, when };
}

/** Stratagems an army can use: core stratagems plus those of its detachments. */
export function armyStratagems(state: GameState, player: PlayerId): Stratagem[] {
  const army = state.armies[player];
  const bundle = BUNDLES[army.faction];
  return bundle.stratagems.filter(
    (s) => s.category === 'core' || (s.category === 'detachment' && s.detachmentId !== null && army.detachmentIds.includes(s.detachmentId)),
  );
}

/** 15.01: a player cannot use the same stratagem twice in one phase, or target one unit with two in one phase. */
export function usedThisPhase(state: GameState, player: PlayerId, stratagemId: string): boolean {
  return state.stratagemUses.some((u) => u.player === player && u.stratagemId === stratagemId && u.turn === state.turn && u.phase === state.phase);
}

export function unitTargetedThisPhase(state: GameState, player: PlayerId, unitId: string): boolean {
  return state.stratagemUses.some((u) => u.player === player && u.unitId === unitId && u.turn === state.turn && u.phase === state.phase);
}

/** Whether a stratagem's timing fits this moment for this player. */
export function fitsMoment(state: GameState, player: PlayerId, s: Stratagem, moment: Moment): boolean {
  const t = timingOf(s);
  if (t.moment !== moment) return false;
  const yours = state.active === player;
  if (t.turn === 'yours' && !yours) return false;
  if (t.turn === 'opponents' && yours) return false;
  if (t.phases !== 'any' && !t.phases.includes(state.phase)) return false;
  return true;
}

export interface ParsedEffect {
  mods: EngineMod[];
  until: 'phase' | 'turn' | 'nextCommand';
  /** True when the engine applies every part of the effect itself. */
  complete: boolean;
}

/** Reads the EFFECT section for modifiers the engine understands. Anything else is done by hand. */
export function parseEffect(s: Stratagem): ParsedEffect {
  const effect = sectionOf(stratagemText(s), 'EFFECT');
  const e = effect.toLowerCase();
  const mods: EngineMod[] = [];
  const defensive = /attacks? (that )?targets? your unit|each time an attack targets|attacks that target your unit/.test(e);
  const scope = /ranged attack|ranged weapon/.test(e) && !/melee/.test(e) ? 'ranged' : /melee attack|melee weapon/.test(e) && !/ranged/.test(e) ? 'melee' : undefined;
  const w = scope ? { weapons: scope as 'ranged' | 'melee' } : {};
  let understood = 0;
  const has = (re: RegExp) => re.test(e);
  if (has(/add 1 to the hit roll|\+1 to hit/)) (mods.push(defensive ? { kind: 'enemyHit', delta: 1, ...w } : { kind: 'hit', delta: 1, ...w }), understood++);
  if (has(/subtract 1 from the hit roll|-1 to hit/)) (mods.push(defensive ? { kind: 'enemyHit', delta: -1, ...w } : { kind: 'hit', delta: -1, ...w }), understood++);
  if (has(/add 1 to the wound roll|\+1 to wound/)) (mods.push(defensive ? { kind: 'enemyWound', delta: 1, ...w } : { kind: 'wound', delta: 1, ...w }), understood++);
  if (has(/subtract 1 from the wound roll|-1 to wound/)) (mods.push(defensive ? { kind: 'enemyWound', delta: -1, ...w } : { kind: 'wound', delta: -1, ...w }), understood++);
  if (has(/re-roll (a|the) hit roll of 1/)) (mods.push({ kind: 'rerollHits', which: 'ones', ...w }), understood++);
  else if (has(/re-roll the hit roll/)) (mods.push({ kind: 'rerollHits', which: 'fails', ...w }), understood++);
  if (has(/re-roll (a|the) wound roll of 1/)) (mods.push({ kind: 'rerollWounds', which: 'ones', ...w }), understood++);
  else if (has(/re-roll the wound roll/)) (mods.push({ kind: 'rerollWounds', which: 'fails', ...w }), understood++);
  for (const kw of ['lethal hits', 'devastating wounds', 'precision', 'ignores cover', 'assault', 'lance', 'twin-linked', 'heavy']) {
    if (e.includes(`[${kw}]`) || new RegExp(`have \\[?${kw}\\]?`).test(e)) (mods.push({ kind: 'weaponKeyword', keyword: kw, ...w }), understood++);
  }
  const sustained = /\[sustained hits (\d)\]/.exec(e);
  if (sustained) (mods.push({ kind: 'weaponKeyword', keyword: `sustained hits ${sustained[1]}`, ...w }), understood++);
  const fnp = /feel no pain (\d)\+/.exec(e);
  if (fnp) (mods.push({ kind: 'fnp', value: Number(fnp[1]) }), understood++);
  const inv = /invulnerable save of (\d)\+|(\d)\+ invulnerable save/.exec(e);
  if (inv) (mods.push({ kind: 'invuln', value: Number(inv[1] ?? inv[2]) }), understood++);
  if (has(/subtract 1 from the damage characteristic/)) (mods.push({ kind: 'damageReduction', amount: 1 }), understood++);
  if (has(/improve the armour penetration characteristic[^.]*by 1/)) (mods.push({ kind: 'weaponStat', stat: 'AP', delta: -1, ...w }), understood++);
  if (has(/have -1 ap|worsen the armour penetration characteristic of that attack by 1/)) (mods.push({ kind: 'save', delta: 1 }), understood++);
  if (has(/add 1 to the strength characteristic/)) (mods.push({ kind: 'weaponStat', stat: 'S', delta: 1, ...w }), understood++);
  if (has(/add 1 to the attacks characteristic/)) (mods.push({ kind: 'weaponStat', stat: 'A', delta: 1, ...w }), understood++);
  if (has(/add 1 to the damage characteristic/)) (mods.push({ kind: 'weaponStat', stat: 'D', delta: 1, ...w }), understood++);
  const crit = /critical hit on (?:an unmodified hit roll of )?(\d)\+/.exec(e);
  if (crit) (mods.push({ kind: 'critHit', on: Number(crit[1]), ...w }), understood++);
  if (has(/fights first/)) (mods.push({ kind: 'fightsFirst' }), understood++);
  if (has(/benefit of cover/)) (mods.push({ kind: 'cover' }), understood++);
  if (has(/\bstealth\b/)) (mods.push({ kind: 'stealth' }), understood++);
  const until = /until the (start|end) of (your|the) next command phase|until the start of your next/.test(e) ? 'nextCommand' : /until the end of the turn/.test(e) ? 'turn' : 'phase';
  // Rough measure of whether anything else is in the text: sentences beyond what was understood.
  const sentences = effect.split(/[.•]/).map((x) => x.trim()).filter((x) => x.length > 12).length;
  return { mods, until, complete: understood > 0 && sentences <= understood };
}
