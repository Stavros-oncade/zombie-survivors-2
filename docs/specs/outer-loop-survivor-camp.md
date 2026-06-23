# Outer Loop — The Survivor Camp — Implementation Spec

Status: Draft / design doc (no code yet)
Author: Game systems design
Target: `zombie-survivors-2` (Phaser 3 + TypeScript)
Series: Outer Loop, Design Doc 2 of 4
Siblings (referenced, not yet written): `outer-loop-job-board.md` (missions feed the camp),
`outer-loop-expedition-loadout.md` (survivors as an assignable resource),
`outer-loop-city-reclamation.md` (cleared zones host new facilities)

## 1. Purpose & Summary

The game today is a single endless run plus two thin meta layers:
- **Blueprints** — a one-axis meta currency in `localStorage`
  (`BlueprintSystem`, `src/game/systems/BlueprintSystem.ts:27-85`), spent on permanent run perks
  in the `Blueprints` scene (`src/game/scenes/Blueprints.ts`).
- **Missions** — a per-run win condition with an optional `reward.blueprintPoints`
  (`Mission.reward`, `src/game/types/MissionTypes.ts:104-112`), already wired end-to-end through
  `Loadout` (`src/game/scenes/Loadout.ts:116-156`) and `GameOver`
  (`src/game/scenes/GameOver.ts:19-95`).

Both are **flat**: there is no stateful world between runs, no stakes for *not* playing, and no
reason a run matters beyond accumulating points. This spec adds **The Survivor Camp**: a
persistent hub, displayed in a new `Camp` scene, that turns the meta into a **survival economy**.

The camp has four **needs** — FOOD, WATER, MEDICINE, and HORDE STRENGTH — each a stock that
**drains every cycle**. Missions (the job board) refill those stocks or push horde strength down;
**buildings** (bought with blueprints) produce and buffer them. If any consumable need hits zero,
or horde strength overwhelms the camp's defense, **survivors die** — and if the camp population
hits zero, the human race is extinct: a hard **meta game-over**.

The camp converts the existing "win a run, get points" loop into "win a run, keep your people
alive." It reuses the Blueprint currency (no new currency), the Mission `reward` seam as its
income channel, and the `localStorage` + static-catalog patterns already established by
`BlueprintSystem` and `LoadoutManager`.

### Key existing facts this spec builds on

| Fact | Source |
| --- | --- |
| Meta currency = blueprint points in `localStorage` | `BlueprintSystem.getPoints/addPoints` — `src/game/systems/BlueprintSystem.ts:28-36` |
| Safe `localStorage` array reader (corrupt-JSON proof) | `BlueprintSystem.readUnlockedArray` — `src/game/systems/BlueprintSystem.ts:40-49` |
| Static authored catalog pattern | `BLUEPRINTS` — `src/game/systems/BlueprintSystem.ts:8-25`; `MISSIONS` — `src/game/config/Missions.ts:6-90` |
| Mission carries a `reward` paid on WIN | `Mission.reward` — `src/game/types/MissionTypes.ts:109`; awarded via `GameOver` — `src/game/scenes/GameOver.ts:94-95` |
| Run outcome reaches the meta layer | `GameOver.init(data.outcome/missionName/blueprintPointsAwarded)` — `src/game/scenes/GameOver.ts:33-50` |
| Default selected mission persisted per loadout | `LoadoutManager.getMissionId` (`localStorage` `zs2_loadout_mission`) — `src/game/systems/LoadoutManager.ts:32-55` |
| Scene registry / keys | `SceneKey` enum — `src/game/config/SceneKeys.ts:1-12` |
| Main menu routes to meta scenes | `MainMenu` → Loadout / Blueprints / SpawnTuner — `src/game/scenes/MainMenu.ts:140-154` |
| Simple list-screen UI idiom | `Blueprints.create()` — `src/game/scenes/Blueprints.ts:9-54` |
| Run flow start | `Loadout` "Start Run" → `scene.start(SceneKey.Game)` — `src/game/scenes/Loadout.ts:158-168` |

> **Design stance.** The Camp is the *state* the outer loop mutates; the Job Board (sibling doc)
> is the *verb* that mutates it. This doc owns the needs model, the cycle clock, the building
> catalog, the lose condition, and persistence. It defines the **interfaces** the Job Board and
> Expedition docs call into (`CampSystem.applyMissionReward`, survivor assignment) but does not
> redesign mission selection itself.

---

## 2. The Needs Model

### 2.1 The four needs

Three are **consumable stocks** (drain each cycle, must be refilled) and one is **adversarial
pressure** (rises each cycle, must be pushed down). All four are integers, clamped `>= 0`.

| Need | Kind | Meaning | Empty/overflow consequence |
| --- | --- | --- | --- |
| `food` | consumable stock | rations | survivors starve |
| `water` | consumable stock | potable water | survivors die of thirst |
| `medicine` | consumable stock | meds / triage supply | wounded/sick die |
| `hordeStrength` | pressure (rises) | incoming horde pressure on the camp | breach → mass casualties |

A separate scalar tracks the population the needs protect:

| Field | Meaning |
| --- | --- |
| `survivors` | living people in the camp. Population is the **score** and the **lose trigger** (zero = extinction). Also the labor pool the Expedition doc assigns (§7). |

### 2.2 Stock, drain, and capacity

Each consumable need is a triple: a current **stock**, a per-cycle **drain**, and a **capacity**
(buffer ceiling, raised by buildings — §5). Drain scales with population so a bigger camp is
hungrier.

```
drainPerCycle(need) = baseDrain[need] + ceil(survivors * perCapita[need])
```

Baseline balance numbers (v1, tuned for ~3–6 cycles of runway from a fresh camp):

| Need | `baseDrain` | `perCapita` | start stock | start capacity |
| --- | --- | --- | --- | --- |
| food | 2 | 0.5 | 30 | 50 |
| water | 2 | 0.5 | 30 | 50 |
| medicine | 1 | 0.2 | 15 | 30 |

Worked example, fresh camp (`survivors = 10`):
- food drain = `2 + ceil(10 * 0.5)` = `7/cycle`; start stock 30 → ~4 cycles before empty.
- water drain = `7/cycle` likewise.
- medicine drain = `1 + ceil(10 * 0.2)` = `3/cycle`; start 15 → 5 cycles.

This deliberately makes the camp **fall behind without missions** — the loop only sustains if the
player completes runs that resupply.

### 2.3 Horde strength (the pressure need)

`hordeStrength` is the meta analogue of in-run difficulty. It **rises every cycle** and is pushed
down only by specific mission rewards (job-board reward type "lower horde pressure", §4) or by a
walls/defense building's passive suppression (§5).

```
hordeStrength += hordeGrowthPerCycle          // baseline creep, default 4
hordeStrength  = max(0, hordeStrength - wallsSuppression())   // walls passively bleed it
```

Camp defense is a derived value from the walls building (§5):

```
campDefense = wallsDefenseValue(tier)         // e.g. 0,10,25,45,70 by tier
```

Each cycle, the breach check compares pressure to defense (§2.4 / §6).

Baseline: `hordeGrowthPerCycle = 4`, `hordeStrength` starts at `10`, `campDefense` starts at `0`
(no walls). So an unwalled camp is breached within a few cycles unless the player runs
horde-suppression missions — exactly the intended pressure.

### 2.4 Per-cycle resolution order (deterministic)

When a cycle advances (§3), `CampSystem.advanceCycle()` resolves in this fixed order so outcomes
are reproducible and explainable in the UI:

1. **Production** — each building adds its yield to the matching stock, clamped to capacity (§5).
2. **Drain** — subtract `drainPerCycle(need)` from food / water / medicine.
3. **Horde growth** — `hordeStrength += hordeGrowthPerCycle`, then subtract walls suppression.
4. **Casualty assessment** — for each empty consumable need and for a breach, compute deaths (§6).
5. **Apply deaths** — `survivors -= totalDeaths` (clamped `>= 0`).
6. **Lose check** — if `survivors <= 0`, set `extinct = true` (§6).
7. **Persist** (§8) and emit `camp_cycle_resolved` with a per-step report for the UI.

Production *before* drain means a building that exactly matches drain holds a need steady; a
building short of drain only slows the bleed. This is the core tuning knob.

---

## 3. The Cycle / Turn Model

**Decision: a cycle advances per *run resolved* (per attempt), not in real time and not per
mission accepted.** A "run resolved" = the player completing a game session that reaches
`GameOver` (win *or* lose), because that is the one event guaranteed to return control to the meta
layer (`GameOver.init`, `src/game/scenes/GameOver.ts:33-50`).

### Why per-run (and not the alternatives)

| Model | Verdict | Reason |
| --- | --- | --- |
| **Real-time (wall clock)** | Rejected | Punishes players for closing the tab; needs idle-game infra (offline catch-up, timestamps); hostile to a session game. |
| **Per mission *accepted*** | Rejected | Accepting is free and reversible; decouples cost from effort; players would accept-spam to farm. |
| **Per run *resolved* (win or lose)** | **Chosen** | Every run is a turn. Playing *advances time and refills* (on win); the act of engaging is the clock. A lost run still burns a cycle (you spent the day, brought nothing home) — meaningful stakes for failure. |

So the loop is: **resolve a run → camp consumes a cycle → its rewards (if any) land → reassess.**

### Cycle trigger wiring

`GameOver` is the single chokepoint. On `create()` (after it has read `data`,
`src/game/scenes/GameOver.ts:48-50`), call:

```ts
const report = CampSystem.getInstance().advanceCycle({
  outcome: this.outcome,               // 'win' | 'lose'
  missionId: this.missionId,           // add to GameOver payload (§9)
  missionReward: this.missionReward,   // CampReward resolved from the won mission (§4)
});
```

`advanceCycle` runs §2.4 and returns a `CycleReport`. `GameOver` shows a compact camp summary
beneath the run stats (or defers it to the `Camp` scene). **Idempotency:** `GameOver.create()` can
fire on scene restart; guard with a per-resolution token (§8 `lastResolvedRunId`) so a single run
advances the camp exactly once. Generate a fresh `runId` at run start (in `Game.create()`), pass it
through to `GameOver`, and have `advanceCycle` no-op if `runId === lastResolvedRunId`.

> Edge: a run that the player abandons via the menu (never reaching `GameOver`) does **not**
> advance a cycle. That is acceptable — abandoning isn't a resolved attempt. If we later want
> "fleeing costs a cycle," route the abandon path through `GameOver` with `outcome:'lose'`.

---

## 4. How Missions Modify the Needs (Job Board seam)

Missions are the camp's **income**. Today a mission's reward is blueprint-only
(`Mission.reward = { blueprintPoints?: number }`, `src/game/types/MissionTypes.ts:109`). This spec
**extends the reward** to carry camp resources, and defines the reward types the Job Board doc
emits.

### 4.1 Extended reward shape (additive, back-compatible)

```ts
// extend src/game/types/MissionTypes.ts Mission.reward
export interface CampReward {
  blueprintPoints?: number;   // existing — still paid to BlueprintSystem
  food?: number;              // adds to camp food stock (clamped to capacity)
  water?: number;
  medicine?: number;
  hordePressureReduction?: number;  // subtracts from hordeStrength (the "lower horde pressure" type)
  survivorsRescued?: number;        // adds to population (rescue missions)
}
```

`Mission.reward?: CampReward` is a superset of the current `{ blueprintPoints? }`, so existing
catalog entries (`src/game/config/Missions.ts:13,21,29,…`) keep compiling unchanged.

### 4.2 Reward → need mapping (the job-board reward types)

| Job-board reward type | Field | Effect on camp |
| --- | --- | --- |
| Supply run | `food` / `water` | `stock += amount`, clamp to capacity |
| Medical run | `medicine` | `medicine += amount`, clamp |
| **Suppression** ("lower horde pressure") | `hordePressureReduction` | `hordeStrength = max(0, hordeStrength - amount)` |
| Rescue | `survivorsRescued` | `survivors += amount` |
| Salvage | `blueprintPoints` | unchanged: `BlueprintSystem.addPoints` |

A single mission may grant several (a supply run that also rescues two survivors). Rewards land in
§2.4 **step 1.5** (between production and drain): applied *after* buildings produce but *before*
the cycle's drain, so a successful run can outrun that cycle's consumption.

### 4.3 Failing / skipping a mission

- **Failed run** (`outcome:'lose'`): cycle still advances (§3), but `missionReward` is **not**
  applied. The camp drains with nothing coming in — the player loses ground. This is the cost of
  failure, no separate penalty needed.
- **Skipping** (not selecting a horde-suppression mission while pressure climbs): purely emergent
  — `hordeStrength` keeps rising untouched. The Job Board doc may add expiring/escalating postings;
  from the camp's side, an unaddressed need simply decays per §2.4.

> The Camp does **not** reach into mission selection. It exposes `applyMissionReward(reward)` and
> trusts the Job Board to call `advanceCycle` with the resolved reward. Clean seam.

---

## 5. Building / Facility Catalog

Buildings are **persistent**, bought once with blueprint points, and **tiered** (upgrading raises
output/buffer for an escalating cost). They are the camp's standing infrastructure: producers,
buffers, and the wall.

### 5.1 Data model

```ts
// new: src/game/types/CampTypes.ts
export enum NeedKind { FOOD = 'food', WATER = 'water', MEDICINE = 'medicine', HORDE = 'horde' }

export enum BuildingId {
  FARM       = 'farm',        // produces food
  WELL       = 'well',        // produces water
  INFIRMARY  = 'infirmary',   // produces medicine + buffers it
  WALLS      = 'walls',       // raises campDefense + passive horde suppression
  WAREHOUSE  = 'warehouse',   // raises capacity (buffer) of food & water
  BARRACKS   = 'barracks',    // raises survivor cap + slow passive regrowth (housing)
}

export interface BuildingTier {
  tier: number;                 // 1..maxTier
  cost: number;                 // blueprint points to reach this tier from the previous
  // effects (any subset; interpreted by CampSystem.advanceCycle)
  produces?: { need: NeedKind; amount: number };  // per-cycle yield
  capacityBonus?: { need: NeedKind; amount: number }; // raises that need's capacity
  defenseValue?: number;        // walls: campDefense
  hordeSuppression?: number;    // walls: passive hordeStrength bleed per cycle
  survivorCapBonus?: number;    // barracks: raises max survivors
  survivorRegrowth?: number;    // barracks: survivors regained per cycle if needs are met
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  description: string;
  tiers: BuildingTier[];        // index 0 = tier 1
}
```

### 5.2 The authored catalog (`src/game/config/CampBuildings.ts`)

Pattern after `BLUEPRINTS` / `MISSIONS`. Costs in blueprint points; numbers are v1 balance.

| Building | T1 (cost) | T2 (cost) | T3 (cost) |
| --- | --- | --- | --- |
| **Farm** → food | +4 food/cyc (3) | +8 food/cyc (6) | +14 food/cyc (10) |
| **Well** → water | +4 water/cyc (3) | +8 water/cyc (6) | +14 water/cyc (10) |
| **Infirmary** → medicine | +2 med/cyc, +10 med cap (4) | +4 med/cyc, +20 cap (7) | +7 med/cyc, +35 cap (11) |
| **Walls** → defense | def 10, suppress 1 (4) | def 25, suppress 2 (8) | def 45, suppress 4 (13) |
| **Warehouse** → buffer | +20 food & water cap (3) | +40 cap (6) | +70 cap (10) |
| **Barracks** → housing | cap 15, +1 regrowth (5) | cap 22, +2 (9) | cap 30, +3 (14) |

```ts
export const CAMP_BUILDINGS: BuildingDef[] = [
  { id: BuildingId.FARM, name: 'Farm', description: 'Grows food each cycle.', tiers: [
      { tier: 1, cost: 3,  produces: { need: NeedKind.FOOD, amount: 4 } },
      { tier: 2, cost: 6,  produces: { need: NeedKind.FOOD, amount: 8 } },
      { tier: 3, cost: 10, produces: { need: NeedKind.FOOD, amount: 14 } },
    ] },
  { id: BuildingId.WELL, name: 'Well', description: 'Draws water each cycle.', tiers: [
      { tier: 1, cost: 3,  produces: { need: NeedKind.WATER, amount: 4 } },
      { tier: 2, cost: 6,  produces: { need: NeedKind.WATER, amount: 8 } },
      { tier: 3, cost: 10, produces: { need: NeedKind.WATER, amount: 14 } },
    ] },
  { id: BuildingId.INFIRMARY, name: 'Infirmary', description: 'Produces and stores medicine.', tiers: [
      { tier: 1, cost: 4,  produces: { need: NeedKind.MEDICINE, amount: 2 }, capacityBonus: { need: NeedKind.MEDICINE, amount: 10 } },
      { tier: 2, cost: 7,  produces: { need: NeedKind.MEDICINE, amount: 4 }, capacityBonus: { need: NeedKind.MEDICINE, amount: 20 } },
      { tier: 3, cost: 11, produces: { need: NeedKind.MEDICINE, amount: 7 }, capacityBonus: { need: NeedKind.MEDICINE, amount: 35 } },
    ] },
  { id: BuildingId.WALLS, name: 'Walls', description: 'Hold back the horde; suppress pressure.', tiers: [
      { tier: 1, cost: 4,  defenseValue: 10, hordeSuppression: 1 },
      { tier: 2, cost: 8,  defenseValue: 25, hordeSuppression: 2 },
      { tier: 3, cost: 13, defenseValue: 45, hordeSuppression: 4 },
    ] },
  { id: BuildingId.WAREHOUSE, name: 'Warehouse', description: 'Stores more food and water.', tiers: [
      { tier: 1, cost: 3,  capacityBonus: { need: NeedKind.FOOD, amount: 20 } /* +water applied in code, see note */ },
      { tier: 2, cost: 6,  capacityBonus: { need: NeedKind.FOOD, amount: 40 } },
      { tier: 3, cost: 10, capacityBonus: { need: NeedKind.FOOD, amount: 70 } },
    ] },
  { id: BuildingId.BARRACKS, name: 'Barracks', description: 'Houses survivors; slow regrowth.', tiers: [
      { tier: 1, cost: 5,  survivorCapBonus: 15, survivorRegrowth: 1 },
      { tier: 2, cost: 9,  survivorCapBonus: 22, survivorRegrowth: 2 },
      { tier: 3, cost: 14, survivorCapBonus: 30, survivorRegrowth: 3 },
    ] },
];
```

> Note: Warehouse boosts **both** food and water capacity equally; the single-`capacityBonus`
> shape keeps the type simple, so `CampSystem` special-cases `BuildingId.WAREHOUSE` to apply the
> bonus to both. (Alternatively make `capacityBonus` an array — deferred to keep v1 lean.)

### 5.3 Purchasing & City Reclamation cross-ref

- **Buying/upgrading** spends blueprint points via `BlueprintSystem.unlock`-style logic; the camp
  stores **owned tier per building** (§8). Cost to go T(n)→T(n+1) is `tiers[n].cost`.
- **City Reclamation tie-in** (sibling doc): tier 1 of any building has a **plot prerequisite** —
  a building can only be *placed* once its hosting zone is cleared. v1 ships with a fixed number of
  starting plots; `outer-loop-city-reclamation.md` unlocks more. The Camp exposes
  `getMaxBuildingSlots()` / `getOwnedBuildingCount()`; reclamation raises the cap. If slots are
  full, the build button is disabled with "Reclaim a zone to expand."

---

## 6. The Lose Condition (meta game-over)

The camp can kill survivors two ways per cycle; either can cascade to extinction.

### 6.1 Starvation / thirst / untreated wounds (empty consumable)

For each consumable need (`food`, `water`, `medicine`) that is **`0` after drain** (§2.4 step 2):

```
deaths_from(need) = ceil(deficit / lethality[need])
   where deficit = drainPerCycle(need) - stockBeforeDrain   // unmet demand this cycle
```

`lethality` (how many units of unmet demand kill one survivor) — lower = deadlier:

| Need | lethality | Reading |
| --- | --- | --- |
| food | 3 | starvation is gradual |
| water | 2 | thirst kills faster |
| medicine | 4 | a shortfall sickens slowly |

Deaths from multiple empty needs **stack** in the same cycle (a camp out of both food and water
loses people to both).

### 6.2 Breach (horde overwhelms defense)

After horde growth (§2.4 step 3), if `hordeStrength > campDefense`:

```
breachDeaths = ceil((hordeStrength - campDefense) / breachLethality)   // breachLethality default 5
```

A breach does **not** reduce `hordeStrength` (the horde is still out there); only suppression
missions and walls lower it. So an unaddressed breach recurs every cycle until pressure is pushed
back below defense — a death spiral the player must actively break.

### 6.3 Extinction = meta game-over

```
survivors -= (sum of need deaths + breachDeaths)
if (survivors <= 0) { survivors = 0; extinct = true; }   // §2.4 steps 5-6
```

`extinct === true` is the **hard meta-loss**: the human race is gone. On entering the `Camp`
scene (or the cycle-resolution screen) with `extinct`, present a terminal "EXTINCTION" state with:
- run/cycle stats (cycles survived, total survivors lost),
- a single **"Begin Again"** action that calls `CampSystem.resetCamp()` (§8) — wipes camp state to
  the fresh-start defaults (population, stocks, buildings) while **preserving** blueprint points
  earned (so a wipe isn't total; the player keeps meta currency to rebuild faster).

> Tunable severity: if total wipe feels harsh, an alternative "reset to a weakened camp" preserves
> tier-1 buildings. v1 recommends full structure reset + kept currency for a clean, legible stakes
> story. Flagged for playtest.

### 6.4 Survivor regrowth (the positive counter-pressure)

If, after a cycle, **no** need was empty and **no** breach occurred, barracks regrowth applies:

```
if (noCasualtiesThisCycle) survivors = min(survivorCap, survivors + barracksRegrowth())
```

This gives a well-run camp a slow climb back, so the population is a meaningful long-horizon score,
not a monotonic countdown.

---

## 7. Survivors as a Resource (Expedition seam)

Population is not just the lose meter — it is the **labor pool** the Expedition doc
(`outer-loop-expedition-loadout.md`) draws from. This spec owns the count and its safety rules;
the Expedition doc owns assignment UX and run effects.

Camp-side contract:
- `survivors` splits conceptually into **available** and **deployed**. The camp persists the total;
  the Expedition system marks some as deployed for a run (e.g. extra survivors = extra in-run perks
  or a second weapon).
- **Risk:** deployed survivors can **die on the run** (an expedition that ends in `outcome:'lose'`
  may return fewer than it took). The Camp exposes `removeSurvivors(n)` / `addSurvivors(n)` so the
  Expedition resolution can report casualties; these feed the same `survivors` field and therefore
  the same extinction check.
- **Floor guard:** the camp refuses to deploy the last survivor — `getDeployableCount()` returns
  `max(0, survivors - 1)` so a single bad expedition can't directly cause extinction (only the
  *cycle* drain/breach can). Keeps the two failure channels independent and prevents a one-click
  loss.
- Drain scales with **total** survivors (deployed people still eat back home in v1; simpler and
  avoids gaming the system by deploying everyone to dodge consumption).

---

## 8. Persistence (`localStorage` shape)

Single namespaced key, written atomically, read through a corrupt-JSON-proof loader mirroring
`BlueprintSystem.readUnlockedArray` (`src/game/systems/BlueprintSystem.ts:40-49`). Blueprint
points stay in their existing key (`zs2_bp_points`) — the camp does **not** duplicate currency.

```ts
// localStorage key: 'zs2_camp_v1'
export interface CampState {
  version: 1;
  survivors: number;
  needs: {
    food:     { stock: number };   // capacity is DERIVED from base + buildings, not stored
    water:    { stock: number };
    medicine: { stock: number };
  };
  hordeStrength: number;
  buildings: Partial<Record<BuildingId, number>>;  // BuildingId -> owned tier (1..max); absent = not built
  cyclesSurvived: number;
  totalSurvivorsLost: number;
  extinct: boolean;
  lastResolvedRunId: string | null;  // idempotency guard for advanceCycle (§3)
}
```

Rules:
- **Capacity is derived, not stored** — recompute from base (§2.2) + building tiers every read so
  changing balance numbers or buildings can never desync a stored ceiling.
- **Versioned** (`version: 1`) so a future migration can detect and upgrade old shapes; an unknown
  or unparseable blob → return `defaultCampState()` (fresh start), never throw.
- **Clamp on load** — every numeric field passed through `Number.isFinite` + `Math.max(0, …)` on
  read (same defensive posture as `BlueprintSystem.getPoints`,
  `src/game/systems/BlueprintSystem.ts:28-34`).
- `resetCamp()` writes `defaultCampState()` but **keeps** `zs2_bp_points` untouched (§6.3).

```ts
function defaultCampState(): CampState {
  return {
    version: 1, survivors: 10,
    needs: { food: { stock: 30 }, water: { stock: 30 }, medicine: { stock: 15 } },
    hordeStrength: 10,
    buildings: {},                 // no buildings; player buys with blueprint points
    cyclesSurvived: 0, totalSurvivorsLost: 0, extinct: false, lastResolvedRunId: null,
  };
}
```

---

## 9. `CampSystem` Class Sketch

New file: `src/game/systems/CampSystem.ts`. **Singleton** persisted to `localStorage`, mirroring
`LoadoutManager` (`src/game/systems/LoadoutManager.ts:16-39`) and the static helpers of
`BlueprintSystem`. No Phaser dependency — pure model, so scenes and (future) the Job Board /
Expedition systems all call the same instance.

```ts
import { BlueprintSystem } from './BlueprintSystem';
import { CAMP_BUILDINGS } from '../config/CampBuildings';
import { BuildingId, NeedKind, CampState, CampReward, CycleReport } from '../types/CampTypes';

const STORAGE_KEY = 'zs2_camp_v1';

export class CampSystem {
  private static _instance: CampSystem;
  private state: CampState;
  private constructor() { this.state = this.load(); }
  static getInstance(): CampSystem { return (this._instance ??= new CampSystem()); }

  // ---- persistence (corrupt-proof, like BlueprintSystem.readUnlockedArray) ----
  private load(): CampState { /* parse zs2_camp_v1, validate+clamp, else defaultCampState() */ }
  private save(): void { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); }

  // ---- derived getters (capacity & defense recomputed from buildings) ----
  getState(): Readonly<CampState> { return this.state; }
  getCapacity(need: NeedKind): number { /* base + sum building capacityBonus (warehouse→food&water) */ }
  getCampDefense(): number { /* walls tier defenseValue */ }
  getSurvivorCap(): number { /* base + barracks survivorCapBonus */ }
  getDrainPerCycle(need: NeedKind): number { /* base + ceil(survivors*perCapita) */ }
  getDeployableCount(): number { return Math.max(0, this.state.survivors - 1); } // §7 floor guard

  // ---- buildings (spends blueprint points) ----
  getOwnedTier(id: BuildingId): number { return this.state.buildings[id] ?? 0; }
  getUpgradeCost(id: BuildingId): number | null { /* next tier cost or null if maxed */ }
  buildOrUpgrade(id: BuildingId): boolean {
    // check slot cap (city-reclamation §5.3), next-tier exists, affordable
    // BlueprintSystem.getPoints() >= cost -> setPoints(-cost), bump tier, save
  }

  // ---- the cycle engine (§2.4) ----
  applyMissionReward(r: CampReward): void { /* food/water/med clamp, horde reduce, survivors+, BP */ }
  advanceCycle(ctx: { outcome: 'win'|'lose'; runId: string; missionReward?: CampReward }): CycleReport {
    if (ctx.runId === this.state.lastResolvedRunId) return this.lastReport; // idempotent (§3)
    // 1 produce -> 1.5 apply reward (if win) -> 2 drain -> 3 horde grow/suppress
    // -> 4 casualties (needs §6.1 + breach §6.2) -> 5 apply deaths -> 5b regrowth (§6.4)
    // -> 6 extinction check -> 7 persist + build report
  }

  // ---- survivors (Expedition seam, §7) ----
  addSurvivors(n: number): void;
  removeSurvivors(n: number): void;   // routes into extinction check on next read

  resetCamp(): void { this.state = defaultCampState(); this.save(); } // keeps zs2_bp_points
}
```

`CycleReport` (returned for the UI / GameOver summary):

```ts
export interface CycleReport {
  produced: Partial<Record<NeedKind, number>>;
  drained:  Partial<Record<NeedKind, number>>;
  rewardApplied: CampReward | null;
  hordeStrengthAfter: number;
  campDefense: number;
  breached: boolean;
  deaths: { fromFood: number; fromWater: number; fromMedicine: number; fromBreach: number };
  regrowth: number;
  survivorsAfter: number;
  extinct: boolean;
}
```

---

## 10. New `Camp` Scene & UI Integration

### 10.1 Scene registration

- Add `Camp = 'Camp'` to `SceneKey` (`src/game/config/SceneKeys.ts:1-12`).
- Register the scene class in the Phaser config scene list (alongside `Blueprints`,
  wherever scenes are registered for the game — same place `Blueprints` is added).
- New file `src/game/scenes/Camp.ts`, structured like `Blueprints`
  (`src/game/scenes/Blueprints.ts:5-55`): a list/stat screen, a `Back` button to `MainMenu`.

### 10.2 Main menu entry

In `MainMenu.create()`, add a **"Camp"** button next to Blueprints/Spawn Tuner
(`src/game/scenes/MainMenu.ts:142-154`) routing to `SceneKey.Camp`. The Camp becomes the
natural hub the player checks between runs.

### 10.3 Camp scene contents

Reading from `CampSystem.getInstance().getState()` + derived getters:
- **Needs panel** — for each consumable: `stock / capacity` with drain (`-7/cyc`) shown; bar tinted
  green→amber→red by cycles-of-runway (`stock / drain`). Reuse the `Blueprints` text-row idiom
  (`src/game/scenes/Blueprints.ts:20-48`); a thin progress bar can mirror the in-run XP/objective
  bar styling.
- **Horde panel** — `hordeStrength` vs `campDefense`, red when `hordeStrength > campDefense`
  (breach imminent).
- **Population** — `survivors / survivorCap`, with `+regrowth/cyc` if healthy.
- **Buildings list** — each `BuildingDef` with owned tier, next-tier effect + cost, an
  **Upgrade/Build** button calling `CampSystem.buildOrUpgrade(id)` and refreshing the points line
  (exactly the buy/refresh pattern in `Blueprints`, `src/game/scenes/Blueprints.ts:29-46`). Disable
  with a reason when unaffordable or out of slots (§5.3).
- **Cycle outlook** — a "Next cycle projection" line running §2.4 against current state *without*
  committing, so the player sees "next cycle: food 23→16, 1 will starve" before they play.

### 10.4 GameOver hook (the cycle trigger)

- Extend the `GameOver` init payload (`src/game/scenes/GameOver.ts:33-50`) with `missionId?: string`
  and `runId?: string` (carry through from `Game.create()` and the `Player.die()` /
  `handleMissionComplete()` transitions that already pass `outcome`/`missionName`).
- After reading `data`, resolve the won mission's `CampReward` (`resolveMission(missionId).reward`,
  `src/game/config/Missions.ts:98-100`) and call `CampSystem.advanceCycle(...)` (§3).
- Render a 3–4 line **camp summary** from the returned `CycleReport` beneath the existing run-stats
  block (`src/game/scenes/GameOver.ts:92-95`), e.g. `"Camp: +12 food, −7 drain · Horde 18/25 ·
  2 survivors lost"`. If `report.extinct`, route the player to the EXTINCTION state in `Camp`
  (§6.3) instead of (or alongside) the normal continue button.

### 10.5 Loadout surfacing (advisory)

Optionally, the `Loadout` mission grid (`src/game/scenes/Loadout.ts:138-151`) can annotate each
mission with what its reward gives the camp (e.g. a small "🍖+10" hint) so the player picks the
mission their camp needs most. Read-only; no behavior change. Defer if it crowds the grid.

---

## 11. Edge Cases

1. **Double cycle on scene restart.** `GameOver.create()` can run more than once; the
   `lastResolvedRunId` token (§3/§8) makes `advanceCycle` idempotent per run.
2. **Run abandoned via menu.** No `GameOver`, no cycle. Acceptable; route abandons through
   `GameOver` later if "fleeing costs a cycle" is wanted.
3. **Capacity shrinks below current stock** (building refunded/removed, balance retune). Clamp
   `stock = min(stock, capacity)` on read so a derived capacity drop never strands extra units.
4. **Corrupt / hand-edited / cross-tab `localStorage`.** `load()` validates the whole shape and
   falls back to `defaultCampState()`; every number passes `Number.isFinite` + `Math.max(0,…)` —
   never throws, never persists `NaN` (the bug `BlueprintSystem.getPoints` guards against,
   `src/game/systems/BlueprintSystem.ts:30-33`).
5. **Reward overfills a need.** Production + reward clamp to capacity; overflow is lost (intended —
   buffers matter, so Warehouse/Infirmary capacity is a real choice).
6. **Multiple empty needs in one cycle.** Deaths stack (§6.1); a camp out of food *and* water loses
   to both. Intended — neglecting two needs is twice as deadly.
7. **Breach persists.** A breach doesn't reduce `hordeStrength`; it recurs each cycle until
   suppressed below defense. Surface this loudly in the Camp outlook so the spiral is legible.
8. **Deploying the last survivor.** `getDeployableCount()` floors at `survivors - 1` (§7) so an
   expedition can't directly extinct the camp; only cycle drain/breach can.
9. **Negative or fractional balance.** All needs/survivors are integers, clamped `>= 0`; per-capita
   drain uses `ceil` so it never silently rounds toward "free."
10. **Extinction then reset.** `resetCamp()` wipes camp structure but preserves `zs2_bp_points`
    (§6.3) so the player rebuilds with their earned currency — a wipe, not a bankruptcy.
11. **Balance/version migration.** `version` field + capacity-is-derived mean retuning numbers
    is safe; only a *shape* change needs a migration branch in `load()`.
12. **Win with no reward defined.** A mission whose `reward` omits camp fields still advances the
    cycle (drain happens) but supplies nothing — fine; the existing blueprint-only missions behave
    this way.

---

## 12. Incremental Implementation Checklist (ordered, file-by-file)

1. **`src/game/types/CampTypes.ts`** (new) — `NeedKind`, `BuildingId`, `BuildingTier`,
   `BuildingDef`, `CampState`, `CampReward`, `CycleReport`, `defaultCampState()` (§5.1, §8, §9).
2. **`src/game/types/MissionTypes.ts`** — widen `Mission.reward` from `{ blueprintPoints? }` to
   `CampReward` (additive, back-compatible — existing entries in
   `src/game/config/Missions.ts:13,21,29,…` keep compiling) (§4.1).
3. **`src/game/config/CampBuildings.ts`** (new) — `CAMP_BUILDINGS: BuildingDef[]` (§5.2), pattern
   after `BLUEPRINTS` (`src/game/systems/BlueprintSystem.ts:8-25`).
4. **`src/game/systems/CampSystem.ts`** (new) — singleton model: load/save (corrupt-proof per
   `BlueprintSystem.readUnlockedArray`), derived getters, `buildOrUpgrade` (spends blueprint
   points), `applyMissionReward`, `advanceCycle` (the §2.4 engine), survivor add/remove,
   `resetCamp` (§9).
5. **`src/game/config/SceneKeys.ts`** — add `Camp = 'Camp'` (§10.1).
6. **`src/game/scenes/Camp.ts`** (new) — needs/horde/population panels, building buy/upgrade rows,
   next-cycle projection, EXTINCTION state, `Back` to `MainMenu` (§10.3), structured like
   `src/game/scenes/Blueprints.ts`.
7. **Scene registration** — add `Camp` to the Phaser scene list wherever `Blueprints` is registered.
8. **`src/game/scenes/MainMenu.ts`** — add a **Camp** button (`MainMenu.ts:142-154`) → `SceneKey.Camp`
   (§10.2).
9. **`src/game/scenes/Game.ts`** — generate a `runId` at `create()` and thread it into the
   `GameOver` transitions (alongside the existing `outcome`/`missionName` payload).
10. **`src/game/scenes/GameOver.ts`** — accept `missionId` + `runId` in `init` (`GameOver.ts:33-50`);
    after reading data, resolve the mission reward (`resolveMission`,
    `src/game/config/Missions.ts:98-100`) and call `CampSystem.advanceCycle`; render the
    `CycleReport` summary; route to EXTINCTION if `report.extinct` (§10.4, §6.3).
11. **(Optional)** `src/game/scenes/Loadout.ts` — annotate mission grid with camp-reward hints
    (`Loadout.ts:138-151`) (§10.5).
12. **Tuning pass** — playtest the §2.2 / §5.2 / §6 numbers for a 3–6 cycle survival curve; confirm
    a no-mission camp visibly declines and a focused player can stabilize and slowly regrow.

---

## 13. Open Questions / Risks

1. **Reset severity (§6.3).** Full structure wipe + kept currency vs. soft reset (keep tier-1).
   Recommend full + kept currency for legible stakes; confirm in playtest.
2. **Deployed survivors and drain (§7).** v1 charges drain on total population (deployed still
   eat). If players game it by deploying everyone, switch to "deployed don't drain" — but that
   invites degenerate deploy-spam; revisit with the Expedition doc.
3. **Slot cap source of truth (§5.3).** Camp owns `getMaxBuildingSlots()`; City-Reclamation raises
   it. Until that doc ships, hardcode a generous starting cap so buildings aren't gated by an
   unbuilt system.
4. **Cycle-per-run vs. catch-up.** If a future "idle" mode is wanted, the per-run clock would need
   an optional real-time supplement; out of scope, but the `advanceCycle` boundary is the seam.
5. **Difficulty coupling.** `hordeStrength` could later feed in-run difficulty (a high-pressure
   camp spawns harder waves), tying the meta back into the inner loop. Compelling but out of v1
   scope; noted as the strongest future hook.
6. **Reward magnitudes are placeholders.** §4 reward amounts live in the Job Board doc's mission
   catalog; the two docs must be balanced together so a typical win roughly offsets a cycle's drain
   plus a little surplus.
