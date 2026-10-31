// Creating a new game from two army lists.
import { spaceMarines, tyranids } from '../data/bundles';
import type { ArmyList } from '../rules/army';
import { listPoints } from '../rules/army';
import { practiceBattlefield } from './battlefield';
import type { DiceMode, Difficulty, GameState, PlayerId } from './state';
import { createUnits } from './units';

export interface NewGameOptions {
  playerList: ArmyList;
  aiList: ArmyList;
  difficulty: Difficulty;
  firstPlayer: PlayerId;
  dice: Record<PlayerId, DiceMode>;
}

export function newGame(o: NewGameOptions): GameState {
  const units = [...createUnits(o.playerList, 'tyranids', 'player'), ...createUnits(o.aiList, 'spaceMarines', 'ai')];
  return {
    version: 1,
    battlefield: practiceBattlefield(),
    round: 0,
    turn: -1,
    firstPlayer: o.firstPlayer,
    active: o.firstPlayer,
    phase: 'deployment',
    // The player going second deploys first.
    deployer: o.firstPlayer === 'player' ? 'ai' : 'player',
    cp: { player: 0, ai: 0 },
    vp: { player: 0, ai: 0 },
    vpLog: [],
    units,
    armies: {
      player: { faction: 'tyranids', name: o.playerList.name, detachmentIds: o.playerList.detachmentIds, points: listPoints(tyranids, o.playerList), list: o.playerList, switches: {} },
      ai: { faction: 'spaceMarines', name: o.aiList.name, detachmentIds: o.aiList.detachmentIds, points: listPoints(spaceMarines, o.aiList), list: o.aiList, switches: {} },
    },
    objectives: [null, null, null, null, null],
    effects: [],
    stratagemUses: [],
    usedOnce: [],
    checklist: [],
    log: [{ turn: -1, phase: 'deployment', player: null, text: 'Deployment: set up your units in your deployment zone (the bottom 12"). Players take turns placing one unit at a time.', kind: 'coach' }],
    settings: { difficulty: o.difficulty, dice: o.dice },
    winner: null,
  };
}
