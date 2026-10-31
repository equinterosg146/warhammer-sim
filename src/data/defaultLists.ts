// The computer opponent's army and a starter list for the player.
import type { ArmyList, ListUnit } from '../rules/army';
import { listPoints } from '../rules/army';
import { spaceMarines, tyranids, type IndexedBundle } from './bundles';

const CHAPTERS = ['Black Templars', 'Blood Angels', 'Dark Angels', 'Space Wolves', 'Deathwatch'];

/** Finds a datasheet by name, preferring the codex version over chapter-specific copies. */
export function datasheetIdByName(bundle: IndexedBundle, name: string): string {
  const matches = bundle.datasheets.filter((d) => d.name === name);
  const plain = matches.find((d) => !d.factionKeywords.some((k) => CHAPTERS.includes(k))) ?? matches[0];
  if (!plain) throw new Error(`Datasheet "${name}" is not in the rules data`);
  return plain.id;
}

const detachmentIdByName = (bundle: IndexedBundle, name: string) => {
  const d = bundle.detachments.find((x) => x.name === name);
  if (!d) throw new Error(`Detachment "${name}" is not in the rules data`);
  return d.id;
};

function unit(bundle: IndexedBundle, uid: string, name: string, size: string, attachedTo?: string): ListUnit {
  return { uid, datasheetId: datasheetIdByName(bundle, name), size, wargearCounts: {}, enhancementId: null, attachedTo: attachedTo ?? null };
}

/** 2000 points of Ultramarines in the Blade of Ultramar detachment. */
export function ultramarinesList(): ArmyList {
  const b = spaceMarines;
  const list: ArmyList = {
    id: -1,
    name: 'Ultramarines Strike Force',
    pointsLimit: 2000,
    isActive: false,
    detachmentIds: [detachmentIdByName(b, 'Blade of Ultramar')],
    units: [
      unit(b, 'um-calgar', 'Marneus Calgar', '1 model', 'um-int-a'),
      unit(b, 'um-int-a', 'Intercessor Squad', '10 models'),
      unit(b, 'um-captain', 'Captain', '1 model', 'um-assault'),
      unit(b, 'um-assault', 'Assault Intercessor Squad', '10 models'),
      unit(b, 'um-lt', 'Lieutenant', '1 model', 'um-hellblasters'),
      unit(b, 'um-hellblasters', 'Hellblaster Squad', '5 models'),
      unit(b, 'um-librarian', 'Librarian', '1 model', 'um-int-b'),
      unit(b, 'um-int-b', 'Intercessor Squad', '5 models'),
      unit(b, 'um-infernus', 'Infernus Squad', '5 models'),
      unit(b, 'um-aggressors', 'Aggressor Squad', '3 models'),
      unit(b, 'um-bladeguard', 'Bladeguard Veteran Squad', '3 models'),
      unit(b, 'um-heavy', 'Heavy Intercessor Squad', '5 models'),
      unit(b, 'um-scouts', 'Scout Squad', '5 models'),
      unit(b, 'um-inceptors', 'Inceptor Squad', '3 models'),
      unit(b, 'um-redemptor', 'Redemptor Dreadnought', '1 model'),
      unit(b, 'um-lancer', 'Gladiator Lancer', '1 model'),
      unit(b, 'um-ballistus', 'Ballistus Dreadnought', '1 model'),
    ],
  };
  return list;
}

/** A starter Tyranid list so a first game can begin straight away; the player can edit it. */
export function starterTyranidList(): ArmyList {
  const b = tyranids;
  return {
    id: 1,
    name: 'My Tyranids',
    pointsLimit: 2000,
    isActive: true,
    detachmentIds: [detachmentIdByName(b, 'Invasion Fleet')],
    units: [
      unit(b, 'ty-tyrant', 'Hive Tyrant', '1 model'),
      unit(b, 'ty-neuro', 'Neurotyrant', '1 model', 'ty-zoans'),
      unit(b, 'ty-zoans', 'Zoanthropes', '3 models'),
      unit(b, 'ty-prime', 'Winged Tyranid Prime', '1 model', 'ty-warriors'),
      unit(b, 'ty-warriors', 'Tyranid Warriors With Melee Bio-weapons', '6 models'),
      unit(b, 'ty-gaunts-a', 'Termagants', '20 models'),
      unit(b, 'ty-gaunts-b', 'Termagants', '10 models'),
      unit(b, 'ty-horma', 'Hormagaunts', '20 models'),
      unit(b, 'ty-guard', 'Hive Guard', '3 models'),
      unit(b, 'ty-carnifex', 'Carnifexes', '2 models'),
      unit(b, 'ty-maleceptor', 'Maleceptor', '1 model'),
      unit(b, 'ty-exocrine', 'Exocrine', '1 model'),
      unit(b, 'ty-lictor', 'Lictor', '1 model'),
      unit(b, 'ty-stealers', 'Genestealers', '10 models'),
    ],
  };
}

export const pointsOf = (bundle: IndexedBundle, list: ArmyList) => listPoints(bundle, list);
