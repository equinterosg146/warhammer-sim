import type { Datasheet } from '../data/types';

const TYPE_KEYWORDS = ['Monster', 'Vehicle', 'Infantry', 'Beast', 'Swarm', 'Mounted', 'Character', 'Epic Hero', 'Aircraft', 'Fortification'];
const isType = (k: string) => TYPE_KEYWORDS.some((t) => t.toLowerCase() === k.toLowerCase());

export const isSynapse = (d: Datasheet) => d.keywords.some((k) => k.toLowerCase() === 'synapse');

/** Synapse badge, unit type badges, then the other keywords. */
export function UnitTags({ datasheet, compact = false }: { datasheet: Datasheet; compact?: boolean }) {
  const types = TYPE_KEYWORDS.filter((t) => datasheet.keywords.some((k) => k.toLowerCase() === t.toLowerCase()));
  const others = datasheet.keywords.filter((k) => !isType(k) && k.toLowerCase() !== 'synapse' && k.toLowerCase() !== datasheet.name.toLowerCase());
  return (
    <span className="row" style={{ gap: 4 }}>
      {isSynapse(datasheet) ? <span className="badge synapse">SYNAPSE</span> : null}
      {types.map((t) => (
        <span key={t} className="badge type">
          {t.toUpperCase()}
        </span>
      ))}
      {!compact && others.length > 0 ? <span className="kw">{others.map((k) => k.toUpperCase()).join(' · ')}</span> : null}
    </span>
  );
}
