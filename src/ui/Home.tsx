import { tyranids } from '../data/bundles';
import { starterTyranidList } from '../data/defaultLists';
import type { GameState } from '../engine/state';
import { listPoints, type ArmyList } from '../rules/army';
import { newListId } from './store';

export function Home({
  lists,
  savedGame,
  onNewGame,
  onContinue,
  onEditList,
  onListsChange,
}: {
  lists: ArmyList[];
  savedGame: GameState | null;
  onNewGame: () => void;
  onContinue: () => void;
  onEditList: (id: number) => void;
  onListsChange: (lists: ArmyList[]) => void;
}) {
  const addList = () => {
    const id = newListId(lists);
    const fresh: ArmyList = { ...starterTyranidList(), id, name: `Tyranid list ${id}`, units: [] };
    onListsChange([...lists, fresh]);
    onEditList(id);
  };
  return (
    <div className="screen home">
      <div className="col" style={{ gap: 4 }}>
        <h1>Warhammer Sim</h1>
        <div className="muted">Practice games of Warhammer 40,000 (11th edition): your Tyranids against a 2000-point Ultramarines army.</div>
      </div>
      <div className="home-actions">
        {savedGame && savedGame.phase !== 'gameOver' ? (
          <button className="primary" onClick={onContinue}>
            Continue game (round {Math.max(1, savedGame.round)})
          </button>
        ) : null}
        <button className={savedGame && savedGame.phase !== 'gameOver' ? '' : 'primary'} onClick={onNewGame}>
          New game
        </button>
      </div>

      <div className="col" style={{ width: 'min(720px, 100%)' }}>
        <div className="row">
          <h2 className="grow">Your army lists</h2>
          <button onClick={addList}>New list</button>
        </div>
        {lists.map((l) => (
          <div key={l.id} className="card row">
            <div className="grow col" style={{ gap: 2 }}>
              <b>{l.name}</b>
              <span className="muted small">
                {listPoints(tyranids, l)} / {l.pointsLimit} pts · {l.units.length} units ·{' '}
                {l.detachmentIds.map((id) => tyranids.detachmentById.get(id)?.name).filter(Boolean).join(', ') || 'no detachment'}
              </span>
            </div>
            <button onClick={() => onEditList(l.id)}>Edit</button>
            {lists.length > 1 ? (
              <button className="danger small" onClick={() => onListsChange(lists.filter((x) => x.id !== l.id))}>
                Delete
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="card col small muted" style={{ width: 'min(720px, 100%)' }}>
        <b style={{ color: 'var(--bone)' }}>How a game works</b>
        <span>
          Deploy, then play five battle rounds. The gold coach box on the right walks you through each phase step by step, lists the abilities that
          matter right now, and offers your stratagems when they can be used. Roll real dice and type them in, or let the game roll.
        </span>
        <span>Measure any distance by right-click dragging on the board. Units move along the shortest legal path; the distance shown is exact.</span>
      </div>
    </div>
  );
}
