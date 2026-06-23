# Spec: Optional "Extraction" Mission End

## Reuse the HOLD_ZONE precedent
`MissionSystem`'s `HOLD_ZONE` (`MissionSystem.ts:63-95, 237-251`) already implements the exact mechanic Extraction needs: a pulsing `Graphics` ring at a location/radius, a dwell timer (`zoneTimer += dt` while inside), and **reset-on-leave** when `continuous`. Extraction = a `continuous` HOLD_ZONE with `dwellSeconds: 3`, unlocked after the primary objective, plus directional uncapped spawning.

The camera follows the player, so `cam.worldView` is centered on the player → edge spawns are effectively directional-around-the-player. World is 2048×1536.

## 1. Trigger model: "Primary-then-extract"
Extraction unlocks when the mission's normal win condition is satisfied; instead of ending, the run flips into an Extraction phase the player must survive. Opt-in per mission so existing missions are unchanged.

`src/game/types/MissionTypes.ts` — add to `Mission`:
```ts
extraction?: { enabled: boolean; radius?: number; dwellSeconds?: number };
```
`Missions.ts` — set `extraction: { enabled: true }` on chosen missions.

Intercept at the top of `Game.handleMissionComplete` (single choke point):
```ts
if (mission.extraction?.enabled && !this.extractionSystem?.isActive() && !this.extractionSystem?.isDone()) {
    this.beginExtraction(mission);
    return; // do NOT end the run yet
}
```
(Alternative: player-pressed "call extraction" hotkey — more UI for marginal benefit; layer later.)

## 2. New `ExtractionSystem` (mirrors MissionSystem), owned by Game
- **`placeZone(playerX, playerY)`**: point at fixed distance `EXTRACT_SPAWN_DIST` ≈ 600px (one viewport away, off-screen but reachable) at a random angle, `Phaser.Math.Clamp`ed to world bounds with margin ≈ `radius+64`. Guarantees not on top of player.
- **Visual**: green `0x44ff88` ring at depth -0.5, pulsing, brightening when inside (copy HOLD_ZONE marker). HUD direction pointer + countdown.
- **Dwell timer** in `update(dt, px, py)`:
```ts
const inside = Phaser.Math.Distance.Between(px, py, zone.x, zone.y) <= radius;
if (inside) { dwell += dt; if (dwell >= dwellSeconds) complete(); }
else dwell = 0;   // reset-if-leaves
```
- **`complete()`**: latch `done`, destroy marker, restore spawn caps, emit `extraction_complete`.

`Game.ts`:
- `beginExtraction(mission)`: construct `ExtractionSystem`, `begin(player.x, player.y)`, listen `extraction_complete → finishWin(mission)`, show banner.
- Drive in `update()` after the missionSystem block.
- **Refactor**: extract the win-payout body (`Game.ts:1104-1179`) into `finishWin(mission)` so both no-extraction and `extraction_complete` paths call it.
- Add `'extraction_complete'`/`'extraction_started'` to `CUSTOM_EVENTS` (:1685); `extractionSystem?.destroy()` in shutdown.

## 3. Directional spawn weighting
Most spawns from *away from exit*, fewest from *toward exit*. With player→exit angle `exitAngle = atan2(zone.y-py, zone.x-px)` and a candidate spawn angle θ, let `δ = |wrap(θ - exitAngle)|` ∈ [0,π] (0 = toward exit, π = away).

```
weight(δ) = baseFloor + (1 - baseFloor) * ( (1 - cos δ)/2 )^k
```
- `(1-cos δ)/2` maps [0,π]→[0,1] (0 toward exit, 1 away).
- `baseFloor = 0.08` — small nonzero chance ahead, so the exit lane is least-defended but never fully safe.
- `k = 2` sharpens the rear bias.

Implement as **rejection sampling** (`getBiasedSpawnPosition()` in `EnemySpawnSystem`): roll θ, accept with prob `weight(δ)`, up to ~8 tries, then `projectToViewportEdge(px, py, θ)` (ray-cast to nearest worldView edge — preserves the "spawn just off-screen" feel). Route cluster placement through this when an `extractionActive` flag is set.

## 4. "Unlimited" spawning
`beginExtractionSpawning(target)`: set `extractionActive`, save current state, replace the spawn timer with a fixed fast loop that **bypasses `getScaledConfig()`** difficulty ceilings:
```ts
delay: 250, loop: true → spawn a fixed batch (spawnCount: 8) via getBiasedSpawnPosition()
```
(~32 zombies/sec; tune. Optionally crescendo `spawnCount` with dwell progress.) Freeze the state machine (`stateTimer?.destroy()`) so `switchState()` can't reset the override. `endExtractionSpawning()` restores the saved state via `applyStateConfig()`. No population cap exists today; default to truly uncapped, add a *raised* soft cap only if FPS suffers.

## 5. State machine (ExtractionSystem)
`IDLE → ARMED (zone placed, unlimited spawning) → DWELLING (inside, timer) → EXTRACTED`; leaving zone → back to ARMED, dwell=0; death → run-end FAILED path. Independent of `MissionProgress` (already latched complete). `runEnded` only flips in `finishWin()` after `extraction_complete`. Expose `isActive()`, `isDone()`, `getDwellRemaining()`.

## 6. Edge cases
- **Leaves mid-dwell**: `dwell=0` (proven HOLD_ZONE behavior).
- **Dies during extraction**: normal GameOver `lose`; `ExtractionSystem.destroy()` must call `endExtractionSpawning()` + destroy marker so nothing leaks into GameOver. Guard `complete()` with `done` latch + `player.getIsDead()` so death in the same frame as dwell-complete loses, not wins.
- **Extraction vs normal completion**: primary emits `mission_complete` once → reroutes to `beginExtraction`; real win only via `extraction_complete → finishWin`. Guard double-begin with `isActive()/isDone()`.
- **Missions without `extraction.enabled`**: zero behavior change.
- **Zone placement near corners**: if clamp lands within `radius+buffer` of player, re-roll angle / push outward.
- **Rewards unchanged**: `finishWin` reuses existing payout (Recon node, Job Board, City Reclamation) — extraction is a survival gate inserted before that code.

## Files
- New: `src/game/systems/ExtractionSystem.ts`
- `EnemySpawnSystem.ts` — `setExtractionTarget`, `getBiasedSpawnPosition`, `projectToViewportEdge`, `beginExtractionSpawning`/`endExtractionSpawning`
- `Game.ts` — `beginExtraction`, `handleMissionComplete`→`finishWin` refactor, update drive, event wiring, teardown
- `MissionTypes.ts` — `Mission.extraction`; `Missions.ts` — opt-in
