import { BUNDLES, tyranidCuration } from '../data/bundles';
import type { When } from '../data/notes';
import { MAX_PRIMARY_PER_TURN, phaseName, VP_PER_OBJECTIVE, type Game } from '../engine/game';
import { onBoard, type Phase } from '../engine/state';

const PHASE_TO_WHEN: Partial<Record<Phase, When>> = { command: 'command', movement: 'movement', shooting: 'shooting', charge: 'charge', fight: 'fight', deployment: 'before' };

const STEPS: Partial<Record<Phase, string[]>> = {
  movement: [
    'Select every unit once: normal move, advance (roll a D6, then no shooting except [ASSAULT] and no charging), fall back if engaged, or stay still.',
    'Units in reserves can arrive from battle round 2: more than 8" from enemies (Deep Strike) or wholly within 6" of an edge.',
    'Every model must end in coherency: within 2" of another model in the unit and 9" of all of them.',
  ],
  shooting: [
    'Pick a unit, then aim each weapon at a target that is visible and in range. Draw the line: hover an enemy to see it.',
    'Infantry inside a ruin or crater field, or units only partly visible behind terrain, have cover: your BS is worse by 1.',
    'Units that advanced can only fire [ASSAULT] weapons. Engaged units can only fire [PISTOL] weapons (Monsters can shoot, at -1 to hit).',
  ],
  charge: [
    'A unit within 12" of an enemy can declare a charge (not if it advanced or fell back). Roll 2D6: that is how far each model can move.',
    'Each model must end closer to a target and the unit must end engaged (within 2") with every target it picked, and no other enemy unit.',
    'Units that charged fight first this turn.',
  ],
  fight: [
    'Pile in: engaged or charging units move up to 3" towards the closest enemy (active player first).',
    'Fight: Fights First units first (chargers), then players alternate picking units. Each model fights with one melee weapon plus any [EXTRA ATTACKS] weapons, against enemies within 2".',
    'Consolidate: up to 3" towards the closest enemy, or onto an objective within 3".',
  ],
};

export function Coach({ game }: { game: Game }) {
  const s = game.state;
  const mine = s.active === 'player';
  const when = PHASE_TO_WHEN[s.phase];
  const turn = mine ? 'yours' : 'opponents';
  const myUnits = game.unitsOf('player').filter((u) => onBoard(u) || u.status === 'reserves');

  // Unit abilities that matter in this phase and turn (from the plain-English notes).
  const reminders: { unit: string; ability: string; text: string }[] = [];
  if (when) {
    const seen = new Set<string>();
    for (const u of myUnits) {
      for (const m of u.members) {
        const d = BUNDLES.tyranids.datasheetById.get(m.datasheetId);
        if (!d) continue;
        for (const a of [...d.abilities.datasheet, ...d.abilities.other]) {
          const note = tyranidCuration.abilityNote(d.name, a.name);
          if (!note || !note.when.includes(when) || (note.turn && note.turn !== turn)) continue;
          const key = `${d.name}|${a.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          reminders.push({ unit: d.name, ability: a.name, text: note.summary });
        }
      }
    }
    for (const id of s.armies.player.detachmentIds) {
      const det = BUNDLES.tyranids.detachmentById.get(id);
      for (const rule of det?.abilities ?? []) {
        const note = tyranidCuration.detachmentNote(rule.name);
        if (note && note.when.includes(when) && (!note.turn || note.turn === turn)) reminders.push({ unit: det!.name, ability: rule.name, text: note.summary });
      }
    }
  }

  const held = s.objectives.filter((o) => o === 'player').length;
  const due = game.battleShockDue('player');
  const shocksDone = s.checklist.filter((c) => c.startsWith('shock:')).length;

  return (
    <div className="coach">
      <h3>
        Coach · {mine ? 'your' : 'Ultramarines'} {phaseName(s.phase)} phase
      </h3>
      {s.phase === 'command' && mine ? (
        <>
          <div className="check done">
            <span className="box" />
            <span>Gain 1 CP (both players, done for you). You have {s.cp.player} CP.</span>
          </div>
          <div className={due.length === 0 ? 'check done' : 'check'}>
            <span className="box" />
            <span>
              Battle-shock tests for units that are battle-shocked or at/below half-strength
              {due.length > 0 ? `: ${due.map((u) => u.name).join(', ')}` : shocksDone > 0 ? ' (done)' : ' (none needed)'}.
            </span>
          </div>
          <div className={s.checklist.includes('abilities') ? 'check done' : 'check'}>
            <span className="box" />
            <span>
              Use Command phase abilities and stratagems (below), and decide whether to unleash the Shadow in the Warp
              {game.canUnleashShadow('player') ? ' (still available)' : ' (used)'}.
            </span>
          </div>
          <div className="check">
            <span className="box" />
            <span>
              {s.round >= 2
                ? `End of phase: you score ${Math.min(MAX_PRIMARY_PER_TURN, held * VP_PER_OBJECTIVE)} VP for the ${held} objective${held === 1 ? '' : 's'} you hold (5 VP each, max 15).`
                : 'No objective scoring in battle round 1.'}
            </span>
          </div>
        </>
      ) : null}
      {s.phase === 'command' && !mine ? (
        <span className="small">
          The Ultramarines gain CP and take their battle-shock tests. {game.canUnleashShadow('player') ? 'You can unleash the Shadow in the Warp in their Command phase too.' : ''}
        </span>
      ) : null}
      {mine && STEPS[s.phase]?.map((t, i) => (
        <div key={i} className="check">
          <span className="box" style={{ borderRadius: 999 }} />
          <span>{t}</span>
        </div>
      ))}
      {reminders.length > 0 ? (
        <div className="col" style={{ gap: 4 }}>
          <b className="small" style={{ color: 'var(--gold)' }}>
            Abilities that matter now
          </b>
          {reminders.map((r, i) => (
            <div key={i} className="rule small">
              <b>
                {r.ability} ({r.unit}).
              </b>{' '}
              {r.text}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
