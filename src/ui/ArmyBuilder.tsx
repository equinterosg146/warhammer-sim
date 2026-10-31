import { useMemo, useState } from 'react';

import { tyranids } from '../data/bundles';
import type { Datasheet } from '../data/types';
import {
  bodyguardChoices,
  copyNumbers,
  enhancementChoices,
  listDetachmentPoints,
  listPoints,
  MAX_DETACHMENT_POINTS,
  POINTS_LIMITS,
  tierFor,
  unitLabels,
  unitPoints,
  validateList,
  type ArmyList,
  type ListUnit,
} from '../rules/army';
import { unitModels } from '../rules/effects';
import { checkLoadout, defaultLoadout, hasWeaponChoices, weaponChoices } from '../rules/loadout';
import { newUid } from './store';
import { UnitTags } from './UnitTags';

const bundle = tyranids;

function minPoints(d: Datasheet): number | null {
  const pts = d.costTiers[0]?.sizes.map((s) => s.points) ?? [];
  return pts.length > 0 ? Math.min(...pts) : null;
}

export function ArmyBuilder({ list, onChange, onDone }: { list: ArmyList; onChange: (l: ArmyList) => void; onDone: () => void }) {
  const [query, setQuery] = useState('');
  const labels = useMemo(() => unitLabels(bundle, list.units), [list.units]);
  const copies = copyNumbers(list.units);
  const points = listPoints(bundle, list);
  const dp = listDetachmentPoints(bundle, list);
  const warnings = validateList(bundle, list);
  const setUnit = (uid: string, change: Partial<ListUnit>) => onChange({ ...list, units: list.units.map((u) => (u.uid === uid ? { ...u, ...change } : u)) });
  const removeUnit = (uid: string) =>
    onChange({ ...list, units: list.units.filter((u) => u.uid !== uid).map((u) => (u.attachedTo === uid ? { ...u, attachedTo: null } : u)) });
  const addUnit = (d: Datasheet) => {
    const tier = tierFor(d, (list.units.filter((u) => u.datasheetId === d.id).length ?? 0) + 1);
    onChange({ ...list, units: [...list.units, { uid: newUid(), datasheetId: d.id, size: tier?.sizes[0]?.label ?? '1 model', wargearCounts: {}, enhancementId: null }] });
  };
  const toggleDetachment = (id: string) =>
    onChange({ ...list, detachmentIds: list.detachmentIds.includes(id) ? list.detachmentIds.filter((x) => x !== id) : [...list.detachmentIds, id] });

  const q = query.trim().toLowerCase();
  const available = bundle.datasheets.filter((d) => d.source.kind === 'core' && (q === '' || d.name.toLowerCase().includes(q)));

  return (
    <div className="screen col" style={{ gap: 16 }}>
      <div className="row">
        <input value={list.name} onChange={(e) => onChange({ ...list, name: e.target.value })} style={{ fontSize: 20, fontWeight: 700, flex: 1 }} />
        <select value={list.pointsLimit} onChange={(e) => onChange({ ...list, pointsLimit: Number(e.target.value) })}>
          {POINTS_LIMITS.map((p) => (
            <option key={p} value={p}>
              {p} pts
            </option>
          ))}
        </select>
        <b style={{ color: points > list.pointsLimit ? 'var(--danger)' : 'var(--bone)' }}>
          {points} / {list.pointsLimit} pts
        </b>
        <button className="primary" onClick={onDone}>
          Done
        </button>
      </div>

      <div className="card col">
        <div className="row">
          <h3 className="grow">Detachments</h3>
          <span className={dp > MAX_DETACHMENT_POINTS ? 'badge warn' : 'badge'}>
            {dp} / {MAX_DETACHMENT_POINTS} detachment points
          </span>
        </div>
        <div className="row">
          {bundle.detachments
            .filter((d) => !d.boardingActions)
            .map((d) => (
              <button key={d.id} className={list.detachmentIds.includes(d.id) ? 'selected small' : 'small'} onClick={() => toggleDetachment(d.id)} title={d.abilities.map((a) => a.name).join(', ')}>
                {d.name} ({d.dp ?? '?'} DP)
              </button>
            ))}
        </div>
        <span className="muted small">Pick the detachments to practise with. Their stratagems and enhancements become available in game.</span>
      </div>

      {warnings.length > 0 ? (
        <div className="card">
          <ul className="problems">
            {warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="builder">
        <div className="col">
          <h3>Units ({list.units.length})</h3>
          {list.units.length === 0 ? <div className="muted">Add units from the list on the right.</div> : null}
          {list.units.map((u) => {
            const d = bundle.datasheetById.get(u.datasheetId);
            if (!d) return null;
            const tier = tierFor(d, copies.get(u.uid) ?? 1);
            const bodyguards = bodyguardChoices(bundle, list, u);
            const enhancements = enhancementChoices(bundle, list, d.id);
            const models = unitModels(u);
            const loadout = u.loadout ?? defaultLoadout(d, models);
            const check = checkLoadout(d, models, loadout);
            return (
              <div key={u.uid} className="card col" style={{ gap: 6 }}>
                <div className="row">
                  <div className="grow col" style={{ gap: 2 }}>
                    <b>{labels.get(u.uid) ?? d.name}</b>
                    <UnitTags datasheet={d} />
                  </div>
                  <b style={{ color: 'var(--bone)' }}>{unitPoints(bundle, u, copies.get(u.uid) ?? 1)} pts</b>
                  <button className="danger small" onClick={() => removeUnit(u.uid)}>
                    Remove
                  </button>
                </div>
                <div className="row small">
                  {tier && tier.sizes.length > 1 ? (
                    <select value={u.size} onChange={(e) => setUnit(u.uid, { size: e.target.value, loadout: null })}>
                      {tier.sizes.map((s) => (
                        <option key={s.label} value={s.label}>
                          {s.label} ({s.points} pts)
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted">{u.size}</span>
                  )}
                  {bodyguards.length > 0 || u.attachedTo ? (
                    <label className="row" style={{ gap: 4 }}>
                      Leads
                      <select value={u.attachedTo ?? ''} onChange={(e) => setUnit(u.uid, { attachedTo: e.target.value || null })}>
                        <option value="">nobody</option>
                        {bodyguards.map((b) => (
                          <option key={b.uid} value={b.uid}>
                            {labels.get(b.uid)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {enhancements.length > 0 ? (
                    <label className="row" style={{ gap: 4 }}>
                      Enhancement
                      <select value={u.enhancementId ?? ''} onChange={(e) => setUnit(u.uid, { enhancementId: e.target.value || null })}>
                        <option value="">none</option>
                        {enhancements.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name} (+{e.cost})
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                {hasWeaponChoices(d) ? (
                  <div className="col" style={{ gap: 4 }}>
                    <span className="muted small">Weapons (how many models carry each)</span>
                    <div className="row small">
                      {weaponChoices(d).map((c) => (
                        <span key={c.key} className="row" style={{ gap: 3, background: 'var(--surface-2)', borderRadius: 6, padding: '2px 4px' }}>
                          {c.name}
                          <button className="small ghost" onClick={() => setUnit(u.uid, { loadout: { ...loadout, [c.key]: Math.max(0, (loadout[c.key] ?? 0) - 1) } })}>
                            −
                          </button>
                          <b>{loadout[c.key] ?? 0}</b>
                          <button className="small ghost" onClick={() => setUnit(u.uid, { loadout: { ...loadout, [c.key]: (loadout[c.key] ?? 0) + 1 } })}>
                            +
                          </button>
                        </span>
                      ))}
                    </div>
                    {check.problems.length > 0 ? (
                      <ul className="problems">
                        {check.problems.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="card col">
          <h3>Add a unit</h3>
          <input placeholder="Search Tyranid units" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="datasheet-pick">
            {available.map((d) => (
              <button key={d.id} className="unit-row" onClick={() => addUnit(d)}>
                <span className="col" style={{ gap: 2, alignItems: 'flex-start' }}>
                  <span>{d.name}</span>
                  <UnitTags datasheet={d} compact />
                </span>
                <span className="muted small">{minPoints(d) ?? '?'} pts</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
