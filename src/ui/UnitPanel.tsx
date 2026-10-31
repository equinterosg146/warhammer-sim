import { useState } from 'react';

import { BUNDLES, tyranidCuration } from '../data/bundles';
import type { Ability } from '../data/types';
import { weaponAbilities } from '../engine/attacks';
import type { Game } from '../engine/game';
import { buffNotes, modsFor, unitBuffs, withinSynapseRange } from '../engine/modifiers';
import { aliveModels, type UnitState } from '../engine/state';
import { modelWeapons, strengthOfUnit } from '../engine/units';
import { RichText } from './RichText';
import { UnitTags } from './UnitTags';

const STRENGTH = { full: '', belowStarting: 'Below Starting Strength', half: 'At half-strength', belowHalf: 'Below Half-strength', destroyed: 'Destroyed' };

function AbilityLine({ datasheetName, ability, tyranid }: { datasheetName: string; ability: Ability; tyranid: boolean }) {
  const [open, setOpen] = useState(false);
  const note = tyranid ? tyranidCuration.abilityNote(datasheetName, ability.name) : undefined;
  const title = ability.parameter ? `${ability.name} ${ability.parameter}` : ability.name;
  return (
    <div className="rule">
      <b>{title}.</b> {note ? note.summary : null}{' '}
      <button className="link" onClick={() => setOpen((v) => !v)}>
        {open ? 'hide official text' : note ? 'official text' : 'show rule'}
      </button>
      {open ? (
        <div className="small muted" style={{ marginTop: 4 }}>
          <RichText nodes={ability.text} />
        </div>
      ) : null}
    </div>
  );
}

export function UnitPanel({ game, unit }: { game: Game; unit: UnitState }) {
  const s = game.state;
  const bundle = BUNDLES[unit.faction];
  const alive = aliveModels(unit);
  const strength = strengthOfUnit(unit);
  const buffs = unitBuffs(s, unit);
  const effects = s.effects.filter((e) => e.unitId === unit.id);
  const notes = buffNotes(s, unit);

  return (
    <div className="card col" style={{ gap: 8 }}>
      <div className="col" style={{ gap: 3 }}>
        <div className="row">
          <b style={{ fontSize: 17 }} className="grow">
            {unit.name}
          </b>
          <span className={unit.owner === 'player' ? 'badge synapse' : 'badge marine'}>{unit.owner === 'player' ? 'YOURS' : 'ENEMY'}</span>
        </div>
        <span className="muted small">
          {alive.length} / {unit.startingStrength} models {STRENGTH[strength] ? `· ${STRENGTH[strength]}` : ''}
          {unit.battleShocked ? ' · BATTLE-SHOCKED (OC 0, no stratagems)' : ''}
          {unit.faction === 'tyranids' && unit.status === 'onBoard' ? (withinSynapseRange(s, unit) ? ' · within Synapse Range' : ' · OUT of Synapse Range') : ''}
        </span>
      </div>

      {unit.members.map((member, mi) => {
        const d = bundle.datasheetById.get(member.datasheetId);
        if (!d) return null;
        const models = alive.filter((m) => m.member === mi);
        if (models.length === 0)
          return (
            <div key={mi} className="muted small">
              {d.name}: destroyed
            </div>
          );
        const mods = modsFor(s, unit, models[0]);
        const moveBonus = mods.reduce((x, m) => x + (m.kind === 'move' ? m.delta : 0), 0);
        const inv = Math.min(...mods.filter((m) => m.kind === 'invuln').map((m) => (m as { value: number }).value), 7);
        const fnp = Math.min(...mods.filter((m) => m.kind === 'fnp').map((m) => (m as { value: number }).value), 7);
        const profiles = [...new Set(models.map((m) => m.profile))];
        // Live weapon counts across this member's models.
        const weapons = new Map<string, { name: string; count: number; w: ReturnType<typeof modelWeapons>[number] }>();
        for (const m of models) for (const w of modelWeapons(unit, m)) {
          const entry = weapons.get(w.weapon.name) ?? { name: w.weapon.name, count: 0, w };
          entry.count += w.count;
          weapons.set(w.weapon.name, entry);
        }
        return (
          <div key={mi} className="col" style={{ gap: 6 }}>
            {unit.members.length > 1 ? <b style={{ color: 'var(--bone)' }}>{d.name}</b> : null}
            <UnitTags datasheet={d} />
            {profiles.map((p) => {
              const prof = d.models[p] ?? d.models[0];
              const printedInv = prof.invSv && prof.invSv !== '-' ? Number(prof.invSv) : 7;
              const shownInv = Math.min(printedInv, inv);
              const printedFnp = Number(d.abilities.core.find((a) => /feel no pain/i.test(a.name))?.parameter.replace(/\D/g, '') || 7);
              const shownFnp = Math.min(printedFnp, fnp);
              const ws = models.filter((m) => m.profile === p).map((m) => m.w);
              return (
                <div key={p} className="col" style={{ gap: 3 }}>
                  {profiles.length > 1 ? <span className="muted small">{prof.name}</span> : null}
                  <div className="stats">
                    <div className={moveBonus ? 'stat buffed' : 'stat'}>
                      <span>M</span>
                      <b>{Number(prof.M.replace(/\D/g, '')) + moveBonus}"</b>
                    </div>
                    <div className="stat">
                      <span>T</span>
                      <b>{prof.T}</b>
                    </div>
                    <div className="stat">
                      <span>SV</span>
                      <b>{prof.Sv}</b>
                    </div>
                    <div className="stat">
                      <span>W</span>
                      <b>{prof.W}</b>
                    </div>
                    <div className="stat">
                      <span>LD</span>
                      <b>{prof.Ld}</b>
                    </div>
                    <div className="stat">
                      <span>OC</span>
                      <b>{unit.battleShocked ? 0 : prof.OC}</b>
                    </div>
                    <div className={shownInv < printedInv ? 'stat buffed' : 'stat'}>
                      <span>INV</span>
                      <b>{shownInv < 7 ? `${shownInv}+` : '-'}</b>
                    </div>
                    <div className={shownFnp < printedFnp ? 'stat buffed' : 'stat'}>
                      <span>FNP</span>
                      <b>{shownFnp < 7 ? `${shownFnp}+` : '-'}</b>
                    </div>
                  </div>
                  {Number(prof.W) > 1 ? <span className="small muted">Wounds left: {ws.join(', ')}</span> : null}
                </div>
              );
            })}
            {weapons.size > 0 ? (
              <table className="weapon-table">
                <thead>
                  <tr>
                    <th>Weapon</th>
                    <th>Range</th>
                    <th>A</th>
                    <th>BS/WS</th>
                    <th>S</th>
                    <th>AP</th>
                    <th>D</th>
                  </tr>
                </thead>
                <tbody>
                  {[...weapons.values()].map(({ name, count, w }) => (
                    <tr key={name}>
                      <td>
                        <span className="count-pill">{count}×</span>
                        {name}
                        {w.weapon.keywords.length > 0 ? <div className="kw">{w.weapon.keywords.join(', ').toUpperCase()}</div> : null}
                      </td>
                      <td>{w.ranged ? `${w.weapon.range}"` : 'Melee'}</td>
                      <td>{w.weapon.A}</td>
                      <td>{weaponAbilities(w.weapon.keywords).has('torrent') ? 'N/A' : `${w.weapon.skill}+`}</td>
                      <td>{w.weapon.S}</td>
                      <td>{w.weapon.AP}</td>
                      <td>{w.weapon.D}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {[...d.abilities.datasheet, ...d.abilities.other].map((a) => (
              <AbilityLine key={a.name} datasheetName={d.name} ability={a} tyranid={unit.faction === 'tyranids'} />
            ))}
            {d.abilities.core.length > 0 ? (
              <span className="small muted">
                <b>Core:</b> {d.abilities.core.map((a) => (a.parameter ? `${a.name} ${a.parameter}` : a.name)).join(', ')}
              </span>
            ) : null}
          </div>
        );
      })}

      {buffs.some((b) => b.active) || effects.length > 0 || notes.length > 0 ? (
        <div className="col" style={{ gap: 3, border: '1px solid var(--buff)', borderRadius: 8, padding: 8 }}>
          <b style={{ color: 'var(--buff)', fontSize: 12, letterSpacing: '0.08em' }}>WHAT IS CHANGING THIS UNIT</b>
          {buffs
            .filter((b) => b.active)
            .map((b) => (
              <span key={b.effect.id} className="small">
                <b>{b.effect.label}</b> <span className="muted">· {b.effect.source}</span>
              </span>
            ))}
          {effects.map((e) => (
            <span key={e.id} className="small">
              <b>{e.label}</b> <span className="muted">· {e.source}</span>
            </span>
          ))}
          {notes.map((n, i) => (
            <span key={i} className="small" style={{ color: 'var(--buff)' }}>
              {n}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
