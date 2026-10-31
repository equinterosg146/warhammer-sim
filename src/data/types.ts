// Shape of the generated rules bundle. Shared by scripts/build-data and the app.

export type RichNode =
  | { t: 'text'; v: string }
  | { t: 'b' | 'i' | 'u' | 'kw'; c: RichNode[] }
  | { t: 'br' }
  | { t: 'p'; c: RichNode[] }
  | { t: 'ul'; items: RichNode[][] }
  | { t: 'table'; rows: RichNode[][][] };

export type Rich = RichNode[];

export type SourceKind = 'core' | 'legends' | 'forgeworld';

export interface StatLine {
  name: string;
  M: string;
  T: string;
  Sv: string;
  invSv: string;
  invSvNote: string;
  W: string;
  Ld: string;
  OC: string;
  baseSize: string;
}

export interface Weapon {
  name: string;
  range: string;
  A: string;
  skill: string;
  S: string;
  AP: string;
  D: string;
  keywords: string[];
}

export interface Ability {
  name: string;
  text: Rich;
  /** e.g. "D3" for Deadly Demise D3, "5+" for Feel No Pain 5+ */
  parameter: string;
}

export interface CostSize {
  /** null when the row is not "<n> models" */
  models: number | null;
  label: string;
  points: number;
}

export interface CostTier {
  fromCopy: number;
  /** null = this copy and every later one */
  toCopy: number | null;
  label: string;
  sizes: CostSize[];
}

export interface WargearCost {
  name: string;
  points: number;
}

export interface Datasheet {
  id: string;
  name: string;
  role: string;
  legend: string;
  source: { name: string; kind: SourceKind };
  loadout: Rich;
  transport: Rich;
  damaged: { w: string; text: Rich } | null;
  keywords: string[];
  factionKeywords: string[];
  models: StatLine[];
  ranged: Weapon[];
  melee: Weapon[];
  abilities: { core: Ability[]; faction: Ability[]; datasheet: Ability[]; other: Ability[] };
  composition: Rich[];
  options: Rich[];
  costTiers: CostTier[];
  wargearCosts: WargearCost[];
  leads: string[];
  ledBy: string[];
  leaderHead: Rich;
  leaderFooter: Rich;
  stratagemIds: string[];
  enhancementIds: string[];
}

export interface DetachmentAbility {
  name: string;
  legend: string;
  text: Rich;
}

export interface Detachment {
  id: string;
  name: string;
  dp: number | null;
  disposition: string;
  boardingActions: boolean;
  legend: string;
  abilities: DetachmentAbility[];
  enhancementIds: string[];
  stratagemIds: string[];
}

export interface Enhancement {
  id: string;
  name: string;
  cost: number;
  detachmentId: string;
  isUpgrade: boolean;
  legend: string;
  text: Rich;
  eligibleDatasheetIds: string[];
}

export type StratagemCategory =
  | 'detachment'
  | 'core'
  | 'coreLegacy'
  | 'mission'
  | 'coreAction'
  | 'challenger'
  | 'boardingActions';

export interface Stratagem {
  id: string;
  name: string;
  category: StratagemCategory;
  type: string;
  cp: number | null;
  turn: string;
  phase: string;
  detachmentId: string | null;
  legend: string;
  text: Rich;
}

export interface Meta {
  lastUpdate: string;
  /** Where unit and enhancement points came from, e.g. "Munitorum Field Manual v1.5 (PDF)". */
  pointsSource: string;
  generatedAt: string;
  factionId: string;
  counts: Record<string, number>;
}

export interface Bundle {
  meta: Meta;
  datasheets: Datasheet[];
  detachments: Detachment[];
  enhancements: Enhancement[];
  stratagems: Stratagem[];
}
