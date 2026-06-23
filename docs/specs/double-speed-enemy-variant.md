# Spec: "Double Speed" Rare Enemy Variant

## Decision
Implement as an **orthogonal modifier on the base `Enemy`** (a `makeDoubleSpeed()` method), NOT a new subclass — so it can ride on any base type (BASIC/FAST/TANK/CARRIER/TOXIC) and each doubles its own base speed. No `Game.ts` change needed; doubled plain enemies already flow through the existing `else`/`moveTowardsPlayer` dispatch.

## Files to change

### `src/game/config/GameConstants.ts` — add under `ENEMIES`
```ts
DOUBLE_SPEED_CHANCE: 0.02,        // 2% rare spawn
DOUBLE_SPEED_MULTIPLIER: 2,       // 2x base type speed
DOUBLE_SPEED_OUTLINE_COLOR: 0xff0000
```

### `src/game/entities/Enemy.ts`
- Add fields: `private isDoubleSpeed = false;`, `private doubleSpeedGlow: Phaser.GameObjects.Sprite | null = null;`, `private doubleSpeedGlowEvent?: Phaser.Time.TimerEvent;`
- Add `public makeDoubleSpeed()`: idempotent; `this.speed *= DOUBLE_SPEED_MULTIPLIER;` then apply red outline.
- Red outline via existing `tryAddGlow(color, 4, 0, false, 0.6, 12)` (preFX glow, tuned tight so it reads as an outline) with the ADD-blend tinted-halo Canvas fallback (mirror `RangedEnemy.ts:23-34`). **Do NOT use `setTint`** — that recolors the whole sprite (what elites do). Requirement is normal image + red outline only.
- Extend `destroy()` to tear down the fallback halo sprite + timer (scene-owned, not children — same reason RangedEnemy destroys its `glowSprite`). preFX path is cleared by existing `die()` → `preFX.clear()`.

### `src/game/systems/EnemySpawnSystem.ts` — in `createEnemy()` after construction
```ts
if (Math.random() < GameConstants.ENEMIES.DOUBLE_SPEED_CHANCE) {
    enemy.makeDoubleSpeed();
}
```

## Notes
- Roll is independent of and stacks on top of base type selection (~1 per 50 spawns).
- Excludes elites/bosses by construction — they spawn via separate `spawnElite()`/`spawnBoss()` paths that never call `createEnemy()`.
- Speed stored in existing private `this.speed`; multiply preserves each type's relative speed. Safe with `applySlow()` (it snapshots its own `baseSpeed`). Apply at spawn before any slow.

## Open product decision
The roll currently also applies to CARRIER/TOXIC subclasses (fun, but stacks a second glow on their existing one). To restrict to basic/fast/tank, gate with `if (type === EnemyType.BASIC || EnemyType.FAST || EnemyType.TANK)`.
