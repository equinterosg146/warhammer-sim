import type {
  Ability,
  Bundle,
  Datasheet,
  Detachment,
  Enhancement,
  SourceKind,
  Stratagem,
  StratagemCategory,
  Weapon,
} from '../../src/data/types';
import { parseCosts } from './costs';
import { requireColumns, type Row, type Table } from './csv';
import { htmlToRich, richToText } from './html';

/** Every file the build reads, with the columns it depends on. */
export const REQUIRED: Record<string, string[]> = {
  Factions: ['id', 'name'],
  Source: ['id', 'name'],
  Last_update: ['last_update'],
  Datasheets: [
    'id', 'name', 'faction_id', 'source_id', 'legend', 'role', 'loadout', 'transport', 'virtual',
    'leader_head', 'leader_footer', 'damaged_w', 'damaged_description',
  ],
  Datasheets_models: ['datasheet_id', 'line', 'name', 'M', 'T', 'Sv', 'inv_sv', 'inv_sv_descr', 'W', 'Ld', 'OC', 'base_size'],
  Datasheets_wargear: ['datasheet_id', 'line', 'line_in_wargear', 'name', 'description', 'range', 'type', 'A', 'BS_WS', 'S', 'AP', 'D'],
  Datasheets_abilities: ['datasheet_id', 'line', 'ability_id', 'name', 'description', 'type', 'parameter'],
  Abilities: ['id', 'name', 'faction_id', 'description'],
  Datasheets_keywords: ['datasheet_id', 'keyword', 'is_faction_keyword'],
  Datasheets_unit_composition: ['datasheet_id', 'line', 'description'],
  Datasheets_options: ['datasheet_id', 'line', 'description'],
  Datasheets_models_cost: ['datasheet_id', 'line', 'description', 'cost'],
  Datasheets_leader: ['leader_id', 'attached_id'],
  Datasheets_stratagems: ['datasheet_id', 'stratagem_id'],
  Datasheets_enhancements: ['datasheet_id', 'enhancement_id'],
  Detachments: ['id', 'faction_id', 'name', 'legend', 'type', 'dp', 'force_disposition'],
  Detachment_abilities: ['id', 'faction_id', 'name', 'legend', 'description', 'detachment_id'],
  Enhancements: ['faction_id', 'name', 'id', 'cost', 'detachment_id', 'upgrade', 'legend', 'description'],
  Stratagems: ['faction_id', 'name', 'id', 'type', 'cp_cost', 'legend', 'turn', 'phase', 'detachment_id', 'description'],
};

export interface BuildResult {
  bundle: Bundle;
  warnings: string[];
}

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  for (const row of rows) {
    const list = map.get(row[key]);
    if (list) list.push(row);
    else map.set(row[key], [row]);
  }
  return map;
}

const byLine = (a: Row, b: Row) =>
  Number(a.line) - Number(b.line) || Number(a.line_in_wargear ?? 0) - Number(b.line_in_wargear ?? 0);

const plain = (html: string) => richToText(htmlToRich(html));

function sourceKind(name: string): SourceKind {
  if (/legends/i.test(name)) return 'legends';
  if (/forge world/i.test(name)) return 'forgeworld';
  return 'core';
}

function stratagemCategory(row: Row): StratagemCategory {
  if (row.faction_id !== '') return 'detachment';
  if (/^Boarding Actions/i.test(row.type)) return 'boardingActions';
  if (/^Challenger/i.test(row.type)) return 'challenger';
  if (/Ability$/i.test(row.type)) return 'coreAction';
  // The export carries two core sets with no edition column. Ids and wording show that plain
  // "Core Stratagem" rows are the current set and "Core – <type> Stratagem" rows the earlier one.
  if (/^Core Stratagem$/i.test(row.type)) return 'core';
  if (/^Core Stratagem /i.test(row.type)) return 'mission';
  return 'coreLegacy';
}

/** Builds the rules bundle for one faction (e.g. "Tyranids", "Space Marines"), plus the shared core stratagems. */
export function buildBundle(tables: Record<string, Table>, generatedAt: string, factionName: string): BuildResult {
  for (const [name, columns] of Object.entries(REQUIRED)) {
    const table = tables[name];
    if (!table) throw new Error(`Missing file ${name}.csv in data/raw`);
    requireColumns(table, columns);
  }
  const t = (name: string) => tables[name].rows;
  const warnings: string[] = [];
  const csvManualVersion =
    t('Source').find((s) => /munitorum field manual/i.test(s.name) && (s.edition ?? '') !== '10')?.version ?? '';
  const pointsSource = `Wahapedia CSV${csvManualVersion ? ` (Field Manual v${csvManualVersion})` : ''}`;

  const faction = t('Factions').find((f) => f.name === factionName);
  if (!faction) throw new Error(`Faction "${factionName}" not found in Factions.csv`);
  const factionId = faction.id;

  const sources = new Map(t('Source').map((s) => [s.id, s.name]));
  const sheetRows = t('Datasheets').filter((d) => d.faction_id === factionId && d.virtual !== 'true');
  const sheetIds = new Set(sheetRows.map((d) => d.id));

  // Stratagems: this faction's plus shared ones (no faction).
  // Shared rows are sometimes repeated word for word (one per mission pack); keep the first.
  const seenShared = new Set<string>();
  const stratagems: Stratagem[] = t('Stratagems')
    .filter((s) => s.faction_id === factionId || s.faction_id === '')
    .filter((s) => {
      if (s.faction_id !== '') return true;
      const key = `${s.name}|${s.type}|${s.description}`;
      if (seenShared.has(key)) return false;
      seenShared.add(key);
      return true;
    })
    .map((s) => ({
      id: s.id,
      name: s.name,
      category: stratagemCategory(s),
      type: s.type,
      cp: s.cp_cost === '' ? null : Number(s.cp_cost),
      turn: s.turn,
      phase: s.phase,
      detachmentId: s.detachment_id || null,
      legend: plain(s.legend),
      text: htmlToRich(s.description),
    }));
  const stratagemIds = new Set(stratagems.map((s) => s.id));

  const eligibleByEnhancement = groupBy(t('Datasheets_enhancements'), 'enhancement_id');
  const enhancements: Enhancement[] = t('Enhancements')
    .filter((e) => e.faction_id === factionId)
    .map((e) => ({ row: e, cost: Number(e.cost) || 0 }))
    .map(({ row: e, cost }) => ({
      id: e.id,
      name: e.name,
      cost,
      detachmentId: e.detachment_id,
      isUpgrade: e.upgrade === 'true',
      legend: plain(e.legend),
      text: htmlToRich(e.description),
      eligibleDatasheetIds: (eligibleByEnhancement.get(e.id) ?? [])
        .map((r) => r.datasheet_id)
        .filter((id) => sheetIds.has(id)),
    }));
  const enhancementIds = new Set(enhancements.map((e) => e.id));

  const detAbilities = groupBy(t('Detachment_abilities'), 'detachment_id');
  const detachments: Detachment[] = t('Detachments')
    .filter((d) => d.faction_id === factionId)
    .map((d) => ({
      id: d.id,
      name: d.name,
      dp: d.dp === '' ? null : Number(d.dp),
      disposition: d.force_disposition,
      boardingActions: /boarding actions/i.test(d.type),
      legend: plain(d.legend),
      abilities: (detAbilities.get(d.id) ?? []).map((a) => ({
        name: a.name,
        legend: plain(a.legend),
        text: htmlToRich(a.description),
      })),
      enhancementIds: enhancements.filter((e) => e.detachmentId === d.id).map((e) => e.id),
      stratagemIds: stratagems.filter((s) => s.detachmentId === d.id).map((s) => s.id),
    }));

  // Shared abilities: the same id can exist once per faction.
  const abilityRows = groupBy(t('Abilities'), 'id');
  const resolveAbility = (id: string): Row | undefined => {
    const rows = abilityRows.get(id) ?? [];
    return rows.find((r) => r.faction_id === factionId) ?? rows.find((r) => r.faction_id === '') ?? rows[0];
  };

  const models = groupBy(t('Datasheets_models'), 'datasheet_id');
  const wargear = groupBy(t('Datasheets_wargear'), 'datasheet_id');
  const abilities = groupBy(t('Datasheets_abilities'), 'datasheet_id');
  const keywords = groupBy(t('Datasheets_keywords'), 'datasheet_id');
  const composition = groupBy(t('Datasheets_unit_composition'), 'datasheet_id');
  const options = groupBy(t('Datasheets_options'), 'datasheet_id');
  const costs = groupBy(t('Datasheets_models_cost'), 'datasheet_id');
  const sheetStratagems = groupBy(t('Datasheets_stratagems'), 'datasheet_id');
  const sheetEnhancements = groupBy(t('Datasheets_enhancements'), 'datasheet_id');
  const leaderRows = t('Datasheets_leader').filter((l) => sheetIds.has(l.leader_id) && sheetIds.has(l.attached_id));

  const datasheets: Datasheet[] = sheetRows.map((d) => {
    const sorted = (map: Map<string, Row[]>) => [...(map.get(d.id) ?? [])].sort(byLine);

    const groups: Datasheet['abilities'] = { core: [], faction: [], datasheet: [], other: [] };
    for (const row of sorted(abilities)) {
      let ability: Ability;
      if (row.ability_id !== '') {
        const shared = resolveAbility(row.ability_id);
        if (!shared) {
          warnings.push(`${d.name}: ability ${row.ability_id} not found in Abilities.csv`);
          continue;
        }
        ability = { name: shared.name, text: htmlToRich(shared.description), parameter: row.parameter };
      } else {
        ability = { name: row.name, text: htmlToRich(row.description), parameter: row.parameter };
      }
      const type = row.type.toLowerCase();
      const group = type === 'core' ? 'core' : type === 'faction' ? 'faction' : type === 'datasheet' ? 'datasheet' : 'other';
      groups[group].push(ability);
    }

    const ranged: Weapon[] = [];
    const melee: Weapon[] = [];
    for (const row of sorted(wargear)) {
      const type = row.type.toLowerCase();
      if (type !== 'ranged' && type !== 'melee') continue;
      const weapon: Weapon = {
        name: row.name,
        range: row.range,
        A: row.A,
        skill: row.BS_WS,
        S: row.S,
        AP: row.AP,
        D: row.D,
        keywords: plain(row.description).split(',').map((k) => k.trim()).filter(Boolean),
      };
      (type === 'ranged' ? ranged : melee).push(weapon);
    }

    const kw = keywords.get(d.id) ?? [];
    const unique = (list: string[]) => [...new Set(list)];
    // Some factions' rows come repeated (each row twice, then the block again); drop the repeats.
    const costRows = sorted(costs)
      .map((r) => ({ description: r.description, cost: r.cost }))
      .filter((r, i, all) => i === 0 || r.description !== all[i - 1].description || r.cost !== all[i - 1].cost);
    const parsedRaw = parseCosts(costRows);
    const seenTiers = new Set<string>();
    const parsed = {
      ...parsedRaw,
      costTiers: parsedRaw.costTiers.filter((tier) => {
        const key = JSON.stringify([tier.fromCopy, tier.toCopy, tier.sizes]);
        if (tier.sizes.length === 0 || seenTiers.has(key)) return false;
        seenTiers.add(key);
        return true;
      }),
    };
    parsed.warnings.forEach((w) => warnings.push(`${d.name}: ${w}`));
    if (parsed.costTiers.every((tier) => tier.sizes.length === 0)) warnings.push(`${d.name}: no points cost found`);

    const sourceName = sources.get(d.source_id) ?? '';
    return {
      id: d.id,
      name: d.name,
      role: d.role,
      legend: plain(d.legend),
      source: { name: sourceName, kind: sourceKind(sourceName) },
      loadout: htmlToRich(d.loadout),
      transport: htmlToRich(d.transport),
      damaged: d.damaged_w ? { w: d.damaged_w, text: htmlToRich(d.damaged_description) } : null,
      keywords: unique(kw.filter((k) => k.is_faction_keyword !== 'true').map((k) => k.keyword)),
      factionKeywords: unique(kw.filter((k) => k.is_faction_keyword === 'true').map((k) => k.keyword)),
      models: sorted(models).map((m) => ({
        name: m.name,
        M: m.M,
        T: m.T,
        Sv: m.Sv,
        invSv: m.inv_sv,
        invSvNote: plain(m.inv_sv_descr),
        W: m.W,
        Ld: m.Ld,
        OC: m.OC,
        baseSize: m.base_size,
      })),
      ranged,
      melee,
      abilities: groups,
      composition: sorted(composition).map((c) => htmlToRich(c.description)),
      options: sorted(options).map((o) => htmlToRich(o.description)),
      costTiers: parsed.costTiers,
      wargearCosts: parsed.wargearCosts,
      leads: unique(leaderRows.filter((l) => l.leader_id === d.id).map((l) => l.attached_id)),
      ledBy: unique(leaderRows.filter((l) => l.attached_id === d.id).map((l) => l.leader_id)),
      leaderHead: htmlToRich(d.leader_head),
      leaderFooter: htmlToRich(d.leader_footer),
      stratagemIds: unique((sheetStratagems.get(d.id) ?? []).map((r) => r.stratagem_id).filter((id) => stratagemIds.has(id))),
      enhancementIds: unique((sheetEnhancements.get(d.id) ?? []).map((r) => r.enhancement_id).filter((id) => enhancementIds.has(id))),
    };
  });

  datasheets.sort((a, b) => a.name.localeCompare(b.name));
  detachments.sort((a, b) => Number(a.boardingActions) - Number(b.boardingActions) || a.name.localeCompare(b.name));

  const count = (category: StratagemCategory) => stratagems.filter((s) => s.category === category).length;
  return {
    warnings,
    bundle: {
      meta: {
        lastUpdate: t('Last_update')[0]?.last_update ?? '',
        pointsSource,
        generatedAt,
        factionId,
        counts: {
          datasheets: datasheets.length,
          legendsAndForgeWorld: datasheets.filter((d) => d.source.kind !== 'core').length,
          detachments: detachments.length,
          enhancements: enhancements.length,
          detachmentStratagems: count('detachment'),
          coreStratagems: count('core'),
          earlierCoreStratagems: count('coreLegacy'),
          missionStratagems: count('mission'),
          coreActions: count('coreAction'),
          challengerStratagems: count('challenger'),
          boardingActionsStratagems: count('boardingActions'),
        },
      },
      datasheets,
      detachments,
      enhancements,
      stratagems,
    },
  };
}
