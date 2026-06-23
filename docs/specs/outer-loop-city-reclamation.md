# Outer Loop — City Reclamation — Implementation Spec

Status: Draft / design doc (no code yet)
Author: Game systems design
Target: `zombie-survivors-2` (Phaser 3 + TypeScript)
Part of: **Outer Loop** meta-layer (Design Doc 4 of the set)

> **Sibling docs (forward references).** This doc cross-references four parallel outer-loop
> specs that live under `docs/specs/`:
> - `outer-loop-survivor-camp.md` — vendors/facilities that zones unlock.
> - `outer-loop-weapon-unlocks.md` — special blueprints that cleared zones reveal.
> - `outer-loop-job-board.md` — where infestation-reduction missions appear as jobs.
> - `outer-loop-route-map.md` — "Long Recon" multi-objective routes a zone can become.
>
> Where those docs are not yet written, this spec defines the **interface** City Reclamation
> exposes to them (events, unlock-table shape, IDs) so they can bind to it. Treat the
> interface here as canonical; the sibling docs own the content behind the IDs.

---

## 1. Purpose & Summary

The game today is a single endless/mission run with a thin meta layer: **Blueprint points**
spent on permanent perks (`BlueprintSystem`, `src/game/systems/BlueprintSystem.ts:27-85`) and
a **Mission** picked per run (`docs/specs/mission-system.md`; catalog at
`src/game/config/Missions.ts:6-90`). There is no persistent *world* — every run starts and
ends in the same featureless arena, and there is no sense of **territory reclaimed**.

This spec adds **City Reclamation**: a persistent meta-map that turns the act of running
missions into the act of *taking back a city from the horde*. The world is a set of
**Cities**; each City is a grid/node map of **Zones**; each Zone carries an **infestation**
value (0–100). Completing missions **in** or **adjacent to** a zone lowers its infestation;
crossing thresholds advances the zone through a state machine **INFESTED → CONTESTED →
CLEARED**. Clearing zones is the **engine of the entire outer loop**:

- **Unlocks vendors/facilities** in the Survivor Camp (`outer-loop-survivor-camp.md`).
- **Reveals special blueprints** — weapons and relics gated behind territory
  (`outer-loop-weapon-unlocks.md`), extending `BLUEPRINTS` (`BlueprintSystem.ts:8-25`).
- **Lowers regional horde pressure**, feeding back into run difficulty (a reclaimed region
  spawns easier jobs; an overrun one spawns harder ones).

When **every zone in a city is CLEARED**, the city is **reclaimed** and the player **advances
to the next city** — a new biome, a harder enemy mix, and a fresh tier of blueprints. This
gives the whole game a **campaign spine** and the core zombie-survivor power fantasy: *you do
not just survive the night, you take the map back, block by block, city by city.*

The design is **persistence-first and event-driven**: City Reclamation owns a `localStorage`
document, listens for one new meta event (`mission_won_meta`) emitted at the existing WIN
transition, applies an **infestation-reduction formula**, recomputes zone/city state, and
fires unlock events. It adds **zero per-frame cost** to the in-run loop — all of its work
happens between runs, on the meta-map scene.

### Key existing facts this spec builds on

| Fact | Source |
| --- | --- |
| Win transition exists; a mission completing is a WIN | `docs/specs/mission-system.md` §7–§8 (`Game.handleMissionComplete()` → `GameOver` with `outcome:'win'`) |
| Mission catalog + resolver | `MISSIONS` / `resolveMission()` — `src/game/config/Missions.ts:6-100` |
| Mission selection persists per loadout | `LoadoutManager.getMissionId()` — `src/game/systems/LoadoutManager.ts:54-55` |
| Mission win awards Blueprint points | `Mission.reward.blueprintPoints` — `src/game/types/MissionTypes.ts:109`; `BlueprintSystem.addPoints()` — `BlueprintSystem.ts:36` |
| Conditions reusable for zone jobs | `MissionCondition` union — `src/game/types/MissionTypes.ts:92-101` |
| Meta currency + unlock list pattern (crash-proof storage) | `BlueprintSystem.readUnlockedArray()` — `BlueprintSystem.ts:40-49` |
| Blueprints are the special-unlock vehicle | `BLUEPRINTS` — `BlueprintSystem.ts:8-25`; `Blueprints` scene — `src/game/scenes/Blueprints.ts` |
| Loadout content unlocked by meta | `CHARACTERS` — `LoadoutManager.ts:10-14`; vendors/facilities (sibling camp doc) |
| Scene flow hub | `MainMenu` buttons → `Loadout` / `Blueprints` / `SpawnTuner` — `src/game/scenes/MainMenu.ts:140-153` |
| Scene registry | `SceneKey` enum — `src/game/config/SceneKeys.ts:1-12` |
| Enemy types (biome enemy mix) | `EnemyType { BASIC, FAST, TANK, RANGED, CARRIER, TOXIC }` — `src/game/types/GameTypes.ts:55-62` |
| localStorage key convention | `zs2_*` (e.g. `zs2_bp_points`, `zs2_loadout_mission`) |

---

## 2. Data Model

New file: `src/game/types/CityTypes.ts`. (Zone missions **reuse** `MissionCondition` from
`src/game/types/MissionTypes.ts:92-101` — they do not redefine objective logic.)

```ts
// src/game/types/CityTypes.ts
import { EnemyType } from './GameTypes';
import { MissionCondition } from './MissionTypes';

/** A zone moves INFESTED -> CONTESTED -> CLEARED as infestation drops past thresholds. */
export enum ZoneState {
  INFESTED  = 'infested',   // infestation > CONTESTED_THRESHOLD
  CONTESTED = 'contested',  // CLEARED_THRESHOLD < infestation <= CONTESTED_THRESHOLD
  CLEARED   = 'cleared',    // infestation <= CLEARED_THRESHOLD (effectively 0)
}

/** What clearing this zone grants. All entries are additive and idempotent. */
export interface ZoneRewards {
  blueprintIds?: string[];   // special blueprints revealed -> see outer-loop-weapon-unlocks.md
  vendorIds?:    string[];   // camp vendors/facilities unlocked -> see outer-loop-survivor-camp.md
  blueprintPoints?: number;  // one-time meta-currency grant (BlueprintSystem.addPoints)
  hordePressureDelta?: number; // additive regional pressure change (usually negative)
}

/** Designer-authored, immutable zone definition (the "blueprint" of a zone). */
export interface ZoneDef {
  id: string;                 // stable, city-unique, e.g. 'nyc_z_03'
  name: string;               // 'Harbor District'
  cityId: string;             // owning city
  grid: { col: number; row: number }; // position on the city grid (for layout + adjacency)
  adjacency: string[];        // ids of neighboring zones (explicit; not derived from grid)
  baseInfestation: number;    // starting infestation 0..100 (deeper zones start higher)
  /**
   * The job(s) that reduce this zone. Each is a MissionCondition reused verbatim from the
   * mission system. A zone with multiple jobs that must ALL be done before it can clear is
   * effectively a "Long Recon" route -> see outer-loop-route-map.md.
   */
  jobs: ZoneJobDef[];
  isLongRecon?: boolean;      // true => surfaced on the Route Map, not the plain Job Board
  rewards: ZoneRewards;       // granted once on CLEARED
  /** Optional: a zone can require an adjacent zone to be at least CONTESTED before it opens. */
  requiresZoneId?: string;
}

/** One job attached to a zone. Reuses MissionCondition; adds infestation weighting. */
export interface ZoneJobDef {
  id: string;                 // stable, e.g. 'nyc_z_03_j1'
  name: string;               // 'Cull the Harbor'
  condition: MissionCondition; // REUSED from mission system (kill/survive/hold/purge/...)
  /** How much infestation a single win of THIS job removes from its own zone. */
  infestationReward: number;  // points removed from this zone on win (pre-adjacency)
  /** Optional reward override layered on the mission's own reward.blueprintPoints. */
  bonusBlueprintPoints?: number;
  repeatable: boolean;        // grindable for partial reduction, or one-shot?
}

/** Designer-authored city definition. */
export interface CityDef {
  id: string;                 // 'city_nyc'
  name: string;               // 'New York Ruins'
  order: number;              // campaign order (0 = first city)
  biome: BiomeId;             // drives visuals + enemy mix
  zones: ZoneDef[];           // the city's zone graph
  /** Enemy-mix weighting for runs launched from this city (escalation knob). */
  enemyMix: Partial<Record<EnemyType, number>>; // weight per type; missing => baseline
  difficultyScalar: number;   // global multiplier applied to spawn rate / HP for this city
  reward: CityReward;         // granted once the WHOLE city is reclaimed
}

export enum BiomeId {
  URBAN_RUINS   = 'urban_ruins',   // city 1
  FLOODED_DELTA = 'flooded_delta', // city 2
  ASH_WASTES    = 'ash_wastes',    // city 3
  FROZEN_SPRAWL = 'frozen_sprawl', // city 4+
}

export interface CityReward {
  blueprintIds?: string[];    // tier-up weapon/relic blueprints
  blueprintPoints?: number;
  unlocksCityId?: string;     // the next city (campaign chaining)
}

/* ---------------- Live, persisted runtime state ---------------- */

/** Per-zone mutable state, persisted to localStorage. */
export interface ZoneState_Live {
  infestation: number;        // current 0..100
  state: ZoneState;           // derived from infestation, cached for fast reads
  cleared: boolean;           // latched; once true, rewards already granted (idempotency)
  jobsCompleted: string[];    // ids of one-shot jobs already done
}

/** The whole persisted City Reclamation document (one per save). */
export interface CityReclamationSave {
  version: number;            // schema version for migrations
  currentCityId: string;      // the city the player is actively reclaiming
  zones: Record<string, ZoneState_Live>; // keyed by ZoneDef.id, across ALL discovered cities
  reclaimedCityIds: string[]; // cities fully cleared (campaign progress)
  grantedRewardKeys: string[];// idempotency ledger: 'zone:<id>' / 'city:<id>' already granted
}
```

### Thresholds & constants

```ts
// src/game/config/Cities.ts (constants section)
export const INFESTATION = {
  MAX: 100,
  MIN: 0,
  CONTESTED_THRESHOLD: 66, // infestation <= 66 => CONTESTED
  CLEARED_THRESHOLD: 5,    // infestation <= 5  => CLEARED (snap to 0)
} as const;
```

### Notes on the model

- **`ZoneState` is derived, not authored.** `infestation` is the single source of truth;
  `state` is recomputed from it (`deriveZoneState()`, §4) and cached for cheap UI reads.
- **Adjacency is explicit** (`ZoneDef.adjacency`) rather than inferred from `grid` so designers
  can hand-author irregular maps (rivers, walls) without changing the reduction math.
- **Reuse over reinvention.** A `ZoneJobDef.condition` is literally a `MissionCondition`
  (`src/game/types/MissionTypes.ts:92-101`). The run that satisfies it is an ordinary mission
  run; City Reclamation only cares about the *result*. A `ZoneJobDef` can be surfaced to the
  player via the Job Board (`outer-loop-job-board.md`), and a multi-job zone marked
  `isLongRecon` is surfaced via the Route Map (`outer-loop-route-map.md`).
- **Idempotency is first-class.** `grantedRewardKeys` is a ledger so re-clearing (or a double
  WIN event, or a corrupt reload) never double-grants blueprints/points. Mirrors the
  unlocked-id discipline in `BlueprintSystem.readUnlockedArray()` (`BlueprintSystem.ts:40-49`).

---

## 3. Infestation-Reduction Math

A mission win reduces infestation on the **target zone** and **bleeds** a fraction into
**adjacent** zones (clearing a block makes its neighbors easier — the regional-pressure
fantasy).

### 3.1 Inputs

| Input | Source |
| --- | --- |
| `job` (the `ZoneJobDef` satisfied) | passed in the `mission_won_meta` payload (§6) |
| `zone` (the owning `ZoneDef` + live state) | looked up by `job` |
| `job.infestationReward` | base points removed from the target zone |
| `difficultyTierBonus` | small bonus for harder mission `difficulty` (`Mission.difficulty`, `MissionTypes.ts:111`) |

### 3.2 Formula

```
// 1. Direct reduction on the target zone.
directDrop = job.infestationReward + difficultyTierBonus
zone.infestation = clamp(zone.infestation - directDrop, 0, 100)

// 2. Adjacency bleed: each neighbor loses a fraction of the direct drop.
ADJACENCY_BLEED = 0.35              // 35% bleeds to each neighbor
for n in zone.adjacency:
    neighbor.infestation = clamp(neighbor.infestation - directDrop * ADJACENCY_BLEED, 0, 100)

// 3. Snap-to-clear: tiny remainders finish the job.
if zone.infestation <= CLEARED_THRESHOLD: zone.infestation = 0

// 4. Recompute derived state for every zone touched (target + neighbors).
```

`difficultyTierBonus = (Mission.difficulty ?? 1 - 1) * 2` → 0..8 extra points, rewarding
harder objectives. Tunable; the multiplier lives in `Cities.ts` constants.

### 3.3 Worked example

`nyc_z_03` starts at `baseInfestation: 100`, has neighbors `[nyc_z_02, nyc_z_04]`, and a job
`infestationReward: 30` from a difficulty-3 mission (`difficultyTierBonus = 4`).

- Win #1: `directDrop = 34` → z03: `100 → 66` (now **CONTESTED**); z02/z04 each `-11.9`.
- Win #2: z03: `66 → 32`; neighbors bleed again.
- Win #3: z03: `32 → -2 → 0` → **CLEARED**, rewards granted, neighbors near-contested already.

So ~3 successful runs reclaim a fresh zone, and the surrounding zones are softened in the
process — exactly the "spreading safe territory" feel. Designers tune pace via
`baseInfestation`, `infestationReward`, and `ADJACENCY_BLEED`.

### 3.4 Repeatable vs one-shot jobs

- `repeatable: true` → the job stays available; each win re-applies the formula until the zone
  clears. Good for "grind the horde down" zones.
- `repeatable: false` → on first win the job id is pushed to `ZoneState_Live.jobsCompleted`
  and removed from the board; a zone may need its remaining jobs (or adjacency bleed) to
  finish clearing. A zone clears when `infestation <= CLEARED_THRESHOLD`, **regardless** of how
  many jobs remain — i.e. one-shot jobs are *contributions*, not gates, unless `requiresZoneId`
  or remaining infestation blocks it.

---

## 4. Zone State Machine

```
            infestation > 66                66 >= infestation > 5         infestation <= 5
          ┌───────────────────┐         ┌───────────────────────┐      ┌──────────────────┐
          │     INFESTED      │ ──────► │      CONTESTED        │ ───► │     CLEARED      │
          │  (red, heavy fog) │  drop   │ (amber, thinning fog) │ drop │ (green, clear)   │
          └───────────────────┘         └───────────────────────┘      └──────────────────┘
                  ▲                                                            │
                  └──────────── (infestation never rises in v1; see §10) ──────┘
```

```ts
function deriveZoneState(infestation: number): ZoneState {
  if (infestation <= INFESTATION.CLEARED_THRESHOLD) return ZoneState.CLEARED;
  if (infestation <= INFESTATION.CONTESTED_THRESHOLD) return ZoneState.CONTESTED;
  return ZoneState.INFESTED;
}
```

**Transitions are one-way in v1** (infestation only decreases). On the **CLEARED** edge,
`CityReclamationSystem.applyZoneCleared()` runs once (guarded by `grantedRewardKeys`):
1. Grant `ZoneRewards` (blueprints revealed, vendors unlocked, points, pressure delta).
2. Emit `zone_cleared { zoneId, cityId, rewards }` for the Camp / Weapon-Unlocks systems.
3. Re-evaluate the **city**: if *all* zones in `currentCityId` are CLEARED, run
   `applyCityReclaimed()` (§7).

> **Optional v2 — re-infestation.** A "horde resurgence" event could raise infestation on a
> cleared zone over real time or on certain run failures, making the state machine
> bidirectional. Out of scope for v1; the model already supports it (just allow
> `infestation` to rise and re-derive). Flagged in §10.

---

## 5. Unlock Tables (Vendors / Facilities / Blueprints)

City Reclamation **owns the mapping** from territory → content; the *content* lives in sibling
systems. Tables are authored on `ZoneDef.rewards` / `CityDef.reward` and applied centrally.

### 5.1 Zone-level unlock table (example, City 1 = NYC Ruins)

| Zone | State to grant | Reveals blueprint(s) | Unlocks vendor/facility | Points | Cross-ref |
| --- | --- | --- | --- | --- | --- |
| `nyc_z_00` Safe Block (start) | pre-cleared | — | `vendor_quartermaster` | 0 | camp doc |
| `nyc_z_01` Market | CLEARED | `bp_smg` | `vendor_gunsmith` | 3 | weapon-unlocks, camp |
| `nyc_z_02` Clinic | CLEARED | `bp_medkit_relic` | `facility_infirmary` | 3 | camp |
| `nyc_z_03` Harbor | CLEARED | `bp_harpoon` | — | 4 | weapon-unlocks |
| `nyc_z_04` Foundry | CLEARED | `bp_flamethrower` | `facility_forge` | 4 | weapon-unlocks, camp |
| `nyc_z_05` City Hall (boss zone) | CLEARED | `bp_legendary_relic_1` | — | 6 | weapon-unlocks |

- **Blueprint IDs are forward references** into `BLUEPRINTS` (`BlueprintSystem.ts:8-25`). The
  Weapon-Unlocks doc owns the actual `Blueprint` entries; City Reclamation only flips them from
  *hidden* to *revealed* (a new `revealedBlueprintIds` ledger, §8) so they appear in the
  `Blueprints` scene (`src/game/scenes/Blueprints.ts:20`).
- **Vendor/facility IDs are forward references** into the Camp doc's registry. City Reclamation
  emits `vendor_unlocked { vendorId }`; the Camp system consumes it.

### 5.2 Application semantics

```ts
applyZoneCleared(zone: ZoneDef) {
  const key = `zone:${zone.id}`;
  if (this.save.grantedRewardKeys.includes(key)) return; // idempotent
  const r = zone.rewards;
  if (r.blueprintPoints) BlueprintSystem.addPoints(r.blueprintPoints); // BlueprintSystem.ts:36
  (r.blueprintIds ?? []).forEach(id => this.revealBlueprint(id));      // §8 ledger
  (r.vendorIds ?? []).forEach(id => this.scene.events.emit('vendor_unlocked', { vendorId: id }));
  if (r.hordePressureDelta) this.adjustRegionalPressure(zone.cityId, r.hordePressureDelta);
  this.save.grantedRewardKeys.push(key);
  this.scene.events.emit('zone_cleared', { zoneId: zone.id, cityId: zone.cityId, rewards: r });
  this.persist();
}
```

`revealBlueprint(id)` adds the id to a `zs2_revealed_blueprints` ledger (§8). The `Blueprints`
scene then filters `BLUEPRINTS` by "revealed OR always-visible" so special blueprints only
appear once their zone is cleared. (Requires a one-line filter in `Blueprints.ts:20`, §9.)

---

## 6. The `mission_won_meta` Hook

City Reclamation needs to know **which zone job** a winning run satisfied. The mission system
already produces a WIN (`docs/specs/mission-system.md` §7–§8); we attach the originating zone
job to the run and re-emit it at the win edge.

### 6.1 Carrying the zone job into the run

When the player accepts a zone job from the Job Board / Route Map, store the active job ids
alongside the chosen mission. Extend `LoadoutManager` (mirrors `setMissionId`,
`LoadoutManager.ts:54-55`):

```ts
// LoadoutManager additions
private activeZoneJob: { zoneId: string; jobId: string } | null = null; // not persisted across runs by default
setActiveZoneJob(z: { zoneId: string; jobId: string } | null) { this.activeZoneJob = z; ... }
getActiveZoneJob() { return this.activeZoneJob; }
```

The Job Board sets both `setMissionId(job.condition's mission)` **and**
`setActiveZoneJob({zoneId, jobId})`. A "free play" run (no zone job) leaves it `null` and
City Reclamation simply ignores the win.

### 6.2 Emitting at the WIN edge

In `Game.handleMissionComplete()` (the win path from `docs/specs/mission-system.md` §8), after
the existing `BlueprintSystem.addPoints(reward)` award, emit a meta event the
`CityReclamationSystem` (running on the meta-map scene, or a global listener) consumes:

```ts
const zj = LoadoutManager.getInstance().getActiveZoneJob();
if (zj) this.events.emit('mission_won_meta', { zoneId: zj.zoneId, jobId: zj.jobId, difficulty: mission.difficulty ?? 1 });
```

Because the meta-map scene is not running during the in-run, the recommended wiring is: the
**WIN→GameOver** payload carries `{ zoneId, jobId, difficulty }`, and the `MetaMap` scene (or a
small persistent `CityReclamationSystem` static) applies it when control returns to the
meta-map after the GameOver screen. Either path is acceptable; the **static apply** is simplest
because `CityReclamationSystem` reads/writes `localStorage` and needs no live scene:

```ts
// On WIN, before leaving GameOver back toward the meta-map:
CityReclamationSystem.applyJobWin(zoneId, jobId, difficulty); // pure localStorage mutation
```

This keeps City Reclamation **fully decoupled** from the in-run loop — no per-frame cost, no
listeners inside `Game`.

---

## 7. Multi-City Progression & Escalation

### 7.1 Advancing cities

A city is **reclaimed** when every `ZoneDef` in it is CLEARED. `applyCityReclaimed()` (run from
the zone-cleared edge, §4):

```ts
applyCityReclaimed(city: CityDef) {
  const key = `city:${city.id}`;
  if (this.save.grantedRewardKeys.includes(key)) return;
  (city.reward.blueprintIds ?? []).forEach(id => this.revealBlueprint(id));
  if (city.reward.blueprintPoints) BlueprintSystem.addPoints(city.reward.blueprintPoints);
  this.save.reclaimedCityIds.push(city.id);
  this.save.grantedRewardKeys.push(key);
  if (city.reward.unlocksCityId) {
    this.save.currentCityId = city.reward.unlocksCityId; // advance
    this.seedCityZones(city.reward.unlocksCityId);       // copy baseInfestation into live state
  }
  this.scene.events.emit('city_reclaimed', { cityId: city.id, nextCityId: city.reward.unlocksCityId });
  this.persist();
}
```

`seedCityZones()` initializes `ZoneState_Live` for the newly unlocked city from its
`ZoneDef.baseInfestation` values. The player keeps all blueprints/points/vendors — escalation
is in the *new content and difficulty*, not a reset.

### 7.2 Escalation knobs per city

| Knob | Field | Effect |
| --- | --- | --- |
| Biome | `CityDef.biome` (`BiomeId`) | new background/fog palette + enemy-mix theme |
| Enemy mix | `CityDef.enemyMix` | weights toward harder types (e.g. City 2 favors `RANGED`/`TOXIC`, City 3 favors `CARRIER`/`TANK`) — feeds the spawn director |
| Global difficulty | `CityDef.difficultyScalar` | multiplies spawn rate / enemy HP for runs launched from that city |
| Zone depth | `ZoneDef.baseInfestation` | later cities start zones at higher infestation (more wins to clear) |
| Blueprint tier | `CityDef.reward.blueprintIds` + zone reveals | each city reveals a strictly stronger blueprint tier (weapon-unlocks doc) |

`enemyMix` and `difficultyScalar` are read by the run launcher: when a run starts from a city,
it passes these into the spawn system (the spawn director already scales difficulty over time;
the city scalar is a per-run multiplier on top). Exact spawn-system binding is owned by the
run-launch integration, not this doc, but the *contract* is: **`Game.create()` reads the
current city's `enemyMix`/`difficultyScalar` and configures the spawn director accordingly.**

### 7.3 Suggested city ladder (v1 content)

| Order | City | Biome | Zones | Enemy-mix lean | Cleared reward |
| --- | --- | --- | --- | --- | --- |
| 0 | New York Ruins | `URBAN_RUINS` | 6 | baseline | unlocks City 1; `bp_legendary_relic_1` |
| 1 | Flooded Delta | `FLOODED_DELTA` | 7 | +RANGED, +TOXIC | unlocks City 2; tier-2 weapons |
| 2 | Ash Wastes | `ASH_WASTES` | 8 | +CARRIER, +TANK | unlocks City 3; tier-2 relics |
| 3 | Frozen Sprawl | `FROZEN_SPRAWL` | 9 | all + bosses early | endgame blueprints |

---

## 8. Persistence (localStorage)

Single document, crash-proof reads, mirroring `BlueprintSystem` discipline
(`BlueprintSystem.ts:28-49`). New keys (convention `zs2_*`, see existing keys
`zs2_blueprints_v1`, `zs2_bp_points`, `zs2_loadout_*`):

| Key | Shape | Purpose |
| --- | --- | --- |
| `zs2_city_reclaim_v1` | `CityReclamationSave` (JSON) | the whole meta-map document |
| `zs2_revealed_blueprints` | `string[]` (JSON) | special-blueprint reveal ledger (read by `Blueprints` scene) |

```ts
// CityReclamationSave example (mid-City-1)
{
  "version": 1,
  "currentCityId": "city_nyc",
  "zones": {
    "nyc_z_00": { "infestation": 0,  "state": "cleared",   "cleared": true,  "jobsCompleted": [] },
    "nyc_z_01": { "infestation": 32, "state": "contested", "cleared": false, "jobsCompleted": ["nyc_z_01_j1"] },
    "nyc_z_02": { "infestation": 100,"state": "infested",  "cleared": false, "jobsCompleted": [] }
  },
  "reclaimedCityIds": [],
  "grantedRewardKeys": ["zone:nyc_z_00"]
}
```

### Read/write rules

- **One safe reader.** `private static load(): CityReclamationSave` wraps `JSON.parse` in
  try/catch and returns a freshly **seeded default** (City 0, all zones at `baseInfestation`,
  zone 0 pre-cleared) on missing/corrupt data — exactly the crash-proofing of
  `readUnlockedArray()` (`BlueprintSystem.ts:40-49`) and the `NaN` guard in `getPoints()`
  (`BlueprintSystem.ts:29-33`).
- **One writer.** `private static persist(save)` `JSON.stringify`s and clamps every
  `infestation` to `[0,100]` before writing (defense against poisoned values).
- **Schema migration.** `version` lets a future `migrate(save)` upgrade old documents. On
  version mismatch with no migration, re-seed (the meta-map is reconstructable from the run
  history conceptually, but v1 simply resets — acceptable for an early meta layer).
- **Reveal ledger** is a separate simple `string[]` so the `Blueprints` scene can read it
  without parsing the whole city document.

---

## 9. Map Scene + UI Integration

### 9.1 New scene: `MetaMap`

Add `MetaMap = 'MetaMap'` to `SceneKey` (`src/game/config/SceneKeys.ts:1-12`) and register it
in the scene list. `MainMenu` gets a new **"City Map"** button (the natural new front door of
the outer loop), added next to the existing `Blueprints` / `Spawn Tuner` buttons
(`MainMenu.ts:142-153`, same `createButton` helper).

Recommended flow:

```
MainMenu ──► MetaMap (pick a zone/job) ──► Loadout (build for it) ──► Game (run)
   ▲             ▲                                                      │
   └──────── GameOver (win/lose) ◄────────────────────────────────────┘
                 │ on WIN: CityReclamationSystem.applyJobWin(...)
                 ▼
              MetaMap (re-rendered: zone infestation dropped / cleared)
```

`MetaMap` renders the `currentCityId` zone graph: one node per `ZoneDef` positioned by
`grid {col,row}`, edges drawn from `adjacency`. Tapping an unlocked zone opens its job list
(Job Board for plain jobs, Route Map for `isLongRecon`) and lets the player accept a job
(sets `setMissionId` + `setActiveZoneJob`, §6) then routes to `Loadout`.

### 9.2 Visual-Progression Spec (the payoff)

The map must **read at a glance** and **feel like reclaiming territory**. Per `ZoneState`:

| State | Node color | Fog / overlay | Icon | Edge | Narrative beat |
| --- | --- | --- | --- | --- | --- |
| INFESTED | deep red `#8b1a1a` | heavy dark fog over the node, pulsing red vignette | biohazard / horde skull | dim, dashed (route unsafe) | "The block is overrun. Bodies in the streets." |
| CONTESTED | amber `#e0a020` | thinning fog, embers, flicker | crossed-rifles / fighting | solid amber (supply line forming) | "We've pushed in. It's a fight, but we're holding ground." |
| CLEARED | green `#2ecc71` | fog gone, warm light, survivor banner planted | flag / safehouse | bright green (safe corridor) | "Reclaimed. Lights on. Survivors are moving back in." |

Dynamic touches that sell progression:
- **Infestation as fill.** Each node shows a radial/bar fill = `infestation/100`, so the player
  watches it *drain* across runs even before a state flips. Reuse the bar-drawing idiom from
  the in-game HUD (`GameUI` bars, e.g. XP bar at `src/game/ui/GameUI.ts:106-119`).
- **Clear animation.** On a zone reaching CLEARED, play a one-shot: fog dissolves, the node
  pulses green, a banner/flag tweens up, neighbors' fog visibly thins (because adjacency bleed
  just lowered them). This is the dopamine moment.
- **Spreading safety.** Because adjacency bleed lowers neighbors, the *region* visibly warms
  from red→amber as you work outward from the start zone — the map tells the story of a
  shrinking horde without any text.
- **City transition.** On `city_reclaimed`, the whole map fades to a "CITY RECLAIMED" splash,
  then the camera/scene swaps to the next city's biome palette (`BiomeId`) — a clear
  chapter break and escalation cue.
- **Survivor count flavor (optional).** A header like "Survivors sheltered: N" that ticks up as
  zones clear, reinforcing the fantasy. Pure flavor; derivable from cleared-zone count.

All UI uses `setScrollFactor(0)`/static positioning and the existing text/graphics idioms;
no new asset pipeline is required for v1 (color + fog rectangles + tweens). Biome backgrounds
can reuse/ tint the existing `background` texture (`MainMenu.ts:42`) per `BiomeId` until
bespoke art lands.

### 9.3 Blueprints scene filter

`Blueprints` (`src/game/scenes/Blueprints.ts:20`) currently lists **all** `BLUEPRINTS`. Add a
visibility filter so special (zone-revealed) blueprints only show once revealed:

```ts
const revealed = CityReclamationSystem.getRevealedBlueprintIds(); // zs2_revealed_blueprints
BLUEPRINTS
  .filter(bp => !bp.special || revealed.includes(bp.id)) // bp.special is added by weapon-unlocks doc
  .forEach(bp => { /* existing render at Blueprints.ts:20-48 */ });
```

`bp.special` is a forward-reference field owned by `outer-loop-weapon-unlocks.md`; until that
ships, the filter is a no-op (no blueprint is `special`).

---

## 10. CityReclamationSystem — Class Sketch

New file: `src/game/systems/CityReclamationSystem.ts`. **Static / localStorage-backed**, like
`BlueprintSystem` (`BlueprintSystem.ts:27`) — no live scene required, so it can be called from
the WIN edge, the `MetaMap` scene, and the `Blueprints` scene alike.

```ts
import { BlueprintSystem } from './BlueprintSystem';
import { CITIES, getCityById, getZoneById, getJob } from '../config/Cities';
import {
  CityReclamationSave, ZoneState, ZoneDef, CityDef, ZoneState_Live,
} from '../types/CityTypes';
import { INFESTATION } from '../config/Cities';

const STORAGE_SAVE = 'zs2_city_reclaim_v1';
const STORAGE_REVEALED = 'zs2_revealed_blueprints';
const ADJACENCY_BLEED = 0.35;
const SCHEMA_VERSION = 1;

export class CityReclamationSystem {
  /* ---------- persistence (crash-proof, mirrors BlueprintSystem) ---------- */
  private static load(): CityReclamationSave {
    const raw = localStorage.getItem(STORAGE_SAVE);
    if (raw) {
      try {
        const s = JSON.parse(raw) as CityReclamationSave;
        if (s && s.version === SCHEMA_VERSION && s.zones) return s;
      } catch { /* fall through to seed */ }
    }
    return this.seedDefault();
  }
  private static persist(save: CityReclamationSave) {
    for (const z of Object.values(save.zones)) {
      z.infestation = Math.min(100, Math.max(0, z.infestation));
      z.state = this.deriveZoneState(z.infestation);
    }
    localStorage.setItem(STORAGE_SAVE, JSON.stringify(save));
  }
  private static seedDefault(): CityReclamationSave { /* City 0, baseInfestation, zone0 cleared */ }
  private static seedCityZones(save: CityReclamationSave, cityId: string) { /* copy baseInfestation */ }

  /* ---------- derived state ---------- */
  static deriveZoneState(infestation: number): ZoneState {
    if (infestation <= INFESTATION.CLEARED_THRESHOLD) return ZoneState.CLEARED;
    if (infestation <= INFESTATION.CONTESTED_THRESHOLD) return ZoneState.CONTESTED;
    return ZoneState.INFESTED;
  }

  /* ---------- the core entry point (called at the WIN edge, §6) ---------- */
  static applyJobWin(zoneId: string, jobId: string, difficulty = 1): void {
    const save = this.load();
    const zoneDef = getZoneById(zoneId);
    const job = getJob(zoneId, jobId);
    if (!zoneDef || !job) return;
    const live = save.zones[zoneId];
    if (!live || live.cleared) { this.persist(save); return; } // already done

    // 1. direct reduction + difficulty bonus (§3.2)
    const bonus = ((difficulty - 1) * 2);
    const directDrop = job.infestationReward + bonus;
    live.infestation = Math.max(0, live.infestation - directDrop);

    // 2. adjacency bleed
    for (const nId of zoneDef.adjacency) {
      const n = save.zones[nId];
      if (n && !n.cleared) n.infestation = Math.max(0, n.infestation - directDrop * ADJACENCY_BLEED);
    }
    // 3. one-shot job bookkeeping
    if (!job.repeatable && !live.jobsCompleted.includes(jobId)) live.jobsCompleted.push(jobId);
    if (job.bonusBlueprintPoints) BlueprintSystem.addPoints(job.bonusBlueprintPoints);

    // 4. re-derive + handle clear edges (target + neighbors can both clear)
    this.reconcileClears(save);
    this.persist(save);
  }

  private static reconcileClears(save: CityReclamationSave): void {
    for (const [zoneId, live] of Object.entries(save.zones)) {
      live.state = this.deriveZoneState(live.infestation);
      if (live.state === ZoneState.CLEARED && !live.cleared) {
        live.cleared = true; live.infestation = 0;
        this.applyZoneCleared(save, getZoneById(zoneId)!);
      }
    }
    this.maybeReclaimCity(save);
  }

  private static applyZoneCleared(save: CityReclamationSave, zone: ZoneDef): void { /* §5.2, idempotent via grantedRewardKeys */ }
  private static maybeReclaimCity(save: CityReclamationSave): void { /* §7.1: all zones cleared => applyCityReclaimed */ }
  private static applyCityReclaimed(save: CityReclamationSave, city: CityDef): void { /* §7.1 */ }

  /* ---------- reveal ledger (read by Blueprints scene) ---------- */
  private static revealBlueprint(id: string): void {
    const arr = this.getRevealedBlueprintIds();
    if (!arr.includes(id)) { arr.push(id); localStorage.setItem(STORAGE_REVEALED, JSON.stringify(arr)); }
  }
  static getRevealedBlueprintIds(): string[] {
    const raw = localStorage.getItem(STORAGE_REVEALED);
    if (!raw) return [];
    try { const a = JSON.parse(raw); return Array.isArray(a) ? a as string[] : []; } catch { return []; }
  }

  /* ---------- read API for the MetaMap scene ---------- */
  static getCurrentCity(): CityDef { return getCityById(this.load().currentCityId)!; }
  static getZoneLive(zoneId: string): ZoneState_Live | undefined { return this.load().zones[zoneId]; }
  static getCityProgress(cityId: string): { cleared: number; total: number } { /* count cleared zones */ }
  static isCityReclaimed(cityId: string): boolean { return this.load().reclaimedCityIds.includes(cityId); }

  /* events emitted via the calling scene's emitter when one is available:
     'zone_cleared' { zoneId, cityId, rewards }
     'vendor_unlocked' { vendorId }
     'city_reclaimed' { cityId, nextCityId }
     When applyJobWin runs statically (no scene), the MetaMap scene reconciles UI on next render
     by reading live state; the events are an optimization for live listeners (Camp/Weapon docs). */
}
```

Config file `src/game/config/Cities.ts` exports `CITIES: CityDef[]` plus
`getCityById` / `getZoneById(zoneId)` / `getJob(zoneId,jobId)` lookups and the `INFESTATION`
constants — patterned after `Missions.ts` (`getMissionById`/`resolveMission`,
`src/game/config/Missions.ts:94-100`) and `BLUEPRINTS` (`BlueprintSystem.ts:8`).

---

## 11. Integration Checklist (ordered, file-by-file)

1. **`src/game/types/CityTypes.ts`** (new) — `ZoneState`, `BiomeId`, `ZoneRewards`,
   `ZoneDef`, `ZoneJobDef`, `CityDef`, `CityReward`, `ZoneState_Live`, `CityReclamationSave`
   (§2). Import `MissionCondition` from `MissionTypes.ts:92-101` (reuse, do not redefine).

2. **`src/game/config/Cities.ts`** (new) — `INFESTATION` constants, `CITIES: CityDef[]` (City 0
   authored fully; later cities stubbed), and `getCityById` / `getZoneById` / `getJob` lookups.
   Pattern after `src/game/config/Missions.ts:94-100`.

3. **`src/game/systems/CityReclamationSystem.ts`** (new) — the static system (§10):
   `load`/`persist`/`seedDefault` (crash-proof, mirror `BlueprintSystem.ts:28-49`),
   `deriveZoneState`, `applyJobWin`, `reconcileClears`, `applyZoneCleared`, `maybeReclaimCity`,
   `applyCityReclaimed`, reveal ledger, MetaMap read API.

4. **`src/game/systems/LoadoutManager.ts`** — add `activeZoneJob` getter/setter (§6.1), mirror
   of `setMissionId`/`getMissionId` (`LoadoutManager.ts:54-55`). Default `null`; not persisted
   across runs (a run carries exactly one accepted job).

5. **Mission WIN edge** (`Game.handleMissionComplete()` per `docs/specs/mission-system.md` §8) —
   after the existing Blueprint-point award, read `LoadoutManager.getActiveZoneJob()` and either
   emit `mission_won_meta` or pass `{zoneId, jobId, difficulty}` in the `GameOver` win payload
   (§6.2).

6. **`src/game/scenes/GameOver.ts`** — on the **win** branch (added by the mission spec), if the
   win payload carries `{zoneId, jobId, difficulty}`, call
   `CityReclamationSystem.applyJobWin(zoneId, jobId, difficulty)` once, then surface a small
   "Infestation −N • Zone CONTESTED/CLEARED" line. Route "Continue" back to `MetaMap`.

7. **`src/game/config/SceneKeys.ts`** — add `MetaMap = 'MetaMap'` (and register the scene in the
   game scene list / `main.ts`).

8. **`src/game/scenes/MetaMap.ts`** (new) — render `currentCityId` zone graph from `ZoneDef`
   grid + adjacency; per-zone visual state (§9.2); fill bar = `infestation/100`; tap a zone →
   job list → accept (sets `setMissionId` + `setActiveZoneJob`) → `Loadout`. Clear/city-reclaim
   animations.

9. **`src/game/scenes/MainMenu.ts`** — add a **"City Map"** button via the existing
   `createButton` helper (`MainMenu.ts:263-278`), placed in the button stack
   (`MainMenu.ts:142-153`), routing to `SceneKey.MetaMap`.

10. **`src/game/scenes/Blueprints.ts`** — filter `BLUEPRINTS` by
    `CityReclamationSystem.getRevealedBlueprintIds()` + `!bp.special` (§9.3) so zone-revealed
    blueprints appear only after their zone clears. No-op until weapon-unlocks doc adds
    `bp.special`.

11. **Run launcher** (`Game.create()`) — read the current city's `enemyMix` /
    `difficultyScalar` (§7.2) and pass them into the spawn director as a per-run escalation
    multiplier. (Binding owned by the spawn-system integration; this doc defines the contract.)

12. **(Sibling consumers)** Camp system listens for `vendor_unlocked` / `zone_cleared`
    (`outer-loop-survivor-camp.md`); Weapon-Unlocks owns `bp.special` + the revealed blueprint
    entries (`outer-loop-weapon-unlocks.md`); Job Board surfaces `ZoneJobDef`s
    (`outer-loop-job-board.md`); Route Map surfaces `isLongRecon` zones
    (`outer-loop-route-map.md`).

---

## 12. Acceptance Criteria

- Winning a run that carried an accepted zone job lowers that zone's `infestation` by the
  formula (§3) and bleeds 35% of the drop into each adjacent, uncleared zone.
- A zone crossing `66` becomes CONTESTED and crossing `5` becomes CLEARED, recoloring on the
  `MetaMap` with the fog/icon/banner changes in §9.2.
- Clearing a zone grants its `ZoneRewards` **exactly once** (idempotent via `grantedRewardKeys`),
  reveals its blueprints (visible in `Blueprints`), and emits `vendor_unlocked` / `zone_cleared`.
- Clearing every zone in the current city marks it reclaimed, grants the city reward, advances
  `currentCityId`, seeds the next city's zones from `baseInfestation`, and emits `city_reclaimed`.
- The next city presents a new biome palette, a harder `enemyMix`, a higher `difficultyScalar`,
  and a stronger blueprint tier.
- All state survives reload (`zs2_city_reclaim_v1`), and corrupt/missing storage re-seeds the
  default safely (no crash, mirroring `BlueprintSystem.ts:40-49`).
- No regressions to the in-run loop: City Reclamation adds **zero** per-frame cost; all work is
  between runs / on the meta-map.
- Free-play runs (no accepted zone job) leave the meta-map untouched.

---

## 13. Edge Cases & Risks

1. **Double-apply / re-entrancy.** A win event firing twice, or `applyJobWin` called on an
   already-cleared zone, must not double-drop or double-grant. Guarded by the `cleared` latch
   and `grantedRewardKeys` ledger (§5.2). Same discipline as `BlueprintSystem.isUnlocked`
   (`BlueprintSystem.ts:51-66`).

2. **Cascade clears in one win.** Adjacency bleed can push a *neighbor* below `CLEARED_THRESHOLD`
   in the same win that clears the target. `reconcileClears()` iterates **all** zones each apply,
   so every newly-cleared zone grants once; a neighbor clearing can in turn satisfy the city —
   `maybeReclaimCity` runs after reconciliation (§10). Verify with a test where one win finishes
   the last two zones.

3. **`difficultyTierBonus` overshoot.** A high-difficulty job can drop infestation well past 0;
   clamping to `[0,100]` in `persist()` and `Math.max(0, …)` in the formula prevents negatives.

4. **Corrupt / cross-tab storage.** Another tab or a manual edit can poison
   `zs2_city_reclaim_v1`. `load()` try/catches and re-seeds; `persist()` clamps all infestation
   values. Reveal ledger has its own safe reader. Mirrors `getPoints()` NaN guard
   (`BlueprintSystem.ts:29-33`).

5. **Schema migration.** Adding fields later (e.g. re-infestation timestamps) bumps
   `SCHEMA_VERSION`; absent a migration, `load()` re-seeds. Acceptable for an early meta layer;
   document the reset behavior so a version bump is a deliberate choice.

6. **Mission/zone-job desync.** The Job Board must set **both** `setMissionId` (so the run has a
   win condition) and `setActiveZoneJob` (so the win is attributed). If only one is set, either
   the run has no objective or the win doesn't reduce a zone. Mitigation: the Job Board accept
   action is a single call that sets both atomically; `getActiveZoneJob()` defaults `null`
   (free play) so a stale job from a prior run can't mis-attribute.

7. **Stale `activeZoneJob` across runs.** Because it is **not** persisted across runs, a player
   who dies (lose) keeps the accepted job only if the Job Board re-sets it; recommend clearing
   `activeZoneJob` on any run end (win or lose) and re-accepting from the map. Prevents a win in
   a later free-play run from crediting a long-finished job.

8. **`requiresZoneId` deadlock.** A zone gated behind a neighbor that itself can't be reached
   could soft-lock the city. Author city graphs so the start zone (`nyc_z_00`, pre-cleared) has
   an unconditional path to every zone; add a config-time validator that asserts the graph is
   fully reachable from the start zone.

9. **`SURVIVE_TIME == 300` job vs boss spawn.** Inherited from the mission spec footgun
   (`docs/specs/mission-system.md` §7.2): a zone job using a 300s survive condition wins at the
   instant the boss spawns. Author zone jobs to avoid exactly 300s unless intended.

10. **Boss-zone jobs (`SLAY_BOSS`) are brutal.** City-Hall-style boss zones reuse `SLAY_BOSS`,
    which is unwinnable for many builds at the current boss HP (`docs/specs/mission-system.md`
    §11.4). Gate boss zones late in a city and/or pair with a per-mission HP override before
    shipping boss-zone reclamation.

11. **Visual scalability.** Later cities have 8–9 zones; the `MetaMap` grid layout must reflow
    for larger graphs (reuse the column-grid reflow idiom already used for the mission grid in
    `src/game/scenes/Loadout.ts:132-153`). Validate readability on the smallest target screen.

12. **Re-infestation (deferred).** v1 is one-way (infestation only drops). If a future
    "horde resurgence" raises infestation on cleared zones, the `cleared` latch and reward
    ledger must be revisited (rewards already granted should not re-trigger on re-clear). Model
    already supports rising values; flagged as v2 scope (§4).
```
