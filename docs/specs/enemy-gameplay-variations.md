# Design: 5 Emergent Enemy Behaviors (beyond Marksmen → bullet hell)

## Key insight
Nearly **every weapon auto-targets the nearest enemy** (closest-enemy loops in `PiercingWeapon`, `RicochetDiscWeapon`, `PrismBeamWeapon`, `SentryDroneWeapon`, `GravityWellWeapon`, `EvolvedInfernoLance`). The player rarely chooses targets — the build does. The most emergent enemy designs **subvert what "nearest" means** or **punish auto-fire**. Ideas #1, #3, #5 all derive their depth from this — that's what makes them feel as emergent as marksmen, not stat-swap reskins.

Avoid duplicating existing behaviors: standoff-shooting (RANGED), on-death adds (CARRIER), on-death gas (TOXIC), telegraph→charge/molten/frost/shield (Elite), radial burst+summon (Boss).

Shared integration points: `updateBehavior(player)` dispatch slot in `Game.ts:703`; weighted `getRandomEnemyType()` (`EnemySpawnSystem.ts:444`); new `SpawnState` banners in `stateConfigs` like `RANGED_PACK`.

---

### 1. Shrieker — pack-rally aura buffing nearby zombies (PRIORITY 1)
Slow, fragile; pulsing aura grants nearby normals +speed/+damage. Hangs at the back of a pack, so auto-fire kills it *last* → player must reposition to make it "nearest." Turns a brainless chase wave into a kill-priority puzzle. New `EnemyType.SHRIEKER` + `ShriekerEnemy`. Reuse the `applySlow()` base-speed-snapshot + refresh-timer pattern as `applyRally(factor>1, ms)`. Cap 1–2 alive; aura ~1.4x speed/1.3x dmg; introduce at `difficultyLevel >= 2`.
**Why #1:** highest payoff, lowest cost; weaponizes the auto-target convention, reuses `applySlow` almost verbatim.

### 2. Splitter — on-hit fission, not on-death adds (PRIORITY 2)
Each hit above a threshold splits it into 2 smaller/faster copies (halve HP per gen, cap gen 3). Punishes high-rate low-per-hit auto-fire (the dominant archetype) — more shots = more enemies. Flips optimization toward big single-hit/AoE. New `SplitterEnemy` overriding `takeDamage()` (base `Enemy.ts:169`), spawning children into the enemy group like `CarrierEnemy.ts:21-27`. The damage threshold gate is the whole design — tune carefully. Spawn singly, never in dense packs; watch entity count.
**Why #2:** strongest build-diversity driver (first real "anti-DPS" enemy); self-contained but needs threshold tuning.

### 3. Phase Stalker — periodically untargetable (PRIORITY 3)
Fast assassin cycling solid↔phased (~1.5s). While phased: translucent, invulnerable, **skipped by auto-targeting** — the build literally can't engage it; player must predict the re-solidify window. Needs a shared `isTargetable()` on `Enemy` that the closest-enemy loops filter on (cleanest: pre-filter `activeEnemies` once in `WeaponSystem.ts:39`). While phased, `takeDamage` no-ops (mirror Elite SHIELDED early-return `EliteEnemy.ts:192`). Rewards orbit/field/AoE weapons.
**Why #3:** cleanest thematic mirror of marksmen, but touches multiple weapon files via the `isTargetable` filter.

### 4. Magnetar — RANGED variant that displaces the player (PRIORITY 4)
"Projectile" is a tractor pulse that yanks/shoves the player instead of damaging — drags them off their kiting line into the horde/hazards. New `RangedVariant.MAGNET` (`GameTypes.ts:92`) handled in `RangedEnemy.fireAt()` — reuses all standoff/cadence machinery. Add `Player.applyPull(angle, force)` (mirror `Enemy.applyKnockback` `Enemy.ts:301`). Rewards DASH/REPULSE/mobility builds. Keep force modest; never >2 locking at once.
**Why #4:** lowest cost (extends existing RANGED), fresh positional axis, but a variant of an existing archetype.

### 5. Warden — damage-link convoy (PRIORITY 5)
Tanky escort projects a shield-link: enemies in radius take greatly reduced damage while it lives. Auto-fire wastes damage on protected front-liners while the Warden hides behind them; player must flank/AoE the back rank first, then burst the freed cluster. Add reusable `damageReduction` field applied at top of `takeDamage()` (parallels `scaleDamage` `Enemy.ts:297`); `WardenEnemy.updateBehavior()` scans group and sets/clears it. Render tether lines. Spawn as escorted cluster; reserve for `difficultyLevel >= 3`.
**Why #5:** strong "peel the formation" objective but highest balancing burden; benefits from #1/#2 shipping first.

---

## Shared infra
A reusable trio in `Enemy.ts` unlocks 1/3/5: `applyRally()`, a `damageReduction` field, and `isTargetable()` — all small additive hooks on `takeDamage()` (:169) and the mutators near :297, plus the proven `applySlow` refresh-timer pattern (:124).
