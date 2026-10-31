import { useState } from 'react';

import type { Stratagem } from '../data/types';
import { needsTarget, type Game, type ReactionWindow } from '../engine/game';
import { sectionOf, stratagemText } from '../engine/stratagems';

/** Offers the player the stratagems they can use at this moment of the opponent's (or their own) turn. */
export function ReactionDialog({ game, window, onDone }: { game: Game; window: ReactionWindow; onDone: (used: { stratagem: Stratagem; unitId: string | null } | null) => void }) {
  const [choice, setChoice] = useState<Record<string, string>>({});
  return (
    <div className="overlay">
      <div className="dialog">
        <span className="badge warn">STRATAGEM OPPORTUNITY</span>
        <h2>{window.prompt}</h2>
        <span className="muted small">You have {game.state.cp.player} CP. Pick one to use now, or carry on.</span>
        {window.stratagems.map((s) => {
          const text = stratagemText(s);
          const targets = game.stratagemTargets('player', s, window.unitIds.length > 0 ? window.unitIds : undefined);
          const targetNeeded = needsTarget(s);
          const selected = choice[s.id] ?? targets[0]?.id ?? '';
          return (
            <div key={s.id} className="card col" style={{ gap: 6 }}>
              <div className="row">
                <b className="grow">{s.name}</b>
                <span className="badge">{s.cp} CP</span>
              </div>
              <div className="small">
                <b>When:</b> {sectionOf(text, 'WHEN')}
              </div>
              <div className="small">
                <b>Target:</b> {sectionOf(text, 'TARGET')}
              </div>
              <div className="small">
                <b>Effect:</b> {sectionOf(text, 'EFFECT')}
              </div>
              <div className="row">
                {targetNeeded ? (
                  <select value={selected} onChange={(e) => setChoice({ ...choice, [s.id]: e.target.value })} disabled={targets.length === 0}>
                    {targets.length === 0 ? <option value="">no eligible unit</option> : null}
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button className="primary" disabled={targetNeeded && !selected} onClick={() => onDone({ stratagem: s, unitId: targetNeeded ? selected : null })}>
                  Use ({s.cp} CP)
                </button>
              </div>
            </div>
          );
        })}
        <button onClick={() => onDone(null)}>No stratagem, carry on</button>
      </div>
    </div>
  );
}
