// Plain-English summaries of core rules terms, written for this app (not rulebook text).
// Each entry cites its section in the Warhammer 40,000 core rules so the exact wording can be checked.
// Core abilities that appear on Tyranid datasheets also have their official text in the Wahapedia data;
// the Rules screen shows that alongside these summaries.

export type GlossaryKind = 'weapon' | 'core' | 'term';

export interface GlossaryEntry {
  term: string;
  kind: GlossaryKind;
  /** Core rules section, e.g. "24.23". */
  rule: string;
  summary: string;
  /** Lower-case weapon keyword prefix this entry explains, e.g. "sustained hits". */
  keyword?: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  // ---- Weapon abilities (24) ----
  {
    term: 'Anti-X Y+',
    kind: 'weapon',
    rule: '24.03',
    keyword: 'anti-',
    summary:
      'Against a target with keyword X, an unmodified Wound roll of Y or more is a Critical Wound. Example: ANTI-INFANTRY 4+ makes every 4, 5 or 6 a critical wound against INFANTRY.',
  },
  {
    term: 'Assault',
    kind: 'weapon',
    rule: '24.04, 10.05',
    keyword: 'assault',
    summary: 'The unit can still shoot after making an advance move, but only with its ASSAULT weapons.',
  },
  {
    term: 'Blast',
    kind: 'weapon',
    rule: '24.05',
    keyword: 'blast',
    summary:
      'Add one extra attack for every five models in the target unit (BLAST X adds X per five models). Blast weapons cannot target a unit your unit is engaged with.',
  },
  {
    term: 'Cleave X',
    kind: 'weapon',
    rule: '24.06',
    keyword: 'cleave',
    summary: 'If all of the weapon’s attacks go into one unit, add X extra attacks for every five models in that unit.',
  },
  {
    term: 'Close-quarters / Pistol',
    kind: 'weapon',
    rule: '24.07, 24.27, 10.06',
    keyword: 'pistol',
    summary:
      'Can be fired while the unit is engaged, at the enemy it is engaged with. Pistol and Close-quarters are the same rule. Outside that, each model (other than a MONSTER or VEHICLE) fires either its close-quarters weapons or its other guns, not both.',
  },
  {
    term: 'Devastating Wounds',
    kind: 'weapon',
    rule: '24.10',
    keyword: 'devastating wounds',
    summary:
      'A critical wound skips the save entirely and becomes mortal wounds equal to the weapon’s Damage. Those mortal wounds can only damage one model; any left over are lost.',
  },
  {
    term: 'Extra Attacks',
    kind: 'weapon',
    rule: '24.11',
    keyword: 'extra attacks',
    summary: 'When the unit fights, models attack with this weapon in addition to one of their other melee weapons.',
  },
  {
    term: 'Hazardous',
    kind: 'weapon',
    rule: '24.15, 06.03',
    keyword: 'hazardous',
    summary:
      'After the unit attacks, roll a D6 for each Hazardous weapon used: on a 1 or 2 the unit suffers 1 mortal wound (3 if every model is a MONSTER or VEHICLE).',
  },
  {
    term: 'Heavy',
    kind: 'weapon',
    rule: '24.16',
    keyword: 'heavy',
    summary:
      'In your Shooting phase, add 1 to the Hit roll if the unit is unengaged, was not set up this turn and no model moved more than 3".',
  },
  {
    term: 'Ignores Cover',
    kind: 'weapon',
    rule: '24.18',
    keyword: 'ignores cover',
    summary: 'The target never gets the benefit of cover against these attacks, even from abilities like Stealth.',
  },
  {
    term: 'Indirect Fire',
    kind: 'weapon',
    rule: '24.19, 10.07',
    keyword: 'indirect fire',
    summary:
      'Can shoot at units you cannot see. The target always counts as in cover, Hit rolls cannot be re-rolled, and an unmodified Hit roll of 1–5 fails (only 1–3 if the unit stayed still and a friendly unit can see the target).',
  },
  {
    term: 'Lance',
    kind: 'weapon',
    rule: '24.21',
    keyword: 'lance',
    summary: 'Add 1 to the Wound roll if the attacking unit made a charge move this turn.',
  },
  {
    term: 'Lethal Hits',
    kind: 'weapon',
    rule: '24.23',
    keyword: 'lethal hits',
    summary:
      'A critical hit (an unmodified 6) can wound automatically, with no Wound roll. You can choose not to, for example so it might roll a critical wound for Devastating Wounds.',
  },
  {
    term: 'Melta X',
    kind: 'weapon',
    rule: '24.25',
    keyword: 'melta',
    summary: 'If the target is within half the weapon’s range, add X to its Damage.',
  },
  {
    term: 'One Shot',
    kind: 'weapon',
    rule: '24.26',
    keyword: 'one shot',
    summary: 'Can only be used to make attacks once per battle.',
  },
  {
    term: 'Precision',
    kind: 'weapon',
    rule: '24.28',
    keyword: 'precision',
    summary:
      'If the target unit contains a CHARACTER you can see, you can send these attacks at that character instead of the bodyguards.',
  },
  {
    term: 'Psychic',
    kind: 'weapon',
    rule: '24.29',
    keyword: 'psychic',
    summary:
      'You can ignore any modifiers to the attack’s BS/WS and to its Hit roll. Attacks with it count as psychic attacks for other rules.',
  },
  {
    term: 'Rapid Fire X',
    kind: 'weapon',
    rule: '24.30',
    keyword: 'rapid fire',
    summary: 'If the target is within half the weapon’s range, add X extra attacks.',
  },
  {
    term: 'Sustained Hits X',
    kind: 'weapon',
    rule: '24.36',
    keyword: 'sustained hits',
    summary: 'Each critical hit (an unmodified 6) scores X extra hits on top of itself.',
  },
  {
    term: 'Torrent',
    kind: 'weapon',
    rule: '24.37',
    keyword: 'torrent',
    summary: 'Hits automatically. No Hit roll is made, so these attacks cannot be critical hits.',
  },
  {
    term: 'Twin-linked',
    kind: 'weapon',
    rule: '24.38',
    keyword: 'twin-linked',
    summary: 'You can re-roll the Wound roll.',
  },

  // ---- Core abilities (24) ----
  {
    term: 'Deadly Demise X',
    kind: 'core',
    rule: '24.08',
    summary: 'When a model with this is destroyed, roll a D6: on a 6, every unit within 6" suffers X mortal wounds.',
  },
  {
    term: 'Deep Strike',
    kind: 'core',
    rule: '24.09',
    summary:
      'If every model in the unit has this, when the unit arrives from reserves (an ingress move) it can be set up anywhere more than 8" from all enemy units, even in their deployment zone.',
  },
  {
    term: 'Feel No Pain X+',
    kind: 'core',
    rule: '24.12',
    summary: 'Each time a model would lose a wound, roll a D6: on X or more, that wound is not lost.',
  },
  {
    term: 'Fights First',
    kind: 'core',
    rule: '24.13, 12.04',
    summary: 'If every model in the unit has this, it fights in the Fights First step, before other units.',
  },
  {
    term: 'Hover',
    kind: 'core',
    rule: '24.17, 21.03',
    summary: 'When this unit takes to the skies, it does not lose the usual 2" of movement.',
  },
  {
    term: 'Infiltrators',
    kind: 'core',
    rule: '24.20',
    summary:
      'If every model has this, the unit can deploy anywhere more than 8" from the enemy deployment zone and all enemy units.',
  },
  {
    term: 'Leader',
    kind: 'core',
    rule: '24.22, 19',
    summary:
      'Before the battle, this unit can join one bodyguard unit it is allowed to lead. They become one unit for the battle. Each bodyguard unit can only have one leader.',
  },
  {
    term: 'Lone Operative',
    kind: 'core',
    rule: '24.24',
    summary:
      'Unless it is part of an attached unit, enemies cannot see or target it (including with Indirect Fire) unless they are within 12".',
  },
  {
    term: 'Scouts X"',
    kind: 'core',
    rule: '24.31',
    summary:
      'Before the battle, if every model has this, the unit can make a move of up to X" from your deployment zone, ending more than 8" from all enemy units.',
  },
  {
    term: 'Stealth',
    kind: 'core',
    rule: '24.33',
    summary: 'If every model has this, the unit always has the benefit of cover against ranged attacks.',
  },
  {
    term: 'Support',
    kind: 'core',
    rule: '24.34, 19',
    summary: 'Like Leader, but fills the separate support slot: a bodyguard unit can have one leader and one support unit.',
  },

  // ---- Game terms ----
  {
    term: 'Attached unit',
    kind: 'term',
    rule: '19',
    summary:
      'A leader and the bodyguard unit it joins. It counts as a single unit with all the keywords of both. Attacks against it use the highest Toughness among the bodyguard models.',
  },
  {
    term: 'Battle-shock',
    kind: 'term',
    rule: '01.07, 08.03',
    summary:
      'In your Command phase, units at or below half-strength (or already battle-shocked) roll 2D6 against their Leadership. On a fail the unit is battle-shocked: its Objective Control drops to nothing, you cannot target it with stratagems, and it cannot start or finish actions.',
  },
  {
    term: 'Benefit of cover',
    kind: 'term',
    rule: '13.08',
    summary:
      'A ranged attack against a unit in cover has its BS made one worse (e.g. 3+ becomes 4+). A unit has cover if every model is INFANTRY, BEASTS or SWARM in a terrain area, or is not fully visible because of terrain.',
  },
  {
    term: 'Command points (CP)',
    kind: 'term',
    rule: '08.02, 15',
    summary: 'Both players gain 1 CP at the start of every Command phase, yours and your opponent’s. CP is spent on stratagems.',
  },
  {
    term: 'Critical hit / critical wound',
    kind: 'term',
    rule: '05.01, 05.02',
    summary:
      'An unmodified 6 on a Hit roll is a Critical Hit; an unmodified 6 on a Wound roll is a Critical Wound. They always succeed and trigger abilities like Lethal Hits, Sustained Hits and Devastating Wounds.',
  },
  {
    term: 'Engaged / engagement range',
    kind: 'term',
    rule: '03.04',
    summary:
      'A model’s engagement range is 2" horizontally and 5" vertically. Units with models in each other’s engagement range are engaged and can fight; most units cannot shoot or make normal moves while engaged.',
  },
  {
    term: 'Hazard roll',
    kind: 'term',
    rule: '06.03',
    summary: 'Roll a D6: on a 1 or 2 the unit suffers 1 mortal wound, or 3 if every model is a MONSTER or VEHICLE.',
  },
  {
    term: 'Mortal wounds',
    kind: 'term',
    rule: '06.02',
    summary:
      'Damage with no save allowed. Each mortal wound removes 1 wound, going onto already-wounded non-CHARACTER models first, then other non-characters, then characters.',
  },
  {
    term: 'Objective Control (OC)',
    kind: 'term',
    rule: '02.02',
    summary:
      'How strongly a model holds an objective. Add up the OC of each player’s models in range of an objective; the higher total controls it. Battle-shocked models have no OC.',
  },
  {
    term: 'Starting strength / half-strength',
    kind: 'term',
    rule: 'Rules appendix',
    summary:
      'Starting strength is the number of models at the start of the first battle round. A unit is at half-strength with exactly half its models left and below half-strength with fewer. A single model goes by its wounds instead.',
  },
  {
    term: 'Stratagems',
    kind: 'term',
    rule: '15.01',
    summary:
      'Special actions bought with CP. You cannot use the same stratagem twice in one phase, and you cannot target the same unit with more than one stratagem in a phase.',
  },
];

/**
 * Finds the entry explaining a weapon keyword as written on a datasheet,
 * e.g. "sustained hits 2" or "anti-infantry 4+".
 */
export function glossaryForKeyword(keyword: string): GlossaryEntry | undefined {
  const k = keyword.trim().toLowerCase();
  if (k === 'close-quarters') return GLOSSARY.find((e) => e.keyword === 'pistol');
  return GLOSSARY.find((e) => e.keyword !== undefined && (k === e.keyword || k.startsWith(e.keyword)));
}
