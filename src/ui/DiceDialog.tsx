import { useEffect, useState } from 'react';

import { COUNTABLE, d6, needNumber, valuesFromCounts, type DiceRequest } from '../engine/dice';

/**
 * Asks for the results of real dice. Big handfuls of hit, wound and save rolls are entered as totals
 * ("14 hit, 3 of them were 6s"); anything else die by die (keys 1-6, Backspace to undo, or the
 * + / − counters per face). "Roll for me" fills them in automatically.
 */
export function DiceDialog({ request, onDone }: { request: DiceRequest; onDone: (values: number[]) => void }) {
  const countable = COUNTABLE.includes(request.kind);
  const [quick, setQuick] = useState(countable && request.count >= 4);
  return (
    <div className="overlay">
      <div className="dialog">
        <div className="row">
          <span className={request.who === 'player' ? 'badge synapse' : 'badge marine'}>{request.who === 'player' ? 'YOUR ROLL' : 'ULTRAMARINES ROLL'}</span>
          {request.reroll ? <span className="badge warn">RE-ROLL</span> : null}
          <span className="grow" />
          {countable ? (
            <button className="small ghost" onClick={() => setQuick((q) => !q)}>
              {quick ? 'Enter each die instead' : 'Enter totals instead'}
            </button>
          ) : null}
        </div>
        <h2>{request.label}</h2>
        <div className="row">
          <b style={{ fontSize: 20 }}>
            Roll {request.count} {request.count === 1 ? 'die' : 'dice'}
          </b>
          {request.need ? <span className="muted">· need {request.need}</span> : null}
        </div>
        {quick ? <TotalsEntry request={request} onDone={onDone} /> : <DieByDie request={request} onDone={onDone} />}
      </div>
    </div>
  );
}

function Counter({ label, hint, value, max, onChange, autoFocus }: { label: string; hint?: string; value: number; max: number; onChange: (v: number) => void; autoFocus?: boolean }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <div className="col" style={{ gap: 0 }}>
        <b>{label}</b>
        {hint ? <span className="small muted">{hint}</span> : null}
      </div>
      <div className="row" style={{ gap: 4 }}>
        <button onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0}>
          −
        </button>
        <input
          type="number"
          min={0}
          max={max}
          value={value}
          autoFocus={autoFocus}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onChange(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
          style={{ width: 64, textAlign: 'center', fontSize: 20, fontWeight: 800 }}
        />
        <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>
          +
        </button>
        <span className="muted small">/ {max}</span>
      </div>
    </div>
  );
}

/** "How many went through": successes, criticals and (when they get re-rolled) 1s. */
function TotalsEntry({ request, onDone }: { request: DiceRequest; onDone: (values: number[]) => void }) {
  const [successes, setSuccesses] = useState(0);
  const [crits, setCrits] = useState(0);
  const [ones, setOnes] = useState(0);
  const attack = request.kind === 'hit' || request.kind === 'wound';
  const need = needNumber(request.need);
  const crit = request.critOn ?? 6;
  const critsPossible = attack && crit <= 6;
  // When only criticals can succeed (e.g. snap shooting needs 6s), every success is a critical.
  const onlyCrits = attack && need >= crit;
  const fails = request.count - successes;
  const word = request.kind === 'hit' ? 'hit' : 'wound';
  const finish = () => onDone(valuesFromCounts(request, { successes, crits: onlyCrits ? successes : Math.min(crits, successes), ones: Math.min(ones, fails) }));

  return (
    <div className="col" style={{ gap: 12 }}>
      {attack ? (
        <>
          <Counter
            label={request.kind === 'hit' ? 'How many hit?' : 'How many wounded?'}
            hint={`Rolls of ${onlyCrits ? `${crit}` : `${need}+`}${critsPossible && !onlyCrits ? ', criticals included' : ''}`}
            value={successes}
            max={request.count}
            onChange={setSuccesses}
            autoFocus
          />
          {critsPossible && !onlyCrits ? (
            <Counter
              label={`How many were critical ${word}s?`}
              hint={`Unmodified ${crit === 6 ? '6s' : `${crit}+`}. ${request.kind === 'hit' ? 'Trigger Sustained Hits / Lethal Hits if the weapon has them.' : 'Trigger Devastating Wounds if the weapon has it (check weapon keywords).'}`}
              value={Math.min(crits, successes)}
              max={successes}
              onChange={setCrits}
            />
          ) : null}
          {request.rerollOnes && fails > 0 ? (
            <Counter label="How many of the misses were 1s?" hint="Those get re-rolled next." value={Math.min(ones, fails)} max={fails} onChange={setOnes} />
          ) : null}
        </>
      ) : request.kind === 'save' ? (
        <Counter label="How many saves failed?" hint={`Rolls below ${request.need}. A 1 always fails.`} value={fails} max={request.count} onChange={(v) => setSuccesses(request.count - v)} autoFocus />
      ) : request.kind === 'fnp' ? (
        <Counter label="How many wounds were ignored?" hint={`Rolls of ${request.need}`} value={successes} max={request.count} onChange={setSuccesses} autoFocus />
      ) : (
        <Counter label="How many hazard rolls failed?" hint="Rolls of 1-2" value={fails} max={request.count} onChange={(v) => setSuccesses(request.count - v)} autoFocus />
      )}
      <div className="row">
        <span className="grow" />
        <button onClick={() => onDone(Array.from({ length: request.count }, () => d6()))}>Roll for me</button>
        <button className="primary" onClick={finish}>
          Done
        </button>
      </div>
    </div>
  );
}

function DieByDie({ request, onDone }: { request: DiceRequest; onDone: (values: number[]) => void }) {
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
  const need = Number(/^(\d)\+/.exec(request.need ?? '')?.[1]);

  return (
    <>
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
          <span key={i} className={Number.isFinite(need) && v < need ? 'die fail' : 'die'}>
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
    </>
  );
}
