// Army lists and the game in progress, saved in this browser's storage.
import { starterTyranidList } from '../data/defaultLists';
import type { GameState } from '../engine/state';
import type { ArmyList } from '../rules/army';

const LISTS = 'wsim.lists';
const GAME = 'wsim.game';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the game still works, it just is not saved.
  }
}

export function loadLists(): ArmyList[] {
  const lists = read<ArmyList[]>(LISTS, []);
  return lists.length > 0 ? lists : [starterTyranidList()];
}

export const saveLists = (lists: ArmyList[]) => write(LISTS, lists);

export const loadGame = (): GameState | null => {
  const g = read<GameState | null>(GAME, null);
  return g && g.version === 1 ? g : null;
};

export const saveGame = (g: GameState | null) => {
  if (g === null) localStorage.removeItem(GAME);
  else write(GAME, g);
};

export const newListId = (lists: ArmyList[]) => Math.max(0, ...lists.map((l) => l.id)) + 1;
export const newUid = () => Math.random().toString(36).slice(2, 10);
