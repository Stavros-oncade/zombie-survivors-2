# Mission System — Implementation Spec

Status: Draft / design doc (no code yet)
Author: Game systems design
Target: `zombie-survivors-2` (Phaser 3 + TypeScript)

## 1. Purpose & Summary

The game is currently **endless**: a run only ends when the player dies (`Player.die()` →
`scene.start(SceneKey.GameOver, …)` at `src/game/entities/Player.ts:134-180`). There is **no
win state**.

This spec adds a **Mission System**: each run carries exactly one **objective** that, when
completed, is a **WIN**. The run can still be **lost** by death at any time while a mission is
in progress. We add a discriminated-union data model for win conditions, a per-run mission
runtime that tracks progress, a HUD objective tracker, and a distinct WIN presentation on the
end screen.

The design is deliberately **event-driven** (reusing the existing `enemyKilled`,
`elite_died`, `boss_died`, `boss_spawned`, `player_hit` scene events) with a single cheap
per-frame poll for spatial conditions. It composes cleanly with the existing Loadout flow,
Blueprint meta-progression, and the elite (every 90 s) / boss (at 5:00) cadence.

### Key existing facts this spec builds on

| Fact | Source |
| --- | --- |
| Run timer in seconds | `Game.playTime` incremented in `Game.update()` — `src/game/scenes/Game.ts:497`; also `GameUI.gameTime` 1 s tick — `src/game/ui/GameUI.ts:78-83` |
| Every kill emits `enemyKilled` | `Enemy.die()` — `src/game/entities/Enemy.ts:204`; handled in `Game` — `src/game/scenes/Game.ts:283-296` |
| Player kill counter | `Player.incrementEnemiesKilled()` — `src/game/entities/Player.ts:122-124`, incremented at `src/game/scenes/Game.ts:295` |
| Elite death event w/ position | `EliteEnemy.destroy()` emits `elite_died {x,y}` — `src/game/entities/EliteEnemy.ts:149` |
| Boss death event w/ position | `BossEnemy.destroy()` emits `boss_died {x,y}` — `src/game/entities/BossEnemy.ts:108` |
| Boss spawn event | `EnemySpawnSystem.spawnBoss()` emits `boss_spawned` — `src/game/systems/EnemySpawnSystem.ts:412`; handled `src/game/scenes/Game.ts:386` |
| Elite spawn event | `EnemySpawnSystem.spawnElite()` emits `elite_spawned` — `src/game/systems/EnemySpawnSystem.ts:403` |
| Player hit event | `Player.takeDamage()` emits `player_hit {amount}` — `src/game/entities/Player.ts:81` |
| World size | `2048 x 1536` — `src/game/config/GameConfig.ts:3-6` |
| Enemy types | `EnemyType { BASIC, FAST, TANK, RANGED, CARRIER, TOXIC }` — `src/game/types/GameTypes.ts:55-62` |
| Player position | `Game.getPlayer()` → `player.x/.y` — `src/game/scenes/Game.ts:600-602` |
| Run start | `Loadout` "Start Run" → `scene.start(SceneKey.Game)` — `src/game/scenes/Loadout.ts:118-123` |
| Meta currency | `BlueprintSystem` points in `localStorage` — `src/game/systems/BlueprintSystem.ts:27-85` |

> **Important type caveat for "kill X of type Y".** Enemy type is stored in
> `Enemy.enemyType` (`protected`, `src/game/entities/Enemy.ts:15`). Elite and Boss are
> **subclasses constructed with a base type**: `EliteEnemy` passes `EnemyType.BASIC`
> (`src/game/entities/EliteEnemy.ts:28`) and `BossEnemy` passes `EnemyType.TANK`
> (`src/game/entities/BossEnemy.ts:14`). So you cannot reliably classify an enemy by
> `enemyType` alone for elite/boss missions — use `instanceof EliteEnemy` / `instanceof
> BossEnemy`. The spec's kill-tracking carries an explicit classification (see §4.2).

---

## 2. Data Model

New file: `src/game/types/MissionTypes.ts`.

```ts
// src/game/types/MissionTypes.ts
import { EnemyType } from './GameTypes';

/** All supported win-condition kinds. */
export enum MissionConditionKind {
  KILL_COUNT          = 'kill_count',           // #1 required
  SURVIVE_TIME        = 'survive_time',          // #2 required
  KILL_TYPE           = 'kill_type',             // #3 required
  HOLD_ZONE           = 'hold_zone',             // #4 required
  KILL_ELITES         = 'kill_elites',           // new #5
  SLAY_BOSS           = 'slay_boss',             // new #6
  FLAWLESS_WINDOW     = 'flawless_window',       // new #7
  COLLECT_DROPS       = 'collect_drops',         // new #8
  PURGE_TYPE          = 'purge_type',            // new #9 (board clear / extermination)
}

/** A point in world space (world is 2048x1536; see GameConfig.WORLD). */
export interface WorldPoint { x: number; y: number; }

/* ---------- Discriminated union of condition definitions ---------- */

interface BaseCondition {
  kind: MissionConditionKind;
}

export interface KillCountCondition extends BaseCondition {
  kind: MissionConditionKind.KILL_COUNT;
  target: number;                 // kill this many enemies (any classification)
}

export interface SurviveTimeCondition extends BaseCondition {
  kind: MissionConditionKind.SURVIVE_TIME;
  seconds: number;                // stay alive until run time >= seconds
}

export interface KillTypeCondition extends BaseCondition {
  kind: MissionConditionKind.KILL_TYPE;
  enemyType: EnemyType;           // BASIC|FAST|TANK|RANGED|CARRIER|TOXIC
  target: number;                 // kill this many of that type
}

export interface HoldZoneCondition extends BaseCondition {
  kind: MissionConditionKind.HOLD_ZONE;
  location: WorldPoint;           // center of the zone (world coords)
  radius: number;                 // player must be within this distance (px)
  holdSeconds: number;            // cumulative OR continuous seconds required
  continuous: boolean;            // true = timer resets when you leave; false = cumulative
}

export interface KillElitesCondition extends BaseCondition {
  kind: MissionConditionKind.KILL_ELITES;
  target: number;                 // kill this many EliteEnemy instances
}

export interface SlayBossCondition extends BaseCondition {
  kind: MissionConditionKind.SLAY_BOSS;
  // The default boss spawns at 5:00 (EnemySpawnSystem.bossTimer, 300000ms).
  // forceEarlySpawnAtSeconds optionally overrides spawn timing for this mission.
  forceEarlySpawnAtSeconds?: number;
}

export interface FlawlessWindowCondition extends BaseCondition {
  kind: MissionConditionKind.FLAWLESS_WINDOW;
  seconds: number;                // survive this long...
  withoutBeingHit: true;          // ...taking zero hits (player_hit) during the window
}

export interface CollectDropsCondition extends BaseCondition {
  kind: MissionConditionKind.COLLECT_DROPS;
  target: number;                 // collect this many qualifying pickups/blueprint drops
  pickupTypes?: string[];         // optional filter (PickupType values); default = all
}

export interface PurgeTypeCondition extends BaseCondition {
  kind: MissionConditionKind.PURGE_TYPE;
  enemyType: EnemyType;           // exterminate this type...
  target: number;                 // ...this many, AND board must be clear of it at the end
  requireBoardClearAtFinish: boolean;
}

export type MissionCondition =
  | KillCountCondition
  | SurviveTimeCondition
  | KillTypeCondition
  | HoldZoneCondition
  | KillElitesCondition
  | SlayBossCondition
  | FlawlessWindowCondition
  | CollectDropsCondition
  | PurgeTypeCondition;

/** Static, designer-authored mission definition. */
export interface Mission {
  id: string;                     // stable id, e.g. 'm_kill_200'
  name: string;                   // HUD title, e.g. 'Cull the Horde'
  description: string;            // short flavor / instruction
  condition: MissionCondition;    // the win condition
  // Optional tie-ins (see §6 Selection):
  reward?: { blueprintPoints?: number };  // bonus meta currency on WIN
  unlocksMissionId?: string;      // campaign chaining
  difficulty?: 1 | 2 | 3 | 4 | 5; // for sorting / UI
}

/** Live, per-run progress for the active mission. */
export interface MissionProgress {
  current: number;                // generic numeric progress (kills, seconds, drops…)
  goal: number;                   // target for the bar (target/seconds/holdSeconds…)
  completed: boolean;             // win latched
  failed: boolean;                // only used by conditions that can hard-fail (e.g. flawless)
  // condition-specific scratch:
  zoneTimer?: number;             // accumulated seconds in zone (HOLD_ZONE)
  windowStartSec?: number;        // when a flawless window started (FLAWLESS_WINDOW)
  lastTickSec?: number;           // for delta accumulation
}
```

### Notes on the model

- `MissionProgress.current/goal` are the canonical pair the HUD reads, so the objective bar
  is condition-agnostic. Each evaluator maps its own state into these two numbers.
- `failed` exists because **two** of the nine conditions can be *invalidated mid-run without
  the player dying* (`FLAWLESS_WINDOW`, `PURGE_TYPE` board-clear). A `failed` mission does
  **not** end the run — it just resets/ends that objective's chance (see §8).
- For `HOLD_ZONE`, `current = floor(zoneTimer)`, `goal = holdSeconds`.

---

## 3. Win-Condition Catalog (9 total)

For each: **params**, **completion logic**, **where evaluated**, **tuning notes**.

### #1 — KILL_COUNT (required) — "Cull the Horde"
- **Params:** `target` (e.g. 200).
- **Completion:** `killsAny >= target`.
- **Evaluated:** event-driven on `enemyKilled` (`Game.ts:283`). Increment a counter; no
  per-frame work. (Carrier minions and boss-summoned minions count, matching the existing
  `enemiesKilled` semantics.)
- **Tuning:** A 5-min "endless" run currently produces hundreds of kills. Suggested tiers:
  100 (easy) / 250 (med) / 500 (hard). Note: `EnemySpawnSystem` difficulty scales spawn count
  every 20 s (`EnemySpawnSystem.ts:181-190`), so higher targets are reachable but pace-gated.

### #2 — SURVIVE_TIME (required) — "Hold the Line"
- **Params:** `seconds` (e.g. 300 = 5:00).
- **Completion:** run time `>= seconds`. Run time is already tracked in `Game.playTime`
  (`Game.ts:497`) and `GameUI.gameTime` (`GameUI.ts:79`).
- **Evaluated:** per-frame compare in `Game.update()` (cheap; one float compare). Could also
  ride the existing 1 s `GameUI` tick.
- **Tuning:** 180 / 300 / 420 s. Note 300 s aligns exactly with the **boss spawn** at
  `300000 ms` (`EnemySpawnSystem.ts:208`) — a 5:00 survive mission effectively asks "survive
  until the boss appears." Pick 240 or 360 to decouple, or 300 to intentionally make the boss
  the climax (see §7).

### #3 — KILL_TYPE (required) — "Specialist"
- **Params:** `enemyType` (one of `EnemyType`), `target` (e.g. 40 TOXIC).
- **Completion:** `killsByType[enemyType] >= target`.
- **Evaluated:** event-driven. The current `enemyKilled` payload is only `xp` (a number)
  (`Enemy.ts:204`), so it cannot classify. **Required change:** enrich the death signal with a
  classification (see §4.2). Then increment `killsByType[type]` on each death.
- **Tuning:** type rarity differs. `BASIC`/`FAST`/`TANK` are common in normal waves; `RANGED`,
  `CARRIER`, `TOXIC` appear in baseline chances and dedicated "pack" waves
  (`EnemySpawnSystem.ts:101-150`). Suggested targets by rarity: common 60, ranged 40,
  carrier 30, toxic 30. Because pack waves are random (`switchState`,
  `EnemySpawnSystem.ts:268-289`), a type mission may need a guaranteed pack injection — see
  Open Questions §11.

### #4 — HOLD_ZONE (required) — "Hold the Zone"
- **Params:** `location {x,y}`, `radius` (px), `holdSeconds`, `continuous` (bool).
- **Completion:** accumulate time while `distance(player, location) <= radius`. If
  `continuous`, reset `zoneTimer` to 0 whenever the player leaves; else keep cumulative.
  Win when `zoneTimer >= holdSeconds`.
- **Evaluated:** per-frame in `Game.update()` using `Phaser.Math.Distance.Between(player.x,
  player.y, loc.x, loc.y)` and `this.game.loop.delta/1000`. This is the one condition that
  *must* poll (spatial). Cost is one distance calc per frame — negligible.
- **Zone placement:** pick `location` away from the player spawn (player spawns at world
  center `1024,768`, `Game.ts:87`). Good defaults: a quadrant center, e.g. `{512, 384}` or
  `{1536, 1152}`, `radius` 160–220 px, `holdSeconds` 20–45.
- **Visual:** draw a translucent ring at `location` with `scrollFactor(1)` (world space) plus
  an off-screen arrow pointer on the HUD (see §5).
- **Tuning:** `continuous:true` is much harder (kiting enemies while pinned to a spot).
  Recommend `continuous:false` (cumulative) for first-tier zone missions; cumulative still
  forces the player to repeatedly return to a dangerous fixed point. Radius should be large
  enough (≥160) that the player can move/dodge inside it.

### #5 — KILL_ELITES (new) — "Elite Hunter"
- **Params:** `target` (e.g. 2).
- **Completion:** count `elite_died` events (`EliteEnemy.destroy()` →
  `elite_died {x,y}`, `EliteEnemy.ts:149`). Win when `eliteKills >= target`.
- **Evaluated:** event-driven on `elite_died`. Zero per-frame cost.
- **Tuning:** elites spawn every **90 s** and only one at a time (`eliteAlive` guard,
  `EnemySpawnSystem.ts:193-201`). So `target=2` ≈ ~3 min minimum, `target=3` ≈ ~4.5 min. To
  make a 2–3 elite mission tractable, optionally request a faster elite cadence for the run
  via a mission spawn hint (see §4.4 / §11).

### #6 — SLAY_BOSS (new) — "Kingslayer"
- **Params:** `forceEarlySpawnAtSeconds?` (optional override of the 5:00 default).
- **Completion:** first `boss_died` event (`BossEnemy.destroy()` → `boss_died {x,y}`,
  `BossEnemy.ts:108`). Win immediately.
- **Evaluated:** event-driven on `boss_died`.
- **Boss is brutal:** `BossEnemy.maxHP = 25000` (`BossEnemy.ts:8`) with 3 phases. Killing it
  is a genuine climax. By default the boss spawns once at 5:00; this mission *requires* the
  player to survive to and through it.
- **Tuning:** Use `forceEarlySpawnAtSeconds` (e.g. 120) for a shorter "boss rush" variant by
  driving `EnemySpawnSystem.triggerBoss()` (already public, `EnemySpawnSystem.ts:417`) on a
  mission-supplied timer. Consider lowering `maxHP` for an accessible tier (the value is
  flagged "buffed ~12.5x for testing").

### #7 — FLAWLESS_WINDOW (new) — "Untouchable"
- **Params:** `seconds` (e.g. 60), `withoutBeingHit: true`.
- **Completion:** maintain a window: once started (e.g. at run start, or at first kill),
  survive `seconds` of run time with **zero** `player_hit` events (`Player.takeDamage()` →
  `player_hit`, `Player.ts:81`). Win when window completes untouched.
- **Soft-fail / retry:** on any `player_hit`, reset `windowStartSec = now` (restart the
  clock) rather than ending the run. This makes it a "go N seconds clean" challenge that can
  be retried in-run. Set `MissionProgress.failed` only transiently for HUD flash, then clear.
- **Evaluated:** `player_hit` listener resets the window; per-frame compares
  `now - windowStartSec >= seconds`.
- **Tuning:** 30 (easy) / 60 (med) / 90 (hard). Interacts with the brief 100 ms i-frames
  (`IMMUNITY_DURATION`, `Player.ts:23`) and defensive skills (Dash/Barrier grant
  invulnerability — `Loadout.ts:127-132`), which is intended: those skills are the
  counterplay.

### #8 — COLLECT_DROPS (new) — "Scavenger"
- **Params:** `target` (e.g. 15), optional `pickupTypes` filter.
- **Completion:** count qualifying pickups collected. Pickups are created on enemy death
  (`Enemy.dropPickup()`, `Enemy.ts:208-236`) and collected in
  `Game.handlePlayerPickupCollision()` (`Game.ts:708-773`). Win when `collected >= target`.
- **Evaluated:** event-driven. Add a `pickupCollected` emit inside
  `handlePlayerPickupCollision` (currently it emits nothing on collect). Blueprint drops
  (`BlueprintDrop`, collected at `Game.ts:639-654`) can optionally count.
- **Tuning:** drop rate is `GameConstants.ENEMIES.PICKUP_DROP_RATE` per kill
  (`Enemy.ts:199`). Target 10–20. With a type filter (e.g. only `HEALTH`) this becomes a
  scarcer, harder collection.

### #9 — PURGE_TYPE (new) — "Extermination"
- **Params:** `enemyType`, `target`, `requireBoardClearAtFinish` (bool).
- **Completion:** kill `target` of `enemyType` **and**, if `requireBoardClearAtFinish`, no
  live enemy of that type remains on the board at the moment the count is hit.
- **Evaluated:** event-driven count on classified death (§4.2); when count reaches `target`,
  do a one-shot scan of `Game.getEnemiesGroup()` (`Game.ts:595`) filtering by classification
  to confirm none remain (board-clear). If `requireBoardClearAtFinish` and some remain, hold
  completion until a later death satisfies both.
- **Tuning:** Pair with `enemyType = TOXIC` or `CARRIER` for thematic "clear the infestation"
  missions. Because Carrier death **spawns 4 basics** (`CarrierEnemy.die()`,
  `CarrierEnemy.ts:13-29`), a Carrier purge has a satisfying escalation. Board-clear adds
  tension at the finish line. Suggested target 20–30.

---

## 4. Progress Tracking & Win Detection

### 4.1 The `MissionSystem` runtime

New file: `src/game/systems/MissionSystem.ts`. One instance per run, owned by `Game`
(created in `Game.create()` alongside the other systems).

```ts
export class MissionSystem {
  constructor(scene: Game, mission: Mission) { /* wires listeners */ }

  // Called from Game.update(); dt in seconds.
  update(dt: number, playTimeSec: number, playerX: number, playerY: number): void { /* poll-based conditions */ }

  getProgress(): MissionProgress;
  getMission(): Mission;
  isComplete(): boolean;
  // optional: getZoneTarget(): WorldPoint | null   (for HUD arrow)

  destroy(): void; // remove listeners
}
```

Responsibilities:
- Subscribe to the scene events relevant to its condition kind **only** (no wasted listeners).
- Maintain `MissionProgress`.
- On completion, emit a single scene event `mission_complete` (the `Game` reacts — §7/§8).

### 4.2 Required change: classified death signal

Today `Enemy.die()` emits `enemyKilled` with **only** the XP number (`Enemy.ts:204`), which is
insufficient for KILL_TYPE / KILL_ELITES / PURGE_TYPE. Two clean options:

**Option A (recommended — minimal, centralized).** Add a second, richer emit in `Enemy.die()`:
```ts
// in Enemy.die(), right after the existing emit at Enemy.ts:204
this.scene.events.emit('enemyKilledClassified', {
  type: this.enemyType,
  isElite: (this as unknown) instanceof EliteEnemy,  // or a virtual getKillClass()
  isBoss:  (this as unknown) instanceof BossEnemy,
  xp: this.experienceValue,
  x: this.x, y: this.y,
});
```
Because `instanceof` of a subclass from the base file creates a circular import, prefer a
**virtual method** instead: add `protected getKillClass(): KillClass { return { type:
this.enemyType, isElite:false, isBoss:false }; }` on `Enemy`, override it in `EliteEnemy`
and `BossEnemy`. `die()` calls `this.getKillClass()`. This avoids `instanceof` and the
elite/boss-base-type pitfall entirely.

**Option B (no Enemy.ts change).** Have `MissionSystem` listen to `enemyKilled` for the *any*
count, and separately to `elite_died` / `boss_died` for elite/boss counts; for KILL_TYPE,
piggyback on a small classifier in the existing `Game.ts:283` handler (which has the killed
enemy in scope only as XP — it does not, today, have the enemy reference, so this is harder).
**Option A is cleaner; recommend it.**

> The classified emit keeps the existing `enemyKilled` event untouched, so XP / killstreak /
> level-up logic at `Game.ts:283-296` is unaffected.

### 4.3 Evaluation map (where each condition is checked)

| Condition | Trigger | Location |
| --- | --- | --- |
| KILL_COUNT | event `enemyKilled` (or classified) | listener in MissionSystem |
| SURVIVE_TIME | per-frame compare `playTimeSec >= seconds` | `MissionSystem.update()` from `Game.update()` (`Game.ts:497` area) |
| KILL_TYPE | event `enemyKilledClassified` | listener |
| HOLD_ZONE | per-frame distance + dt accumulate | `MissionSystem.update()` (`Game.ts` update loop) |
| KILL_ELITES | event `elite_died` (`EliteEnemy.ts:149`) | listener |
| SLAY_BOSS | event `boss_died` (`BossEnemy.ts:108`) | listener |
| FLAWLESS_WINDOW | event `player_hit` (`Player.ts:81`) resets; per-frame checks elapsed | listener + `update()` |
| COLLECT_DROPS | event `pickupCollected` (new emit in `Game.ts:708-773`) | listener |
| PURGE_TYPE | event `enemyKilledClassified` + one-shot group scan via `Game.getEnemiesGroup()` (`Game.ts:595`) | listener |

**Efficiency:** only HOLD_ZONE, SURVIVE_TIME, FLAWLESS_WINDOW touch the per-frame path, and
each is O(1). Everything else is event-driven, so the system adds essentially zero steady-state
cost. The PURGE_TYPE group scan runs **once** when the kill count threshold is reached, not
every frame.

### 4.4 Integration into `Game.update()`

Insert one line in `Game.update()` after `this.playTime += …` (`src/game/scenes/Game.ts:497`),
guarded the same way the rest of update is (respects pause / elite-intro early-returns at
`Game.ts:493-494`):

```ts
this.missionSystem?.update(
  this.game.loop.delta / 1000,
  this.playTime,
  this.player.x, this.player.y
);
if (this.missionSystem?.isComplete()) this.handleMissionComplete();
```

`handleMissionComplete()` (new private in `Game`) performs the win transition (§7).

---

## 5. UI

### 5.1 HUD objective tracker (in `GameUI`)

`GameUI` (`src/game/ui/GameUI.ts`) already owns the top-left stack (level, timer, bars at
`y = padding…padding+108`, skill arc at `+100`, killstreak at `+140`). Add an **objective
block** below the killstreak line (≈ `y = padding + 170`).

Add to `GameUI`:
- `private objectiveTitle: Phaser.GameObjects.Text;` — mission `name`.
- `private objectiveDetail: Phaser.GameObjects.Text;` — progress string, e.g. `"Toxic
  killed: 23 / 40"` or `"Zone held: 18s / 30s"`.
- `private objectiveBar: Phaser.GameObjects.Graphics;` — a thin progress bar (`current/goal`),
  styled like the XP bar (`GameUI.ts:106-119`), color cyan `#00ffff`.
- New method `updateObjective(progress: MissionProgress, label: string)` called from
  `Game.update()` next to the existing `this.gameUI.update(...)` call (`Game.ts:530`).
- All elements `setScrollFactor(0)` and registered in `GameUI.destroy()` (`GameUI.ts:129-137`).

### 5.2 Off-screen zone pointer (HOLD_ZONE / SLAY_BOSS / zone-bound missions)

For HOLD_ZONE, add a small arrow at screen edge pointing toward `location` when it is off the
camera view, plus the in-world translucent ring (drawn in world space, `scrollFactor(1)`).
Compute screen-edge position from camera worldView (`cameras.main.worldView`) similar to the
spawn math in `EnemySpawnSystem.getRandomSpawnPositionOnSide()` (`EnemySpawnSystem.ts:443`).
Reuse the same pointer to mark the **boss** for SLAY_BOSS by feeding the boss sprite position.

### 5.3 WIN screen (GameOver win-vs-lose distinction)

`GameOver` (`src/game/scenes/GameOver.ts`) currently always says **"Game Over"** and shows
kills / XP / level / time. Extend it to present **win vs. lose**:

- Extend `GameOver.init(data)` (`GameOver.ts:23-35`) to accept `outcome?: 'win' | 'lose'` and
  `missionName?: string`.
- In `create()` (`GameOver.ts:37`):
  - **Win:** title `"MISSION COMPLETE"` (or the mission `name`), color gold `#ffd54f`, a
    distinct background tint, and append a line `"Objective: {missionName} — CLEARED"`.
    Optionally award `reward.blueprintPoints` via `BlueprintSystem.addPoints(...)`
    (`BlueprintSystem.ts:36`) and show `"+N Blueprint Points"`.
  - **Lose:** keep existing `"Game Over"` presentation, plus a muted line `"Objective:
    {missionName} — FAILED"`.
- Keep the same stats block (kills/XP/level/time) for both outcomes; only the header, color,
  and the objective line differ.

> **Recommendation:** reuse `GameOver` with an `outcome` flag rather than adding a new
> `Victory` scene. It is less surface area, the stats block is shared, and `Player.die()`
> already routes to `GameOver`. A dedicated `Victory` scene is optional polish (see §11).

### 5.4 Mission display at run start

Show the mission name/description as a brief banner when the run begins (reuse the existing
banner pattern — the spawn-state banner via `spawn_state_changed`, `EnemySpawnSystem.ts:282`,
or a simple fading `add.text` in `Game.create()`). Also surface the mission on the `Loadout`
screen if player-chosen (see §6).

---

## 6. Selection — How a Mission Is Chosen for a Run

### Options considered
1. **Fixed single mission** (everyone gets the same). Simplest; no replay variety.
2. **Random per run.** Variety, zero UI, but the player can't strategize loadout for it.
3. **Player-chosen at Loadout.** Player picks a mission; can tailor character / skill /
   killstreak to it.
4. **Campaign progression.** Ordered list; clearing one unlocks the next (`Mission.unlocksMissionId`).
5. **Blueprint meta tie-in.** Missions gate or reward Blueprint points.

### Recommendation: **Player-chosen at Loadout, backed by a small fixed catalog, with a
Blueprint-point reward on win, and an optional campaign chain layered on later.**

**Why:**
- The Loadout screen (`src/game/scenes/Loadout.ts`) is *already* the run-configuration hub
  (character, defensive skill, killstreak). It uses a `LoadoutManager` singleton persisted to
  `localStorage` (`LoadoutManager.ts`). Adding a **Mission** picker there is the natural,
  consistent place and lets the player build a loadout *for* the objective (e.g. Barrier +
  flawless mission). It mirrors the existing three selector groups exactly — minimal new UX.
- A **fixed authored catalog** (one `MISSIONS: Mission[]` constant, like
  `BLUEPRINTS` in `BlueprintSystem.ts:8` and `CHARACTERS` in `LoadoutManager.ts:9`) keeps
  conditions hand-tuned rather than randomly degenerate.
- **Blueprint reward on win** (`Mission.reward.blueprintPoints` → `BlueprintSystem.addPoints`)
  ties missions into the existing meta loop so winning *feels* progressive and funds
  Blueprints — without inventing a new currency.
- **Campaign chaining is additive:** `unlocksMissionId` + a persisted "cleared missions" set in
  `localStorage` (same pattern as `BlueprintSystem.readUnlockedArray`,
  `BlueprintSystem.ts:40-49`) can be layered on top later, locking advanced missions behind
  cleared prerequisites. Start with all missions selectable; gate later.

**Plumbing:** Add `selectedMissionId` to `LoadoutManager` (persisted, like the other three
selections at `LoadoutManager.ts:37-48`). `Game.create()` reads
`LoadoutManager.getInstance().getMissionId()`, resolves it against `MISSIONS`, and constructs
the `MissionSystem`. Provide a sensible default mission (e.g. `KILL_COUNT 200`) so existing
flows that don't touch the picker still get a valid win condition.

---

## 7. Boss Interaction

The game already spawns **one boss at 5:00** (`bossTimer` 300000 ms,
`EnemySpawnSystem.ts:208-210`) and a recurring **elite every 90 s**
(`EnemySpawnSystem.ts:193-201`). Missions must coexist with this cadence.

**Decisions / recommendations:**

1. **"Kill the boss" IS a mission type** — `SLAY_BOSS` (#6). It listens for the existing
   `boss_died` event (`BossEnemy.ts:108`); no new boss machinery needed. For non-boss
   missions, the boss still spawns as the normal climax encounter and is simply *not* the win
   condition — it's an obstacle.

2. **Does mission completion end the run immediately?** **Recommendation: YES — completing
   the mission ends the run as a WIN immediately** (transition to the WIN screen). This gives
   every run a clear, satisfying terminus, which is the entire point of the feature. Rationale:
   an explicit win that doesn't end the run feels anticlimactic and re-opens the "when does it
   end?" problem.
   - *Exception to consider:* `SURVIVE_TIME` set to exactly 300 s would win **the instant the
     boss spawns**, denying the boss fight. Mitigation: either (a) set survive missions to a
     time other than 300 (e.g. 240/360), or (b) for a deliberately boss-capped run, use
     `SLAY_BOSS` instead. Document this so designers don't accidentally collide a survive timer
     with the boss spawn.

3. **Boss spawn timing for `SLAY_BOSS`:** by default rely on the 5:00 spawn (the player must
   survive to it). For a "boss rush" tier, `SLAY_BOSS.forceEarlySpawnAtSeconds` drives
   `EnemySpawnSystem.triggerBoss()` (public, `EnemySpawnSystem.ts:417`) early via a
   mission-scheduled `delayedCall`. The existing `bossAlive` guard prevents a double spawn.

4. **Elite cadence for `KILL_ELITES`:** keep the 90 s cadence by default. Optionally, a
   mission can request a tighter cadence by exposing a setter on `EnemySpawnSystem` (e.g.
   `setEliteIntervalMs`) — see §11. Not required for v1; `target=2` is reachable inside ~3 min.

5. **Win during boss intro:** the boss/elite intros pause physics and set `isEliteIntro`
   (`Game.ts:386-429`, `493-494`), and `Game.update()` early-returns during intros. The
   mission `update()` is called *after* those guards, so spatial/time conditions correctly do
   **not** tick during a cinematic pause. Event-driven conditions (e.g. `boss_died`) still
   fire normally. This is the desired behavior — no special handling needed.

---

## 8. Failure / Secondary — Lose vs. Win Paths

- **The run can always still be lost by death.** `Player.die()`
  (`src/game/entities/Player.ts:134-180`) is the death path and transitions to `GameOver`.
  This is unchanged. A mission in progress does **not** prevent losing.
- **Two outcomes, two transitions:**
  - **LOSE:** `Player.die()` → `GameOver` with `outcome:'lose'` + `missionName` (add these
    fields to the existing `start(SceneKey.GameOver, {...})` payload at `Player.ts:174-179`).
  - **WIN:** `MissionSystem` emits `mission_complete` → `Game.handleMissionComplete()` →
    stops overlay scenes (mirror the cleanup `Player.die()` already does for
    `LevelUpSelection` / `PauseMenu`, `Player.ts:166-172`) → `scene.start(SceneKey.GameOver,
    { outcome:'win', missionName, ...stats })`.
- **Race condition (win and death in same frame):** guard with a single latch. `Game` should
  hold a `private runEnded = false;` flag; both `handleMissionComplete()` and the win path
  check-and-set it, and `Player.die()` is already idempotent via its own `isDead` guard
  (`Player.ts:137-140`). If death and completion resolve in the same tick, **death wins**
  (lose) — simplest and least exploitable. Document and pick one; recommend **death precedence**.
- **Soft-fail conditions** (`FLAWLESS_WINDOW`, `PURGE_TYPE` board-clear) set
  `MissionProgress.failed` transiently for a HUD flash and then **reset**, they never end the
  run. The only run-ending outcomes are WIN (mission complete) and LOSE (death).

### Win/Lose flow diagram (textual)

```
            ┌──────────────── run in progress ────────────────┐
            │                                                  │
   player_hit/spatial/kill events → MissionSystem             player takes lethal damage
            │                                                  │
   isComplete() == true                                   Player.die() (Player.ts:134)
            │                                                  │
   Game.handleMissionComplete()                          (idempotent isDead latch)
            │                                                  │
   stop overlays + scene.start(GameOver, outcome:'win')  scene.start(GameOver, outcome:'lose')
            └───────────────────► GameOver ◄───────────────────┘
                         (renders WIN or LOSE per outcome)
```

---

## 9. Integration Checklist (ordered, file-by-file)

1. **`src/game/types/MissionTypes.ts`** (new). Add `MissionConditionKind`, the condition
   interfaces, the `MissionCondition` union, `Mission`, `MissionProgress`, `WorldPoint`
   (§2).

2. **`src/game/config/Missions.ts`** (new). Export `MISSIONS: Mission[]` — the authored
   catalog (the 9 conditions as concrete tuned entries), plus a `DEFAULT_MISSION_ID`. Pattern
   after `BLUEPRINTS` (`BlueprintSystem.ts:8`).

3. **`src/game/entities/Enemy.ts`** — add a virtual `getKillClass()` (base returns
   `{type:this.enemyType, isElite:false, isBoss:false}`) and emit `enemyKilledClassified` in
   `die()` right after the existing `enemyKilled` emit (`Enemy.ts:204`). Do **not** change the
   existing `enemyKilled` event.

4. **`src/game/entities/EliteEnemy.ts`** / **`BossEnemy.ts`** — override `getKillClass()` to
   set `isElite`/`isBoss`. (Elite/boss death events `elite_died`/`boss_died` already exist —
   `EliteEnemy.ts:149`, `BossEnemy.ts:108` — and are reused for #5/#6.)

5. **`src/game/scenes/Game.ts`** — handle pickup collection emit: add
   `this.events.emit('pickupCollected', { type: pickup.getType() })` inside
   `handlePlayerPickupCollision` (`Game.ts:708-773`) for COLLECT_DROPS.

6. **`src/game/systems/MissionSystem.ts`** (new). The runtime (§4.1): constructor wires only
   the listeners its condition needs; `update(dt, playTime, px, py)` handles the polled
   conditions; emits `mission_complete`; `destroy()` removes listeners.

7. **`src/game/systems/LoadoutManager.ts`** — add `selectedMissionId` with
   getter/setter persisted to `localStorage` (mirror `LoadoutManager.ts:37-48`), default
   `DEFAULT_MISSION_ID`.

8. **`src/game/scenes/Loadout.ts`** — add a **Mission** selector group (a 4th block, same
   pattern as the character/defensive/killstreak groups, `Loadout.ts:30-110`) listing
   `MISSIONS` with a description line. Writes `LoadoutManager.setMissionId(...)`.

9. **`src/game/scenes/Game.ts`** (run wiring):
   - In `create()`: read `LoadoutManager.getInstance().getMissionId()`, resolve against
     `MISSIONS`, `new MissionSystem(this, mission)`. Place near the other system inits
     (`Game.ts:120-161`).
   - If the mission requests early boss/faster elites, schedule via `enemySpawnSystem`
     (`triggerBoss`, `EnemySpawnSystem.ts:417`).
   - In `update()`: after `this.playTime += …` (`Game.ts:497`), call `missionSystem.update(...)`
     and `if (isComplete()) handleMissionComplete()` (§4.4). Also call
     `gameUI.updateObjective(...)` near `gameUI.update(...)` (`Game.ts:530`).
   - Add `private runEnded = false;` latch and `handleMissionComplete()` (stop overlays,
     start `GameOver` with `outcome:'win'`).
   - In `shutdownScene()` (`Game.ts:1004-1025`): `this.missionSystem?.destroy()`.

10. **`src/game/ui/GameUI.ts`** — add objective title/detail/bar, `updateObjective()`,
    register in `destroy()` (§5.1). Optional: off-screen zone/boss arrow (§5.2).

11. **`src/game/entities/Player.ts`** — in `die()` (`Player.ts:174-179`), add `outcome:'lose'`
    and `missionName` to the `GameOver` payload so the lose screen can show the failed
    objective.

12. **`src/game/scenes/GameOver.ts`** — extend `init`/`create` for `outcome:'win'|'lose'` and
    `missionName` (§5.3): WIN header/color + cleared line + optional Blueprint-point award via
    `BlueprintSystem.addPoints` (`BlueprintSystem.ts:36`); LOSE keeps current look + failed
    line.

13. **(Optional, campaign)** Persist cleared mission ids in `localStorage` (pattern:
    `BlueprintSystem.readUnlockedArray`, `BlueprintSystem.ts:40-49`) and gate `MISSIONS`
    visibility in `Loadout` by `unlocksMissionId`.

---

## 10. Acceptance Criteria

- Selecting any of the 9 missions at Loadout starts a run with that objective shown on the HUD.
- Each condition completes under its defined logic and routes to the **WIN** GameOver screen
  with a distinct (win) presentation.
- Dying mid-mission routes to the **LOSE** GameOver screen and shows the objective as FAILED.
- HUD objective bar reflects live progress (kills/seconds/zone-time/drops).
- `KILL_TYPE` / `KILL_ELITES` / `PURGE_TYPE` classify elites/bosses correctly (not by base
  `enemyType`) via `getKillClass()`.
- No steady-state per-frame cost beyond O(1) for time/zone/flawless polls; everything else is
  event-driven.
- No regressions to XP / level-up / killstreak (the original `enemyKilled` event is untouched).
- Listeners are torn down on run end (`MissionSystem.destroy()` in `shutdownScene`), matching
  the existing per-run cleanup discipline (`Game.ts:1023-1024`).

---

## 11. Open Questions / Risks

1. **Guaranteeing the right enemies for type missions.** Pack waves
   (`RANGED_PACK`/`CARRIER_PACK`/`TOXIC_PACK`) are selected randomly by `switchState`
   (`EnemySpawnSystem.ts:268-289`). A `KILL_TYPE TOXIC 40` mission could stall if toxic packs
   rarely roll. **Mitigation:** add a mission "spawn hint" that biases `EnemySpawnSystem` to a
   matching pack state via the existing `forceState()` (`EnemySpawnSystem.ts:292`) on a timer,
   or expose a small `setEnemyChanceFloor(type, weight)`. Decide whether missions may steer the
   spawn director.

2. **Elite cadence vs. `KILL_ELITES` target.** 90 s spacing + single-elite guard
   (`EnemySpawnSystem.ts:193-201`) caps elite throughput. For `target >= 3`, consider an
   `EnemySpawnSystem.setEliteIntervalMs()` so missions can tighten cadence. Otherwise keep
   `target <= 2`.

3. **`SURVIVE_TIME == 300` collides with boss spawn** (§7.2). Pick survive times that avoid
   exactly 300 unless the intent is to win at boss-spawn. Designer footgun — document loudly.

4. **Boss HP is "buffed ~12.5x for testing"** (`BossEnemy.ts:8`, 25000 HP). `SLAY_BOSS` may be
   unwinnable for most builds at that value. Needs a tuning pass (per-mission HP override?).

5. **Win-vs-death same-frame race** (§8). Resolved by death-precedence + a `runEnded` latch,
   but confirm the latch is checked in both transition sites.

6. **Carrier/boss minions inflate `KILL_COUNT`.** `CarrierEnemy.die()` spawns 4 basics
   (`CarrierEnemy.ts:13-29`) and boss phase 3 summons minions (`BossEnemy.summonMinions`,
   `BossEnemy.ts:87-101`). This is consistent with the existing `enemiesKilled` counter, but
   note it makes KILL_COUNT easier than raw spawn pacing implies. Acceptable; just tune
   targets with it in mind.

7. **HOLD_ZONE during intros / pause.** Handled (mission `update` runs after the
   `isEliteIntro` / pause early-returns, `Game.ts:493-494`), but verify zone time does not tick
   while paused. Covered by current placement; add a test.

8. **Dedicated `Victory` scene vs. reused `GameOver`.** Spec recommends reuse with an `outcome`
   flag for v1 (§5.3). If win moments need bespoke art/audio later, promote to a `Victory`
   scene (register in `main.ts` scene list and `SceneKey`).

9. **Multiple objectives / optional bonus objectives.** Out of scope for v1 (single mission per
   run), but the `Mission` model could later hold `condition: MissionCondition[]` for
   compound objectives.

10. **Persistence of "current campaign mission".** If campaign chaining ships, decide whether
    the next mission auto-selects after a win or the player re-picks at Loadout.
