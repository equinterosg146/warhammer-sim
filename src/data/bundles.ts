import spaceMarinesRaw from './generated/spaceMarines.json';
import tyranidsRaw from './generated/tyranids.json';
import { makeCuration } from './curation';
import type { Bundle, Datasheet, Detachment, Enhancement, Stratagem } from './types';

export interface IndexedBundle extends Bundle {
  datasheetById: Map<string, Datasheet>;
  detachmentById: Map<string, Detachment>;
  enhancementById: Map<string, Enhancement>;
  stratagemById: Map<string, Stratagem>;
}

export function indexBundle(bundle: Bundle): IndexedBundle {
  const index = <T extends { id: string }>(items: T[]) => new Map(items.map((item) => [item.id, item]));
  return {
    ...bundle,
    datasheetById: index(bundle.datasheets),
    detachmentById: index(bundle.detachments),
    enhancementById: index(bundle.enhancements),
    stratagemById: index(bundle.stratagems),
  };
}

export const tyranids: IndexedBundle = indexBundle(tyranidsRaw as unknown as Bundle);
export const spaceMarines: IndexedBundle = indexBundle(spaceMarinesRaw as unknown as Bundle);

export type FactionKey = 'tyranids' | 'spaceMarines';
export const BUNDLES: Record<FactionKey, IndexedBundle> = { tyranids, spaceMarines };

/** Plain-English notes for Tyranid abilities, checked against the current rules text. */
export const tyranidCuration = makeCuration(tyranids);
