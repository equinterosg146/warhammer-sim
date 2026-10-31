// Plain-English notes for Tyranid unit abilities and detachment rules, written for this app.
// They summarise the official text; they never replace it. Each note is tied to the wording it was
// written against (see curation.ts): if a rules update changes that wording, the note is hidden
// until it has been reviewed.

/** When a rule matters. 'before' is deployment and pre-battle; 'always' is passive or any time. */
export type When = 'before' | 'command' | 'movement' | 'shooting' | 'charge' | 'fight' | 'always';

export interface Note {
  summary: string;
  when: When[];
  /** Whose turn it applies in. Omitted means either. */
  turn?: 'yours' | 'opponents';
}

export const WHEN_LABEL: Record<When, string> = {
  before: 'Before battle',
  command: 'Command',
  movement: 'Movement',
  shooting: 'Shooting',
  charge: 'Charge',
  fight: 'Fight',
  always: 'Always on',
};

const FLOATING_DEATH = (low: string, high: string): Note => ({
  summary: `Whenever this unit or an enemy unit ends a move, each mine within 3" of an enemy explodes: the mine is destroyed and you roll a D6. On 2-5 the enemy unit takes ${low}; on a 6 it takes ${high}.`,
  when: ['movement', 'charge'],
});

/**
 * Keyed by ability name. Where the same name means something different on another datasheet,
 * a "Datasheet name::Ability name" key overrides it.
 */
export const ABILITY_NOTES: Record<string, Note> = {
  'Overgrown Barbs': {
    summary: 'After this model shoots, pick one enemy unit it hit (not TITANIC). Until the start of your next turn, subtract 1 from the Hit roll each time a model in that unit makes an attack.',
    when: ['shooting'],
    turn: 'yours',
  },
  'Disruption Bombardment': {
    summary: 'After this unit shoots, pick one enemy INFANTRY unit it hit. Until the end of your opponent’s next turn, subtract 2 from that unit’s Move characteristic and from its Advance and Charge rolls.',
    when: ['shooting'],
    turn: 'yours',
  },
  'Seed Spore Mines': {
    summary: 'Once per turn, instead of shooting, add a new Spore Mines unit (one mine per Biovore) within 48" of this unit and more than 8" from all enemies.',
    when: ['shooting'],
    turn: 'yours',
  },
  'Vicious Insight': {
    summary: 'While the Broodlord leads a unit, every weapon in that unit has Devastating Wounds.',
    when: ['shooting', 'fight'],
  },
  'Hypnotic Gaze (Psychic)': {
    summary: 'At the start of the Fight phase, pick one enemy unit engaged with the Broodlord. Until the end of the phase, subtract 1 from the Hit roll each time a model in that unit makes an attack.',
    when: ['fight'],
  },
  'Blistering Assault': {
    summary: 'In your opponent’s Shooting phase, after an enemy unit shoots and a model in this unit lost a wound to it, this unit can make a surge move of D6+2".',
    when: ['shooting'],
    turn: 'opponents',
  },
  'Feeder Tendrils': {
    summary: 'You gain 1 CP each time this model destroys an enemy CHARACTER model.',
    when: ['fight'],
  },
  'Fear of the Unseen (Aura)': {
    summary: 'Worsen the Leadership characteristic of enemy units within 6" by 1. In your opponent’s Command phase, those units must also take a Battle-shock test if they are below Starting Strength.',
    when: ['always', 'command'],
    turn: 'opponents',
  },
  'HUNTER ORGANISM': {
    summary: 'This model cannot be your Warlord.',
    when: ['before'],
  },
  'Digestion Spine': {
    summary: 'After this model fights, if it destroyed any enemy models (not VEHICLES), it heals up to D3 wounds.',
    when: ['fight'],
  },
  'Symbiotic Targeting': {
    summary: 'After this model shoots, pick one enemy unit it hit. For the rest of the phase every friendly Tyranids model re-rolls a Hit roll of 1 against that unit. Shoot with this model first.',
    when: ['shooting'],
    turn: 'yours',
  },
  'Winged Swarm': {
    summary: 'After this unit shoots, if it is not engaged it can make a Normal move of up to 6". If it does, it cannot charge this turn.',
    when: ['shooting'],
    turn: 'yours',
  },
  'Vanguard Predator': {
    summary: 'Re-roll a Hit roll of 1. If the target is within range of an objective, re-roll a Wound roll of 1 as well.',
    when: ['shooting', 'fight'],
  },
  'Spore Mine Cysts': {
    summary: 'At the end of your opponent’s Fight phase, either roll six D6 at a visible enemy unit within 24" (each 3+ is 1 mortal wound), or add a new Spore Mines unit of D3 models within 6" of this model. Only one model per turn can pick the second option.',
    when: ['fight'],
    turn: 'opponents',
  },
  'Frenzied Metabolism': {
    summary: 'When this model shoots you can add 1 to its Wound rolls for the phase. Afterwards roll a D6: on a 2+ it suffers D3 mortal wounds.',
    when: ['shooting'],
  },
  'Grisly Spectacle': {
    summary: 'After this model fights, if it destroyed an enemy unit, every enemy unit within 6" must take a Battle-shock test.',
    when: ['fight'],
  },
  'Apex-beast': {
    summary: 'Add 1 to the Hit roll when attacking a Battle-shocked unit.',
    when: ['shooting', 'fight'],
  },
  'Stalking Forward': {
    summary: 'When making a Normal, Advance or Fall Back move, it moves over models (not TITANIC) and terrain 4" or lower as if they were not there.',
    when: ['movement'],
  },
  'Airborne Predator': {
    summary: 'Add 1 to the Hit roll for ranged attacks against units that can FLY.',
    when: ['shooting'],
  },
  'Defensive Stance': {
    summary: 'When you use Fire Overwatch with this unit, it hits on an unmodified Hit roll of 5+, or 4+ if it is within range of an objective marker you control.',
    when: ['movement', 'charge'],
    turn: 'opponents',
  },
  'Will of the Hive Mind': {
    summary: 'Once per battle round, when a friendly Tyranids unit within 12" is targeted with a stratagem, that stratagem costs 1 CP less.',
    when: ['always'],
  },
  'Onslaught (Aura, Psychic)': {
    summary: 'Friendly Tyranids units within 6" have Assault and Lethal Hits on their ranged weapons.',
    when: ['shooting'],
  },
  'Bounding Leap': {
    summary: 'This unit can charge in a turn in which it Advanced.',
    when: ['movement', 'charge'],
    turn: 'yours',
  },
  'Alpha Invader': {
    summary: 'Every weapon in this unit has Sustained Hits 1.',
    when: ['shooting', 'fight'],
  },
  'Hypersensory Array': {
    summary: 'Once per battle round, Rapid Ingress or Heroic Intervention on this unit costs 1 CP less, can be used even if you already used that stratagem this phase, and does not stop you using it on other units.',
    when: ['movement', 'charge'],
    turn: 'opponents',
  },
  'Pheromone Trail': {
    summary: 'Once per battle round, you can use Rapid Ingress on this model for 0 CP.',
    when: ['movement'],
    turn: 'opponents',
  },
  'Enhanced Toxic Miasma': {
    summary: 'While this model leads a unit, that unit’s Foul Spores aura reaches 9" instead of 6".',
    when: ['always'],
  },
  'Prey Adaptation': {
    summary: 'Each time this model’s unit fights, choose one for all its melee weapons this phase: Sustained Hits 1, Lance or Lethal Hits.',
    when: ['fight'],
  },
  'Encephalic Diffusion (Aura, Psychic)': {
    summary: 'Enemy units within 6" subtract 1 from their Hit rolls. If such a unit is Below Half-strength, it subtracts 1 from its Wound rolls as well.',
    when: ['always'],
  },
  'Terror From The Deep': {
    summary: 'When this model arrives by Deep Strike, roll a D6 for each enemy unit within 12": on 2-4 it takes D3 mortal wounds; on 5+ it takes 3 mortal wounds and a Battle-shock test.',
    when: ['movement'],
    turn: 'yours',
  },
  'Bio-minefield': {
    summary: 'Enemy units cannot start or end an Advance move within 6" of this unit.',
    when: ['movement'],
    turn: 'opponents',
  },
  'Floating Death': FLOATING_DEATH('1 mortal wound', 'D3 mortal wounds'),
  'Mucolid Spores::Floating Death': FLOATING_DEATH('D3 mortal wounds', 'D6 mortal wounds'),
  Neurocytes: {
    summary: 'While this unit is within Synapse Range of another Tyranids unit (not Neurogaunts), it counts as a Synapse unit itself.',
    when: ['always'],
  },
  'Neural Disruption': {
    summary: 'In your Command phase, pick one enemy unit within 12". It must take a Battle-shock test.',
    when: ['command'],
    turn: 'yours',
  },
  'Psychological Saboteur (Aura)': {
    summary: 'Battle-shocked enemy units within 12" subtract 1 from their Hit rolls, and friendly Tyranids add 1 to the Wound roll when attacking them.',
    when: ['always'],
  },
  'Node Lash (Psychic)': {
    summary: 'While this model leads a unit, add 1 to the Hit roll for that unit\u2019s attacks. Against a Battle-shocked target, add 1 to the Wound roll as well.',
    when: ['shooting', 'fight'],
  },
  'Psychic Terror (Psychic)': {
    summary: 'When you unleash the Shadow in the Warp, enemy units take those Battle-shock tests at -1.',
    when: ['command'],
  },
  Neuroloids: {
    summary: 'In your Command phase, pick up to two friendly Tyranids units within 18". They count as within Synapse Range until your next Command phase.',
    when: ['command'],
    turn: 'yours',
  },
  'Singular Purpose': {
    summary: 'At the start of the first battle round choose one. Either pick an enemy unit: this model can re-roll the Hit roll and the Wound roll against it all battle. Or pick an objective: while in range of it this model has Feel No Pain 5+ and Objective Control 15.',
    when: ['before'],
  },
  'Harpoon Barbs': {
    summary: 'Once per turn, when an enemy unit engaged with this model Falls Back, roll a D6: on a 2+ that unit suffers D6 mortal wounds.',
    when: ['movement'],
    turn: 'opponents',
  },
  Harpooned: {
    summary: 'When this unit declares a charge, if an enemy MONSTER or VEHICLE within 12" was hit by the harpoon this turn, you can add 2 to the Charge roll. If you do, the charge must end engaged with that unit.',
    when: ['charge'],
    turn: 'yours',
  },
  'Unnatural Resilience': {
    summary: 'This model has Feel No Pain 4+ against mortal wounds.',
    when: ['always'],
  },
  'Alpha Leader': {
    summary: 'While this model leads a unit, that unit can re-roll the Hit roll for its attacks.',
    when: ['shooting', 'fight'],
  },
  'Unstoppable Monster': {
    summary: 'At the start of each player’s Command phase, this model heals up to D3 wounds.',
    when: ['command'],
  },
  'Parasitic Infection': {
    summary: 'When the barbed ovipositor destroys an INFANTRY model, after this model finishes attacking you can add a new Ripper Swarms unit of D3 models within 3" of it.',
    when: ['fight'],
  },
  'It Itches!': {
    summary: 'At the start of the Fight phase, pick one enemy unit engaged with this model. It must take a Battle-shock test.',
    when: ['fight'],
  },
  'Bio-stimulus': {
    summary: 'After this model shoots, pick one enemy unit it hit. Until the end of the turn, friendly Tyranids melee attacks against that unit improve their Armour Penetration characteristic by 1.',
    when: ['shooting'],
    turn: 'yours',
  },
  'Feeding Frenzy': {
    summary: 'Melee attacks against a unit below Starting Strength add 1 to the Hit roll, and add 1 to the Wound roll as well if the target is Below Half-strength.',
    when: ['fight'],
  },
  'Burning Spray': {
    summary: 'After this unit shoots, pick one enemy unit it hit. That unit cannot have the Benefit of Cover for the rest of the phase.',
    when: ['shooting'],
    turn: 'yours',
  },
  'Death From Below': {
    summary: 'At the end of your opponent’s turn, if this unit is not engaged, you can remove it and place it into Strategic Reserves.',
    when: ['fight'],
    turn: 'opponents',
  },
  'Chitinous Horrors (Aura)': {
    summary: 'Halve the Objective Control characteristic of enemy units engaged with this unit.',
    when: ['always'],
  },
  'Chitinous Horrors': {
    summary: 'Halve the Objective Control characteristic of enemy units engaged with this unit.',
    when: ['always'],
  },
  'Death Scream': {
    summary: 'After this model shoots, pick one unit it hit. That unit must take a Battle-shock test at -1.',
    when: ['shooting'],
    turn: 'yours',
  },
  'Irresistible Force': {
    summary: 'This model can charge in a turn in which it Fell Back.',
    when: ['movement', 'charge'],
    turn: 'yours',
  },
  'Seed Mucolids': {
    summary: 'Once per turn, instead of shooting, add a new Mucolid Spores unit of 1 model within 18" of this model and more than 8" from all enemies.',
    when: ['shooting'],
    turn: 'yours',
  },
  'Hive Defences': {
    summary: 'Fire Overwatch with this model costs 0 CP and can be used even if you already used it on another unit this turn. Once per turn.',
    when: ['movement', 'charge'],
    turn: 'opponents',
  },
  'Skulking Horrors': {
    summary: 'In your opponent’s Movement phase, when an enemy unit ends a move within 8" of this unit and this unit is not engaged, it can make a Normal move of up to D6".',
    when: ['movement'],
    turn: 'opponents',
  },
  'Spawn Termagants': {
    summary: 'In your Command phase, return up to D3+3 destroyed models to one friendly Termagants unit within 6".',
    when: ['command'],
    turn: 'yours',
  },
  'Brood Progenitor (Aura, Psychic)': {
    summary: 'Friendly Termagants units within 6" have Lethal Hits on their ranged weapons.',
    when: ['shooting'],
  },
  'Swallow Whole': {
    summary: 'With the gaping maw against INFANTRY, MOUNTED or BEASTS, every successful unmodified Wound roll is a Critical Wound. Each such model it destroys heals this model up to D3+2 wounds.',
    when: ['fight'],
  },
  'Subterranean Hunter': {
    summary: 'At the end of the Fight phase, if this unit is not engaged, you can remove it and place it into Strategic Reserves.',
    when: ['fight'],
  },
  'Hive Commander': {
    summary: 'You gain 1 extra CP at the start of your Command phase while this model is on the battlefield.',
    when: ['command'],
    turn: 'yours',
  },
  'Malign Presence (Aura)': {
    summary: 'If this model is your Warlord, your opponent pays 1 CP more for stratagems that target their units within 12" of it.',
    when: ['always'],
  },
  'Domination of the Hive Mind (Aura)': {
    summary: 'Friendly Tyranids units within 9" count as within Synapse Range.',
    when: ['always'],
  },
  'Grasping Tendrils': {
    summary: 'When an enemy unit (not TITANIC) engaged with this unit tries to Fall Back, roll a D6: on a 3+ it must Remain Stationary instead.',
    when: ['movement'],
    turn: 'opponents',
  },
  'Hypertoxic Miasma (Aura)': {
    summary: 'At the end of your Movement phase, roll a D6 for each enemy unit within 6": on 2-3 it takes 1 mortal wound, on 4-5 D3, on a 6 D6.',
    when: ['movement'],
    turn: 'yours',
  },
  'Subterranean Tunnels': {
    summary: 'When arriving by Deep Strike, this model can set up more than 6" from enemies instead of 8". If it does, it cannot charge that turn.',
    when: ['movement'],
    turn: 'yours',
  },
  'Alpha Warrior': {
    summary: 'While this model leads a unit, every weapon in that unit has Sustained Hits 1.',
    when: ['shooting', 'fight'],
  },
  'Tyranid Prime with Lash Whip::Alpha Warrior': {
    summary: 'Every weapon in this model’s unit has Sustained Hits 1.',
    when: ['shooting', 'fight'],
  },
  'Aggressive Leader-beast': {
    summary: 'In your opponent’s Shooting phase, after an enemy unit shoots and destroys a model in this unit, this unit can make a surge move of up to D6".',
    when: ['shooting'],
    turn: 'opponents',
  },
  'Adaptive Instincts (Once per turn, per unit)': {
    summary: 'Once per turn in the Fight phase, when this unit is picked to fight or is targeted, choose one: add 1 to the Strength characteristic of its melee attacks, or add 1 to its Toughness characteristic.',
    when: ['fight'],
  },
  'Adaptable Predators': {
    summary: 'This unit can shoot and charge in a turn in which it Fell Back.',
    when: ['movement', 'shooting', 'charge'],
    turn: 'yours',
  },
  'Aerial Seeding': {
    summary: 'Must start in Reserves, without counting against your Reserves limit. It can arrive in your first, second or third Movement phase. Units inside must get out straight away, more than 8" from enemies, and nothing can embark afterwards.',
    when: ['before', 'movement'],
    turn: 'yours',
  },
  'Resilient Organism': {
    summary: 'Once per battle, when an attack is allocated to this model, change that attack’s Damage characteristic to 0.',
    when: ['shooting', 'fight'],
    turn: 'opponents',
  },
  'Guardian Organism': {
    summary: 'While a Character leads this unit, that Character has Feel No Pain 5+.',
    when: ['always'],
  },
  'Foul Spores (Aura)': {
    summary: 'Friendly Tyranids units within 6" have Stealth, so ranged attacks against them count them as in cover.',
    when: ['always'],
  },
  'Pouncing Leap': {
    summary: 'Heroic Intervention on this unit costs 1 CP less, can be used even if you already used it this phase, and does not stop you using it on other units.',
    when: ['charge'],
    turn: 'opponents',
  },
  'Paroxysm (Psychic)': {
    summary: 'At the start of the Fight phase, pick a visible enemy unit within 12" and roll a D6. On a 1 this model suffers D3 mortal wounds; on 2+ subtract 1 from the Attacks characteristic of that unit’s weapons this phase.',
    when: ['fight'],
  },
  'Death Blow': {
    summary: 'If this model is destroyed by a melee attack before it has fought this phase, roll a D6: on a 4+ it fights before being removed.',
    when: ['fight'],
  },
  'Spirit Leech (Aura, Psychic)': {
    summary: 'If this unit includes a Neurothrope: each time an enemy unit within 6" fails a Battle-shock test, it suffers D3 mortal wounds and one model in this unit heals up to D3 wounds.',
    when: ['command'],
  },
  'Warp Field (Aura, Psychic)': {
    summary: 'Friendly Tyranids units within 6" have a 6+ invulnerable save.',
    when: ['always'],
  },
};

/** Keyed by the detachment rule's name. */
export const DETACHMENT_NOTES: Record<string, Note> = {
  Mindhunger: {
    summary: 'Deathleaper, Lictors and Neurolictors have Deep Strike. Lictors and Neurolictors re-roll a Hit roll of 1 against CHARACTER units.',
    when: ['before', 'fight'],
  },
  'Feed the Swarm': {
    summary: 'In your Command phase, each Harvester unit can regenerate one friendly Tyranids unit within 6" (a unit can only be regenerated once per phase). Either one model heals D3+1 wounds, or one destroyed Infantry model (not a Character) comes back; Endless Multitude units get up to 3 models back instead.',
    when: ['command'],
    turn: 'yours',
  },
  'Enraged Behemoths': {
    summary: 'Tyranids Monsters add 1 to the Hit roll once their unit is below Starting Strength, and add 1 to the Wound roll as well once it is Below Half-strength. Monster units still at Starting Strength and not Battle-shocked add 2 to their Objective Control characteristic.',
    when: ['shooting', 'fight', 'always'],
  },
  'Hyper-adaptations': {
    summary: 'At the start of the first battle round choose one for your whole army for the battle. Swarming Instincts: Sustained Hits 1 against INFANTRY and SWARM. Hyper-aggression: Lethal Hits against MONSTERS and VEHICLES. Hive Predators: critical hits against CHARACTER units have Precision.',
    when: ['before', 'shooting', 'fight'],
  },
  'Surprise Assault': {
    summary: 'All your Tyranids re-roll a Hit roll of 1. Mawlocs and Trygons are Burrowers: when one arrives from Reserves, place a Tunnel Marker within 1" of it. Later Reserves units can arrive within 9" of a marker and more than 6" from enemies. A marker is removed if an enemy model ends a move within 3" of it. When mustering, up to 2 Trygons can become Characters, so they can take enhancements or be your Warlord.',
    when: ['before', 'movement', 'shooting', 'fight'],
  },
  'Synaptic Imperatives': {
    summary: 'At the start of each battle round pick one imperative for units within Synapse Range; each can be picked once per battle. Synaptic Augmentation: 5+ invulnerable save. Surging Vitality: add 1 to Advance and Charge rolls. Goaded to Slaughter: add 1 to the Hit roll for melee attacks.',
    when: ['command', 'always'],
  },
  'Higher Imperatives': {
    summary: 'Once per battle per unit, in your Command phase, a Norn Emissary or Norn Assimilator can make a new choice for its Singular Purpose ability.',
    when: ['command'],
    turn: 'yours',
  },
  'Insurmountable Odds': {
    summary: 'In your opponent’s Shooting phase, when an enemy unit shoots and destroys a model in one of your Endless Multitude units, that unit can make a surge move of up to D6".',
    when: ['shooting'],
    turn: 'opponents',
  },
  'Questing Tendrils': {
    summary: 'Your Tyranids units can charge in a turn in which they Fell Back. Vanguard Invader units can also charge in a turn in which they Advanced.',
    when: ['movement', 'charge'],
    turn: 'yours',
  },
  'Leader-beasts': {
    summary: 'Tyranid Warriors units gain the TYRANID WARRIORS and BATTLELINE keywords. Tyranid Warriors, Tyranid Primes with Lash Whip and Winged Tyranid Primes have a 5+ invulnerable save.',
    when: ['always'],
  },
  'Unstoppable Swarm': {
    summary: 'Your Tyranids can move through friendly Tyranids models. You add 1 to the roll-off when your opponent contests you operating a closed Hatchway.',
    when: ['movement'],
  },
  'Priority Predation': {
    summary: 'When an enemy unit engaged with your Tyranids Falls Back, each of those Tyranids units that is no longer engaged with anything can make a Normal move of up to 3".',
    when: ['movement'],
    turn: 'opponents',
  },
  'Half-Glimpsed Shadows': {
    summary: 'Subtract 1 from the Hit roll for ranged attacks against your Great Devourer units unless the attacker is within 6".',
    when: ['always'],
  },
  'Xeno-Terror': {
    summary: 'When you unleash the Shadow in the Warp, enemy units take the Battle-shock tests at -1, and any unit that fails cannot Fire Overwatch this turn.',
    when: ['command'],
  },
};

/** Keyed by army rule name. */
export const ARMY_NOTES: Record<string, Note> = {
  Synapse: {
    summary: 'A Tyranids unit within 6" of a friendly Synapse model is within Synapse Range. While it is, it takes Battle-shock tests on 3D6 instead of 2D6 and add 1 to the Strength characteristic of its melee attacks. Only units with the SYNAPSE keyword are Synapse models; the app marks them with a SYNAPSE label.',
    when: ['always', 'command', 'fight'],
  },
  'Shadow in the Warp': {
    summary: 'Once per battle, in either player\u2019s Command phase, every enemy unit on the battlefield must take a Battle-shock test. Units within 6" of one of your Synapse units take it at -1.',
    when: ['command'],
  },
};
