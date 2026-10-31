import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { Opponent } from '../ai/ai';
import { autoRoller, d6, type DiceRequest } from '../engine/dice';
import { Game, needsTarget, parseRange, phaseName, type ReactionWindow, type ShootAssignment } from '../engine/game';
import { edgeDistance, type Vec } from '../engine/geometry';
import { unitBuffs } from '../engine/modifiers';
import type { MoveCheck } from '../engine/movement';
import { engagePositions, formation } from '../engine/placement';
import { armyStratagems, sectionOf, stratagemText } from '../engine/stratagems';
import { aliveModels, onBoard, TURN_PHASES, type GameState, type MoveKind, type UnitState } from '../engine/state';
import { hasCoreAbility, modelWeapons } from '../engine/units';
import { canSeeUnit, hasCover } from '../engine/visibility';
import type { Stratagem } from '../data/types';
import { Board, type Aim, type Ring } from './Board';
import { Coach } from './Coach';
import { dangerMap } from './danger';
import { DiceDialog } from './DiceDialog';
import { loadGame } from './store';
import { ReactionDialog } from './ReactionDialog';
import { UnitPanel } from './UnitPanel';

type Mode =
  | { kind: 'deploy' }
  | { kind: 'move'; move: MoveKind; flying: boolean }
  | { kind: 'ingress' }
  | { kind: 'charge'; targets: string[] }
  | { kind: 'pile'; step: 'pileIn' | 'consolidate' };

const RE_ROLLABLE = ['hit', 'wound', 'save', 'damage', 'attacks', 'charge', 'advance', 'hazard'];

export function Battle({ initial, onSave, onQuit }: { initial: GameState; onSave: (g: GameState) => void; onQuit: (finished: boolean) => void }) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [dice, setDice] = useState<{ req: DiceRequest; resolve: (v: number[]) => void } | null>(null);
  const [review, setReview] = useState<{ req: DiceRequest; values: number[]; resolve: (v: number[]) => void } | null>(null);
  const [reaction, setReaction] = useState<{ window: ReactionWindow; resolve: () => void } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [draft, setDraft] = useState<Map<string, Vec> | null>(null);
  const [check, setCheck] = useState<MoveCheck | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [moveTogether, setMoveTogether] = useState(true);
  const [showDanger, setShowDanger] = useState(false);
  const [assign, setAssign] = useState<Record<string, { profile: string; targetId: string }>>({});
  const [shootType, setShootType] = useState<'normal' | 'assault' | 'closeQuarters' | 'indirect'>('normal');
  const [fightTarget, setFightTarget] = useState<string>('');
  const [fightProfiles, setFightProfiles] = useState<Record<string, string>>({});
  const [stratTarget, setStratTarget] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  /** Rapid Ingress during the opponent's turn: the reaction waits until the unit is placed. */
  const [arrival, setArrival] = useState<{ unitId: string; resolve: () => void } | null>(null);
  const aiRef = useRef(new Opponent(450));
  const aiRunning = useRef(false);
  /** "Don't ask again this phase": turn and phase the player muted stratagem prompts for. */
  const skipPrompts = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const gameRef = useRef<Game | null>(null);

  if (!gameRef.current) {
    // The latest autosave of this game wins, so reopening the screen never goes back in time.
    const saved = loadGame();
    const state: GameState = structuredClone(saved && saved.armies.player.name === initial.armies.player.name ? saved : initial);
    const auto = autoRoller();
    const game: Game = new Game(state, {
      roll: async (req) => {
        let values: number[];
        if (game.state.settings.dice[req.who] === 'auto') values = await auto(req);
        else values = await new Promise<number[]>((resolve) => setDice({ req, resolve }));
        // Command Re-roll (15.02) for the player's own rolls.
        if (req.who === 'player' && !req.reroll && RE_ROLLABLE.includes(req.kind) && commandReroll(game) && (game.state.settings.dice.player === 'manual' || req.kind === 'charge' || req.kind === 'advance')) {
          values = await new Promise<number[]>((resolve) => setReview({ req, values, resolve }));
        }
        return values;
      },
      react: async (window) => {
        if (window.player === 'ai') return aiRef.current.react(game, window);
        if (skipPrompts.current === `${game.state.turn}:${game.state.phase}`) return;
        await new Promise<void>((resolve) => setReaction({ window, resolve }));
      },
      changed: () => {
        force();
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => onSave(game.state), 400);
      },
    });
    gameRef.current = game;
  }
  const game = gameRef.current;
  const s = game.state;
  const selected = selectedId ? s.units.find((u) => u.id === selectedId) ?? null : null;
  const mine = s.active === 'player';

  // The computer acts whenever it has something to do and no dialog is waiting.
  useEffect(() => {
    if (aiRunning.current || dice || reaction || review) return;
    if (!aiRef.current.hasDuty(game)) return;
    aiRunning.current = true;
    (async () => {
      try {
        let guard = 0;
        while (aiRef.current.hasDuty(game) && guard++ < 400) await aiRef.current.act(game);
      } catch (e) {
        console.error(e);
        game.log(`The computer hit a problem: ${(e as Error).message}`, 'warn');
      } finally {
        aiRunning.current = false;
        force();
      }
    })();
  });

  // A charge that was rolled but not moved (e.g. after reopening the game) picks up where it was.
  const chargingId = s.charge?.unitId ?? null;
  useEffect(() => {
    if (!chargingId || s.active !== 'player') return;
    const unit = s.units.find((u) => u.id === chargingId);
    if (!unit) return;
    setSelectedId(chargingId);
    setMode((m) => (m?.kind === 'charge' ? m : { kind: 'charge', targets: [] }));
    setDraft((d) => d ?? new Map(aliveModels(unit).map((x) => [x.id, { x: x.x, y: x.y }])));
  }, [chargingId, s.active, s.units]);

  // Keep the newest log lines in view.
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [s.log.length]);

  const resetInteraction = () => {
    setMode(null);
    setDraft(null);
    setCheck(null);
    setAssign({});
    setFightTarget('');
    setFightProfiles({});
  };

  const select = (id: string | null) => {
    resetInteraction();
    setSelectedId(id);
    setNotice(null);
  };

  // ---- Draft positions and checks --------------------------------------------------------

  const runCheck = (next: Map<string, Vec>, m: Mode | null = mode): MoveCheck | null => {
    if (!selected || !m) return null;
    switch (m.kind) {
      case 'deploy':
        return game.deploymentCheck(selected.id, next);
      case 'ingress':
        return game.ingressCheck(selected, next);
      case 'move':
        return game.checkUnitMove(selected.id, m.move, next, m.flying);
      case 'charge':
        return game.checkCharge(m.targets, next);
      case 'pile':
        return game.checkPileIn(selected.id, next, m.step);
    }
  };

  const onDraft = (next: Map<string, Vec>, done: boolean) => {
    setDraft(next);
    if (done) setCheck(runCheck(next));
  };

  const startMode = (m: Mode, unit: UnitState, initialDraft?: Map<string, Vec>) => {
    setMode(m);
    const d = initialDraft ?? new Map(aliveModels(unit).map((x) => [x.id, { x: x.x, y: x.y }]));
    setDraft(d);
    setCheck(m.kind === 'move' || m.kind === 'pile' ? null : runCheck(d, m));
  };

  // ---- Board events ---------------------------------------------------------------------------

  const onBoardClick = (p: Vec) => {
    if (selected && mode && (mode.kind === 'deploy' || mode.kind === 'ingress')) {
      const d = formation(selected, p);
      setDraft(d);
      setCheck(runCheck(d));
      return;
    }
    if (!mode) select(null);
  };

  const onUnitClick = (id: string) => {
    const u = game.unit(id);
    if (selected && u.owner !== selected.owner) {
      if (mode?.kind === 'charge' && game.chargeTargets().includes(u)) {
        const targets = mode.targets.includes(id) ? mode.targets.filter((t) => t !== id) : [...mode.targets, id];
        const m: Mode = { kind: 'charge', targets };
        setMode(m);
        if (draft) setCheck(runCheck(draft, m));
        return;
      }
      if (s.phase === 'shooting' && mine && selected.owner === 'player' && game.shootingTypes(selected).length > 0) {
        const next = { ...assign };
        for (const w of game.rangedWeapons(selected)) {
          const profile = next[w.key]?.profile ?? w.profiles[0].weapon.name;
          if (game.weaponTargets(selected, w.key, profile, shootType).includes(u)) next[w.key] = { profile, targetId: id };
        }
        setAssign(next);
        return;
      }
      if (s.phase === 'fight' && game.meleeTargets(selected).includes(u)) {
        setFightTarget(id);
        return;
      }
    }
    if (mode) return;
    select(id);
  };

  // ---- Aiming line (shooting) ----------------------------------------------------------------

  const aim: Aim | null = useMemo(() => {
    if (!selected || !hover || s.phase !== 'shooting') return null;
    const target = s.units.find((u) => u.id === hover);
    if (!target || target.owner === selected.owner || !onBoard(target) || !onBoard(selected)) return null;
    const shooters = aliveModels(selected);
    const shooter = [...shooters].sort((a, b) => Math.min(...aliveModels(target).map((t) => edgeDistance(a, t))) - Math.min(...aliveModels(target).map((t) => edgeDistance(b, t))))[0];
    const sight = canSeeUnit(s, shooter, target);
    const closest = [...aliveModels(target)].sort((a, b) => edgeDistance(shooter, a) - edgeDistance(shooter, b))[0];
    const range = Math.max(0, ...shooters.flatMap((m) => modelWeapons(selected, m).filter((w) => w.ranged).map((w) => parseRange(w.weapon.range))));
    const d = edgeDistance(shooter, closest);
    const to = sight.line ? sight.line[1] : closest;
    const from = sight.line ? sight.line[0] : shooter;
    if (!sight.visible) return { from: shooter, to: closest, color: '#ec6a7e', label: `${d.toFixed(1)}" · blocked by terrain` };
    if (d > range) return { from, to, color: '#ec6a7e', label: `${d.toFixed(1)}" · out of range (${range}")` };
    const cover = hasCover(s, shooter, target);
    return cover ? { from, to, color: '#f2a65a', label: `${d.toFixed(1)}" · visible, in cover (-1 BS)` } : { from, to, color: '#6fd69a', label: `${d.toFixed(1)}" · clear shot` };
  }, [selected, hover, s, s.phase]);

  const rings: Ring[] = useMemo(() => {
    if (!selected || !mode || !draft) return [];
    const models = aliveModels(selected);
    if (mode.kind === 'move' || mode.kind === 'pile' || mode.kind === 'charge') {
      const kind = mode.kind === 'move' ? mode.move : mode.kind === 'charge' ? 'charge' : mode.step;
      const flying = mode.kind === 'move' && mode.flying;
      const list = models.length <= 12 ? models : [models[0]];
      return list.map((m) => ({ x: m.x, y: m.y, r: game.maxMove(selected, m, kind, flying), color: '#ffffff40' }));
    }
    return [];
  }, [selected, mode, draft, game]);

  const highlight = useMemo(() => {
    const map = new Map<string, string>();
    if (!selected) return map;
    if (mode?.kind === 'charge') {
      for (const t of game.chargeTargets()) map.set(t.id, mode.targets.includes(t.id) ? '#ec6a7e' : '#f2a65a');
    } else if (s.phase === 'shooting' && selected.owner === 'player' && mine) {
      for (const a of Object.values(assign)) map.set(a.targetId, '#ec6a7e');
    } else if (s.phase === 'fight' && fightTarget) map.set(fightTarget, '#ec6a7e');
    return map;
  }, [selected, mode, assign, fightTarget, s.phase, mine, game]);

  const danger = useMemo(() => (showDanger ? dangerMap(s, 'ai') : null), [showDanger, s, s.units.map((u) => u.status).join()]);

  // ---- Actions --------------------------------------------------------------------------------

  const confirmDraft = async () => {
    if (!selected || !mode || !draft) return;
    const c = runCheck(draft);
    setCheck(c);
    if (!c?.ok) return;
    if (arrival && mode.kind === 'ingress') {
      game.arriveNow(selected.id, draft);
      const done = arrival.resolve;
      setArrival(null);
      resetInteraction();
      done();
      return;
    }
    if (mode.kind === 'deploy') game.deploy(selected.id, draft);
    else if (mode.kind === 'ingress') await game.move(selected.id, 'ingress', draft);
    else if (mode.kind === 'move') await game.move(selected.id, mode.move, draft, mode.flying);
    else if (mode.kind === 'charge') await game.chargeMove(mode.targets, draft);
    else if (mode.kind === 'pile') await game.pileIn(selected.id, draft, mode.step);
    resetInteraction();
  };

  const endPhase = async () => {
    resetInteraction();
    const ok = await game.endPhase();
    if (!ok) setNotice(game.phaseBlockers().join(' '));
  };

  // ---- Side panel sections ---------------------------------------------------------------------

  const draftControls = (confirmLabel: string) => (
    <div className="col">
      <div className="row small">
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={moveTogether} onChange={(e) => setMoveTogether(e.target.checked)} /> Drag moves the whole unit (hold Alt to move one model)
        </label>
      </div>
      {check && !check.ok ? (
        <ul className="problems">
          {[...new Set(check.problems.map((p) => p.message))].slice(0, 6).map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      ) : null}
      {check?.ok ? <span className="small" style={{ color: 'var(--good)' }}>Legal position.</span> : null}
      {check && check.distances.size > 0 ? (
        <span className="small muted">Furthest model moves {Math.max(...check.distances.values()).toFixed(1)}".</span>
      ) : null}
      <div className="row">
        <button className="primary" onClick={confirmDraft} disabled={!draft || (game.busy && !arrival)}>
          {confirmLabel}
        </button>
        <button
          onClick={() => {
            resetInteraction();
            if (arrival) {
              const done = arrival.resolve;
              setArrival(null);
              done();
            }
          }}>
          Cancel
        </button>
      </div>
    </div>
  );

  const unitRows = (units: UnitState[], status: (u: UnitState) => string, done: (u: UnitState) => boolean) => (
    <div className="unit-list">
      {units.map((u) => (
        <button key={u.id} className={`unit-row ${selectedId === u.id ? 'selected' : ''} ${done(u) ? 'done' : ''}`} onClick={() => select(u.id)}>
          <span>{u.name}</span>
          <span className="small muted">{status(u)}</span>
        </button>
      ))}
    </div>
  );

  const deploymentPanel = () => {
    const mineLeft = game.undeployed('player');
    if (game.deploymentFinished()) {
      return (
        <div className="card col">
          <b>Both armies are deployed.</b>
          <span className="small muted">{s.firstPlayer === 'player' ? 'You take the first turn.' : 'The Ultramarines take the first turn.'}</span>
          <button className="primary" onClick={() => game.startBattle()}>
            Start battle round 1
          </button>
        </div>
      );
    }
    if (s.deployer !== 'player' && mineLeft.length > 0 && game.undeployed('ai').length > 0) return <div className="card">The Ultramarines are placing a unit…</div>;
    return (
      <div className="card col">
        <h3>Deploy your army</h3>
        <span className="small muted">
          Pick a unit, click inside your zone (purple, bottom) to place it, then drag to adjust. Hidden infantry: in a ruin, they cannot be seen from further than 15" until they shoot. Turn on "Danger" to see where the enemy guns reach.
        </span>
        {unitRows(mineLeft, (u) => `${aliveModels(u).length} models`, () => false)}
        <button
          className="small"
          onClick={() => {
            resetInteraction();
            for (const u of game.undeployed('player')) aiRef.current.deployUnit(game, u);
          }}>
          Deploy the rest for me (you can still learn from where they end up)
        </button>
        {selected && selected.status === 'undeployed' && selected.owner === 'player' ? (
          <div className="col">
            {mode?.kind === 'deploy' ? (
              draftControls('Deploy here')
            ) : (
              <div className="row">
                <button className="primary" onClick={() => startMode({ kind: 'deploy' }, selected, formation(selected, { x: 30, y: 38 }))}>
                  Place {selected.name}
                </button>
                {game.canGoToReserves(selected) ? (
                  <button onClick={() => (game.putInReserves(selected.id), select(null))}>
                    {hasCoreAbility(selected, 'Deep Strike') ? 'Hold back to Deep Strike' : 'Strategic reserves'}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const commandPanel = () => {
    const due = game.battleShockDue('player');
    const choices = game.unitsOf('player').length > 0 ? unitBuffs(s, game.unitsOf('player').find(onBoard) ?? game.unitsOf('player')[0]).filter((b) => b.effect.listWide && b.decidedBy === 'player') : [];
    return (
      <div className="card col">
        {due.map((u) => (
          <div key={u.id} className="row">
            <span className="grow">{u.name} must take a battle-shock test.</span>
            <button className="primary small" onClick={() => game.battleShockTest(u.id)}>
              Take test
            </button>
          </div>
        ))}
        {game.canUnleashShadow('player') ? (
          <button onClick={() => game.unleashShadow('player')}>Unleash the Shadow in the Warp (once per battle)</button>
        ) : null}
        {choices.length > 0 ? (
          <div className="col" style={{ gap: 4 }}>
            <b className="small">Detachment choices in effect</b>
            {choices.map((b) => (
              <label key={b.effect.id} className="row small" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={b.active}
                  onChange={() => {
                    const sw = s.armies.player.switches;
                    sw[b.effect.id] = !b.active;
                    const group = b.effect.condition !== 'always' ? b.effect.condition.group : undefined;
                    if (sw[b.effect.id] && group) for (const o of choices) if (o.effect.id !== b.effect.id && o.effect.condition !== 'always' && o.effect.condition.group === group) sw[o.effect.id] = false;
                    game.changed();
                  }}
                />
                {b.effect.label}
              </label>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const movementPanel = () => {
    const units = game.unitsOf('player').filter((u) => onBoard(u) || u.status === 'reserves');
    return (
      <div className="card col">
        {unitRows(
          units,
          (u) => (u.status === 'reserves' ? (s.round >= 2 ? 'in reserves: can arrive' : 'in reserves') : u.flags.move ? `moved (${u.flags.move})` : 'not moved'),
          (u) => u.flags.move !== null,
        )}
        {selected && selected.owner === 'player' ? (
          mode?.kind === 'move' || mode?.kind === 'ingress' ? (
            <>
              {mode.kind === 'move' && game.canFly(selected) ? (
                <label className="row small" style={{ gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={mode.flying}
                    onChange={(e) => {
                      const m: Mode = { kind: 'move', move: mode.move, flying: e.target.checked };
                      setMode(m);
                      if (draft) setCheck(runCheck(draft, m));
                    }}
                  />
                  Take to the skies (-2" but fly over models and terrain)
                </label>
              ) : null}
              {mode.kind === 'ingress' ? <span className="small muted">Click where the unit arrives: {selected.deepStrike ? 'anywhere more than 8" from enemies (Deep Strike).' : 'wholly within 6" of a battlefield edge, more than 8" from enemies.'}</span> : null}
              {mode.kind === 'move' ? <span className="small muted">Maximum {game.maxMove(selected, aliveModels(selected)[0], mode.move, mode.flying)}" per model (dashed rings).</span> : null}
              {draftControls('Confirm move')}
            </>
          ) : (
            <div className="row">
              {game.moveOptions(selected.id).map((k) => (
                <button
                  key={k}
                  onClick={async () => {
                    if (k === 'stationary') {
                      await game.move(selected.id, 'stationary', new Map());
                      return;
                    }
                    if (k === 'ingress') {
                      startMode({ kind: 'ingress' }, selected, formation(selected, { x: 30, y: 40 }));
                      return;
                    }
                    if (k === 'advance') await game.rollAdvance(selected.id);
                    startMode({ kind: 'move', move: k, flying: false }, selected);
                  }}>
                  {k === 'stationary' ? 'Remain stationary' : k === 'normal' ? 'Normal move' : k === 'advance' ? 'Advance (roll D6)' : k === 'fallBack' ? 'Fall back' : 'Arrive from reserves'}
                </button>
              ))}
            </div>
          )
        ) : null}
      </div>
    );
  };

  const shootingPanel = () => {
    const shooters = game.unitsOf('player').filter(onBoard);
    const types = selected && selected.owner === 'player' ? game.shootingTypes(selected) : [];
    const type = types.includes(shootType) ? shootType : types[0];
    return (
      <div className="card col">
        {unitRows(shooters, (u) => (u.flags.shot ? 'has shot' : game.shootingTypes(u).length > 0 ? 'can shoot' : 'cannot shoot'), (u) => u.flags.shot || game.shootingTypes(u).length === 0)}
        {selected && selected.owner === 'player' && type ? (
          <div className="col">
            {types.length > 1 ? (
              <div className="row">
                {types.map((t) => (
                  <button key={t} className={t === type ? 'selected small' : 'small'} onClick={() => (setShootType(t), setAssign({}))}>
                    {t === 'normal' ? 'Normal' : t === 'assault' ? 'Assault (advanced)' : t === 'closeQuarters' ? 'Close quarters' : 'Indirect'}
                  </button>
                ))}
              </div>
            ) : null}
            <span className="small muted">Hover an enemy to draw the line of sight; click it to aim every weapon that can reach it.</span>
            {game.rangedWeapons(selected).map((w) => {
              const current = assign[w.key];
              const profile = current?.profile ?? w.profiles[0].weapon.name;
              const targets = game.weaponTargets(selected, w.key, profile, type);
              return (
                <div key={w.key} className="row small">
                  <span className="count-pill">{w.carriers}×</span>
                  {w.profiles.length > 1 ? (
                    <select value={profile} onChange={(e) => setAssign({ ...assign, [w.key]: { profile: e.target.value, targetId: current?.targetId ?? '' } })}>
                      {w.profiles.map((p) => (
                        <option key={p.weapon.name} value={p.weapon.name}>
                          {p.weapon.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="grow">{w.profiles[0].weapon.name}</span>
                  )}
                  <select value={current?.targetId ?? ''} onChange={(e) => setAssign({ ...assign, [w.key]: { profile, targetId: e.target.value } })}>
                    <option value="">{targets.length === 0 ? 'no target in range and sight' : 'hold fire'}</option>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
            <button
              className="primary"
              disabled={Object.values(assign).every((a) => !a.targetId) || game.busy}
              onClick={async () => {
                const list: ShootAssignment[] = Object.entries(assign)
                  .filter(([, a]) => a.targetId)
                  .map(([key, a]) => ({ key, profile: a.profile, targetId: a.targetId }));
                await game.shoot(selected.id, type, list);
                resetInteraction();
              }}>
              Shoot
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  const chargePanel = () => {
    const chargers = game.unitsOf('player').filter(onBoard);
    return (
      <div className="card col">
        {unitRows(chargers, (u) => (u.flags.charged ? 'charged' : u.flags.chargeDeclared ? 'charge failed' : game.canDeclareCharge(u) ? 'can charge' : '—'), (u) => !game.canDeclareCharge(u))}
        {selected && selected.owner === 'player' ? (
          game.charge && game.charge.unitId === selected.id ? (
            <div className="col">
              <b>Charge roll: {game.charge.distance}"</b>
              <span className="small muted">Click the enemy units to charge (in reach: {game.chargeTargets().map((t) => t.name).join(', ')}). Then place the models.</span>
              <div className="row">
                <button
                  disabled={!mode || mode.kind !== 'charge' || mode.targets.length === 0}
                  onClick={() => {
                    if (mode?.kind !== 'charge') return;
                    const d = engagePositions(s, selected, mode.targets, game.charge?.distance ?? 0);
                    setDraft(d);
                    setCheck(runCheck(d));
                  }}>
                  Place models for me
                </button>
                <button onClick={() => (game.failCharge(), resetInteraction())}>Give up the charge</button>
              </div>
              {mode?.kind === 'charge' && draft ? draftControls('Confirm charge') : null}
            </div>
          ) : game.canDeclareCharge(selected) ? (
            <button
              className="primary"
              onClick={async () => {
                await game.declareCharge(selected.id);
                if (game.charge) startMode({ kind: 'charge', targets: [] }, selected);
              }}>
              Declare a charge (roll 2D6)
            </button>
          ) : null
        ) : null}
      </div>
    );
  };

  const fightPanel = () => {
    const f = game.fight;
    if (!f) return null;
    const stepMine = game.stepPlayer() === 'player';
    if (f.step === 'pileIn' || f.step === 'consolidate') {
      const step = f.step;
      const units = step === 'pileIn' ? game.pileInUnits('player') : game.consolidateUnits('player');
      if (!stepMine) return <div className="card">Waiting for the Ultramarines to {step === 'pileIn' ? 'pile in' : 'consolidate'}…</div>;
      return (
        <div className="card col">
          <b>{step === 'pileIn' ? 'Pile in (up to 3")' : 'Consolidate (up to 3")'}</b>
          {units.length === 0 ? <span className="small muted">None of your units can {step === 'pileIn' ? 'pile in' : 'consolidate'}.</span> : unitRows(units, () => '', () => false)}
          {selected && units.includes(selected) ? (
            mode?.kind === 'pile' ? (
              draftControls(step === 'pileIn' ? 'Confirm pile in' : 'Confirm consolidation')
            ) : (
              <div className="row">
                <button onClick={() => startMode({ kind: 'pile', step }, selected, engagePositions(s, selected, game.pileInTargets(selected).map((t) => t.id), 3, step))}>Move for me</button>
                <button onClick={() => startMode({ kind: 'pile', step }, selected)}>Move by hand</button>
              </div>
            )
          ) : null}
          <button className="primary" onClick={() => (resetInteraction(), game.finishStep('player'))}>
            {step === 'pileIn' ? 'Done piling in' : 'Done consolidating'}
          </button>
        </div>
      );
    }
    if (f.step === 'fight') {
      if (game.fightStepOver()) return <div className="card">All fights are resolved.</div>;
      if (f.picker !== 'player') return <div className="card">The Ultramarines are choosing a unit to fight…</div>;
      const pickable = game.pickableUnits();
      const targets = selected ? game.meleeTargets(selected) : [];
      const target = fightTarget || targets[0]?.id || '';
      return (
        <div className="card col">
          <b>Your pick: choose a unit to fight{pickable.some((u) => u.flags.fightsFirst) ? ' (Fights First units go first)' : ''}</b>
          {unitRows(pickable, (u) => (u.flags.fightsFirst ? 'fights first' : 'eligible'), () => false)}
          {selected && pickable.includes(selected) ? (
            <div className="col">
              <select value={target} onChange={(e) => setFightTarget(e.target.value)}>
                {targets.length === 0 ? <option value="">no enemy within 2" (it can still pile in first by hand)</option> : null}
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {meleeChoices(selected).map(({ key, options, models }) => (
                <label key={key} className="row small" style={{ gap: 4 }}>
                  {models} model{models === 1 ? '' : 's'} fight with
                  <select value={fightProfiles[key] ?? game.bestMelee(selected, aliveModels(selected).find((m) => profileKey(selected, m) === key)!)?.weapon.name ?? ''} onChange={(e) => setFightProfiles({ ...fightProfiles, [key]: e.target.value })}>
                    {options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <button
                className="primary"
                disabled={game.busy}
                onClick={async () => {
                  const profiles: Record<string, string> = {};
                  for (const m of aliveModels(selected)) {
                    const k = profileKey(selected, m);
                    if (fightProfiles[k]) profiles[m.id] = fightProfiles[k];
                  }
                  await game.fightWith(selected.id, { targetId: target, profiles });
                  resetInteraction();
                }}>
                Fight!
              </button>
            </div>
          ) : null}
          {game.canPass('player') ? <button onClick={() => game.passFight('player')}>Pass (no enemy within 5")</button> : null}
        </div>
      );
    }
    return <div className="card">The Fight phase is over.</div>;
  };

  const stratagemPanel = () => {
    if (s.phase === 'deployment' || s.phase === 'gameOver' || !mine) return null;
    const usable = game.usableStratagems('player', 'during').filter((st) => !needsTarget(st) || game.stratagemTargets('player', st).length > 0);
    const all = armyStratagems(s, 'player').filter((x) => x.category === 'detachment');
    return (
      <details className="card" open={usable.length > 0}>
        <summary style={{ cursor: 'pointer' }}>
          <b>Stratagems you can use now ({usable.length})</b> <span className="muted small">· {s.cp.player} CP</span>
        </summary>
        <div className="col" style={{ marginTop: 8 }}>
          {usable.map((st) => (
            <StratagemRow key={st.id} game={game} st={st} target={stratTarget[st.id]} setTarget={(t) => setStratTarget({ ...stratTarget, [st.id]: t })} onUsed={(msg) => setNotice(msg)} />
          ))}
          {usable.length === 0 ? <span className="small muted">None fit this moment. Reaction stratagems pop up by themselves when their moment comes.</span> : null}
          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>
              All your detachment stratagems ({all.length})
            </summary>
            <div className="col small" style={{ marginTop: 6 }}>
              {all.map((st) => (
                <div key={st.id} className="rule">
                  <b>
                    {st.name} ({st.cp} CP).
                  </b>{' '}
                  <span className="muted">When:</span> {sectionOf(stratagemText(st), 'WHEN')} <span className="muted">Effect:</span> {sectionOf(stratagemText(st), 'EFFECT')}
                </div>
              ))}
            </div>
          </details>
        </div>
      </details>
    );
  };

  const actionPanel = () => {
    if (s.phase === 'deployment') return deploymentPanel();
    if (s.phase === 'gameOver') return null;
    if (arrival && selected) {
      return (
        <div className="card col">
          <b>Rapid Ingress: place {selected.name}</b>
          <span className="small muted">{selected.deepStrike ? 'Anywhere more than 8" from enemy units (Deep Strike).' : 'Wholly within 6" of a battlefield edge and more than 8" from enemy units.'} Click the board, then drag to adjust.</span>
          {draftControls('Arrive here')}
        </div>
      );
    }
    if (!mine) {
      if (s.phase === 'fight') return fightPanel();
      return <div className="card">The Ultramarines are taking their turn. Their moves and attacks appear in the log below; you will be asked when you can react.</div>;
    }
    switch (s.phase) {
      case 'command':
        return commandPanel();
      case 'movement':
        return movementPanel();
      case 'shooting':
        return shootingPanel();
      case 'charge':
        return chargePanel();
      case 'fight':
        return fightPanel();
    }
  };

  const blockers = game.phaseBlockers();
  const canEnd = mine && s.phase !== 'deployment' && s.phase !== 'gameOver' && blockers.length === 0 && !game.busy && !(s.phase === 'fight' && game.fight && game.fight.step !== 'done');

  return (
    <div className="battle">
      <div className="board-wrap">
        <div className="board-toolbar">
          <b>Round {Math.max(1, s.round)} / 5</b>
          <span className={mine ? 'badge synapse' : 'badge marine'}>{s.phase === 'deployment' ? 'DEPLOYMENT' : mine ? 'YOUR TURN' : 'ULTRAMARINES TURN'}</span>
          <span className="muted small grow">Right-click and drag to measure. Grid squares are 6".</span>
          <label className="row small" style={{ gap: 4 }}>
            <input type="checkbox" checked={showDanger} onChange={(e) => setShowDanger(e.target.checked)} /> Danger (enemy guns)
          </label>
          <button className="small" onClick={() => (onSave(game.state), onQuit(s.phase === 'gameOver'))}>
            {s.phase === 'gameOver' ? 'Back to menu' : 'Save & quit'}
          </button>
        </div>
        {!mine && s.phase !== 'deployment' && s.phase !== 'gameOver' ? <div className="banner ai">Ultramarines {phaseName(s.phase)} phase</div> : null}
        <div className="board-area">
          <Board
            state={s}
            selectedId={selectedId}
            draft={draft}
            draftUnitId={mode ? selectedId : null}
            badModels={new Set(check?.problems.map((p) => p.modelId).filter((x): x is string => !!x) ?? [])}
            rings={rings}
            highlight={highlight}
            aim={aim}
            showZones={s.phase === 'deployment' || mode?.kind === 'deploy'}
            danger={danger}
            moveTogether={moveTogether}
            onDraft={onDraft}
            onBoardClick={onBoardClick}
            onUnitClick={onUnitClick}
            onHover={(id) => setHover(id)}
          />
        </div>
      </div>

      <div className="side">
        <div className="phase-header">
          <div className="score">
            <span className="ty">Tyranids {s.vp.player} VP</span>
            <span className="muted">·</span>
            <span className="um">Ultramarines {s.vp.ai} VP</span>
            <span className="grow" />
            <span className="small muted">
              CP {s.cp.player} / {s.cp.ai}
            </span>
          </div>
          {s.phase !== 'deployment' && s.phase !== 'gameOver' ? (
            <div className="phase-track">
              {TURN_PHASES.map((p) => (
                <span key={p} className={`phase-pill ${s.phase === p ? 'current' : ''} ${s.phase === p && !mine ? 'ai' : ''}`}>
                  {phaseName(p)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="side-scroll">
          {s.phase === 'gameOver' ? (
            <div className="card col">
              <h2>{s.winner === 'player' ? 'Victory!' : s.winner === 'ai' ? 'Defeat' : 'Draw'}</h2>
              <span>
                Tyranids {s.vp.player} VP · Ultramarines {s.vp.ai} VP
              </span>
              <span className="small muted">Units destroyed: yours {game.unitsOf('player').filter((u) => u.status === 'destroyed').length}, theirs {game.unitsOf('ai').filter((u) => u.status === 'destroyed').length}.</span>
            </div>
          ) : null}
          {s.phase !== 'gameOver' && s.phase !== 'deployment' ? <Coach game={game} /> : null}
          {actionPanel()}
          {notice ? <div className="card small" style={{ borderColor: 'var(--warn)' }}>{notice}</div> : null}
          {s.phase !== 'deployment' && s.phase !== 'gameOver' && mine ? (
            <div className="col">
              <button className="primary" disabled={!canEnd} onClick={endPhase}>
                End {phaseName(s.phase)} phase
              </button>
              {blockers.length > 0 ? <span className="small" style={{ color: 'var(--warn)' }}>{blockers.join(' ')}</span> : null}
            </div>
          ) : null}
          {stratagemPanel()}
          {selected ? <UnitPanel game={game} unit={selected} /> : <span className="small muted">Click a unit on the board to see its datasheet, abilities and what is buffing it.</span>}
          <div className="card col">
            <h3>Battle log</h3>
            <div className="log" ref={logRef}>
              {s.log
                .slice(-80)
                .map((l, i) => (
                  <span key={i} className={`${l.kind ?? ''} ${l.player === 'ai' ? 'ai' : ''}`}>
                    {l.text}
                  </span>
                ))}
            </div>
          </div>
        </div>
      </div>

      {dice ? (
        <DiceDialog
          request={dice.req}
          onDone={(v) => {
            const r = dice.resolve;
            setDice(null);
            r(v);
          }}
        />
      ) : null}
      {review ? (
        <RerollDialog
          game={game}
          req={review.req}
          values={review.values}
          onDone={(v) => {
            const r = review.resolve;
            setReview(null);
            r(v);
          }}
        />
      ) : null}
      {reaction ? (
        <ReactionDialog
          game={game}
          window={reaction.window}
          onSkipPhase={() => {
            skipPrompts.current = `${game.state.turn}:${game.state.phase}`;
          }}
          onDone={async (used) => {
            const r = reaction.resolve;
            setReaction(null);
            if (used) {
              const result = game.useStratagem('player', used.stratagem.id, used.unitId);
              if (/rapid ingress/i.test(used.stratagem.name) && used.unitId) {
                const unit = game.unit(used.unitId);
                setSelectedId(unit.id);
                setMode({ kind: 'ingress' });
                const d = formation(unit, { x: 30, y: unit.owner === 'player' ? 40 : 4 });
                setDraft(d);
                setCheck(game.ingressCheck(unit, d));
                setArrival({ unitId: unit.id, resolve: r });
                return;
              }
              if (/fire overwatch/i.test(used.stratagem.name) && used.unitId) {
                const unit = game.unit(used.unitId);
                const enemy = reaction.window.enemyUnitId ? game.unit(reaction.window.enemyUnitId) : undefined;
                const targets = game.snapTargets(unit);
                const target = enemy && targets.includes(enemy) ? enemy : targets[0];
                if (target) await game.snapShoot(unit.id, target.id);
              } else if (result.manual) setNotice(`${used.stratagem.name}: resolve this part yourself — ${result.manual}`);
            }
            r();
          }}
        />
      ) : null}
    </div>
  );
}

/** Groups of models with the same melee weapon choice. */
function profileKey(u: UnitState, m: ReturnType<typeof aliveModels>[number]): string {
  return modelWeapons(u, m)
    .filter((w) => !w.ranged)
    .map((w) => w.weapon.name)
    .sort()
    .join('|');
}

function meleeChoices(u: UnitState): { key: string; options: string[]; models: number }[] {
  const groups = new Map<string, { key: string; options: string[]; models: number }>();
  for (const m of aliveModels(u)) {
    const options = modelWeapons(u, m)
      .filter((w) => !w.ranged && !w.weapon.keywords.some((k) => /extra attacks/i.test(k)))
      .map((w) => w.weapon.name);
    if (options.length < 2) continue;
    const key = profileKey(u, m);
    const g = groups.get(key) ?? { key, options, models: 0 };
    g.models++;
    groups.set(key, g);
  }
  return [...groups.values()];
}

function commandReroll(game: Game): Stratagem | undefined {
  const st = armyStratagems(game.state, 'player').find((x) => /command re-roll/i.test(x.name));
  if (!st || game.state.cp.player < (st.cp ?? 1)) return undefined;
  if (game.state.stratagemUses.some((u) => u.player === 'player' && u.stratagemId === st.id && u.turn === game.state.turn && u.phase === game.state.phase)) return undefined;
  return st;
}

function StratagemRow({ game, st, target, setTarget, onUsed }: { game: Game; st: Stratagem; target: string | undefined; setTarget: (t: string) => void; onUsed: (msg: string) => void }) {
  const text = stratagemText(st);
  const targets = game.stratagemTargets('player', st);
  const targetNeeded = needsTarget(st);
  const chosen = target ?? targets[0]?.id ?? '';
  return (
    <div className="col" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
      <div className="row">
        <b className="grow small">{st.name}</b>
        <span className="badge">{st.cp} CP</span>
      </div>
      <span className="small muted">{sectionOf(text, 'EFFECT')}</span>
      <div className="row">
        {targetNeeded ? (
          <select value={chosen} onChange={(e) => setTarget(e.target.value)}>
            {targets.length === 0 ? <option value="">no eligible unit</option> : null}
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : null}
        <button
          className="small"
          disabled={(targetNeeded && !chosen) || game.busy}
          onClick={() => {
            const r = game.useStratagem('player', st.id, targetNeeded ? chosen : null);
            onUsed(r.manual ? `${st.name}: resolve this part yourself — ${r.manual}` : `${st.name} applied.`);
          }}>
          Use
        </button>
      </div>
    </div>
  );
}

/** After a roll: offer Command Re-roll on one die (or the whole charge roll). */
function RerollDialog({ game, req, values, onDone }: { game: Game; req: DiceRequest; values: number[]; onDone: (v: number[]) => void }) {
  const [current, setCurrent] = useState(values);
  const [used, setUsed] = useState(false);
  const st = commandReroll(game);
  const manual = game.state.settings.dice.player === 'manual';
  const [picking, setPicking] = useState<number | null>(null);
  const whole = req.kind === 'charge';
  const reroll = (index: number | null, newValues: number[]) => {
    if (!st) return;
    game.useStratagem('player', st.id, null);
    setUsed(true);
    if (index === null) setCurrent(newValues);
    else setCurrent(current.map((v, i) => (i === index ? newValues[0] : v)));
    setPicking(null);
  };
  useEffect(() => {
    if (picking === null || !manual) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[1-6]$/.test(e.key)) reroll(picking === -1 ? null : picking, picking === -1 ? [Number(e.key)] : [Number(e.key)]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="overlay">
      <div className="dialog">
        <h2>{req.label}</h2>
        <div>
          {current.map((v, i) => (
            <button key={i} className={picking === i ? 'selected' : ''} style={{ padding: 0, border: 'none', background: 'none' }} disabled={used || whole || !st} onClick={() => (manual ? setPicking(i) : reroll(i, [d6()]))}>
              <span className="die">{v}</span>
            </button>
          ))}
          {whole ? <b style={{ marginLeft: 8 }}>= {current.reduce((a, b) => a + b, 0)}"</b> : null}
        </div>
        {st && !used ? (
          <span className="small muted">
            {whole ? 'Command Re-roll (1 CP) re-rolls the whole charge roll.' : 'Command Re-roll (1 CP): click one die to re-roll it.'}
            {manual && picking !== null ? ' Roll it and press its number key.' : ''}
          </span>
        ) : null}
        <div className="row">
          {st && !used && whole ? (
            <button onClick={() => (manual ? setPicking(-1) : reroll(null, current.map(() => d6())))}>Command Re-roll the charge (1 CP)</button>
          ) : null}
          <span className="grow" />
          <button className="primary" onClick={() => onDone(current)}>
            Keep {used ? 'these' : 'the roll'}
          </button>
        </div>
      </div>
    </div>
  );
}

