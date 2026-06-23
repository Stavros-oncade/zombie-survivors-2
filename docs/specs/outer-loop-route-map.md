# Outer Loop — The FTL-Style Route Map ("Long Recon") — Implementation Spec

Status: Draft / design doc (no code yet)
Author: Game systems design
Target: `zombie-survivors-2` (Phaser 3 + TypeScript)
Design Doc: 3 of the Outer Loop set
Cross-refs: `outer-loop-job-board.md` (the recon appears as one Job Board offer),
`outer-loop-city-reclamation.md` (a zone clear can be authored as a recon),
`outer-loop-survivor-camp.md` (payout sink), `outer-loop-expedition-loadout.md`
(single outfit at the start of the recon), `mission-system.md` (each node is a `Mission`).

## 1. Purpose & Summary

The inner game is a single run that ends on **WIN** (mission complete) or **LOSE** (death)
— see `mission-system.md` and `Game.handleMissionComplete()`
(`src/game/scenes/Game.ts:809-837`). Today every "Play" press goes Loadout → one Game run →
GameOver → MainMenu. There is **no structure between runs** and no reason for any single run
to matter beyond its own reward.

A **Long Recon** is a multi-mission **expedition**: an FTL / Slay-the-Spire style branching
map of mission nodes from a start to an end. The player:

1. Accepts a recon offer (from the Job Board) and **outfits once** at an expedition loadout.
2. Sees a **layered DAG** of nodes; each node is a short Game run driven by a `Mission`.
3. Picks a path. Each node launches the existing `Game` scene; on **WIN** they advance to the
   next chosen node, on **LOSE** the **entire recon fails**.
4. **Run-state (HP / weapons / level / buffs) carries between nodes** (FTL run-state), so a
   recon is one continuous escalating campaign rather than independent runs.
5. Reaches the **boss node** at the end. Rewards **accumulate** node-by-node and **pay out on
   completion** into camp resources / blueprints.

This reuses the entire Mission System unchanged: a recon node *is* a `Mission`
(`src/game/types/MissionTypes.ts:104-112`), launched by the same `MissionSystem`
(`src/game/systems/MissionSystem.ts:30`), won via the same `mission_complete` event
(`src/game/scenes/Game.ts:174`). The new surface is: a **map data model + generator**, a
**ReconSystem** that owns persistent run-state and accumulated rewards, a **RouteMap scene**
that renders the graph and launches nodes, and small **handoff hooks** in `Game` /
`Loadout` / a new node-result return path.

### Key existing facts this spec builds on

| Fact | Source |
| --- | --- |
| A node = a `Mission` (id/name/condition/reward) | `src/game/types/MissionTypes.ts:104-112` |
| Per-run mission runtime, emits `mission_complete` | `src/game/systems/MissionSystem.ts:30,226-232` |
| Win transition reads mission, awards points, starts GameOver | `Game.handleMissionComplete()` — `src/game/scenes/Game.ts:809-837` |
| Lose transition (death) starts GameOver `outcome:'lose'` | `Player.die()` — `src/game/entities/Player.ts:142-195` |
| `runEnded` latch, fires win at most once, death precedence | `src/game/scenes/Game.ts:810-812` |
| Mission resolved from `LoadoutManager.getMissionId()` at run start | `src/game/scenes/Game.ts:172` |
| Loadout applies character / skills / killstreak / blueprints | `src/game/scenes/Game.ts:151-169` |
| Player HP getters/setters | `getStats()` `Player.ts:195-199`; `setMaxHealth()` `Player.ts:256-259`; `heal()` `Player.ts:261-264` |
| Player level via ExperienceSystem | `Player.ts:42,198`; `ExperienceSystem.getCurrentLevel()` `src/game/systems/ExperienceSystem.ts:62` |
| Weapon unlocks (carry candidates) | `WeaponSystem.unlockPiercing/unlockExplosive` — `src/game/systems/WeaponSystem.ts:67,83` |
| Meta currency in localStorage | `BlueprintSystem.getPoints/addPoints` — `src/game/systems/BlueprintSystem.ts:28-36` |
| Safe localStorage array read pattern | `BlueprintSystem.readUnlockedArray` — `src/game/systems/BlueprintSystem.ts:40-49` |
| Loadout persistence pattern (per-field keys) | `LoadoutManager` — `src/game/systems/LoadoutManager.ts:24-55` |
| Scene registry (must register new scenes) | `src/game/config/SceneKeys.ts:1-12` |
| World size 2048×1536 | `src/game/config/GameConfig.ts` |
| GameOver routes back to MainMenu | `GameOver.changeScene()` — `src/game/scenes/GameOver.ts:128-131` |

---

## 2. Data Model

New file: `src/game/types/ReconTypes.ts`.

```ts
// src/game/types/ReconTypes.ts
import { Mission } from './MissionTypes';

/** Node-type catalog (§7). Drives generation weighting, difficulty, and node art. */
export enum ReconNodeKind {
  COMBAT = 'combat',     // standard mission (KILL_COUNT / SURVIVE_TIME / KILL_TYPE / HOLD_ZONE…)
  ELITE  = 'elite',      // KILL_ELITES mission, harder
  CACHE  = 'cache',      // light combat (COLLECT_DROPS) with an outsized loot reward
  SHOP   = 'shop',       // NO run: spend accumulated currency on camp/loadout upgrades
  EVENT  = 'event',      // NO run: rest/heal/risk-reward choice node (FTL-style event)
  BOSS   = 'boss',       // SLAY_BOSS; always the single terminal node
}

/** True when entering this node launches a Game run; false = handled on the map. */
export const NODE_LAUNCHES_RUN: Record<ReconNodeKind, boolean> = {
  [ReconNodeKind.COMBAT]: true,
  [ReconNodeKind.ELITE]:  true,
  [ReconNodeKind.CACHE]:  true,
  [ReconNodeKind.SHOP]:   false,
  [ReconNodeKind.EVENT]:  false,
  [ReconNodeKind.BOSS]:   true,
};

/** Rewards a node grants on clear. Accumulated by ReconSystem, paid out at the end (§9). */
export interface ReconReward {
  blueprintPoints?: number;     // -> BlueprintSystem.addPoints (BlueprintSystem.ts:36)
  campResources?: number;       // -> survivor camp currency (outer-loop-survivor-camp.md)
  specialBlueprintId?: string;  // -> guaranteed unlock id (rare, on CACHE/BOSS)
}

/** One node in the layered DAG. Carries its Mission and the difficulty it is scaled to. */
export interface ReconNode {
  id: string;                   // stable within a recon, e.g. 'n_2_1' (layer 2, slot 1)
  kind: ReconNodeKind;
  layer: number;                // 0..(layers-1); 0 = start, last = boss
  slot: number;                 // index within the layer (for UI x-position)
  missionId?: string;           // resolved Mission id for run nodes (undefined for SHOP/EVENT)
  difficultyTier: number;       // 1..N, scales with layer (§8); injected into the Mission at launch
  reward: ReconReward;          // payout for clearing this node
  next: string[];               // ids of nodes in layer+1 this node connects to (out-edges)
  // Authoring/event payload (SHOP/EVENT only):
  eventId?: string;             // resolves to an authored event/shop definition
}

/** A generated expedition: the immutable graph + metadata. */
export interface ReconMap {
  id: string;                   // unique recon instance id (timestamp+seed)
  seed: number;                 // generation seed (deterministic regen / resume)
  name: string;                 // e.g. 'Downtown Sweep'
  layers: number;               // total layers including start(0) and boss(last)
  nodes: ReconNode[];           // all nodes, flat
  startNodeId: string;          // the single layer-0 entry node
  bossNodeId: string;           // the single terminal node
  requiredClears: number;       // X nodes to traverse start->boss (== layers, one per layer)
  baseReward: ReconReward;      // completion bonus paid on reaching boss clear (§9)
}

/** Live progress through a recon (the FTL "run-state"). Persisted between nodes (§5,§10). */
export interface ReconRunState {
  mapId: string;                // which ReconMap this state belongs to
  currentNodeId: string;        // node just cleared (or start before first move)
  clearedNodeIds: string[];     // path taken so far (for map rendering + resume)
  availableNodeIds: string[];   // out-edges of currentNode the player may pick next
  // ---- Carried character state (the part that makes a recon "one run") ----
  carry: ReconCarryState;
  // ---- Accumulated, unpaid rewards (banked only on full completion) ----
  pending: { blueprintPoints: number; campResources: number; specialBlueprintIds: string[] };
  status: 'active' | 'won' | 'failed';
}

/**
 * The minimal serializable snapshot of the player carried node-to-node. Deliberately
 * small and value-based (no live Phaser objects) so it survives scene restarts and
 * localStorage round-trips (§5).
 */
export interface ReconCarryState {
  maxHealth: number;            // Player.getStats().maxHealth (Player.ts:197)
  currentHealth: number;        // Player.health at node clear; rest nodes can restore
  level: number;                // ExperienceSystem.getCurrentLevel() (ExperienceSystem.ts:62)
  totalXP: number;              // banked XP so leveling continues across nodes
  unlockedWeaponIds: string[];  // e.g. ['piercing','explosive'] (WeaponSystem.ts:67,83)
  upgradeIds: string[];         // in-run upgrades chosen (UpgradeSystem) to re-apply
  relicIds: string[];           // relics acquired (RelicSystem) to re-apply
  // Loadout chosen once at expedition start (re-applied so the build is stable):
  characterId: string;
  defensiveSkillId: string;
  killstreakPerkId: string;
}
```

### Notes on the model

- A **node is a `Mission` plus a difficulty tier and reward**. We do **not** fork the Mission
  System; we *select* an authored `Mission` (`MISSIONS`, `src/game/config/Missions.ts:6`) for
  each run node and apply a per-layer difficulty multiplier at launch (§8).
- `ReconMap` is **immutable once generated** (pure function of `seed`); `ReconRunState` is the
  only mutable, persisted thing. This keeps resume trivial: regenerate the map from `seed`,
  then replay `clearedNodeIds`.
- `requiredClears === layers`: every path from start to boss visits exactly one node per layer
  (classic StS column structure), so the **X missions to finish** is exactly the layer count.
- `ReconCarryState` is intentionally **value-only**. It is rebuilt into a live `Player` at the
  start of each node (§5.3) rather than trying to serialize Phaser game objects.

---

## 3. Map Topology (Layered DAG)

Slay-the-Spire / FTL column structure:

```
 layer:   0       1        2        3        4         5(boss)
          ●  ──►  ●  ──►   ●   ──►  ●  ──►   ●   ──►   ◆
 start    │   ╲   ●   ╳    ●   ╲    ●   ╱             (single
          ●  ──►  ●  ──►   ●        ●                  boss
                  (2-3 nodes per inner layer, edges only to layer+1)
```

Rules:
- **Layer 0:** exactly one **start** node (auto-cleared / staging; no run, or a trivial intro
  combat). Layer `layers-1`: exactly one **boss** node.
- **Inner layers (1..layers-2):** `branchWidth` nodes each (2–3). Edges go **only** to the
  next layer (DAG, no skips, no back-edges) — guarantees a finite, forward-only traversal and
  that exactly one node per layer is cleared.
- **Reconvergence:** because all inner-layer edges target layer+1 and the boss is a single
  node, paths fan out then fan back in. Every node in the penultimate layer connects to the
  boss.
- **Connectivity invariant:** every node has ≥1 in-edge (except start) and ≥1 out-edge
  (except boss). The generator (§4) enforces this.

Sizing defaults (tunable in `ReconConfig`):

| Param | Default | Notes |
| --- | --- | --- |
| `layers` | 6 | start + 4 inner + boss → `requiredClears = 6` (≈ 6 short runs) |
| `branchWidth` | 2–3 | per inner layer, random in `[minWidth,maxWidth]` |
| `minWidth` / `maxWidth` | 2 / 3 | |
| short-run length | ~90–150 s | tune node Missions shorter than the standalone 5:00 climax |

A full recon ≈ 6 short runs ≈ 10–15 min, escalating to the boss — long enough to feel like an
expedition, short enough that losing it stings without being punishing-by-hours.

---

## 4. Procedural Generation Algorithm

New file: `src/game/systems/ReconMapGenerator.ts`. Pure, seeded, deterministic.

```ts
export function generateReconMap(opts: {
  seed: number;
  name: string;
  layers?: number;        // default 6
  minWidth?: number;      // default 2
  maxWidth?: number;      // default 3
  theme?: 'city' | 'wilds';   // selects Mission pool + node-kind weights
}): ReconMap;
```

Algorithm (layered DAG construction):

1. **Seeded RNG.** Wrap a small deterministic PRNG seeded by `opts.seed` (mulberry32-style).
   All randomness flows through it so the same seed regenerates the identical map (needed for
   resume, §10).
2. **Place layers.**
   - Layer 0: one `start` node.
   - Layers `1..layers-2`: `width = rngInt(minWidth, maxWidth)` nodes each. Assign `slot`
     `0..width-1`.
   - Layer `layers-1`: one `boss` node.
3. **Assign node kinds** (inner layers) by **weighted pick**, with constraints:
   - Weights (default): `COMBAT 0.50, ELITE 0.18, CACHE 0.14, EVENT 0.12, SHOP 0.06`.
   - **Constraints:** at least one `ELITE` in the second half of the map; at least one `SHOP`
     **or** `EVENT` (rest) somewhere in layers `1..layers-2` so the player can heal/spend
     before the boss; never two `SHOP`s adjacent in the same layer.
4. **Wire edges (out-edges only to next layer).** For each node in layer `L` (`L < layers-1`):
   - Connect to **1–2** nodes in layer `L+1`, biased toward the nearest `slot` (so the drawn
     graph doesn't fully cross). Use slot proximity weighting.
   - After wiring all of layer `L`, run a **coverage pass**: any node in `L+1` with **zero
     in-edges** gets an edge from the nearest node in `L`. This guarantees connectivity /
     reconvergence (no orphan nodes).
   - Penultimate layer: force every node's `next = [bossNodeId]`.
5. **Assign difficulty tiers.** `node.difficultyTier = 1 + node.layer` (boss gets the max).
   Tier feeds the scaling in §8.
6. **Resolve Missions for run nodes.** For each run node, pick a `Mission` from the
   theme/kind-appropriate subset of `MISSIONS` (`src/game/config/Missions.ts:6`) via seeded
   pick:
   - `COMBAT` → `KILL_COUNT` / `SURVIVE_TIME` / `KILL_TYPE` / `HOLD_ZONE`.
   - `ELITE` → `KILL_ELITES` (`m_kill_elites_2`).
   - `CACHE` → `COLLECT_DROPS` (`m_collect_15`).
   - `BOSS` → `SLAY_BOSS` (`m_slay_boss`).
   Store the chosen `missionId`. (The Mission's own `reward` is ignored for recon nodes — recon
   reward comes from `ReconNode.reward`, §9, to avoid double-paying.)
7. **Assign node rewards.** Scale `ReconReward` by `difficultyTier` and kind (CACHE pays
   ~2× a COMBAT of the same tier; ELITE pays a premium; BOSS pays `baseReward` on top).
8. **Return** the assembled, frozen `ReconMap` with `startNodeId`, `bossNodeId`,
   `requiredClears = layers`.

**Determinism note.** Generation must not read `Math.random()` directly anywhere; only the
seeded PRNG. This is the contract that lets §10 resume by storing only `{seed, clearedNodeIds}`.

---

## 5. Run-State Persistence Across Nodes (FTL Run-State)

This is the heart of "it's one expedition, not six runs."

### 5.1 What persists vs. what resets

| State | Persists across nodes? | How |
| --- | --- | --- |
| **Max HP** | **Yes** | `ReconCarryState.maxHealth` ← `Player.getStats().maxHealth` (`Player.ts:197`) |
| **Current HP** | **Yes** (damage carries) | `ReconCarryState.currentHealth` ← `Player.health` at node clear |
| **Level & XP** | **Yes** | `level`/`totalXP` ← `ExperienceSystem` (`ExperienceSystem.ts:62`) |
| **Unlocked weapons** | **Yes** | `unlockedWeaponIds` (`WeaponSystem.ts:67,83`) |
| **In-run upgrades** | **Yes** | `upgradeIds` (UpgradeSystem) re-applied at node start |
| **Relics** | **Yes** | `relicIds` (RelicSystem) re-applied at node start |
| **Loadout (char/skill/killstreak)** | **Yes** (chosen once) | from expedition loadout, §6 |
| **Permanent blueprints** | **Yes** (already global) | `BlueprintSystem.applyToGame` (`Game.ts:164`) |
| Enemy positions / wave state | **No** (each node is a fresh battlefield) | `EnemySpawnSystem` re-inits per scene |
| Killstreak counter | **No** (resets per node) | fresh `KillstreakSystem` per `Game.create()` |
| Mission progress | **No** (each node has its own objective) | fresh `MissionSystem` per node |
| Cooldowns / i-frames | **No** | fresh per scene |

Design intent: **attrition matters.** You finish a hard COMBAT node at 30% HP and must decide
whether to route through a rest/EVENT node before the ELITE. This is the FTL tension.

### 5.2 Capturing carry-state on a node WIN

`Game.handleMissionComplete()` (`src/game/scenes/Game.ts:809-837`) currently always
`scene.start(SceneKey.GameOver, …)`. When a recon is active, it must instead:

1. Build a `ReconCarryState` snapshot from the live player/systems.
2. Hand it (with the node result) back to `ReconSystem`, which updates `ReconRunState`,
   accumulates `pending` rewards, and returns to the **RouteMap** scene (not GameOver).

We do **not** award `mission.reward.blueprintPoints` immediately for recon nodes (rewards bank
on completion, §9). Detect "recon mode" via `ReconSystem.isActive()` and branch:

```ts
// in Game.handleMissionComplete(mission), before the GameOver path:
if (ReconSystem.getInstance().isActive()) {
  const carry = this.captureCarryState();           // §5.4
  ReconSystem.getInstance().completeNode(this.activeReconNodeId, carry); // accrues reward, advances
  this.scene.start(SceneKey.RouteMap);              // back to the map, NOT GameOver
  return;
}
// …existing standalone GameOver win path unchanged…
```

### 5.3 Re-applying carry-state at the start of the next node

`Game.create()` currently builds a fresh player and applies the loadout
(`src/game/scenes/Game.ts:151-173`). Add: **if a recon is active**, after the normal loadout
application, **overwrite** with carry-state:

```ts
if (ReconSystem.getInstance().isActive()) {
  const carry = ReconSystem.getInstance().getCarry();
  this.player.setMaxHealth(carry.maxHealth);         // Player.ts:256
  this.player.setHealthAbsolute(carry.currentHealth);// NEW small setter (see §11 checklist)
  this.experienceSystem.restore(carry.level, carry.totalXP); // NEW restore method
  carry.unlockedWeaponIds.forEach(id => this.weaponSystem.unlockById(id)); // NEW lookup
  carry.upgradeIds.forEach(id => this.upgradeSystem.reapply(id));
  carry.relicIds.forEach(id => this.relicSystem.reapply(id));
  // mission for THIS node, with difficulty tier injected (§8):
  this.activeMission = ReconSystem.getInstance().getActiveNodeMission();
  this.activeReconNodeId = ReconSystem.getInstance().getActiveNodeId();
}
```

The character/defensive/killstreak loadout is read from the recon's frozen loadout (§6), not
from `LoadoutManager`, so mid-recon the build is stable even if the player edits the menu.

### 5.4 `captureCarryState()` (new private in `Game`)

```ts
private captureCarryState(): ReconCarryState {
  const s = this.player.getStats();                 // Player.ts:195
  return {
    maxHealth: s.maxHealth,
    currentHealth: this.player.getCurrentHealth(),  // NEW getter
    level: this.experienceSystem.getCurrentLevel(), // ExperienceSystem.ts:62
    totalXP: this.experienceSystem.getTotalXP(),    // NEW getter
    unlockedWeaponIds: this.weaponSystem.getUnlockedIds(),
    upgradeIds: this.upgradeSystem.getChosenIds(),
    relicIds: this.relicSystem.getAcquiredIds(),
    characterId: ReconSystem.getInstance().getLoadout().characterId,
    defensiveSkillId: ReconSystem.getInstance().getLoadout().defensiveSkillId,
    killstreakPerkId: ReconSystem.getInstance().getLoadout().killstreakPerkId,
  };
}
```

> Several of these getters/setters don't exist yet (`getCurrentHealth`,
> `setHealthAbsolute`, `getTotalXP`, `ExperienceSystem.restore`, weapon/upgrade/relic
> id accessors). They are small, well-scoped additions — listed in the checklist (§11).
> They are the only edits to gameplay systems; the combat loop itself is untouched.

### 5.5 Death anywhere = recon failed

`Player.die()` (`src/game/entities/Player.ts:142-195`) goes to GameOver `outcome:'lose'`. In
recon mode it must instead **fail the recon**: forfeit `pending` rewards (the FTL "you lose the
run" stake) and route to a **recon-failed** screen (a GameOver variant). See §9 for the
forfeit policy and §11 for the hook. We keep the existing `isDead` re-entry guard
(`Player.ts:145-147`) so death resolves exactly once.

---

## 6. Expedition Loadout (Outfit Once)

Per `outer-loop-expedition-loadout.md`, the player outfits **once** when accepting the recon,
not before every node.

- On **accept**, snapshot the current `LoadoutManager` selections
  (`getCharacter/getDefensiveSkill/getKillstreakPerk`, `LoadoutManager.ts:46-55`) into the
  `ReconRunState`'s frozen loadout (stored inside `ReconCarryState` at start).
- Every node reads that frozen loadout, so changing the menu mid-recon has no effect on the
  in-flight expedition. This is what makes carry-state coherent.
- The accept flow can reuse the existing `Loadout` scene (`src/game/scenes/Loadout.ts`) as the
  expedition-loadout screen, then route to **RouteMap** instead of straight to `Game`. (When
  the Job Board offers a recon, "Embark" → Loadout(expedition mode) → RouteMap.)

---

## 7. Node-Type Catalog

| Kind | Launches run? | Mission used | Role / feel | Reward profile |
| --- | --- | --- | --- | --- |
| **COMBAT** | Yes | `KILL_COUNT` / `SURVIVE_TIME` / `KILL_TYPE` / `HOLD_ZONE` | Bread-and-butter node; objective varies for texture | Base BP + small camp resources, scaled by tier |
| **ELITE** | Yes | `KILL_ELITES` (`m_kill_elites_2`) | Spike node — tighter elite cadence (§8), real attrition | Premium BP; chance of `specialBlueprintId` |
| **CACHE** | Yes | `COLLECT_DROPS` (`m_collect_15`) | Lighter combat, loot-focused; the "reward" path | Big BP + camp resources; often a `specialBlueprintId` |
| **SHOP** | No | — | Map-screen overlay: spend `pending` camp resources on heal / weapon unlock / temp buff | Spends, doesn't grant |
| **EVENT / REST** | No | — | Map-screen FTL event: choose heal-up, gamble for loot, or take a risk for more reward | Choice-driven; heal restores `currentHealth` toward `maxHealth` |
| **BOSS** | Yes | `SLAY_BOSS` (`m_slay_boss`) | Terminal climax; survive the carried-in damage and kill it | Triggers full payout (§9) incl. `baseReward` |

**Non-run nodes (SHOP/EVENT)** are resolved entirely on the **RouteMap** scene as a modal
panel — they update `ReconRunState` (heal `carry.currentHealth`, spend `pending`, maybe add a
`unlockedWeaponId`) and then mark the node cleared without ever entering `Game`. This is the
FTL "store / event" beat and is cheap (no scene transition).

**EVENT heal** is the primary mid-recon recovery valve: e.g. "Field medic: restore 50% max
HP" sets `carry.currentHealth = min(maxHealth, currentHealth + 0.5*maxHealth)`.

---

## 8. Difficulty Scaling Per Layer

`node.difficultyTier = 1 + layer` (§4.5). Two scaling axes, applied at node launch in
`Game.create()` when recon is active:

1. **Mission target scaling.** The chosen `Mission`'s numeric target is multiplied by a tier
   curve before constructing the `MissionSystem`. We inject a *scaled copy* of the mission
   (don't mutate the shared `MISSIONS` constant):
   ```ts
   const m = ReconSystem.getInstance().getActiveNodeMission(); // already tier-scaled copy
   // e.g. KILL_COUNT target *= (1 + 0.35*(tier-1)); SURVIVE_TIME seconds += 20*(tier-1); etc.
   ```
   `ReconSystem.scaleMission(mission, tier)` returns a deep-cloned `Mission` with the
   condition's `target`/`seconds`/`holdSeconds` bumped per a per-kind curve.
2. **Spawn-director scaling.** Bias `EnemySpawnSystem` harder per tier (higher spawn-count
   multiplier / faster elite cadence at higher tiers), via a setter on `EnemySpawnSystem`
   (the Mission spec already anticipates `setEliteIntervalMs` / spawn hints —
   `mission-system.md` §11). Boss-node tier optionally lowers/raises boss HP toward a
   beatable value (boss HP is flagged "buffed ~12.5× for testing" in `mission-system.md`).

Result: layer 1 nodes are near-trivial warmups; the penultimate layer is brutal; the boss is
the wall. Combined with carry-state attrition, the **difficulty is felt cumulatively**.

Tier curve lives in `ReconConfig` so it's a single tuning surface:
```ts
export const RECON_DIFFICULTY = {
  killCountPerTier: 0.35,   // +35% target per tier above 1
  surviveSecPerTier: 20,    // +20s per tier
  spawnRatePerTier: 0.15,   // +15% spawn-count multiplier per tier
  eliteCadencePerTier: 0.10 // -10% elite interval per tier
};
```

---

## 9. Failure / Payout Rules

### Payout (on full completion — boss cleared)

When `BOSS` node clears, `ReconSystem` flips `status='won'` and **banks `pending`**:
- `BlueprintSystem.addPoints(pending.blueprintPoints + baseReward.blueprintPoints)`
  (`src/game/systems/BlueprintSystem.ts:36`).
- `CampResourceSystem.add(pending.campResources + baseReward.campResources)` — the survivor
  camp sink (`outer-loop-survivor-camp.md`).
- Unlock each `pending.specialBlueprintIds` (write to the blueprint-unlocked list using the
  same safe-array pattern as `BlueprintSystem.readUnlockedArray`,
  `src/game/systems/BlueprintSystem.ts:40-49`).
- Clear `ReconRunState` from storage (the expedition is consumed).
- Route to a **win** GameOver-style screen ("RECON COMPLETE") summarizing total payout.

### Failure (death on any node)

**Recommended policy: forfeit-most-with-a-salvage-floor.**
- On death, `ReconSystem.failRecon()` sets `status='failed'`.
- **Forfeit** the bulk of `pending` (the staked, escalating reward you were playing for) — this
  is the FTL risk that makes routing decisions matter.
- **Salvage floor:** pay out a small fraction (e.g. `floor(0.25 * pending.blueprintPoints)`) so
  a deep, near-complete run isn't a total zero — softens the punishment, respects time spent.
  (Tunable; set to 0 for a hardcore variant.)
- Clear `ReconRunState`, route to a **recon-failed** screen showing nodes cleared + salvage.

| Outcome | `pending` BP/resources | special blueprints | run-state |
| --- | --- | --- | --- |
| Boss cleared (win) | full + `baseReward` | all granted | cleared |
| Death mid-recon | salvage floor only (≈25%) | none | cleared (forfeited) |
| Abandon at SHOP/EVENT (optional) | salvage floor | none | cleared |

**Race / latch.** Reuse the existing precedence: `Game.handleMissionComplete()`'s `runEnded`
guard (`src/game/scenes/Game.ts:810`) + `Player.die()`'s `isDead` guard
(`src/game/entities/Player.ts:145`). If a node win and death resolve in the same frame, **death
wins** → recon fails. This is identical to the standalone rule and needs no new machinery.

---

## 10. Persistence (localStorage, Resumable Mid-Recon)

Single key, JSON, read with the crash-proof pattern from `BlueprintSystem.readUnlockedArray`
(`src/game/systems/BlueprintSystem.ts:40-49`).

```
key: 'zs2_recon_v1'
value (JSON):
{
  "seed": 1718900000123,
  "mapId": "recon_1718900000123",
  "name": "Downtown Sweep",
  "currentNodeId": "n_2_1",
  "clearedNodeIds": ["n_0_0", "n_1_0", "n_2_1"],
  "availableNodeIds": ["n_3_0", "n_3_1"],
  "carry": { "maxHealth": 130, "currentHealth": 54, "level": 7, "totalXP": 4210,
             "unlockedWeaponIds": ["piercing"], "upgradeIds": ["u_dmg","u_rof"],
             "relicIds": ["r_thorns"], "characterId": "soldier",
             "defensiveSkillId": "dash", "killstreakPerkId": "damage" },
  "pending": { "blueprintPoints": 14, "campResources": 30, "specialBlueprintIds": [] },
  "status": "active"
}
```

- **The map itself is NOT stored** — only `seed`. On resume, `generateReconMap({seed, …})`
  reproduces the identical DAG (§4 determinism), then `clearedNodeIds` replays the path. This
  keeps the blob tiny and immune to schema drift in the graph shape.
- **Write points:** after every `completeNode()` (node win, SHOP/EVENT resolution) and on
  `failRecon()` / completion (which then deletes the key). Mirror `LoadoutManager`'s
  write-on-set discipline (`src/game/systems/LoadoutManager.ts:43-54`).
- **Resume:** on MainMenu / Job Board load, if `zs2_recon_v1` exists with `status='active'`,
  surface a **"Resume Recon"** entry that boots straight into the RouteMap at `currentNodeId`.
- **Versioning + corruption:** `v1` suffix in the key; wrap `JSON.parse` in try/catch and
  treat any parse failure or missing required field as "no active recon" (silently drop), same
  defensive stance as `BlueprintSystem`.
- **Single active recon** at a time (v1). Accepting a new recon while one is active prompts to
  abandon (forfeit per §9) — no concurrent expeditions.

---

## 11. ReconSystem Class Sketch

New file: `src/game/systems/ReconSystem.ts`. **Singleton** (like `LoadoutManager`,
`src/game/systems/LoadoutManager.ts:36-39`) because it must outlive scene transitions
(RouteMap ↔ Game) and persist to localStorage.

```ts
export class ReconSystem {
  private static instance: ReconSystem;
  static getInstance(): ReconSystem { /* lazy + hydrate from localStorage */ }

  // ---- Lifecycle ----
  /** Begin a fresh recon from a generated map + the once-chosen loadout. Persists. */
  startRecon(map: ReconMap, loadout: ReconLoadout): void;
  /** True while an expedition is in progress (gates the Game branch in §5). */
  isActive(): boolean;
  /** Hydrate from 'zs2_recon_v1' if present & status==='active' (resume). */
  private hydrate(): void;
  private persist(): void;     // write zs2_recon_v1
  private clear(): void;       // delete key (on win/fail)

  // ---- Map / navigation ----
  getMap(): ReconMap;                       // regenerated from seed if needed
  getActiveNodeId(): string;
  getActiveNodeMission(): Mission;          // tier-scaled clone (§8) for the node about to launch
  getAvailableNextNodes(): ReconNode[];     // out-edges of current node
  selectNextNode(nodeId: string): void;     // validate it's in availableNodeIds; set as active

  // ---- Node resolution ----
  /** Run node WON: accrue node reward into pending, store carry, advance available set. */
  completeNode(nodeId: string, carry: ReconCarryState): void;
  /** SHOP/EVENT resolved on the map (no run): apply effects, mark cleared, advance. */
  resolveMapNode(nodeId: string, effect: MapNodeEffect): void;

  // ---- Carry-state bridge (§5) ----
  getCarry(): ReconCarryState;              // applied in Game.create()
  getLoadout(): ReconLoadout;

  // ---- Terminal ----
  isBossNode(nodeId: string): boolean;
  completeRecon(): ReconPayout;             // bank pending + baseReward; clear(); -> win screen
  failRecon(): ReconPayout;                 // salvage floor; clear(); -> fail screen

  // ---- Difficulty ----
  scaleMission(m: Mission, tier: number): Mission;  // deep-clone + bump targets (§8)
}
```

Responsibilities:
- Owns `ReconRunState`; the **only** writer of `zs2_recon_v1`.
- Provides the tier-scaled `Mission` for each node so `Game` stays ignorant of recon internals
  (it just asks for "the mission to run").
- Accrues `pending`, banks on `completeRecon()`, salvages on `failRecon()`.
- Never holds live Phaser objects — pure data + localStorage.

---

## 12. RouteMap Scene + UI Integration

New scene `src/game/scenes/RouteMap.ts`; register `RouteMap = 'RouteMap'` in
`src/game/config/SceneKeys.ts:1-12` and add to the scene list in `main.ts`.

### 12.1 Rendering the graph

- On `create()`, read `ReconSystem.getInstance().getMap()` and `ReconRunState`.
- Lay out nodes by `layer` (x = `layer * colSpacing`) and `slot` (y), left→right
  (mirrors the StS column map). Reuse the simple `add.text` + `setInteractive` button idiom
  already used throughout `Loadout` (`src/game/scenes/Loadout.ts:33-49`).
- Draw edges (`Graphics.lineBetween`) from each node to its `next` targets.
- **Node states:** cleared (dim/check), current (highlight), available (interactive, pulsing),
  locked (dim, non-interactive). Available = `ReconSystem.getAvailableNextNodes()`.
- Icon/color per `ReconNodeKind` (combat/elite/cache/shop/event/boss).
- Header strip: recon name, `pending` reward tally, carried HP/level (so the player sees their
  attrition before choosing the next node).

### 12.2 Selecting and launching a node

```
pointerdown on an available node →
  ReconSystem.selectNextNode(node.id)
  if NODE_LAUNCHES_RUN[node.kind]:
      this.scene.start(SceneKey.Game)          // Game reads ReconSystem in create() (§5.3)
  else: // SHOP / EVENT
      open modal panel → on resolve:
        ReconSystem.resolveMapNode(node.id, effect)
        refresh map (no scene change)
```

### 12.3 Returning from a node (the launch/return contract)

- **Node WIN:** `Game.handleMissionComplete()` (recon branch, §5.2) calls
  `ReconSystem.completeNode(...)` then:
  - if it was the **boss** node → `ReconSystem.completeRecon()` → `scene.start(GameOver,
    {outcome:'win', reconPayout})` (a "RECON COMPLETE" presentation, §9).
  - else → `scene.start(SceneKey.RouteMap)` (back to the map; next nodes now available).
- **Node LOSE (death):** `Player.die()` (recon branch, §5.5) calls
  `ReconSystem.failRecon()` → `scene.start(GameOver, {outcome:'lose', reconFailed:true,
  salvage})`.
- GameOver's "Back to Main Menu" (`src/game/scenes/GameOver.ts:128-131`) is unchanged; after a
  recon ends (win or fail) the state is cleared so the player lands back at the menu / Job
  Board fresh.

### 12.4 GameOver extension

`GameOver.init` already accepts `outcome` + extras (`src/game/scenes/GameOver.ts:28-51`). Add
optional `reconPayout?` / `reconFailed?` / `salvage?` and a recon-specific summary block
("Nodes cleared: 5/6 — Salvaged: +3 BP" or "RECON COMPLETE — +14 BP, +30 resources"). Reuse
the existing win/lose color + stats scaffold (`GameOver.ts:55-101`) — no new scene needed for
v1 (a bespoke `Victory` scene is optional polish, matching the Mission spec's recommendation).

---

## 13. Integration Checklist (ordered, file-by-file)

1. **`src/game/types/ReconTypes.ts`** (new). `ReconNodeKind`, `NODE_LAUNCHES_RUN`,
   `ReconReward`, `ReconNode`, `ReconMap`, `ReconRunState`, `ReconCarryState`, `ReconLoadout`,
   `MapNodeEffect`, `ReconPayout` (§2).
2. **`src/game/config/ReconConfig.ts`** (new). `layers`/`branchWidth` defaults, node-kind
   weights, `RECON_DIFFICULTY` curve (§3,§8), recon catalog (themes → Mission pools).
3. **`src/game/systems/ReconMapGenerator.ts`** (new). Seeded PRNG + `generateReconMap()`
   (§4). Pure, deterministic, no `Math.random()`.
4. **`src/game/systems/ReconSystem.ts`** (new). Singleton owner of `ReconRunState`, localStorage
   (`zs2_recon_v1`), node accrual, `scaleMission()`, payout/forfeit (§9,§10,§11).
5. **`src/game/config/SceneKeys.ts`** — add `RouteMap = 'RouteMap'` (after `Loadout`,
   `SceneKeys.ts:5`).
6. **`src/game/scenes/RouteMap.ts`** (new). Render DAG, node selection, SHOP/EVENT modals,
   launch/return (§12). Register in `main.ts` scene list.
7. **`src/game/entities/Player.ts`** — add `getCurrentHealth()` and `setHealthAbsolute(n)`
   (small accessors near `getStats`/`setMaxHealth`, `Player.ts:195-259`). In `die()`
   (`Player.ts:185`), branch: if `ReconSystem.isActive()` → `failRecon()` + GameOver
   `reconFailed` instead of the standalone lose payload.
8. **`src/game/systems/ExperienceSystem.ts`** — add `getTotalXP()` and `restore(level, xp)`
   (alongside `getCurrentLevel`, `ExperienceSystem.ts:62`).
9. **`src/game/systems/WeaponSystem.ts`** — add `getUnlockedIds()` and `unlockById(id)` wrapping
   the existing `unlockPiercing`/`unlockExplosive` (`WeaponSystem.ts:67,83`).
10. **UpgradeSystem / RelicSystem** — add `getChosenIds()`/`getAcquiredIds()` and
    `reapply(id)` so carried upgrades/relics re-instantiate at node start (§5.3).
11. **`src/game/scenes/Game.ts`**:
    - In `create()` (`Game.ts:151-184`): after loadout application, if `ReconSystem.isActive()`
      re-apply carry-state (§5.3) and use `ReconSystem.getActiveNodeMission()` (tier-scaled)
      instead of `resolveMission(LoadoutManager…)` (`Game.ts:172`). Apply spawn-director tier
      scaling (§8). Store `this.activeReconNodeId`.
    - Add `captureCarryState()` (§5.4).
    - In `handleMissionComplete()` (`Game.ts:809-837`): recon branch (§5.2) — `completeNode`,
      then RouteMap or `completeRecon()` → GameOver win.
12. **`src/game/scenes/GameOver.ts`** — extend `init`/`create` for `reconPayout`/`reconFailed`/
    `salvage` summary (§12.4), reusing the win/lose scaffold (`GameOver.ts:55-101`).
13. **`src/game/scenes/MainMenu.ts`** — if `zs2_recon_v1` is active, add a **"Resume Recon"**
    button next to Play (`MainMenu.ts:129-147` button idiom). (Job Board, when built, owns the
    "Accept Recon" → expedition Loadout → RouteMap entry — cross-ref `outer-loop-job-board.md`.)
14. **`src/game/scenes/Loadout.ts`** — expedition mode: when launched as the recon-accept
    loadout, on "Start" snapshot the loadout into `ReconSystem.startRecon(map, loadout)` and
    `scene.start(SceneKey.RouteMap)` instead of `SceneKey.Game` (`Loadout.ts:163-168`).
15. **(Optional)** `CampResourceSystem` (survivor camp) — `add()` sink for `campResources`
    payout (cross-ref `outer-loop-survivor-camp.md`); until it exists, route `campResources`
    into blueprint points.

---

## 14. Acceptance Criteria

- Accepting a recon generates a deterministic layered DAG (`layers` columns, 2–3 nodes per
  inner layer, single start + single boss, every node reachable, all penultimate nodes →
  boss).
- The RouteMap renders the graph with cleared/current/available/locked states; only out-edges
  of the current node are selectable.
- Selecting a run node launches `Game` with that node's tier-scaled `Mission`; SHOP/EVENT
  nodes resolve on the map with no scene transition.
- HP, level/XP, weapons, upgrades, relics **carry** from one node to the next; killstreak,
  mission progress, and the battlefield reset per node (§5.1).
- Death on any node fails the recon: `pending` forfeited to the salvage floor, run-state
  cleared, recon-failed screen shown.
- Clearing the boss banks all `pending` + `baseReward` into BlueprintSystem / camp resources,
  grants any `specialBlueprintIds`, clears run-state, shows "RECON COMPLETE".
- Closing the tab mid-recon and reopening surfaces "Resume Recon" and restores the exact map
  (from `seed`), path, carry-state, and pending rewards.
- No changes to the standalone (non-recon) Loadout → Game → GameOver flow when no recon is
  active (`ReconSystem.isActive() === false`).
- Win/death race resolves death-first via the existing `runEnded` / `isDead` latches
  (`Game.ts:810`, `Player.ts:145`).

---

## 15. Open Questions / Risks

1. **Serializing in-run upgrades/relics.** Re-applying by id (§5.3) requires UpgradeSystem /
   RelicSystem to be **idempotent and id-addressable**. If any upgrade applies a side-effecting
   delta that can't be cleanly re-derived from id, carry-state must store the *resolved value*
   instead. Audit both systems before implementing `reapply(id)`.
2. **Stacked-stat drift.** Re-applying max-HP/speed multipliers each node must not
   double-compound with the per-level effects (`Player.applyLevelUpEffects`,
   `Player.ts:103-107`). Carry-state stores **absolute** `maxHealth`, and node start
   `setMaxHealth`-overwrites rather than re-multiplies, to avoid compounding.
3. **Boss HP at the terminal node.** Boss is flagged "buffed ~12.5× for testing"
   (`mission-system.md` §11/risk #4). A recon boss arriving with carried attrition may be
   unwinnable — needs a per-tier HP override pass.
4. **Difficulty cliff vs. carry-state.** If carry-state snowballs the player too hard, late
   nodes trivialize; if scaling outpaces it, the boss is a wall. The two curves (§8 scaling vs.
   carry growth) need a joint tuning pass / SpawnTuner support.
5. **Salvage floor value.** 25% is a guess; playtest whether forfeiting hurts enough to make
   routing matter without feeling griefing. Expose in `ReconConfig`.
6. **Mission variety per node.** Reusing the small authored `MISSIONS` pool
   (`src/game/config/Missions.ts:6`) means a 6-node recon may repeat objectives. Either expand
   the catalog or allow generated parametric missions (target overrides already supported via
   `scaleMission`).
7. **Single vs. multiple active recons.** v1 allows one (§10). Multiple concurrent expeditions
   (one per city zone, `outer-loop-city-reclamation.md`) would need keyed run-state
   (`zs2_recon_v1_<zoneId>`).
8. **SHOP/EVENT economy.** SHOP spends `pending` resources that are otherwise forfeit-on-death
   — so spending is a hedge against losing them. Confirm this is the intended risk dynamic
   (spend-now-or-bank-later) and price shop items against the salvage floor.
9. **City reclamation framing.** `outer-loop-city-reclamation.md` may want a zone clear to *be*
   a recon with a fixed (authored, non-random) map. `generateReconMap` should accept an
   optional authored-node-list override so a hand-built zone map reuses the same runtime.
10. **Abandon flow.** Decide whether abandoning mid-recon (from the map) is allowed and whether
    it pays the salvage floor or zero. Recommended: allow, pay salvage floor (§9 table).
