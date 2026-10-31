import { useState } from 'react';

import { spaceMarines, tyranids } from '../data/bundles';
import { ultramarinesList } from '../data/defaultLists';
import { newGame } from '../engine/setup';
import type { DiceMode, Difficulty, GameState, PlayerId } from '../engine/state';
import { listPoints, validateList, type ArmyList } from '../rules/army';
import { unitLabels } from '../rules/army';

const DIFFICULTIES: { value: Difficulty; label: string; hint: string }[] = [
  { value: 'easy', label: 'Easy', hint: 'Walks at your nearest unit, shoots whatever is closest, no stratagems.' },
  { value: 'normal', label: 'Normal', hint: 'Plays the objectives, picks targets by expected damage, charges when the odds are fair.' },
  { value: 'hard', label: 'Hard', hint: 'Weighs each move against how exposed it is, focuses fire, deep strikes onto weak spots, uses defensive stratagems.' },
];

export function Setup({ lists, onBack, onStart }: { lists: ArmyList[]; onBack: () => void; onStart: (g: GameState) => void }) {
  const [listId, setListId] = useState(lists[0]?.id ?? 0);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [first, setFirst] = useState<PlayerId | 'roll'>('roll');
  const [myDice, setMyDice] = useState<DiceMode>('manual');
  const [aiDice, setAiDice] = useState<DiceMode>('auto');
  const list = lists.find((l) => l.id === listId);
  const enemy = ultramarinesList();
  const problems = list ? validateList(tyranids, list).filter((w) => !/No detachment/.test(w.message) || list.detachmentIds.length === 0) : [];
  const enemyLabels = unitLabels(spaceMarines, enemy.units);

  const start = () => {
    if (!list) return;
    const firstPlayer: PlayerId = first === 'roll' ? (Math.random() < 0.5 ? 'player' : 'ai') : first;
    onStart(newGame({ playerList: list, aiList: enemy, difficulty, firstPlayer, dice: { player: myDice, ai: aiDice } }));
  };

  return (
    <div className="screen col" style={{ gap: 16, maxWidth: 820 }}>
      <div className="row">
        <h1 className="grow">New game</h1>
        <button onClick={onBack}>Back</button>
      </div>

      <div className="card col">
        <h3>Your army</h3>
        <select value={listId} onChange={(e) => setListId(Number(e.target.value))}>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({listPoints(tyranids, l)} pts)
            </option>
          ))}
        </select>
        {problems.length > 0 ? (
          <ul className="problems">
            {problems.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="card col">
        <h3>Opponent: {enemy.name} (2000 pts, Blade of Ultramar)</h3>
        <span className="muted small">{enemy.units.filter((u) => !u.attachedTo).map((u) => {
          const leaders = enemy.units.filter((x) => x.attachedTo === u.uid).map((x) => enemyLabels.get(x.uid));
          return [enemyLabels.get(u.uid), ...leaders].join(' + ');
        }).join(' · ')}</span>
        <div className="row">
          {DIFFICULTIES.map((d) => (
            <button key={d.value} className={difficulty === d.value ? 'selected' : ''} onClick={() => setDifficulty(d.value)}>
              {d.label}
            </button>
          ))}
        </div>
        <span className="muted small">{DIFFICULTIES.find((d) => d.value === difficulty)?.hint}</span>
      </div>

      <div className="card col">
        <h3>First turn</h3>
        <div className="row">
          {(['roll', 'player', 'ai'] as const).map((f) => (
            <button key={f} className={first === f ? 'selected' : ''} onClick={() => setFirst(f)}>
              {f === 'roll' ? 'Roll off' : f === 'player' ? 'I go first' : 'Ultramarines go first'}
            </button>
          ))}
        </div>
        <span className="muted small">The player who goes second deploys first.</span>
      </div>

      <div className="card col">
        <h3>Dice</h3>
        <div className="row">
          <span style={{ width: 170 }}>My rolls</span>
          <button className={myDice === 'manual' ? 'selected' : ''} onClick={() => setMyDice('manual')}>
            I roll real dice
          </button>
          <button className={myDice === 'auto' ? 'selected' : ''} onClick={() => setMyDice('auto')}>
            Roll for me
          </button>
        </div>
        <div className="row">
          <span style={{ width: 170 }}>Ultramarines rolls</span>
          <button className={aiDice === 'manual' ? 'selected' : ''} onClick={() => setAiDice('manual')}>
            I roll them too
          </button>
          <button className={aiDice === 'auto' ? 'selected' : ''} onClick={() => setAiDice('auto')}>
            Roll for them
          </button>
        </div>
        <span className="muted small">With real dice, every roll asks you for the results. Each dice window also has an auto-roll button for when you are in a hurry.</span>
      </div>

      <button className="primary" style={{ padding: '14px', fontSize: 18 }} disabled={!list || list.units.length === 0} onClick={start}>
        Start deployment
      </button>
    </div>
  );
}
