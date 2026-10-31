import { useState } from 'react';

import type { GameState } from '../engine/state';
import type { ArmyList } from '../rules/army';
import { ArmyBuilder } from './ArmyBuilder';
import { Battle } from './Battle';
import { Home } from './Home';
import { Setup } from './Setup';
import { loadGame, loadLists, saveGame, saveLists } from './store';

type Screen = { name: 'home' } | { name: 'builder'; listId: number } | { name: 'setup' } | { name: 'battle' };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [lists, setLists] = useState<ArmyList[]>(() => loadLists());
  const [game, setGame] = useState<GameState | null>(() => loadGame());

  const updateLists = (next: ArmyList[]) => {
    setLists(next);
    saveLists(next);
  };

  switch (screen.name) {
    case 'home':
      return (
        <Home
          lists={lists}
          savedGame={game}
          onNewGame={() => setScreen({ name: 'setup' })}
          onContinue={() => setScreen({ name: 'battle' })}
          onEditList={(id) => setScreen({ name: 'builder', listId: id })}
          onListsChange={updateLists}
        />
      );
    case 'builder': {
      const list = lists.find((l) => l.id === screen.listId);
      if (!list) return null;
      return (
        <ArmyBuilder
          list={list}
          onChange={(l) => updateLists(lists.map((x) => (x.id === l.id ? l : x)))}
          onDone={() => setScreen({ name: 'home' })}
        />
      );
    }
    case 'setup':
      return (
        <Setup
          lists={lists}
          onBack={() => setScreen({ name: 'home' })}
          onStart={(g) => {
            setGame(g);
            saveGame(g);
            setScreen({ name: 'battle' });
          }}
        />
      );
    case 'battle':
      if (!game) return null;
      return (
        <Battle
          initial={game}
          onSave={(g) => saveGame(g)}
          onQuit={(finished) => {
            if (finished) {
              saveGame(null);
              setGame(null);
            } else setGame(loadGame());
            setScreen({ name: 'home' });
          }}
        />
      );
  }
}
