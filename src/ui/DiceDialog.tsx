import { useEffect, useState } from 'react';

import { d6, type DiceRequest } from '../engine/dice';

/**
 * Asks for the results of real dice. Type each die as you read it (keys 1-6, Backspace to undo), or
 * use the + / − counters per face. "Roll for me" fills them in automatically.
 */
export function DiceDialog({ request, onDone }: { request: DiceRequest; onDone: (values: number[]) => void }) {
  const [values, setValues] = useState<number[]>([]);
  const complete = values.length === request.count;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[1-6]$/.test(e.key)) setValues((v) => (v.length < request.count ? [...v, Number(e.key)] : v));
      else if (e.key === 'Backspace') setValues((v) => v.slice(0, -1));
      else if (e.key === 'Enter' && values.length === request.count) onDone(values);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request.count, values, onDone]);

  const counts = [1, 2, 3, 4, 5, 6].map((f) => values.filter((v) => v === f).length);
  const setFace = (face: number, delta: number) => {
    setValues((v) => {
      if (delta > 0) return v.length < request.count ? [...v, face] : v;
      const i = v.lastIndexOf(face);
      return i < 0 ? v : [...v.slice(0, i), ...v.slice(i + 1)];
    });
  };
  const needNumber = Number(/^(\d)\+/.exec(request.need ?? '')?.[1]);

  return (
    <div className="overlay">
      <div className="dialog">
        <div className="row">
          <span className={request.who === 'player' ? 'badge synapse' : 'badge marine'}>{request.who === 'player' ? 'YOUR ROLL' : 'ULTRAMARINES ROLL'}</span>
          {request.reroll ? <span className="badge warn">RE-ROLL</span> : null}
        </div>
        <h2>{request.label}</h2>
        <div className="row">
          <b style={{ fontSize: 20 }}>
            Roll {request.count} {request.count === 1 ? 'die' : 'dice'}
          </b>
          {request.need ? <span className="muted">· need {request.need}</span> : null}
        </div>
        <div className="dice-faces">
          {counts.map((n, i) => (
            <div key={i} className="face">
              <span className="pip">{i + 1}</span>
              <span className="n">{n}</span>
              <div className="row" style={{ gap: 2 }}>
                <button className="small" onClick={() => setFace(i + 1, -1)} disabled={n === 0}>
                  −
                </button>
                <button className="small" onClick={() => setFace(i + 1, 1)} disabled={complete}>
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ minHeight: 36 }}>
          {values.map((v, i) => (
            <span key={i} className={Number.isFinite(needNumber) && v < needNumber ? 'die fail' : 'die'}>
              {v}
            </span>
          ))}
          {values.length === 0 ? <span className="muted small">Type the dice with the number keys 1-6 as you read them, or use the counters.</span> : null}
        </div>
        <div className="row">
          <span className="muted grow">
            {values.length} / {request.count} entered
          </span>
          <button onClick={() => setValues([])} disabled={values.length === 0}>
            Clear
          </button>
          <button onClick={() => onDone(Array.from({ length: request.count }, () => d6()))}>Roll for me</button>
          <button className="primary" disabled={!complete} onClick={() => onDone(values)}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
