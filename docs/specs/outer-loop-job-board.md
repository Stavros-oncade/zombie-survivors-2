# Outer Loop — The Job Board — Implementation Spec

Status: Draft / design doc (no code yet)
Author: Game systems design
Target: `zombie-survivors-2` (Phaser 3 + TypeScript)
Part of: Outer Loop (meta layer between runs). Sibling docs:
`outer-loop-survivor-camp.md`, `outer-loop-expedition-loadout.md`,
`outer-loop-route-map.md` (Long Recon), `outer-loop-city-reclamation.md`.

## 1. Purpose & Summary

The inner loop is solved: each run already carries exactly **one** `Mission` (a win
condition) selected at Loadout and tracked at runtime by `MissionSystem`
(`src/game/systems/MissionSystem.ts:30`). Today that mission is picked from a flat list of
nine authored missions in a grid on the Loadout screen
(`src/game/scenes/Loadout.ts:116-156`), persisted as a single id in `LoadoutManager`
(`src/game/systems/LoadoutManager.ts:21`, `:54-55`). The only reward sink is Blueprint
points (`Mission.reward.blueprintPoints` → `BlueprintSystem.addPoints`,
`src/game/systems/BlueprintSystem.ts:36`), awarded on win at `GameOver`.

This spec replaces the flat Loadout mission grid with a **Job Board**: a new pre-run meta
screen that presents **3 mission offers** the player chooses between. Each offer is a
`JobOffer` that **wraps an existing `Mission`** (reusing the entire `MissionCondition`
discriminated union and the `MissionSystem` runtime unchanged) and decorates it with:

1. **Run modifiers** — conditions that alter how the run plays (enemy density, elite
   cadence, hazards, time pressure). These are applied to `EnemySpawnSystem` / `Game` at run
   start, distinct from the win condition.
2. **A computed difficulty score** derived from the base mission + the modifiers.
3. **A reward bundle spanning four meta currencies/effects**:
   - (a) **Blueprints** — the existing meta-currency (`BlueprintSystem`).
   - (b) **Campaign progression** — advances a campaign track (story beats / unlock gates).
   - (c) **Horde pressure relief** — lowers the threat clock on the survivor camp
     (defined in `outer-loop-survivor-camp.md`).
   - (d) **Camp-need resources** — food / water / medicine the camp consumes
     (also in `outer-loop-survivor-camp.md`).

Rewards are **balanced against difficulty** by a single formula (§5): harder offers pay
more, across a chosen mix of the four currencies.

The board also hosts **two special offer types** that, instead of launching a normal Game
run, hand off into dedicated outer-loop sub-loops:

- **Long Recon** → launches the FTL-style route map (`outer-loop-route-map.md`).
- **City Reclamation** → launches the district reclamation sub-loop
  (`outer-loop-city-reclamation.md`).

These appear as ordinary board offers but carry a `launch` descriptor that routes to a
different scene instead of `SceneKey.Game` (§6.4, §7.4).

### Key existing facts this spec builds on

| Fact | Source |
| --- | --- |
| `Mission` / `MissionCondition` discriminated union (REUSED wholesale) | `src/game/types/MissionTypes.ts:92-112` |
| Authored mission catalog + `resolveMission(id)` | `src/game/config/Missions.ts:6`, `:98` |
| Per-run mission runtime (unchanged) | `src/game/systems/MissionSystem.ts:30` |
| Mission selected via `LoadoutManager.getMissionId()` | `src/game/systems/LoadoutManager.ts:21`, `:54-55` |
| `Game.create()` resolves mission + builds runtime | `src/game/scenes/Game.ts:172-174` |
| Win → `mission_complete` → `handleMissionComplete()` | `src/game/scenes/Game.ts:174`, `:809` |
| Blueprint meta-currency (points in localStorage) | `src/game/systems/BlueprintSystem.ts:28-36` |
| Blueprint reward applied on win at GameOver | `src/game/scenes/GameOver.ts:94-95` |
| Loadout is the run-config hub (3 selectors + mission grid) | `src/game/scenes/Loadout.ts:23-156` |
| MainMenu → Loadout / Blueprints scene routing | `src/game/scenes/MainMenu.ts:140`, `:143-145` |
| Scene registry (must add new scene here) | `src/game/main.ts:22-33` |
| Scene key enum (must add `JobBoard`) | `src/game/config/SceneKeys.ts:1-12` |
| World size `2048 x 1536` | `src/game/config/GameConfig.ts` |
| Default boss spawn 5:00 / elite every 90 s | `mission-system.md` §7 (`EnemySpawnSystem`) |

> **Design principle: the Job Board is purely additive over the mission system.** It never
> changes `MissionTypes.ts`, `MissionSystem.ts`, or the win/lose flow. It (a) selects which
> `Mission` feeds the run, (b) layers run modifiers + a reward bundle on top, and (c)
> redirects two special offer kinds to other scenes. The inner loop is a black box it drives.

---

## 2. Data Model

New file: `src/game/types/JobBoardTypes.ts`. Imports and **reuses** `Mission` /
`MissionConditionKind` from `MissionTypes.ts` — do not redefine win conditions here.

```ts
// src/game/types/JobBoardTypes.ts
import { Mission } from './MissionTypes';
import { EnemyType } from './GameTypes';

/* ──────────────────────────── Run modifiers ──────────────────────────── */

/** All run-altering modifier kinds an offer can carry. Each maps to a knob the
 *  Game / EnemySpawnSystem already exposes (or a small new setter — see §6.3). */
export enum JobModifierKind {
  ENEMY_DENSITY    = 'enemy_density',    // scales spawn count / cap
  ELITE_CADENCE    = 'elite_cadence',    // tightens/loosens the 90s elite interval
  BOSS_TIMING      = 'boss_timing',      // moves the 5:00 boss spawn earlier/later
  HAZARD_FIELD     = 'hazard_field',     // toxic clouds / fire patches seeded in the arena
  TIME_LIMIT       = 'time_limit',       // hard run timer; expiry = LOSE (see §6.3)
  ENEMY_BUFF       = 'enemy_buff',       // +% enemy hp or speed
  SCARCITY         = 'scarcity',         // lowers pickup drop rate (harder sustain)
  TYPE_INFESTATION = 'type_infestation', // biases spawn director toward a type (helps type missions)
}

interface BaseModifier { kind: JobModifierKind; }

export interface EnemyDensityModifier extends BaseModifier {
  kind: JobModifierKind.ENEMY_DENSITY;
  multiplier: number;            // 1.0 = normal; 1.5 = +50% spawn pressure
}
export interface EliteCadenceModifier extends BaseModifier {
  kind: JobModifierKind.ELITE_CADENCE;
  intervalMs: number;            // default 90000; lower = more elites
}
export interface BossTimingModifier extends BaseModifier {
  kind: JobModifierKind.BOSS_TIMING;
  spawnAtSeconds: number;        // default 300; lower = boss rush
}
export interface HazardFieldModifier extends BaseModifier {
  kind: JobModifierKind.HAZARD_FIELD;
  hazard: 'toxic' | 'fire';
  patchCount: number;            // number of seeded hazard zones
}
export interface TimeLimitModifier extends BaseModifier {
  kind: JobModifierKind.TIME_LIMIT;
  seconds: number;               // run must complete the win condition before this
}
export interface EnemyBuffModifier extends BaseModifier {
  kind: JobModifierKind.ENEMY_BUFF;
  hpMultiplier?: number;         // e.g. 1.25
  speedMultiplier?: number;      // e.g. 1.15
}
export interface ScarcityModifier extends BaseModifier {
  kind: JobModifierKind.SCARCITY;
  dropRateMultiplier: number;    // 0.5 = half pickups
}
export interface TypeInfestationModifier extends BaseModifier {
  kind: JobModifierKind.TYPE_INFESTATION;
  enemyType: EnemyType;
  weight: number;                // bias strength toward this type
}

export type JobModifier =
  | EnemyDensityModifier | EliteCadenceModifier | BossTimingModifier
  | HazardFieldModifier  | TimeLimitModifier    | EnemyBuffModifier
  | ScarcityModifier     | TypeInfestationModifier;

/* ──────────────────────────── Rewards (4 currencies) ──────────────────────────── */

export enum CampResource { FOOD = 'food', WATER = 'water', MEDICINE = 'medicine' }

/** A reward bundle. Any subset of the four currencies may be present. */
export interface JobReward {
  blueprintPoints?: number;            // (a) meta-currency → BlueprintSystem.addPoints
  campaignPoints?: number;             // (b) campaign progression → CampaignSystem.addProgress
  hordePressureRelief?: number;        // (c) lowers camp threat clock → CampSystem.relieveHordePressure
  campResources?: Partial<Record<CampResource, number>>; // (d) food/water/medicine
}

/* ──────────────────────────── Special launch types ──────────────────────────── */

/** Normal offers launch SceneKey.Game. Special offers route elsewhere (§6.4). */
export enum JobLaunchKind {
  GAME_RUN        = 'game_run',          // default: launch the inner-loop Game scene
  LONG_RECON      = 'long_recon',        // → route map sub-loop (outer-loop-route-map.md)
  CITY_RECLAMATION = 'city_reclamation', // → district reclamation (outer-loop-city-reclamation.md)
}

export interface JobLaunch {
  kind: JobLaunchKind;
  /** Opaque payload handed to the destination scene (route seed, district id, etc.). */
  payload?: Record<string, unknown>;
}

/* ──────────────────────────── The offer ──────────────────────────── */

/** One card on the Job Board. Wraps a Mission with modifiers + rewards + routing. */
export interface JobOffer {
  id: string;                    // stable per-generation id (seeded — see §4)
  title: string;                 // board headline, e.g. 'Supply Run: West Yards'
  flavor: string;                // one-line client/quest text
  mission: Mission;              // REUSED win condition (from MISSIONS or generated)
  modifiers: JobModifier[];      // run-altering conditions
  reward: JobReward;             // balanced bundle (§5)
  difficulty: number;            // computed score (§5.1), 0..~100, drives reward + UI tier
  launch: JobLaunch;             // GAME_RUN by default; special types route elsewhere
  expiresAtRunCount?: number;    // board generation index this offer belongs to (§4.3)
}

/** Persisted board state (one active board of 3 offers + bookkeeping). */
export interface JobBoardState {
  version: 1;
  seed: number;                  // rng seed that produced the current offers
  generation: number;            // increments each refresh (run counter)
  offers: JobOffer[];            // exactly 3
  acceptedOfferId: string | null;// set when player commits an offer for the next run
  rerollsRemaining: number;      // free rerolls left this generation (§4.4)
}
```

### Notes on the model

- `JobOffer.mission` is a **full `Mission`** (`MissionTypes.ts:104`). For most offers this is
  a reference to an entry in `MISSIONS` (`Missions.ts:6`); for procedurally-scaled offers it
  is a generated `Mission` with the same shape (§4.2). Either way `Game` resolves it through
  the existing path — see §6.2.
- `Mission.reward.blueprintPoints` (`MissionTypes.ts:109`) still exists, but the Job Board
  **supersedes** it: the canonical reward is `JobOffer.reward`. To avoid double-paying, the
  generator sets `offer.mission.reward = undefined` and the board awards `JobOffer.reward` at
  win time (§6.5). Keep `Mission.reward` working for the legacy Loadout path until it is
  removed (§9 step 9).
- `campaignPoints`, `hordePressureRelief`, and `campResources` are written through **camp /
  campaign systems defined in sibling docs**. This spec depends on those systems exposing:
  `CampaignSystem.addProgress(n)`, `CampSystem.relieveHordePressure(n)`,
  `CampSystem.addResource(CampResource, n)`. If those systems do not exist yet, §9 step 7
  ships thin localStorage-backed stubs mirroring `BlueprintSystem`'s static API
  (`BlueprintSystem.ts:28-36`).

---

## 3. Offer Generation — Authored / Procedural / Hybrid

**Recommendation: hybrid.** A small pool of **authored templates** defines the *shape* and
flavor of jobs; a **seeded procedural pass** instantiates them with scaled numbers and a
modifier roll, then computes difficulty and the matching reward bundle (§5). This keeps jobs
hand-readable and thematic while giving each board fresh, balanced variety.

New file: `src/game/config/JobTemplates.ts`.

```ts
// src/game/config/JobTemplates.ts
import { JobModifier, JobLaunchKind } from '../types/JobBoardTypes';
import { MissionConditionKind } from '../types/MissionTypes';

/** A template that the generator scales + rolls modifiers onto. */
export interface JobTemplate {
  id: string;                          // template id, e.g. 't_supply_run'
  titlePool: string[];                 // headline variants
  flavorPool: string[];
  conditionKind: MissionConditionKind; // which win condition to instantiate
  /** Numeric range for the condition's primary target (kills/seconds/etc). */
  targetRange: [number, number];
  /** Modifiers that MAY roll onto this template, each with a probability + magnitude band. */
  modifierTable: Array<{ make: (tier: number) => JobModifier; weight: number }>;
  /** Reward emphasis: how the reward budget (§5) is split across the 4 currencies. */
  rewardEmphasis: Partial<Record<'blueprints'|'campaign'|'horde'|'resources', number>>;
  launchKind?: JobLaunchKind;          // default GAME_RUN; set for special jobs
  minTier?: number;                    // gate harder templates behind progression
}
```

Authored templates (initial set, mapping to the 9 conditions in `Missions.ts:6` plus the 2
specials):

| Template | conditionKind | rewardEmphasis | launchKind |
| --- | --- | --- | --- |
| Supply Run | KILL_COUNT | resources-heavy | GAME_RUN |
| Hold the Perimeter | SURVIVE_TIME | horde-relief-heavy | GAME_RUN |
| Pest Control | KILL_TYPE / PURGE_TYPE | resources + blueprints | GAME_RUN |
| Beacon Defense | HOLD_ZONE | horde-relief + campaign | GAME_RUN |
| Elite Bounty | KILL_ELITES | blueprints-heavy | GAME_RUN |
| Decapitation | SLAY_BOSS | campaign-heavy | GAME_RUN |
| Ghost Protocol | FLAWLESS_WINDOW | blueprints-heavy | GAME_RUN |
| Salvage Sweep | COLLECT_DROPS | resources-heavy | GAME_RUN |
| **Long Recon** | SURVIVE_TIME (nominal) | campaign + blueprints | **LONG_RECON** |
| **City Reclamation** | HOLD_ZONE (nominal) | campaign + horde-relief | **CITY_RECLAMATION** |

For the two specials, the wrapped `Mission` is **nominal** — the win condition is evaluated
inside the sub-loop scene, not by `MissionSystem`. The board only needs the title/flavor/
difficulty/reward; `launch.kind` routes the rest (§6.4).

---

## 4. Generation & Refresh Algorithm

New file: `src/game/systems/JobBoardSystem.ts` — a **static system** mirroring
`BlueprintSystem` (`BlueprintSystem.ts:27`): all state in `localStorage`, no instance.

### 4.1 Generating a board (3 offers)

```
generateBoard(seed, generation, tier):
  rng = mulberry32(seed)                     // deterministic, seed-reproducible
  picked = weightedSampleWithoutReplacement(  // 3 distinct templates
             JOB_TEMPLATES.filter(t => (t.minTier ?? 0) <= tier), 3, rng)
  offers = picked.map((tmpl, i) => instantiate(tmpl, rng, tier, generation, i))
  // Guarantee variety: at most one special (LONG_RECON/CITY_RECLAMATION) per board.
  enforceAtMostOneSpecial(offers, rng)
  // Guarantee a low-friction option: ensure >=1 offer with difficulty < EASY_CAP.
  ensureAtLeastOneEasy(offers, tmplPool, rng)
  return offers
```

`instantiate(tmpl, rng, tier, generation, i)`:
1. Roll the primary target in `tmpl.targetRange`, biased up by `tier`.
2. Build the wrapped `Mission` (reuse the matching condition interface from
   `MissionTypes.ts`). For authored 1:1 conditions, optionally start from the concrete entry
   in `MISSIONS` (`Missions.ts:6`) and override the target.
3. Roll modifiers from `tmpl.modifierTable` (0–3 modifiers, weighted; higher tier → more).
4. Compute `difficulty` (§5.1).
5. Compute `reward` from difficulty + `tmpl.rewardEmphasis` (§5.2).
6. Assign `launch` (`tmpl.launchKind ?? GAME_RUN`).
7. `id = \`${generation}_${i}_${tmpl.id}\``, `expiresAtRunCount = generation`.

`mulberry32` is a ~5-line seeded PRNG; add it to `src/game/utils/Rng.ts`. Seeding makes
boards reproducible (testing, and "same board across reloads until you act").

### 4.2 Procedural vs authored split

- **Authored:** template identity, flavor text, condition kind, reward emphasis, modifier
  *menu*. Designers control the feel.
- **Procedural:** exact targets, which modifiers roll and their magnitudes, the difficulty
  score, and the reward numbers. Generator controls the balance.

### 4.3 Refresh policy — **when do offers change?**

| Event | Behavior |
| --- | --- |
| First open, no saved board | Generate generation 0 from a fresh seed (default `Date.now() & 0xffffffff`). |
| Re-open board, same generation, **not yet acted** | Show the **same** offers (seed-stable). The board is a standing choice, not a slot machine. |
| Player **accepts** an offer → run starts | Record `acceptedOfferId`; do **not** regenerate yet (the run might be abandoned/lost). |
| Run **resolves** (win OR lose) | On return to the board, `generation++`, new seed, fresh 3 offers, `rerollsRemaining` reset, `acceptedOfferId = null`. **A completed/failed run consumes the board.** |
| Player **rerolls** (manual) | Regenerate the 3 offers with a *new* seed but **same generation**; decrement `rerollsRemaining` (§4.4). |

Rationale: refresh-on-resolve (not on a wall clock) keeps the loop deterministic, test-able,
and fair — the player commits to a board, plays it out, and a new board greets them. No
real-time timers, no FOMO clocks. (A timed/daily board is a possible later variant — §8.)

### 4.4 Reroll rules

- `rerollsRemaining` starts at `FREE_REROLLS_PER_BOARD` (default **1**) each generation.
- Free reroll: regenerate all 3 offers (new seed, same generation), `rerollsRemaining--`.
- **Paid reroll** (after free ones exhausted): spend a small Blueprint-point cost
  (`REROLL_BP_COST`, default **1**) via `BlueprintSystem.unlock`-style debit
  (`BlueprintSystem.setPoints`, `BlueprintSystem.ts:35`). If the player can't afford it, the
  reroll button is disabled.
- Reroll **never** rerolls a single card — it rerolls the whole board (simpler, prevents
  cherry-picking degenerate combos).

---

## 5. Reward-Balancing Formula

### 5.1 Difficulty score

`difficulty` is a single number (~0–100) combining the **base mission difficulty** and the
**modifier load**.

```
baseDifficulty(mission):
  // Per-condition base weights, calibrated against Missions.ts difficulty (1..5).
  // Reuse the authored Mission.difficulty (MissionTypes.ts:111) as the anchor.
  base = (mission.difficulty ?? estimateFromCondition(mission)) * 10   // → 10..50

  // Target scaling within a condition: bigger target = harder.
  base *= targetScale(mission.condition)   // 0.8 .. 1.6

modifierDifficulty(modifiers):
  sum over each modifier of its difficulty delta:
    ENEMY_DENSITY    → (multiplier - 1) * 25
    ELITE_CADENCE    → (90000 / intervalMs - 1) * 18
    BOSS_TIMING      → max(0, (300 - spawnAtSeconds) / 300) * 30   // earlier boss = harder
    HAZARD_FIELD     → patchCount * (hazard === 'fire' ? 5 : 4)
    TIME_LIMIT       → tighterIsHarder(seconds, mission) → 8..30
    ENEMY_BUFF       → ((hpMul-1) * 20) + ((spdMul-1) * 25)
    SCARCITY         → (1 - dropRateMultiplier) * 15
    TYPE_INFESTATION → +3 flat (mild; it also *helps* type missions — small net)

difficulty = clamp(baseDifficulty + modifierDifficulty, 1, 100)
```

`estimateFromCondition` provides a fallback ranking when `mission.difficulty` is absent,
matching the authored ordering in `Missions.ts` (e.g. SLAY_BOSS=5, FLAWLESS/PURGE=4,
KILL_TYPE/HOLD_ZONE/KILL_ELITES=3, SURVIVE=2, KILL_COUNT/COLLECT=1–2).

### 5.2 Reward budget → 4-currency split

A single **reward budget** scales linearly-ish with difficulty, then splits across the four
currencies by the template's `rewardEmphasis`.

```
rewardBudget(difficulty) = ceil(BASE_BUDGET + difficulty * BUDGET_PER_DIFF)
                           // e.g. BASE_BUDGET=2, BUDGET_PER_DIFF=0.18  → diff 50 ≈ 11 budget

splitReward(budget, emphasis):
  weights = normalize(emphasis)          // e.g. {resources:0.6, blueprints:0.4}
  per-currency budget = budget * weight
  convert each currency budget via its exchange rate:
    blueprints:          1 budget  = 1 blueprint point      (rare, high value)
    campaignPoints:      1 budget  = 1 campaign point
    hordePressureRelief: 1 budget  = HORDE_RELIEF_PER_BUDGET (e.g. 5 threat units)
    campResources:       1 budget  = RES_PER_BUDGET units, distributed across
                                     emphasized resources (e.g. 4 food per budget)
  round to ints; drop zero buckets
```

**Invariant (the balance contract):** for any two offers A and B,
`difficulty(A) > difficulty(B)  ⇒  rewardBudget(A) >= rewardBudget(B)`. The split changes the
*flavor* of the payout (a horde-relief job vs a blueprint job) but never lets a harder job pay
strictly less total value. Unit-test this invariant over a large sample of generated boards.

### 5.3 Tuning constants (one place)

Put all magic numbers in `src/game/config/JobBoardConfig.ts`:
`BASE_BUDGET`, `BUDGET_PER_DIFF`, `HORDE_RELIEF_PER_BUDGET`, `RES_PER_BUDGET`,
`FREE_REROLLS_PER_BOARD`, `REROLL_BP_COST`, `EASY_CAP`, `EXCHANGE_RATES`. This mirrors how
`mission-system.md` keeps tuning loud and centralized.

---

## 6. Scene / Flow Integration

### 6.1 Where the board sits

Current flow: `MainMenu → Loadout → Game → GameOver → (MainMenu)`
(`MainMenu.ts:140` → `Loadout.ts:167` → `GameOver`).

New flow inserts the Job Board **before** Loadout, so the player picks *what* job, then plans
their *loadout* for it (loadout planning is detailed in `outer-loop-expedition-loadout.md`):

```
MainMenu ──► JobBoard ──► Loadout ──► Game ──► GameOver
   ▲            │  ▲                              │
   │            │  └──────────── back ────────────┘  (on resolve: generation++, fresh board)
   └──── back ──┘
```

- `MainMenu` "Play" routes to `JobBoard` instead of `Loadout`
  (change `MainMenu.ts:140` target `SceneKey.Loadout` → `SceneKey.JobBoard`).
- `JobBoard` "Accept" sets `acceptedOfferId`, persists the chosen mission into the existing
  loadout path (§6.2), then `scene.start(SceneKey.Loadout)`.
- `Loadout` keeps character / defensive / killstreak selectors but **removes** its own mission
  grid (`Loadout.ts:116-156`) — mission choice now lives on the board. Loadout shows the
  accepted job as a read-only banner instead.
- On `GameOver`, the existing "back to menu" path triggers a board refresh on next open
  (§4.3) because `JobBoardSystem.onRunResolved()` is called from `GameOver.create()`.

### 6.2 Handing the chosen mission to the run (minimal wiring)

`Game.create()` already resolves its mission via
`resolveMission(LoadoutManager.getInstance().getMissionId())` (`Game.ts:172`). Reuse this:

1. On Accept, `JobBoardSystem.setAcceptedOffer(offer)` persists the offer **and** writes
   `LoadoutManager.setMissionId(offer.mission.id)` (`LoadoutManager.ts:54`) so the existing
   resolution path still works for the common case.
2. For **generated** missions not present in `MISSIONS`, store the full offer (with its
   `Mission`) in `JobBoardState.acceptedOfferId` + offer record, and have `Game.create()`
   prefer the accepted offer's mission when present:
   ```ts
   // Game.create(), replacing the resolve at Game.ts:172
   const offer = JobBoardSystem.getAcceptedOffer();
   this.activeMission = offer?.mission
       ?? resolveMission(LoadoutManager.getInstance().getMissionId());
   this.activeModifiers = offer?.modifiers ?? [];
   this.activeReward = offer?.reward ?? null;
   ```
   `MissionSystem` construction at `Game.ts:173` is unchanged — it just receives this mission.

### 6.3 Applying run modifiers

Apply `this.activeModifiers` in `Game.create()` right after the systems are built (near the
mission wiring at `Game.ts:172-174`), each mapping to an `EnemySpawnSystem` / `Game` knob:

| Modifier | Applied via |
| --- | --- |
| ENEMY_DENSITY | `EnemySpawnSystem.setSpawnMultiplier(m)` (new thin setter) |
| ELITE_CADENCE | `EnemySpawnSystem.setEliteIntervalMs(ms)` (flagged as future work in `mission-system.md` §11) |
| BOSS_TIMING | schedule `EnemySpawnSystem.triggerBoss()` at `spawnAtSeconds` (public per `mission-system.md` §7) |
| HAZARD_FIELD | seed N hazard zones at run start (toxic reuses existing toxic-cloud logic; fire reuses Inferno Lance patch visuals) |
| TIME_LIMIT | `Game` schedules a `delayedCall(seconds*1000)` → if mission not complete, force LOSE through the existing death path (`Player.die`-equivalent transition to `GameOver` with `outcome:'lose'`) |
| ENEMY_BUFF | apply hp/speed multipliers on enemy spawn (new spawn hook) |
| SCARCITY | scale `GameConstants.ENEMIES.PICKUP_DROP_RATE` for the run |
| TYPE_INFESTATION | bias the spawn director toward `enemyType` (the `forceState`/chance-floor hook noted in `mission-system.md` §11) |

Most setters are small additions; none touch `MissionSystem`. Modifiers that aren't yet
backed by a setter degrade gracefully (no-op + console warn) so the board can ship before
every knob exists.

### 6.4 Special offers — routing into sub-loops

On Accept, branch on `offer.launch.kind`:

```ts
switch (offer.launch.kind) {
  case JobLaunchKind.GAME_RUN:
    LoadoutManager.getInstance().setMissionId(offer.mission.id);
    this.scene.start(SceneKey.Loadout);            // → normal run
    break;
  case JobLaunchKind.LONG_RECON:
    this.scene.start(SceneKey.RouteMap, offer.launch.payload);   // outer-loop-route-map.md
    break;
  case JobLaunchKind.CITY_RECLAMATION:
    this.scene.start(SceneKey.CityReclamation, offer.launch.payload); // outer-loop-city-reclamation.md
    break;
}
```

`SceneKey.RouteMap` and `SceneKey.CityReclamation` are owned by those sibling docs; this spec
only requires that they exist and accept a payload, and that on completion they call
`JobBoardSystem.onRunResolved()` + award `offer.reward` the same way a normal run does (§6.5).
Until those scenes land, the special templates are gated out of generation by `minTier`
(§3) / a feature flag, so the board ships standalone.

### 6.5 Awarding rewards on success

A run/sub-loop "succeeds" when its win condition resolves. For normal runs that is
`mission_complete` → `handleMissionComplete()` (`Game.ts:809`) → `GameOver` with
`outcome:'win'`. Award the **offer reward** (not `Mission.reward`) at the win site:

```ts
// in the win path that today awards Mission.reward.blueprintPoints (GameOver.ts:94-95):
const reward = JobBoardSystem.getAcceptedOffer()?.reward;
if (reward && outcome === 'win') {
  if (reward.blueprintPoints)      BlueprintSystem.addPoints(reward.blueprintPoints);   // (a)
  if (reward.campaignPoints)       CampaignSystem.addProgress(reward.campaignPoints);   // (b)
  if (reward.hordePressureRelief)  CampSystem.relieveHordePressure(reward.hordePressureRelief); // (c)
  for (const [res, n] of Object.entries(reward.campResources ?? {}))                    // (d)
    CampSystem.addResource(res as CampResource, n);
}
JobBoardSystem.onRunResolved();   // consume the board → next open regenerates (§4.3)
```

`onRunResolved()` is called for **both** win and lose (it bumps `generation`); reward award
is gated on `outcome === 'win'`. On a lose, the board still refreshes but pays nothing
(failed jobs are gone). The GameOver win panel should surface the full bundle, extending the
existing `+N Blueprint Points` line (`GameOver.ts:94-95`).

---

## 7. UI — The JobBoard Scene

New file: `src/game/scenes/JobBoard.ts` (Phaser `Scene`, key `SceneKey.JobBoard`). Style
matches the existing text-driven scenes (`Loadout.ts`, `Blueprints.ts`).

### 7.1 Layout

- Title `Job Board` (top center), and a currencies strip showing current balances: Blueprint
  points (`BlueprintSystem.getPoints()`, `BlueprintSystem.ts:28`), campaign progress, camp
  horde-pressure level, and food/water/medicine — read from the camp/campaign systems.
- **Three offer cards** laid out horizontally (or stacked on narrow screens), each showing:
  title + flavor; the **objective** (derive from `mission.condition` — reuse the label logic
  in `MissionSystem.getDetailLabel()`, `MissionSystem.ts:247`, or a static formatter so the
  board needn't instantiate a runtime); a **modifier list** (human-readable, e.g. "+50%
  density", "Boss at 2:00", "Toxic fields ×3"); a **difficulty tier badge** (map
  `offer.difficulty` to Easy/Med/Hard/Brutal); and the **reward bundle** with currency icons.
  Special offers (Long Recon / City Reclamation) get a distinct frame/color.
- Buttons: per-card **Accept**; a single **Reroll** (shows `rerollsRemaining` and the paid
  cost when free ones are spent, §4.4); **Back** → `MainMenu`.

### 7.2 Interaction

- Hover highlights a card (mirror the `pointerover`/`pointerout` color swaps used throughout
  `Loadout.ts:44-45`, `Blueprints.ts:28`).
- Accept → `JobBoardSystem.setAcceptedOffer(offer)` then route per `launch.kind` (§6.4).
- Reroll → `JobBoardSystem.reroll()`; rebuild the three cards in place; disable when no free
  rerolls and points < `REROLL_BP_COST`.

### 7.3 Loadout banner

`Loadout` gains a read-only banner at top: "Job: {title} — {objective}  •  Reward: {bundle}".
Replaces the removed mission grid (`Loadout.ts:116-156`). Source it from
`JobBoardSystem.getAcceptedOffer()`.

### 7.4 Special-offer screens

Long Recon and City Reclamation render their own scenes (sibling docs). From the board's
perspective they are just cards with a special frame and a route on Accept (§6.4).

---

## 8. Persistence (localStorage shape)

Single key, mirroring `BlueprintSystem`'s storage discipline (`BlueprintSystem.ts:5-6`,
`:40-49` — crash-proof JSON read with a safe fallback).

```
Key:   'zs2_jobboard_v1'
Value: JSON.stringify(JobBoardState)   // see §2

{
  "version": 1,
  "seed": 1734736000,
  "generation": 7,
  "offers": [ /* exactly 3 JobOffer */ ],
  "acceptedOfferId": "7_1_t_supply_run",
  "rerollsRemaining": 1
}
```

`JobBoardSystem` static API (mirrors `BlueprintSystem.ts:27-85`):

```ts
class JobBoardSystem {
  static getState(): JobBoardState;                  // safe-read; regenerate if missing/corrupt
  static getOffers(): JobOffer[];                    // current 3 (generates on first call)
  static reroll(): boolean;                          // free or paid; false if unaffordable
  static setAcceptedOffer(offer: JobOffer): void;    // persist + mirror to LoadoutManager
  static getAcceptedOffer(): JobOffer | null;
  static onRunResolved(): void;                      // generation++, fresh board, clear accept
  private static save(s: JobBoardState): void;
  private static safeRead(): JobBoardState | null;   // try/catch JSON like readUnlockedArray
}
```

The four reward currencies persist in **their own systems' storage** (Blueprint points
already at `zs2_bp_points`, `BlueprintSystem.ts:6`; campaign + camp keys defined by the
sibling docs). The board never owns currency balances — it only emits reward deltas.

---

## 9. Implementation Checklist (ordered, file-by-file)

1. **`src/game/types/JobBoardTypes.ts`** (new). `JobModifierKind` + modifier interfaces +
   `JobModifier` union; `CampResource`, `JobReward`; `JobLaunchKind`, `JobLaunch`; `JobOffer`;
   `JobBoardState` (§2). Reuse `Mission` from `MissionTypes.ts` — do not redefine conditions.

2. **`src/game/config/JobBoardConfig.ts`** (new). All tuning constants + `EXCHANGE_RATES`
   (§5.3).

3. **`src/game/utils/Rng.ts`** (new). `mulberry32(seed)` + `weightedSampleWithoutReplacement`.

4. **`src/game/config/JobTemplates.ts`** (new). `JobTemplate` interface + `JOB_TEMPLATES`
   array (§3), including the two special templates gated by `minTier` / feature flag.

5. **`src/game/systems/JobBoardSystem.ts`** (new). Static system: `generateBoard`,
   `instantiate`, difficulty + reward formulas (§4, §5), reroll, accept, `onRunResolved`,
   localStorage persistence with safe-read (mirror `BlueprintSystem.ts:40-49`). Unit-test the
   reward-monotonicity invariant (§5.2).

6. **`src/game/config/SceneKeys.ts`** — add `JobBoard = 'JobBoard'` (and, when sibling docs
   land, `RouteMap`, `CityReclamation`) to the enum (`SceneKeys.ts:1-12`).

7. **Camp / campaign reward sinks** — ensure `CampaignSystem.addProgress`,
   `CampSystem.relieveHordePressure`, `CampSystem.addResource` exist (owned by
   `outer-loop-survivor-camp.md`). If not yet present, ship thin localStorage stubs modeled on
   `BlueprintSystem` so the board can award all four currencies today.

8. **`src/game/scenes/JobBoard.ts`** (new). The board UI (§7): currencies strip, 3 cards,
   reroll, accept routing (§6.4), back. Register it in **`src/game/main.ts`** scene array
   (`main.ts:22-33`).

9. **`src/game/scenes/MainMenu.ts`** — change Play target from `SceneKey.Loadout` to
   `SceneKey.JobBoard` (`MainMenu.ts:140`).

10. **`src/game/scenes/Loadout.ts`** — remove the mission grid (`Loadout.ts:18-19`, `:116-156`)
    and its `MISSIONS` import (`Loadout.ts:6`); add a read-only accepted-job banner sourced
    from `JobBoardSystem.getAcceptedOffer()` (§7.3). Keep character/defensive/killstreak.

11. **`src/game/scenes/Game.ts`** — prefer the accepted offer's mission + capture modifiers +
    reward in `create()` (replace the resolve at `Game.ts:172`, §6.2); apply modifiers near
    `Game.ts:172-174` (§6.3). No change to `MissionSystem` construction (`Game.ts:173`).

12. **`EnemySpawnSystem` setters** — add the thin knobs modifiers need (`setSpawnMultiplier`,
    `setEliteIntervalMs`, type-bias / chance-floor, enemy buff hook). Several are already
    flagged as future work in `mission-system.md` §11. Unbacked modifiers no-op + warn.

13. **`src/game/scenes/GameOver.ts`** — award `JobOffer.reward` across all four currencies on
    win (replace the blueprint-only award at `GameOver.ts:94-95`, §6.5); call
    `JobBoardSystem.onRunResolved()` on both win and lose; extend the win panel to show the
    full bundle.

14. **(Special offers)** When `outer-loop-route-map.md` / `outer-loop-city-reclamation.md`
    ship their scenes, ungate the special templates and have those scenes award
    `offer.reward` + call `onRunResolved()` on completion (§6.4).

15. **(Cleanup, later)** Remove `Mission.reward` (`MissionTypes.ts:109`) and the legacy
    blueprint-only award once all entry points go through the board.

---

## 10. Acceptance Criteria

- Opening the board shows exactly 3 offers, each with objective, modifiers, difficulty tier,
  and a reward bundle drawn from the four currencies.
- Re-opening the board without acting shows the **same** offers; rerolling replaces all three;
  completing or failing a run yields a **fresh** board next open (§4.3).
- Accepting a normal offer launches a run whose win condition is the offer's `Mission`
  (verified via `MissionSystem` unchanged) and whose run is altered by the offer's modifiers.
- Winning awards the offer's reward across all four currencies (blueprints land in
  `BlueprintSystem`; campaign/horde/resources land in their systems); losing awards nothing.
- For any generated board, the reward-monotonicity invariant holds:
  higher difficulty ⇒ ≥ total reward budget (§5.2) — covered by a unit test over many seeds.
- Long Recon / City Reclamation offers route to their sub-loop scenes via `launch.kind`
  (or are cleanly gated out until those scenes exist).
- Persistence survives reload and is crash-proof against corrupt JSON (mirrors
  `BlueprintSystem.readUnlockedArray`, `BlueprintSystem.ts:40-49`).
- `MissionTypes.ts` and `MissionSystem.ts` are **not** modified by this feature.

---

## 11. Open Questions / Risks

1. **Reward currency conversion rates** (§5.2) are guesses until the camp economy
   (`outer-loop-survivor-camp.md`) defines what a "food unit" or "threat unit" is worth.
   Treat `EXCHANGE_RATES` as provisional; co-tune with the camp doc.
2. **Generated vs catalog missions in `Game.create()`** — §6.2 prefers the accepted offer's
   `Mission` over `resolveMission`. Confirm no other code path reads only
   `LoadoutManager.getMissionId()` and would miss a generated mission. (Today only `Game.ts:172`
   does; the board mirrors the id there as a belt-and-suspenders fallback.)
3. **TIME_LIMIT forcing a LOSE** (§6.3) needs a non-death lose transition. Reuse the
   GameOver-with-`outcome:'lose'` path but originate it from `Game` (a timer) rather than
   `Player.die`. Ensure the `runEnded` latch (`Game.ts:564`) prevents double transitions.
4. **Modifier ↔ win-condition antagonism.** E.g. SCARCITY on a COLLECT_DROPS job, or
   TYPE_INFESTATION that *helps* a KILL_TYPE job. The generator should bias toward modifiers
   that add friction (and the difficulty formula already gives TYPE_INFESTATION a near-neutral
   delta). Add a per-template `incompatibleModifiers` denylist if degenerate combos appear.
5. **Special-offer rewards on partial completion.** Sub-loops may have multiple objectives /
   partial success; define whether partial sub-loop progress pays partial reward (likely yes —
   defer to the sub-loop docs).
6. **Difficulty of `mission.difficulty` absence for generated missions.** The fallback
   `estimateFromCondition` (§5.1) must stay in sync with `Missions.ts` ordering; centralize the
   per-condition base weights so both the catalog and the generator read one source.
7. **Board variety guarantees** (§4.1: ≥1 easy, ≤1 special) can fail if the template pool is
   too small at low `tier`. Ensure `JOB_TEMPLATES` has enough `minTier:0` entries to always
   fill 3 distinct cards including one easy.
8. **Timed/daily board variant.** §4.3 chose refresh-on-resolve. A real-time daily board
   (seeded by date) is a later option but introduces FOMO and breaks determinism — out of
   scope for v1.
