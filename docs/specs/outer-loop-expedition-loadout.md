# Outer Loop — Expedition Loadout Planning — Implementation Spec

Status: Draft / design doc (no code yet)
Author: Game systems design
Target: `zombie-survivors-2` (Phaser 3 + TypeScript)
Series: Outer Loop, Design Doc 5 of N
Priority: **VERY HIGH**
Cross-refs: `mission-system.md` (canonical, shipped), `outer-loop-survivor-camp.md` (Doc N — survivor roster source), `outer-loop-job-board.md` (Doc N — mission offers + reward scaling). The two cross-refs are sibling outer-loop docs; this spec depends on their *interfaces* (a survivor roster, a per-mission base reward) and degrades gracefully if they ship later (see §11).

## 1. Purpose & Summary

The inner loop is a short (≤5:00) mission run with one win condition (see `mission-system.md`). Today the only pre-run choices are character, defensive skill, killstreak perk, and mission — each a single persisted enum, with **no resource cost** (`src/game/scenes/Loadout.ts`, `src/game/systems/LoadoutManager.ts`). Every run is independent and free; there is no scarcity, no preparation, and nothing carries between runs except permanent Blueprint unlocks (`src/game/systems/BlueprintSystem.ts`).

This spec adds the **Expedition Loadout Planning** layer: the meta step that sits between the camp and the run. Before each mission the player assembles an **ExpeditionPlan** by allocating four scarce resources:

1. **SUPPLIES** — consumable items (medkits, ammo crates, adrenaline) spent into a single run. Weight/slot-limited. Consumed whether you win or lose.
2. **SURVIVORS** — assignable camp units. Each grants a passive perk/stat for the run and is **at risk**: a failed or punishing mission can injure or kill them, feeding the camp-needs model in `outer-loop-survivor-camp.md`.
3. **PERKS** — loadout modifiers unlocked in the camp/Blueprint tree, slotted into a small fixed number of perk sockets.
4. **RISK MODIFIERS** — opt-in difficulty toggles (e.g. `+50% enemy density`) that multiply mission rewards. They alter the actual run config fed into `EnemySpawnSystem` / `MissionSystem`.

The fantasy is **"preparing efficiently"**: the run is short and twitchy; the *depth* lives in allocation under scarcity. You can't bring everything. Spending a rare medkit, risking your best survivor, or toggling `+enemy density` for a bigger payout are the meaningful decisions.

The assembled `ExpeditionPlan` is validated, frozen, and handed to the `Game` scene as **run config** — extending the exact pattern `LoadoutManager` → `Game.create()` already uses for character/skill/mission (`src/game/scenes/Game.ts:152-181`).

### Key existing facts this spec builds on

| Fact | Source |
| --- | --- |
| Loadout is the run-config hub (character/skill/killstreak/mission selectors) | `src/game/scenes/Loadout.ts:23-169` |
| Selections persisted as singletons in `localStorage` | `src/game/systems/LoadoutManager.ts:23-55` |
| "Start Run" resets tuner then `scene.start(Game)` | `src/game/scenes/Loadout.ts:163-168` |
| `Game.create()` reads `LoadoutManager` and applies character/blueprints/skill/mission | `src/game/scenes/Game.ts:152-183` |
| Meta currency (Blueprint points) in `localStorage`, `addPoints` on win | `src/game/systems/BlueprintSystem.ts:28-36`, awarded `src/game/scenes/Game.ts:814-819` |
| Per-run mission win condition + reward, resolved from id | `src/game/systems/MissionSystem.ts`, `src/game/config/Missions.ts`, `Game.ts:172-173` |
| Win/lose terminus + `runEnded` latch | `Game.handleMissionComplete()` `src/game/scenes/Game.ts:809-837`; `Player.die()` `src/game/entities/Player.ts` |
| Win reward award point (extend for survivor/risk outcome) | `Game.ts:814-836` |
| Per-run cleanup discipline | `Game.shutdownScene()` → `this.missionSystem?.destroy()` `src/game/scenes/Game.ts:1176` |
| Run-modifiable systems: relics (XP mult), weapon dmg/speed, player HP/speed | `RelicSystem.ts`, `BlueprintSystem.ts:9-25` |
| `MissionConditionKind`, `Mission`, `MissionProgress` model | `src/game/types/MissionTypes.ts` |

> **Existing-code caveat — singleton, not multi-profile.** `LoadoutManager` is a process-wide singleton holding *one* current selection per axis (`LoadoutManager.ts:18-21`). The ExpeditionPlan is also a *single current draft* (one mission is prepped at a time), so this is fine — but it means the plan must be cleared/recomputed whenever the selected mission changes, because supply/survivor/risk validity is mission-relative (slot caps, eligible survivors). See §7 (build/validate) and §10 (edge cases).

---

## 2. Data Model

New file: `src/game/types/ExpeditionTypes.ts`.

```ts
// src/game/types/ExpeditionTypes.ts
import { MissionCondition } from './MissionTypes';

/* ============================ SUPPLIES ============================ */

export enum SupplyId {
  MEDKIT       = 'medkit',        // heal-on-demand charge
  AMMO_CRATE   = 'ammo_crate',    // +weapon damage for the run
  ADRENALINE   = 'adrenaline',    // +attack speed for the run
  SCANNER      = 'scanner',       // reveals zone/boss earlier on HUD
  REINFORCED   = 'reinforced',    // +max HP for the run
}

/** Designer-authored supply definition (a catalog entry). */
export interface SupplyDef {
  id: SupplyId;
  name: string;
  description: string;
  weight: number;                 // capacity cost (see scarcity §3)
  /** Inventory is a camp resource; consumed on use. How a unit applies at run start. */
  apply: (rc: RunModifierSink) => void;
}

/** A stack of a supply committed to the plan. */
export interface SupplyStack {
  id: SupplyId;
  qty: number;                    // how many units of this supply to bring
}

/* ============================ SURVIVORS ============================ */

/** Camp-owned unit (full definition lives in outer-loop-survivor-camp.md). */
export interface SurvivorRef {
  id: string;                     // stable survivor id from the camp roster
  name: string;
  level: number;                  // affects perk magnitude + survival odds
  /** The run-affecting perk this survivor grants while assigned. */
  perk: Perk;
  status: SurvivorStatus;         // must be HEALTHY to assign
}

export enum SurvivorStatus {
  HEALTHY  = 'healthy',
  INJURED  = 'injured',           // recovering in camp; not assignable
  DEAD     = 'dead',              // removed from roster
}

/** One survivor committed to this expedition. */
export interface SurvivorAssignment {
  survivorId: string;             // ref into the camp roster
  /** Cached at assign-time so the run is self-contained (roster may change). */
  perk: Perk;
  level: number;
}

/* ============================== PERKS ============================== */

export enum PerkKind {
  STAT_MULT   = 'stat_mult',      // multiply a player/weapon stat
  XP_MULT     = 'xp_mult',
  SUPPLY_CAP  = 'supply_cap',     // raise carrying capacity
  SURVIVAL    = 'survival',       // improve survivor survival odds
  ON_WIN      = 'on_win',         // bonus reward on win
}

export interface Perk {
  id: string;
  name: string;
  description: string;
  kind: PerkKind;
  /** Generic magnitude; interpretation depends on kind (e.g. 1.1 = +10%). */
  magnitude: number;
  /** Optional stat selector for STAT_MULT. */
  stat?: 'maxHealth' | 'speed' | 'weaponDamage' | 'weaponSpeed' | 'projectileSpeed';
}

/* ========================= RISK MODIFIERS ========================= */

export enum RiskModifierId {
  DENSITY      = 'density',       // +X% enemy spawn count
  FEROCITY     = 'ferocity',      // +X% enemy damage
  VEIL         = 'veil',          // reduced vision / fog
  ELITE_TIDE   = 'elite_tide',    // faster elite cadence
  BRITTLE      = 'brittle',       // -X% player max HP
  IRONMAN      = 'ironman',       // no supplies usable this run
}

/** Designer-authored risk-modifier definition. */
export interface RiskModifierDef {
  id: RiskModifierId;
  name: string;
  description: string;
  /** Additive reward bonus this modifier contributes (e.g. 0.5 = +50%). */
  rewardBonus: number;
  /** Additive survivor-danger contribution (see §6). */
  dangerBonus: number;
  /** How the modifier mutates the run config when active. */
  apply: (rc: RunModifierSink) => void;
  /** Ids that cannot be combined with this one (mutual exclusion). */
  conflictsWith?: RiskModifierId[];
}

/* ===================== ASSEMBLED EXPEDITION PLAN ===================== */

/** The frozen plan handed to the Game scene as run config. */
export interface ExpeditionPlan {
  missionId: string;              // the selected mission (drives MissionSystem)
  supplies: SupplyStack[];
  survivors: SurvivorAssignment[];
  perks: string[];                // slotted Perk ids
  risks: RiskModifierId[];        // active risk modifiers
  /** Derived, cached at freeze time (single source of truth for the run). */
  derived: {
    usedWeight: number;
    capacityWeight: number;
    rewardMultiplier: number;     // total reward scaling (§5)
    dangerScore: number;          // total survivor danger (§6)
  };
}

/**
 * The narrow surface supplies / perks / risk modifiers mutate at run start.
 * Backed by the existing Game accessors so we do NOT widen Game's public API
 * more than necessary (see §8). Every method already exists on Game today.
 */
export interface RunModifierSink {
  adjustMaxHealth(mult: number): void;        // Game.playerAdjustMaxHealth (BlueprintSystem.ts:14)
  applyAsymptoticSpeed(mult: number): void;   // Game.playerApplyAsymptoticSpeed (RelicSystem.ts:65)
  upgradeWeaponDamage(mult: number): void;    // Game.getWeaponSystem().upgradeWeaponDamage
  upgradeWeaponSpeed(mult: number): void;     // Game.getWeaponSystem().upgradeWeaponSpeed
  upgradeProjectileSpeed(mult: number): void; // Game.getWeaponSystem().upgradeProjectileSpeed
  setXPMultiplier(mult: number): void;        // Game.getRelicSystemInternal().setXPMultiplier
  grantSupplyCharge(id: SupplyId, qty: number): void; // in-run consumable charges (§8)
  setEnemyDensityMult(mult: number): void;    // EnemySpawnSystem hook (§8 / §11)
  setEnemyDamageMult(mult: number): void;     // EnemySpawnSystem hook (§8 / §11)
  setEliteIntervalMult(mult: number): void;   // EnemySpawnSystem hook (§8 / §11)
  setVision(mult: number): void;              // camera/fog hook (§8 / §11)
}
```

### Notes on the model

- `ExpeditionPlan.derived` is computed **once** at freeze (`buildPlan()`, §7) so the run reads a single immutable snapshot — no recomputation in `Game`.
- `SurvivorAssignment.perk`/`.level` are **cached copies** of the roster entry. The run must not depend on the live camp roster, which can mutate between freeze and run end (parallel tabs, async camp ops). The roster is reconciled by id at run end (§6).
- `RunModifierSink` deliberately mirrors the methods already used by `BlueprintSystem`/`RelicSystem` (`BlueprintSystem.ts:9-24`, `RelicSystem.ts:54-116`). Supplies/perks/risks therefore reuse the *exact* application path blueprints already use — no new player-mutation plumbing for the stat-multiplier cases. Only the four `EnemySpawnSystem`/vision hooks and `grantSupplyCharge` are genuinely new (§8, §11).

---

## 3. The Scarcity Economy

The whole point is allocation under scarcity. Three tiers of persistence:

| Resource | Scarce? | Carries over? | Consumed when? | Storage owner |
| --- | --- | --- | --- | --- |
| **Supplies** | Yes — a finite camp inventory | Unused stays in camp | On run start (committed), regardless of win/lose | `ExpeditionManager` (`zs2_supply_inventory`) |
| **Survivors** | Yes — fixed roster, slow to recruit | Roster persists | Time (assigned survivors are "out" for the run) + risk of injury/death | survivor camp doc; mirrored here read-only |
| **Perks** | Soft — unlocked via Blueprint/camp tree | Permanent once unlocked | Not consumed; only **socket count** is scarce | Blueprint tree + `zs2_perk_unlocks` |
| **Risk Modifiers** | Free to toggle | n/a | Not consumed; they *raise danger and reward* | n/a (per-plan only) |
| **Capacity (weight/slots)** | The binding constraint | Raised by perks/survivor level | Per-run budget | Derived |

**Capacity is the core constraint.** The plan has a `capacityWeight` budget; each supply stack costs `SupplyDef.weight × qty`. Base capacity is a constant (e.g. `BASE_SUPPLY_CAPACITY = 10`), raised by `PerkKind.SUPPLY_CAP` perks and by high-level survivors carrying capacity. You physically cannot bring everything; bringing 3 medkits means no ammo crate.

**Slot limits** (independent of weight):
- `MAX_SURVIVOR_SLOTS = 3` (camp-doc canonical; mirror as a constant here).
- `MAX_PERK_SOCKETS = 2` (raise later via meta progression).
- Risk modifiers: no count cap, but mutual-exclusion via `conflictsWith` (§5).

**What's consumed vs. what carries:**
- **Supplies are spent on commit.** The moment the run starts, `qty` is deducted from `zs2_supply_inventory`. Losing the run does **not** refund them — this is the scarcity bite. (Design alternative considered: consume only-if-used. Rejected: it removes the allocation tension and makes over-packing free.)
- **Survivors are not "spent"** but are *unavailable* during the run and may come back injured/dead (§6). That is their cost.
- **Perks/risks cost nothing to slot** — their cost is opportunity (socket scarcity) and danger (risk modifiers).

**Income (how supplies/survivors replenish)** is owned by the camp/job-board docs (mission rewards, scavenging). This doc only *spends* them and writes back survivor outcomes. The income side is out of scope here; we expose the spend/writeback API the camp consumes.

---

## 4. Resource Catalogs (authored defaults)

New file: `src/game/config/Expedition.ts` — exports `SUPPLIES`, `PERKS`, `RISK_MODIFIERS`, and capacity constants. Pattern after `MISSIONS` (`src/game/config/Missions.ts`), `BLUEPRINTS` (`BlueprintSystem.ts:8`), `RELICS` (`RelicSystem.ts:47`).

### 4.1 Supplies (starter catalog)

| Id | Name | Weight | Effect at run start |
| --- | --- | --- | --- |
| `MEDKIT` | Medkit | 2 | Grants 1 heal charge (in-run consumable) |
| `AMMO_CRATE` | Ammo Crate | 3 | `upgradeWeaponDamage(1.15)` |
| `ADRENALINE` | Adrenaline | 2 | `upgradeWeaponSpeed(1.15)` |
| `REINFORCED` | Reinforced Vest | 4 | `adjustMaxHealth(1.20)` |
| `SCANNER` | Scanner | 1 | `setVision(1.25)` + early zone/boss HUD pointer |

`MEDKIT` is the one supply that is an **in-run consumable** (a charge the player triggers), routed through `grantSupplyCharge` (§8). All others are run-start one-shot stat applications reusing the blueprint/relic path.

### 4.2 Perks (starter catalog — slotted, 2 sockets)

| Id | Name | Kind | Effect |
| --- | --- | --- | --- |
| `quartermaster` | Quartermaster | `SUPPLY_CAP` | `capacityWeight += 4` |
| `field_medic` | Field Medic | `STAT_MULT maxHealth` | +10% max HP |
| `scavenger` | Scavenger | `XP_MULT` | +15% XP gain (`setXPMultiplier`) |
| `veteran` | Veteran | `SURVIVAL` | −20% survivor danger (§6) |
| `bounty` | Bounty Hunter | `ON_WIN` | +1 blueprint point on win |

### 4.3 Risk Modifiers — see §5.

---

## 5. Risk-Modifier Catalog + Reward-Scaling Math

Risk modifiers are opt-in difficulty boosts that raise the mission's reward. They are the bridge between this doc and the job board's reward scaling.

### 5.1 Catalog

| Id | Name | `rewardBonus` | `dangerBonus` | Run effect (`apply`) | Conflicts |
| --- | --- | --- | --- | --- | --- |
| `DENSITY` | Swarm | +0.50 | +0.20 | `setEnemyDensityMult(1.5)` | — |
| `FEROCITY` | Ferocity | +0.40 | +0.25 | `setEnemyDamageMult(1.5)` | — |
| `ELITE_TIDE` | Elite Tide | +0.35 | +0.20 | `setEliteIntervalMult(0.6)` (elites every ~54s) | — |
| `VEIL` | The Veil | +0.30 | +0.15 | `setVision(0.6)` (fog) | conflicts `SCANNER`'s benefit (allowed, just cancels) |
| `BRITTLE` | Brittle | +0.45 | +0.30 | `adjustMaxHealth(0.75)` | `IRONMAN` (no, stackable) |
| `IRONMAN` | Ironman | +0.60 | +0.35 | sets `suppliesDisabled` → supplies grant nothing | mutually exclusive with bringing supplies (validation, §7) |

`IRONMAN` is the only modifier with a hard interaction: if active, the plan must carry **zero** supplies (validation error), since "bring nothing" is the point of the bonus.

### 5.2 Reward-scaling math

Let the mission's base reward be `B = mission.reward.blueprintPoints` (`Mission.reward`, `MissionTypes.ts:109`; currently 2–5). Risk modifiers stack **additively** into a multiplier:

```
rewardMultiplier = 1 + Σ riskDef.rewardBonus      (over active risks)
finalReward      = round( B × rewardMultiplier ) + onWinPerkBonus
```

Additive (not multiplicative) stacking is chosen so the player can reason about it linearly ("three +0.4s = +120%") and so it can't blow up combinatorially. A soft cap keeps it bounded:

```
rewardMultiplier = min(1 + Σ rewardBonus, REWARD_MULT_CAP)   // REWARD_MULT_CAP = 4.0
```

Worked example: mission `m_slay_boss` (B = 5) + `DENSITY` (+0.5) + `FEROCITY` (+0.4) + `IRONMAN` (+0.6) → `rewardMultiplier = 2.5`, `finalReward = round(5 × 2.5) = 13` blueprint points (plus +1 if `bounty` perk slotted → 14).

`rewardMultiplier` is cached in `ExpeditionPlan.derived.rewardMultiplier` at freeze and applied at the existing win-award site (`Game.ts:814-819`) — replacing the flat `mission.reward.blueprintPoints` with `round(B × rewardMultiplier) + onWinBonus`. See §8.

> The job board (`outer-loop-job-board.md`) may scale `B` per-offer; this doc treats `B` as whatever the resolved mission reports and scales on top of it. The two are composable: `finalReward = round(jobBoardB × rewardMultiplier)`.

---

## 6. Survivor Risk — Injury & Death Rules

Assigned survivors are at risk. After every run, each assigned survivor rolls an outcome that writes back to the camp roster.

### 6.1 Danger score

```
dangerScore = BASE_DANGER
            + Σ riskDef.dangerBonus            (active risks)
            + missionDifficultyDanger(mission)  // mission.difficulty 1..5 → 0.0..0.4
            − survivalPerkReduction             (e.g. Veteran perk −0.20)
            − survivorLevelMitigation(level)    // higher level survivors are hardier
```

- `BASE_DANGER = 0.05` (a healthy survivor on an easy, unmodified, *won* mission is almost always fine).
- `missionDifficultyDanger = (mission.difficulty − 1) × 0.10` (0 for difficulty 1, 0.4 for difficulty 5).
- `survivorLevelMitigation = min(level × 0.03, 0.25)`.
- Clamp `dangerScore` into `[0.02, 0.95]`.

`dangerScore` is cached at freeze (`derived.dangerScore`) for the *no-outcome-modifier* part; the **win/lose outcome** modifies it at resolution (you can't know it at freeze):

### 6.2 Outcome roll (per assigned survivor, at run end)

Run end has two outcomes (`mission_complete` → WIN, `Player.die()` → LOSE). Apply an outcome factor:

```
effectiveDanger = dangerScore × outcomeFactor
  WIN  → outcomeFactor = 0.4   (you brought them home — much safer)
  LOSE → outcomeFactor = 1.0   (a wipe is dangerous)

roll r ∈ [0,1):
  r <  effectiveDanger × DEATH_SHARE   → DEAD     (DEATH_SHARE = 0.30)
  r <  effectiveDanger                 → INJURED
  else                                 → HEALTHY (returns fine)
```

So death is ~30% of the danger mass, injury the rest. Example: difficulty-5 boss mission, lost, no mitigation: `dangerScore ≈ 0.05 + 0.4 + risks` → with `+0.35` risks ≈ `0.80`, clamped; `effectiveDanger = 0.80`. Death chance ≈ `0.24`, injury ≈ `0.56`, survives ≈ `0.20`. A won easy mission: `dangerScore ≈ 0.05`, `effectiveDanger = 0.02` → essentially always fine.

### 6.3 Write-back

- `INJURED` → set `SurvivorStatus.INJURED` in the roster; camp doc owns recovery timers. Injured survivors are not assignable until healed.
- `DEAD` → set `SurvivorStatus.DEAD` (or remove from roster per camp-doc policy). Permanent loss; this is the stakes.
- Resolution happens in `Game` at both terminus sites (win: extend `handleMissionComplete` `Game.ts:809-837`; lose: at the `Player.die()` → GameOver payload). The actual roster mutation is delegated to `ExpeditionManager.resolveSurvivors(outcome)` so `Game` stays thin (§8).
- **Idempotency:** resolution must run exactly once per run, guarded by the existing `runEnded` latch (`Game.ts:68, 810-812`) so a death-then-mission-complete same-frame race (already handled for the win/lose terminus) cannot double-resolve survivors. Resolve survivors *inside* the same `runEnded` guard.

> Determinism/anti-savescum: seed the outcome RNG from the run at freeze (`derived` could hold a `seed`), so reloading the GameOver screen can't reroll survivor fates. Optional for v1; note it.

---

## 7. Building & Validating the Plan

New singleton: `src/game/systems/ExpeditionManager.ts` (mirrors `LoadoutManager`'s singleton+localStorage shape, `LoadoutManager.ts:16-56`). It owns the **draft plan** the Loadout scene edits, persists the supply inventory, and produces the frozen `ExpeditionPlan`.

```ts
export class ExpeditionManager {
  static getInstance(): ExpeditionManager;

  // ---- draft editing (called by the Loadout scene UI) ----
  setMission(missionId: string): void;        // clears now-invalid allocations (§10)
  addSupply(id: SupplyId, qty?: number): boolean;   // false if over capacity / inventory
  removeSupply(id: SupplyId, qty?: number): void;
  assignSurvivor(survivorId: string): boolean;      // false if slot full / not HEALTHY
  unassignSurvivor(survivorId: string): void;
  togglePerk(perkId: string): boolean;              // false if no free socket
  toggleRisk(id: RiskModifierId): boolean;          // false if conflict
  getDraft(): ExpeditionPlanDraft;

  // ---- validation ----
  validate(): ValidationResult;   // { ok: boolean; errors: string[] }

  // ---- freeze + handoff ----
  buildPlan(): ExpeditionPlan;    // validates, computes derived, returns immutable plan

  // ---- inventory (scarcity) ----
  getSupplyInventory(): Record<SupplyId, number>;
  commitSupplies(plan: ExpeditionPlan): void;    // deduct on run start
  resolveSurvivors(outcome: 'win'|'lose', plan: ExpeditionPlan): SurvivorOutcome[]; // §6
}
```

### 7.1 Capacity & validation rules

`validate()` returns `ok:false` with human-readable errors for:
1. **Over weight** — `usedWeight > capacityWeight`.
2. **Insufficient inventory** — any `SupplyStack.qty > inventory[id]`.
3. **Survivor slots** — `survivors.length > MAX_SURVIVOR_SLOTS`, or any assigned survivor not `HEALTHY`.
4. **Perk sockets** — `perks.length > MAX_PERK_SOCKETS`.
5. **Risk conflicts** — any active risk in another active risk's `conflictsWith`.
6. **Ironman vs. supplies** — `IRONMAN` active AND `supplies.length > 0`.
7. **Stale survivor refs** — assigned `survivorId` no longer in roster (camp changed) → drop + warn.

The "Start Run" button is disabled (greyed) while `validate().ok === false`, with the first error shown inline. Capacity computation:

```
capacityWeight = BASE_SUPPLY_CAPACITY
               + Σ perk(SUPPLY_CAP).magnitude
               + Σ survivorCapacityBonus(level)
usedWeight     = Σ SupplyDef[id].weight × qty
```

### 7.2 Freeze + handoff

`buildPlan()`:
1. Runs `validate()`; throws/returns null if invalid (UI prevents this path).
2. Computes `derived` (`usedWeight`, `capacityWeight`, `rewardMultiplier` §5, `dangerScore` §6.1 sans outcome).
3. Caches survivor perk/level snapshots into `SurvivorAssignment`.
4. Returns a frozen (`Object.freeze`) `ExpeditionPlan`.

The plan is handed to `Game` via the **scene-start data payload** (preferred over a second singleton read, because it's an immutable snapshot decoupled from later draft edits):

```ts
// Loadout "Start Run" handler (extends Loadout.ts:163-168)
const plan = ExpeditionManager.getInstance().buildPlan();
ExpeditionManager.getInstance().commitSupplies(plan);  // spend now (§3)
SpawningConfig.getInstance().reset();
this.scene.start(SceneKey.Game, { expeditionPlan: plan });
```

`Game.init(data)` stashes `data.expeditionPlan` (falling back to a built plan from the persisted draft if absent, so SpawnTuner/dev entry still works — §10).

---

## 8. Applying the Plan in the Game Scene

All application happens in `Game.create()` immediately after the existing loadout block (`src/game/scenes/Game.ts:152-183`), reusing the established ordering: character → blueprints → skill/killstreak → **expedition** → mission.

```ts
// after BlueprintSystem.applyToGame(this);  (Game.ts:164)
const plan: ExpeditionPlan = this.expeditionPlan;   // from init()
const sink = this.makeRunModifierSink();            // wraps existing Game accessors

// 1. Perks (stat mults / xp / capacity already baked into derived)
for (const perkId of plan.perks) PERKS.find(p => p.id === perkId)?.…apply via sink

// 2. Risk modifiers (mutate run config: density/damage/elite/vision)
for (const id of plan.risks) RISK_MODIFIERS.find(r => r.id === id)?.apply(sink);

// 3. Supplies (one-shot stat applies + in-run charges)
if (!plan.risks.includes(RiskModifierId.IRONMAN)) {
  for (const s of plan.supplies) {
    const def = SUPPLIES.find(d => d.id === s.id)!;
    for (let i = 0; i < s.qty; i++) def.apply(sink);   // qty-stacking
  }
}

// 4. Survivors (their cached perk applies for the run)
for (const a of plan.survivors) applyPerk(a.perk, sink);
```

`makeRunModifierSink()` returns a `RunModifierSink` whose stat methods delegate to **existing** `Game` methods (`playerAdjustMaxHealth`, `playerApplyAsymptoticSpeed`, `getWeaponSystem().upgrade*`, `getRelicSystemInternal().setXPMultiplier` — all already public and used by `BlueprintSystem`/`RelicSystem`). Genuinely new surface (§11):
- `setEnemyDensityMult / setEnemyDamageMult / setEliteIntervalMult` → new setters on `EnemySpawnSystem`.
- `setVision` → camera zoom / fog overlay hook in `Game`.
- `grantSupplyCharge(MEDKIT, qty)` → an in-run consumable store (heal charge bound to a key, e.g. `Q`), the only new gameplay verb.

### 8.1 Reward + survivor resolution at run end

- **Win:** in `Game.handleMissionComplete()` (`Game.ts:809-837`), replace the flat reward (`Game.ts:816-818`) with:
  ```ts
  const base = mission.reward?.blueprintPoints ?? 0;
  awardedPoints = Math.round(base * this.expeditionPlan.derived.rewardMultiplier) + onWinPerkBonus(plan);
  BlueprintSystem.addPoints(awardedPoints);
  const survivorOutcomes = ExpeditionManager.getInstance().resolveSurvivors('win', plan);
  ```
- **Lose:** at the `Player.die()` → GameOver transition, call `resolveSurvivors('lose', plan)` under the same `runEnded` latch, and include outcomes + (zero) reward in the payload.
- Pass `survivorOutcomes` into the `GameOver` payload so the end screen can show "Survivor X — INJURED / KIA" alongside the existing win/lose presentation (extends `GameOver` from `mission-system.md` §5.3).

---

## 9. Persistence (localStorage shape)

Keys namespaced `zs2_` like existing ones (`LoadoutManager.ts:24-33`, `BlueprintSystem.ts:5-6`). All reads must be corruption-safe (try/catch + sane default), matching `BlueprintSystem.readUnlockedArray` (`BlueprintSystem.ts:40-49`).

| Key | Shape | Owner |
| --- | --- | --- |
| `zs2_supply_inventory` | `{ [SupplyId]: number }` | ExpeditionManager (scarcity store) |
| `zs2_perk_unlocks` | `string[]` (unlocked perk ids) | ExpeditionManager / camp tree |
| `zs2_expedition_draft` | `ExpeditionPlanDraft` JSON (current unfrozen plan: missionId, supplies, survivors, perks, risks) | ExpeditionManager |
| `zs2_loadout_mission` | unchanged (existing) — kept as the mission selector source of truth | LoadoutManager |
| (survivor roster) | owned by `outer-loop-survivor-camp.md` (`zs2_camp_survivors`) | camp doc |

The draft is persisted so a page reload mid-planning restores the in-progress plan. The frozen `ExpeditionPlan` is **not** persisted (it lives only for the run, passed via scene data). On run end, only the *side effects* persist: supply deduction (already committed at start), blueprint points, and survivor status write-backs.

> **Migration note:** `LoadoutManager` stays the owner of the mission/character/skill selectors (no change to its keys). `ExpeditionManager` is *additive* — it reads `LoadoutManager.getMissionId()` to know the mission, and owns only the new supply/perk/survivor/risk state. No existing key changes shape, so existing saves load fine (empty inventory + no allocations = today's free run).

---

## 10. Edge Cases

1. **No camp / no survivors yet (cold start).** Inventory empty, roster empty → plan with zero supplies/survivors is **valid** and equals today's free run. The feature is strictly additive; a brand-new player can still hit Start Run.
2. **Dev entry bypassing Loadout (SpawnTuner).** `Game.init` has no `expeditionPlan` → build one from the persisted draft (or an empty default plan). Never crash on missing plan; `mission-system.md` already requires a default mission.
3. **Mission changed after allocating.** `setMission()` clears HOLD_ZONE-bound or difficulty-sensitive allocations only where invalidated; simplest correct behavior: re-run `validate()` and drop now-invalid items (over-cap supplies, ineligible survivors), surfacing a warning. Don't silently keep an invalid plan.
4. **Survivor injured/killed in a parallel tab between freeze and run end.** The run uses the **cached** `SurvivorAssignment` snapshot; write-back reconciles by id — if the survivor is already `DEAD` in the roster at resolution, skip (don't resurrect-then-rekill). Last-write-wins is acceptable.
5. **Ironman + supplies.** Hard validation error (§5.1, §7.1 rule 6); Start Run disabled.
6. **Over-capacity via perk removal.** Removing a `SUPPLY_CAP` perk can push `usedWeight > capacityWeight`. Re-validate on every edit; block Start Run until the player drops supplies.
7. **Reward overflow.** `REWARD_MULT_CAP = 4.0` bounds payout; `addPoints` already floors and clamps ≥0 (`BlueprintSystem.ts:35`).
8. **Same-frame win+death race.** Survivor resolution runs inside the existing `runEnded` latch (§6.3), so it resolves exactly once with a single outcome (death precedence per `mission-system.md` §8).
9. **Quitting mid-run (no terminus).** Supplies were already spent at commit (intended). Survivors are *not* resolved (no outcome) → they return `HEALTHY` (benefit of the doubt). Decide if camp doc wants an abandon penalty; default: no penalty, supplies lost.
10. **Corrupt localStorage.** Every reader guards with try/catch → empty defaults (pattern: `BlueprintSystem.ts:40-49`).

---

## 11. Incremental Implementation Checklist (ordered, file-by-file)

1. **`src/game/types/ExpeditionTypes.ts`** (new) — `SupplyId/SupplyDef/SupplyStack`, `SurvivorRef/Status/Assignment`, `Perk/PerkKind`, `RiskModifierId/Def`, `ExpeditionPlan`, `RunModifierSink` (§2).

2. **`src/game/config/Expedition.ts`** (new) — `SUPPLIES`, `PERKS`, `RISK_MODIFIERS`, and constants `BASE_SUPPLY_CAPACITY`, `MAX_SURVIVOR_SLOTS=3`, `MAX_PERK_SOCKETS=2`, `REWARD_MULT_CAP=4.0`, `BASE_DANGER`, `DEATH_SHARE` (§3–§6). Pattern after `Missions.ts` / `RelicSystem.ts:47`.

3. **`src/game/systems/ExpeditionManager.ts`** (new) — singleton (mirror `LoadoutManager.ts:16-56`): draft edit API, `validate()`, `buildPlan()`, supply inventory persistence (`zs2_supply_inventory`), `commitSupplies()`, `resolveSurvivors()` (§6, §7, §9). Corruption-safe readers (§10.10).

4. **`src/game/scenes/Loadout.ts`** — add four planning panels below the existing mission grid (`Loadout.ts:116-156`), each following the established selector pattern (`Loadout.ts:33-49`): Supplies (qty +/−, weight bar), Survivors (roster list with status), Perks (socket toggles), Risk Modifiers (toggles showing `+reward% / +danger%`). Live capacity bar + reward-multiplier readout. Disable "Start Run" while `validate().ok === false`. Extend the Start handler (`Loadout.ts:163-168`) to `buildPlan()` → `commitSupplies()` → `scene.start(Game, { expeditionPlan })` (§7.2).

5. **`src/game/scenes/Game.ts`** —
   - `init(data)`: stash `data.expeditionPlan` (fallback build from draft) (§10.2).
   - `create()`: after `BlueprintSystem.applyToGame(this)` (`Game.ts:164`), add `applyExpedition(plan)` using `makeRunModifierSink()` (§8).
   - `handleMissionComplete()` (`Game.ts:809-837`): scale reward by `derived.rewardMultiplier` + on-win perk bonus; call `resolveSurvivors('win')` inside `runEnded` guard; pass outcomes to GameOver (§8.1).
   - Lose path (`Player.die()` → GameOver): `resolveSurvivors('lose')`; pass outcomes (§8.1).
   - `makeRunModifierSink()` helper delegating to existing accessors + the new hooks.

6. **`src/game/systems/EnemySpawnSystem.ts`** — add `setEnemyDensityMult`, `setEnemyDamageMult`, `setEliteIntervalMult` setters consumed by `DENSITY`/`FEROCITY`/`ELITE_TIDE` (§8, mirrors the spawn-hint discussion in `mission-system.md` §11).

7. **`src/game/scenes/Game.ts` (vision + medkit)** — `setVision` (camera zoom / fog) for `SCANNER`/`VEIL`; an in-run heal-charge consumable bound to a key for `MEDKIT` via `grantSupplyCharge` (§8).

8. **`src/game/scenes/GameOver.ts`** — extend the win/lose payload (already carries `outcome`/`missionName` per `mission-system.md` §5.3) to also render `blueprintPointsAwarded` (now risk-scaled) and a survivor-outcomes list ("Survivor X — KIA / INJURED / returned") (§8.1).

9. **Survivor camp integration (`outer-loop-survivor-camp.md`)** — `ExpeditionManager` reads the roster (`zs2_camp_survivors`) for assignable survivors and writes status back via `resolveSurvivors`. Until that doc ships, stub the roster reader to return `[]` (cold-start path, §10.1) so this feature ships independently.

10. **(Optional) Determinism** — seed survivor-outcome RNG at freeze (`derived.seed`) to prevent savescum rerolls (§6.3 note).

---

## 12. Acceptance Criteria

- The Loadout scene lets the player allocate supplies/survivors/perks/risks under a visible capacity budget; "Start Run" is blocked while the plan is invalid, with a clear reason.
- Supplies are deducted from `zs2_supply_inventory` on run start and are **not** refunded on loss.
- Active risk modifiers measurably alter the run (more/angrier enemies, faster elites, fog) and scale the on-win blueprint reward per §5 (additive, capped at 4.0×).
- Assigned survivors roll injury/death per §6 at run end, write back to the camp roster, and the outcome is shown on GameOver. Resolution runs exactly once (runEnded latch).
- The frozen `ExpeditionPlan` is the single immutable run-config snapshot, passed via scene data; `Game` reads no live draft state mid-run.
- Cold start (no camp, empty inventory) yields a valid empty plan equal to today's free run — feature is strictly additive; no existing localStorage key changes shape.
- All localStorage reads are corruption-safe with sane defaults.
- Per-run teardown unchanged; no new listeners leak (any added emitters cleaned in `shutdownScene`, `Game.ts:1176`).
```
