// Keeps hand-written content (plain-English notes, buff tables) honest across rules updates.
// Every curated entry points at the official text it was written against. `stamps.json` records a
// fingerprint of that text; when a data update changes the wording, the entry stops being "current"
// and the app falls back to the official text alone until the entry is reviewed and re-stamped.
import stamps from './stamps.json';
import { ABILITY_NOTES, ARMY_NOTES, DETACHMENT_NOTES, type Note } from './notes';
import type { Bundle, Rich } from './types';

export function plainText(nodes: Rich): string {
  return nodes
    .map((n): string => {
      switch (n.t) {
        case 'text':
          return n.v;
        case 'br':
          return ' ';
        case 'ul':
          return ' ' + n.items.map(plainText).join(' ') + ' ';
        case 'table':
          return ' ' + n.rows.map((r) => r.map(plainText).join(' ')).join(' ') + ' ';
        default:
          return plainText(n.c);
      }
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Small, stable fingerprint of a rule's wording. */
export function fingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

export const abilityKey = (datasheetName: string, abilityName: string) => `ability:${datasheetName}::${abilityName}`;
export const detachmentKey = (ruleName: string) => `detachment:${ruleName}`;
export const enhancementKey = (name: string) => `enhancement:${name}`;
export const armyKey = (name: string) => `army:${name}`;

/** Official wording of every rule that curated content can point at, by key. */
export function sourceTexts(bundle: Bundle): Map<string, string> {
  const texts = new Map<string, string>();
  for (const d of bundle.datasheets) {
    for (const a of [...d.abilities.datasheet, ...d.abilities.other]) texts.set(abilityKey(d.name, a.name), plainText(a.text));
    for (const a of d.abilities.faction) texts.set(armyKey(a.name), plainText(a.text));
  }
  for (const d of bundle.detachments) for (const a of d.abilities) texts.set(detachmentKey(a.name), plainText(a.text));
  for (const e of bundle.enhancements) texts.set(enhancementKey(e.name), plainText(e.text));
  return texts;
}

export type Stamps = Record<string, string>;

/** Checks curated keys against the bundle. A key is current when its text still matches its stamp. */
export function makeCuration(bundle: Bundle, stamped: Stamps = stamps as Stamps) {
  const texts = sourceTexts(bundle);
  const isCurrent = (key: string) => {
    const text = texts.get(key);
    return text !== undefined && stamped[key] === fingerprint(text);
  };
  return {
    isCurrent,
    /** The plain-English note for a unit ability, if one exists and is still current. */
    abilityNote(datasheetName: string, abilityName: string): Note | undefined {
      const note = ABILITY_NOTES[`${datasheetName}::${abilityName}`] ?? ABILITY_NOTES[abilityName];
      return note && isCurrent(abilityKey(datasheetName, abilityName)) ? note : undefined;
    },
    detachmentNote(ruleName: string): Note | undefined {
      const note = DETACHMENT_NOTES[ruleName];
      return note && isCurrent(detachmentKey(ruleName)) ? note : undefined;
    },
    armyNote(ruleName: string): Note | undefined {
      const note = ARMY_NOTES[ruleName];
      return note && isCurrent(armyKey(ruleName)) ? note : undefined;
    },
  };
}

export type Curation = ReturnType<typeof makeCuration>;

/** Rules whose wording no longer matches its stamp, or that have never been stamped. */
export function staleKeys(bundle: Bundle, stamped: Stamps = stamps as Stamps): { changed: string[]; unstamped: string[] } {
  const changed: string[] = [];
  const unstamped: string[] = [];
  for (const [key, text] of sourceTexts(bundle)) {
    if (stamped[key] === undefined) unstamped.push(key);
    else if (stamped[key] !== fingerprint(text)) changed.push(key);
  }
  return { changed, unstamped };
}
