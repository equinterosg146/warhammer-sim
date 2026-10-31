# Warhammer Sim — design

A practice table for Warhammer 40,000 (11th edition) that runs in a browser on a PC. You play your
Tyranids against a computer-controlled 2000-point Ultramarines army to get reps in: learning your
abilities and detachment stratagems, never forgetting Command phase steps, and deploying hordes safely.

## Why (from Erick's last game)

1. Did not know the army's abilities well → abilities are shown at the moment they apply.
2. Unfamiliar with detachment stratagems → every Tyranid detachment can be picked when building the
   list, and the stratagems usable *right now* are offered in each phase.
3. Kept forgetting Command phase steps → the game walks through each step of each phase and will not
   move on until required steps are done.
4. Deployed hordes poorly and lost units turn 1 → a real deployment step with terrain, and an opponent
   that punishes units left in the open. While deploying, a "who can see here" view shows danger.

## Goals

- 2D top-down board, 44" × 60", models on their real base sizes, every distance measured base edge to
  base edge in inches (fractions allowed). Movement is free (no grid); paths around enemy models and
  walls are measured exactly.
- Line of sight drawn with the mouse, like the aiming line in a pool game: from the shooting unit to the
  target, coloured by whether it is visible/in range/has cover.
- Rules follow the 11th edition core rules in `data/raw/core-rules-11th.pdf` (section numbers are quoted
  in code comments).
- Dice: roll real dice and type the results, or press auto-roll.
- Army builder in the game: Tyranids, any detachment(s), unit sizes, leaders, enhancements, points.
- Opponent: a default 2000-point Ultramarines list, difficulty Easy / Normal / Hard.
- Separate project from the Tyranid phone app, its own folder and git repo.

## Non-goals (for now)

- Any faction other than Tyranids (player) and Space Marines/Ultramarines (computer).
- True 3D: no terrain heights, no shooting from upper floors, no plunging fire.
- Transports, aircraft and actions (secondary missions) — later.
- Every datasheet ability automated — abilities are hand-coded unit by unit; the rest are shown as
  reminders with plain-English text.

## Decisions made by Claude (check these)

- **Stack:** TypeScript, React, Vite, Vitest. Rules data built from the same Wahapedia CSVs as the
  phone app (`npm run build-data`). Tyranid points come from the phone app's Field Manual v1.5 points.
- **Terrain:** each terrain area is a polygon footprint with a category (light/dense). Dense areas
  (ruins) also have wall segments inside them. Following 13.06–13.11:
  - Light and dense terrain areas are *obscuring*: two models cannot see each other if every line
    between their bases crosses an obscuring area that neither of them is within.
  - INFANTRY/BEASTS/SWARM models within a terrain area have the benefit of cover (BS worsened by 1),
    as do models not fully visible because of intervening terrain.
  - Hidden (13.09): INFANTRY/BEASTS/SWARM within a dense area whose unit did not shoot this or last turn
    can only be seen from within 15".
  - Walls block movement for models that are not INFANTRY/BEASTS/SWARM/MOBILE (they can still enter
    the area through gaps).
- **Other models do not block line of sight** in this 2D version.
- **Mission:** a simple practice mission (no mission deck is available): 5 battle rounds, 5 terrain
  objectives, primary scoring at the end of each Command phase from round 2 (5 VP per objective
  controlled, max 15 per turn), plus 10 VP for holding more objectives than the opponent at the end
  of the battle. Deployment: long table edges, 12" deep zones.
- **Stratagems:** every stratagem of the chosen detachments plus the core ones is listed and can be used
  when its timing fits. Effects the engine understands (modifiers to hit/wound/save/damage, re-rolls,
  weapon abilities, Feel No Pain, Fights First, cover, extra moves) are applied automatically; anything
  else is shown with its text so you can resolve it by hand.

## Build stages

1. Board, terrain, measuring, movement and deployment (hot-seat).
2. Shooting, charging, fighting, dice entry, battle-shock, objectives and scoring.
3. Computer opponent: Easy, Normal, Hard.
4. More abilities, stratagem effects and terrain options.
