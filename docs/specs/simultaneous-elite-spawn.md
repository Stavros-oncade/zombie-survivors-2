# Spec: Spawn All Elites Simultaneously (KILL_ELITES mission)

## Why they're sequential today
There's no dedicated "spawn N elites" path. The `KILL_ELITES` mission (`m_kill_elites_2`, `Missions.ts:46-52`, `target: 2`) is just a kill counter. Elites come from a generic 90s periodic timer gated by a single `eliteAlive` boolean (`EnemySpawnSystem.ts:52`) — a new elite can't spawn until the previous dies. That gate = sequential appearance.

## 1. Spawn all at once

### `EnemySpawnSystem.ts` — new `spawnEliteGroup(count)` (near `spawnElite`, ~:403)
Loop `count` times creating `EliteEnemy`s (spawn them **clustered on one shared side** so a single camera pan can frame them — see §3 caveat), add to group, set elite-alive state, then emit ONE combined event:
```ts
this.scene.events.emit('elites_group_spawned', elites);
```
Suppress the periodic elite timer for KILL_ELITES missions (the mission is a fixed group), or convert `eliteAlive` → `eliteAliveCount` (§4).

### `Game.ts` — trigger in `create()` (mirror SLAY_BOSS `forceEarlySpawnAtSeconds` at :258-264)
```ts
if (cond.kind === MissionConditionKind.KILL_ELITES) {
    this.time.delayedCall(2500, () => this.enemySpawnSystem.spawnEliteGroup(cond.target));
}
```

## 2. What breaks the camera if you don't fix it
The current `'elite_spawned'` handler (`Game.ts:450-493`) assumes **one elite per event**. Two events back-to-back cause:
- **Fighting pan/zoom tweens** — second `cam.pan`/`zoomTo` cancels the first; camera frames only the last elite.
- **`isEliteIntro` double-set / single-clear race** — first `tryResume` clears the flag and resumes physics while the second intro still thinks it owns the camera → premature resume, camera snap, duplicate prompts.
- **Duplicate UI prompts** stacked, only one destroyed.
- **Duplicate global input listeners** — one tap fires both closures.
- **`prevZoom` corruption** — second event captures zoom *after* first zoomed to 1.5 → restores to 1.5, camera stuck zoomed.

## 3. Camera fix (recommended)
**Single combined group intro** driven by `'elites_group_spawned'` — do NOT emit per-elite `'elite_spawned'` for the group. One event → one intro → one set of tweens/listeners/flags eliminates every race. Near-verbatim copy of the working single-elite intro with:
- Pan target = **centroid** of all elites: `cx = mean(e.x)`, `cy = mean(e.y)`.
- `cam.zoomTo(elites.length > 1 ? 1.0 : 1.5, 350)` so a spread group still fits.
- Generalized prompt: `"${n} ELITES — TAP TO CONTINUE"`.

**Framing caveat:** the centroid only frames all elites if they spawn close together. `getRandomSpawnPositionOnSide(Between(0,3))` can put two on opposite edges → centroid frames empty space. **Fix: spawn the group clustered on one shared side** (preferred), or compute a bounding-box zoom, or accept the wider `zoomTo(1.0)`.

## 4. State flags assuming one-at-a-time
- **`eliteAlive: boolean`** (`EnemySpawnSystem.ts:52`): death listener (`:201-203`) clears it on the *first* `elite_died`, re-opening the timer mid-mission. Fix: convert to `eliteAliveCount` (increment per spawn, decrement per death, gate on `=== 0`); or suppress the periodic timer for KILL_ELITES.
- **`isEliteIntro: boolean`** (`Game.ts:59`, shared with boss intro): stays clean with the single combined intro — no change, as long as you don't also emit per-elite events.
- **Event cleanup array** (`Game.ts:1693-1694`): add `'elites_group_spawned'` so the listener is torn down on shutdown (lingering listeners cause a `startFollow()` TypeError across runs — see comment at :1677).

## 5. Edge cases
- Physics is paused during the intro, so elites can't be killed mid-pan — safe.
- Mission counting unchanged: each elite still emits its own `'elite_died'` (`EliteEnemy.ts:154`), counter reaches target correctly.
- **Amplified pre-existing risk:** the `'elite_died'` handler opens an elite chest with `scene.pause()` (`Game.ts:558`). Simultaneous spawns make simultaneous deaths (one AoE killing both) much more likely → two stacked `scene.pause()` + chests. Consider a `chestPending` guard. Flag to dev.

## Files
- `EnemySpawnSystem.ts` (:52, :201-203, :394-429) — `spawnEliteGroup`, `eliteAlive`→count, timer suppression
- `Game.ts` (:256-264, :450-493, :1693-1694) — combined intro, trigger, cleanup
- `EliteEnemy.ts` (:147-160), `MissionSystem.ts` (:148-155), `Missions.ts` (:45-52) — confirm unchanged
