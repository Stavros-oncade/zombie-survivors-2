# Implementation Spec: Weapon Evolutions & Legendary Relics

**Status:** Design / implementation-ready
**Author:** Game systems design
**Date:** 2026-06-20
**Scope:** Expand build variety by (A) generalizing the evolution framework into a data-driven recipe table, (B) adding 2 new weapon evolutions (and 1 new base weapon to feed one of them), (C) adding 2 LEGENDARY relics with proper gating, (D) a concrete integration checklist.

This is a design document. It references real files and line numbers in the current codebase and grounds all numbers in `src/game/config/GameConstants.ts`. No game source is modified by this spec.

---

## 0. Current state (verified against source)

### Weapons
- `src/game/weapons/IWeapon.ts` — the base interface. Every weapon implements: `fire(scene, player, enemies)`, `upgrade()`, `upgradeDamage(m)`, `upgradeSpeed(m)`, `upgradeProjectileSpeed(m)`, `getDamage()`, `setDamage(v)`, `getAttackSpeed()`, `getProjectileSpeed()`, `getLevel()`, `setTempDamageMultiplier(m)`.
- `src/game/weapons/Weapon.ts` — the **basic** weapon, always owned, constructed in `WeaponSystem` constructor (`WeaponSystem.ts:21-28`). Homes the nearest enemy, single-target, destroys on first hit.
- `src/game/weapons/PiercingWeapon.ts` — unlockable. Fires a nearest-target bolt that pierces `pierceCount` (default 3) enemies. Constructed in `WeaponSystem.unlockPiercing()` (`WeaponSystem.ts:67-81`) at `damage = round(BASIC_DAMAGE * 0.8) = 16`, `attackSpeed = BASIC_ATTACK_SPEED * 1.1 = 3.3`, `projectileSpeed = BASIC_PROJECTILE_SPEED * 1.1 = 550`, `pierceCount = 3`.
- `src/game/weapons/ExplosiveWeapon.ts` — unlockable. Player-centered AoE every 4th shot (`ExplosiveWeapon.ts:32`). Constructed in `WeaponSystem.unlockExplosive()` (`WeaponSystem.ts:83-97`) at `damage = round(BASIC_DAMAGE * 1.1) = 22`, `attackSpeed = BASIC_ATTACK_SPEED * 0.5 = 1.5`, `range = 80`. `getProjectileSpeed()` returns `0` and `upgradeProjectileSpeed()` is a no-op.
- `src/game/weapons/EvolvedInfernoLance.ts` — the one existing evolution. Piercing bolt that spawns a mini-explosion at each pierced enemy (`EvolvedInfernoLance.ts:66`). Constructed in `checkEvolution()` (`WeaponSystem.ts:107-112`) at `damage = round(BASIC_DAMAGE * 1.5) = 30`, `attackSpeed = BASIC_ATTACK_SPEED * 1.1 = 3.3`, `projectileSpeed = BASIC_PROJECTILE_SPEED * 1.1 = 550`, `pierceCount = 2`.

### Base stat constants (`GameConstants.ts:16-20`)
```
BASIC_DAMAGE          = 20
BASIC_ATTACK_SPEED    = 3   (shots/sec)
BASIC_PROJECTILE_SPEED = 500
```
All new weapon numbers below are expressed as multiples of these so they stay in scale.

### The hardcoded evolution (the thing we are generalizing)
`WeaponSystem.checkEvolution()` (`WeaponSystem.ts:99-114`) is a single hardcoded `if`: own both `PiercingWeapon` AND `ExplosiveWeapon`, each `getLevel() >= 2`, and no `EvolvedInfernoLance` yet → strip both bases, push `EvolvedInfernoLance`. It is called at the end of `unlockPiercing()` and `unlockExplosive()` (`WeaponSystem.ts:80, 96`).

### Unlocks
`src/game/systems/UpgradeSystem.ts` exposes 9 level-up upgrades, including `PIERCING_SHOT` (`UpgradeSystem.ts:52-62`) and `EXPLOSIVE_BURST` (`UpgradeSystem.ts:63-73`), which call `unlockPiercing()` / `unlockExplosive()`. Upgrade IDs are enumerated in `src/game/types/GameTypes.ts:123-133` (`UpgradeId`).

### Relics
`src/game/systems/RelicSystem.ts` — `RELICS` array (`RelicSystem.ts:47-118`) holds 7 relics. Each `Relic` has `{ id, name, description, rarity, weight, apply(game) }`. `RelicRarity` (`GameTypes.ts:72-77`) already defines `COMMON | RARE | EPIC | LEGENDARY`; **no LEGENDARY relic exists yet**. Selection is weighted by the `weight` field only (no per-rarity multiplier) in `UpgradeSystem.getRandomRelicUpgradesFiltered()` (`UpgradeSystem.ts:115-141`).

How relics are offered:
- **Level-up:** 15% chance per level-up, `getRandomRelicUpgrades(3)` — does NOT filter already-acquired (`Game.ts:698-701`).
- **Elite chest:** guaranteed on `elite_died`, `getRandomRelicUpgradesFiltered(3, acquiredIds)` — filters acquired, tops up with regular upgrades if the pool runs short (`Game.ts:442-454`).
- `RelicSystem.acquireRelic(id)` is idempotent (a `Set` guards re-acquire, `RelicSystem.ts:26-32`).

### Rarity UI (already supports legendary)
`LevelUpSelection.getRarityColorFromName()` (`LevelUpSelection.ts:295-306`) already parses `[legendary]` from the option name and returns gold `0xffc107`. Relic option names are formatted `"{name} [{rarity}]"` in `getRandomRelicUpgradesFiltered()` (`UpgradeSystem.ts:132`). **Legendary rendering needs no UI change.**

### Art / asset fallback
`src/game/scenes/Preloader.ts` loads images from `public/content.manifest.json` (entries with `status: "present"`). For relic/upgrade icon keys, `Preloader.create()` (`Preloader.ts:114-137`) auto-generates a flat 48×48 rounded-rect placeholder texture (`ensureIcon`) for any key not already loaded. Weapons resolve their projectile texture with `scene.textures.exists(...)` and fall back to `'projectile'` (e.g. `PiercingWeapon.ts:46`, `EvolvedInfernoLance.ts:43`). **Net: every new weapon/relic ships functional with placeholders; real art is optional polish.** New relic icon keys should still be added to the `ensureIcon` list so they get a deterministic color instead of nothing.

---

## PART A — Generalize the evolution framework

### A.1 Goal
Replace the single hardcoded `if` in `checkEvolution()` with a **data-driven recipe table**. Each recipe declares its required base weapons + min levels, an optional required relic (Vampire-Survivors style: weapon-at-level + a specific passive), and a factory that builds the evolved weapon. `checkEvolution()` iterates the table.

### A.2 Recipe table shape (new file: `src/game/weapons/EvolutionRecipes.ts`)

```ts
import { Scene } from 'phaser';
import { IWeapon } from './IWeapon';
import { GameConstants } from '../config/GameConstants';
import { RelicSystem } from '../systems/RelicSystem';

// A constructor-ish identity for a weapon class, used for instanceof checks
// without importing every class into WeaponSystem.
export type WeaponClass = new (...args: any[]) => IWeapon;

export interface EvolutionRequirement {
  /** The weapon class that must be owned. */
  weapon: WeaponClass;
  /** Minimum getLevel() the owned instance must have reached. */
  minLevel: number;
}

export interface EvolutionRecipe {
  /** Stable id for logging / analytics / de-dup. */
  id: string;
  /** Human name of the resulting weapon (also used for toast text). */
  resultName: string;
  /** All of these weapons must be owned at >= minLevel. */
  requires: EvolutionRequirement[];
  /** Optional: a relic id that must be acquired (RelicSystem.hasRelic). */
  requiresRelicId?: string;
  /** The evolved class to detect "already evolved" and skip re-firing. */
  resultClass: WeaponClass;
  /**
   * Build the evolved weapon. Receives the matched source instances (in the
   * same order as `requires`) so a recipe MAY scale the result off the
   * sources' current stats if desired. Most recipes just use GameConstants.
   */
  build: (scene: Scene, sources: IWeapon[]) => IWeapon;
}
```

Recipe table (the existing Inferno Lance is now recipe row 0, plus the two new recipes from Part B):

```ts
import { Weapon } from './Weapon';
import { PiercingWeapon } from './PiercingWeapon';
import { ExplosiveWeapon } from './ExplosiveWeapon';
import { EvolvedInfernoLance } from './EvolvedInfernoLance';
// New classes introduced by this spec (Part B):
import { OrbitalWeapon } from './OrbitalWeapon';            // new BASE weapon
import { GravityWellWeapon } from './GravityWellWeapon';    // evolution #1
import { StormVortexWeapon } from './StormVortexWeapon';    // evolution #2

const B = GameConstants.WEAPONS;

export const EVOLUTION_RECIPES: EvolutionRecipe[] = [
  // --- Existing, preserved exactly (backward compatible) ---
  {
    id: 'inferno_lance',
    resultName: 'Inferno Lance',
    requires: [
      { weapon: PiercingWeapon, minLevel: 2 },
      { weapon: ExplosiveWeapon, minLevel: 2 },
    ],
    resultClass: EvolvedInfernoLance,
    build: (scene) => new EvolvedInfernoLance(scene, {
      damage: Math.round(B.BASIC_DAMAGE * 1.5),       // 30
      attackSpeed: B.BASIC_ATTACK_SPEED * 1.1,        // 3.3
      projectileSpeed: B.BASIC_PROJECTILE_SPEED * 1.1,// 550
      pierceCount: 2,
    }),
  },

  // --- New: Part B recipes (see that section for design rationale) ---
  {
    id: 'gravity_well',
    resultName: 'Gravity Well',
    requires: [
      { weapon: ExplosiveWeapon, minLevel: 3 },
      { weapon: OrbitalWeapon, minLevel: 2 },
    ],
    requiresRelicId: 'singularity_core',     // LEGENDARY gate, see Part C
    resultClass: GravityWellWeapon,
    build: (scene) => new GravityWellWeapon(scene, {
      damage: Math.round(B.BASIC_DAMAGE * 1.2),       // 24 / tick
      attackSpeed: B.BASIC_ATTACK_SPEED * 0.5,        // 1.5 (re-cast cadence)
      range: 140,
    }),
  },
  {
    id: 'storm_vortex',
    resultName: 'Storm Vortex',
    requires: [
      { weapon: PiercingWeapon, minLevel: 2 },
      { weapon: OrbitalWeapon, minLevel: 2 },
    ],
    resultClass: StormVortexWeapon,
    build: (scene) => new StormVortexWeapon(scene, {
      damage: Math.round(B.BASIC_DAMAGE * 0.9),       // 18 / hit
      attackSpeed: B.BASIC_ATTACK_SPEED * 1.2,        // 3.6 (orbit tick rate)
      projectileSpeed: B.BASIC_PROJECTILE_SPEED,      // 500 (orbit angular feel)
      orbCount: 3,
      pierceCount: 2,
    }),
  },
];
```

### A.3 Rewritten `checkEvolution()` (`WeaponSystem.ts:99-114`)

```ts
import { EVOLUTION_RECIPES, EvolutionRecipe } from '../weapons/EvolutionRecipes';

private checkEvolution(): void {
  for (const recipe of EVOLUTION_RECIPES) {
    if (this.tryEvolve(recipe)) {
      // Re-scan from the top: removing bases can satisfy/invalidate others.
      // Cheap (table is tiny) and keeps behavior deterministic.
      return this.checkEvolution();
    }
  }
}

private tryEvolve(recipe: EvolutionRecipe): boolean {
  // Already have the result? skip.
  if (this.weapons.some(w => w instanceof recipe.resultClass)) return false;

  // Relic gate (optional). Game owns RelicSystem.
  if (recipe.requiresRelicId) {
    const relics = (this.scene as Game).getRelicSystem?.();
    if (!relics || !relics.hasRelic(recipe.requiresRelicId)) return false;
  }

  // Match every required weapon at >= minLevel, capturing the instances.
  const sources: IWeapon[] = [];
  for (const req of recipe.requires) {
    const inst = this.weapons.find(w => w instanceof req.weapon) as IWeapon | undefined;
    if (!inst || inst.getLevel() < req.minLevel) return false;
    sources.push(inst);
  }

  // Consume the source weapons and add the evolved one.
  const consume = new Set(recipe.requires.map(r => r.weapon));
  this.weapons = this.weapons.filter(
    w => ![...consume].some(c => w instanceof c)
  );
  this.weapons.push(recipe.build(this.scene, sources));
  // Optional: this.scene.events.emit('weapon_evolved', recipe.resultName);
  return true;
}
```

Notes:
- `WeaponSystem` already holds `this.scene` (`WeaponSystem.ts:12, 18`). To read relics, cast to `Game` and call `getRelicSystem()` (`Game.ts:619`). Guard with `?.` so non-Game scenes (tests) don't crash. To avoid a circular import, import `Game` as a type-only import (`import type { Game }`).
- The `build` factory receives `sources` so a future recipe can scale the evolved weapon off the players' invested levels; the recipes above ignore it and use `GameConstants`, matching today's behavior.

### A.4 Backward compatibility
- Recipe row 0 (`inferno_lance`) reproduces `WeaponSystem.ts:104-112` byte-for-byte: same classes, same `minLevel: 2`, same `build` numbers (`30 / 3.3 / 550 / pierce 2`). The "already evolved" guard (`WeaponSystem.ts:102-103`) becomes the per-recipe `instanceof resultClass` check.
- `checkEvolution()` is still called from the same two sites (`WeaponSystem.ts:80, 96`); no caller changes.
- Because the Inferno recipe has **no** `requiresRelicId`, the relic-gate branch is skipped for it — existing players evolve exactly as before with no new dependency.

---

## PART B — Two new weapon evolutions (+ one new base weapon)

Today only **two** unlockable non-basic weapons exist (Piercing, Explosive), and they already feed Inferno Lance. To create genuinely different builds we introduce **one new base weapon — Orbital Shield** — so both new evolutions have a distinct second parent. Orbital is a strong standalone pick (orbiting bodies = passive 360° defense, a staple VS archetype) and a natural combine target.

### B.0 New BASE weapon: Orbital Shield (`src/game/weapons/OrbitalWeapon.ts`)

**Fantasy:** 2–3 small bodies orbit the player, damaging anything they pass through. Pure defense/zone-control; complements the aim-at-nearest weapons.

**Behavior:** On `fire()`, lazily create N orbiting sprites (cache them on the instance; do not recreate per frame). Each frame, advance their orbit angle and damage-on-overlap enemies, with a short per-enemy hit cooldown (store last-hit time in the enemy's data manager, mirroring the `__pierced` pattern at `PiercingWeapon.ts:54-55`) so a stationary enemy isn't hit every frame.

**Stats (grounded in GameConstants):**
- `damage = round(BASIC_DAMAGE * 0.6) = 12` per orb hit
- `orbCount = 2` (level 1), orbit radius `~70px`, angular speed `~2.5 rad/s`
- per-enemy hit cooldown `~400ms`
- `getAttackSpeed()` returns the orbit hit-tick rate (used by Arsenal/Overclock multipliers); `getProjectileSpeed()` returns `0` and `upgradeProjectileSpeed()` is a no-op (like `ExplosiveWeapon.ts:70, 79`).
- `upgrade()`: `level++`, `damage *= 1.15`, and on even levels `orbCount += 1` (cap at 4), else `radius += 8`.

**Unlock path** (mirror Piercing/Explosive end-to-end):
1. Add `UpgradeId.ORBITAL_SHIELD = 'orbital_shield'` to `GameTypes.ts:123-133`.
2. Add an `UpgradeSystem.availableUpgrades` entry (after `EXPLOSIVE_BURST`, `UpgradeSystem.ts:63-73`) named **"Orbital Shield"**, description "Unlocks or upgrades orbiting guardian bodies", whose `effect` calls `sc.getWeaponSystem().unlockOrbital()`.
3. Add `WeaponSystem.unlockOrbital()` mirroring `unlockExplosive()` (`WeaponSystem.ts:83-97`): if owned → `upgrade()`, else push `new OrbitalWeapon(...)`; then call `this.checkEvolution()`.
4. Add an icon key `'upgrade_orbital'` to `LevelUpSelection.getIconKeyForUpgrade()` switch (`LevelUpSelection.ts:283-292`) and to the `ensureIcon` placeholder list (`Preloader.ts:122-137`), color e.g. `0x66ffcc`.

(Optional, not required: a Demolitionist-style character or a blueprint that grants Orbital at start — the `CharacterId` enum already exists at `GameTypes.ts:37-41`. Out of scope for MVP; the upgrade unlock above is sufficient.)

---

### B.1 Evolution #1 — **Gravity Well** (Explosive Lv3 + Orbital Lv2 + *Singularity Core* legendary)

**New class:** `src/game/weapons/GravityWellWeapon.ts`

**Recipe:** `ExplosiveWeapon (minLevel 3)` + `OrbitalWeapon (minLevel 2)` + `requiresRelicId: 'singularity_core'` (the LEGENDARY relic in Part C). This is the "weapon-at-level + specific passive" VS pattern, and is the legendary that is **build-defining** by unlocking an evolution that is otherwise impossible.

**Behavior (distinct from both parents):** Instead of an instant player-centered burst (Explosive) or a fixed orbit (Orbital), Gravity Well periodically casts a stationary **vortex field** at the nearest enemy cluster. The field (a) pulls nearby enemies toward its center each tick (nudge their velocity / position toward center, capped) and (b) deals damage-over-time to everything inside, then collapses. Crowd-control + AoE in one — a true zone-denial build, very different from the aim-and-fire weapons.

**Stats (grounded):**
- `damage = round(BASIC_DAMAGE * 1.2) = 24` per DoT tick (4 ticks over ~1s = 96 total per field)
- recast cadence `attackSpeed = BASIC_ATTACK_SPEED * 0.5 = 1.5` (one field roughly every ~0.67s gated by an internal counter, like Explosive's every-4th-shot at `ExplosiveWeapon.ts:32`)
- `range = 140` (field radius), pull strength ~120 px/s toward center, capped so fast enemies aren't yanked through the player.
- `getProjectileSpeed()` returns `0`; `upgrade()`: `level++`, `damage *= 1.2`, `range += 12`.

**Art:** projectile/VFX key `'vfx_gravity_well'` (purple swirling ring); falls back to a code-drawn graphics circle exactly like `ExplosiveWeapon.ts:51-57` and `EvolvedInfernoLance.ts:98-107`. No blocker.

---

### B.2 Evolution #2 — **Storm Vortex** (Piercing Lv2 + Orbital Lv2)

**New class:** `src/game/weapons/StormVortexWeapon.ts`

**Recipe:** `PiercingWeapon (minLevel 2)` + `OrbitalWeapon (minLevel 2)`. **No relic required** — an accessible mid-game evolution that any Piercing+Orbital player can reach, keeping the "no-legendary" evolution path alive alongside Inferno Lance.

**Behavior (distinct from both parents):** Merges Piercing's penetration with Orbital's rotation. Storm Vortex maintains `orbCount` fast-spinning **piercing blades** that orbit the player AND, on each orbit tick, the blade nearest an enemy launches a short-range piercing shard outward (homes the nearest target, pierces `pierceCount`). So it is simultaneously a defensive orbit and an offensive piercing emitter — a hybrid that neither parent provides.

**Stats (grounded):**
- orbit blade contact `damage = round(BASIC_DAMAGE * 0.9) = 18` per hit
- launched shard reuses the same damage, `pierceCount = 2`, `projectileSpeed = BASIC_PROJECTILE_SPEED = 500`
- `attackSpeed = BASIC_ATTACK_SPEED * 1.2 = 3.6` (orbit/emit tick rate), `orbCount = 3`
- `upgrade()`: `level++`, `damage *= 1.18`, on even levels `orbCount += 1` (cap 5), else `pierceCount += 1`.

**Art:** shard texture key `'proj_storm'` → falls back to `'proj_piercing'` → `'projectile'` (same cascade as `EvolvedInfernoLance.ts:43`). Orbit blades can reuse the piercing texture tinted cyan. No blocker.

### B.3 Build-variety summary

| Build | Path | Identity |
|---|---|---|
| Inferno Lance (existing) | Piercing 2 + Explosive 2 | Piercing bolt that detonates on each hit |
| **Storm Vortex** (new) | Piercing 2 + Orbital 2 | Defensive orbit that also emits piercing shards |
| **Gravity Well** (new) | Explosive 3 + Orbital 2 + *Singularity Core* (legendary) | Cast vortex fields that pull + DoT crowds |

Three distinct evolved archetypes from three base weapons, one gated behind a legendary.

---

## PART C — Legendary relics

Both legendaries below use the existing `RelicRarity.LEGENDARY` (`GameTypes.ts:76`). They are designed to be **build-defining**, not "+X% bigger number." They are added to the `RELICS` array (`RelicSystem.ts:47-118`).

### C.1 Gating strategy (how legendary rarity is enforced)

The current selection (`UpgradeSystem.getRandomRelicUpgradesFiltered`, `UpgradeSystem.ts:115-141`) is weighted purely by `weight`, with no rarity awareness, and is fed from two sites:
- level-up: 15% chance, unfiltered (`Game.ts:698-701`)
- elite chest: guaranteed, filtered-by-acquired (`Game.ts:442-454`)

We gate legendaries with **three** mechanisms (low weight is necessary but not sufficient):

1. **Very low weight.** Give legendaries `weight: 3` (vs common 35–50, epic 15–20). With raw weighting that is already rare.

2. **Source restriction — boss/elite chests only, and only late.** Add an optional `minPlayTimeSec` (and/or `minLevel`) field to the `Relic` type and **filter legendaries out of the level-up pool entirely**, only allowing them from elite/boss chests after a time threshold. `Game.getPlayTime()` (`Game.ts:573`) and `player.getStats().level` are both available. Concretely:
   - Extend `Relic` with `rarity`-aware eligibility: `minPlayTimeSec?: number` (e.g. `300` = 5 min) and a `chestOnly?: boolean` flag.
   - Add a filter param to `getRandomRelicUpgradesFiltered(count, acquired, ctx)` where `ctx = { playTimeSec, level, fromChest }`. Drop any relic whose `minPlayTimeSec > playTimeSec`, and drop `chestOnly` relics when `!fromChest`.
   - The level-up call (`Game.ts:700`) passes `fromChest: false`; the elite-chest call (`Game.ts:444`) passes `fromChest: true` and the current playtime. This guarantees legendaries **cannot** appear from a normal level-up and only show up in chests after the time gate.

3. **One-per-run feel via existing acquire de-dup.** `acquireRelic` is already idempotent (`RelicSystem.ts:26-32`) and the chest path filters acquired ids (`Game.ts:444`), so a legendary can't be offered twice once taken.

> Minimal-change variant if you don't want to touch the selection signature: keep weight `3` and add a guard inside `getRandomRelicUpgradesFiltered` that excludes `rarity === LEGENDARY` unless a module-level `allowLegendary` flag (set true only on the elite-chest path) is on. The structured `ctx` approach above is cleaner and future-proofs boss-only drops.

The `LevelUpSelection` UI already colors `[legendary]` gold (`LevelUpSelection.ts:303`); no UI change needed.

### C.2 Legendary #1 — **Singularity Core** (enables the Gravity Well evolution)

```ts
{
  id: 'singularity_core',
  name: 'Singularity Core',
  description: 'Your explosive bursts collapse inward. Unlocks the Gravity Well evolution and pulls enemies toward blast centers.',
  rarity: RelicRarity.LEGENDARY,
  weight: 3,
  minPlayTimeSec: 300,   // 5 min, chest-only (see C.1)
  chestOnly: true,
  apply: (game: Game) => {
    // Primary effect is the evolution UNLOCK: GravityWell recipe requires
    // hasRelic('singularity_core') (Part A.2). Acquiring it immediately
    // re-checks evolutions so the player evolves if they already qualify.
    game.getWeaponSystem().checkEvolutionPublic?.();
    // Secondary flavor: small global projectile-pull could be added here if
    // ExplosiveWeapon exposes a pull hook; optional, not required for MVP.
  }
}
```

**Why build-defining:** it is the *only* way to reach Gravity Well (Part B.1). It converts an Explosive+Orbital player from "burst + passive defense" into a "pull-and-melt zone-control" build — a genuinely different play pattern (kite enemies into wells rather than aim at them).

**Implementation note:** `checkEvolution()` is currently `private` (`WeaponSystem.ts:99`). Add a thin public wrapper `public checkEvolutionPublic(): void { this.checkEvolution(); }` so the relic's `apply` can trigger an immediate re-evaluation (otherwise the evolution wouldn't happen until the next weapon unlock/upgrade fired `checkEvolution()`).

### C.3 Legendary #2 — **Chrono Engine** (build-defining, no evolution dependency)

```ts
{
  id: 'chrono_engine',
  name: 'Chrono Engine',
  description: 'Time dilates around you. +60% attack speed for ALL weapons, but enemies that die have a chance to briefly slow nearby foes.',
  rarity: RelicRarity.LEGENDARY,
  weight: 3,
  minPlayTimeSec: 300,
  chestOnly: true,
  apply: (game: Game) => {
    // Big global attack-speed step that reshapes pacing (vs Arsenal +10% /
    // Overclock +15% at RelicSystem.ts:78, 117). Reuses the existing hook.
    game.getWeaponSystem().upgradeWeaponSpeed(1.6);
    // Optional synergy hook: register an on-kill slow field. If a kill-event
    // bus exists (e.g. 'enemy_died'), subscribe here and apply a short
    // movement-speed debuff to enemies within ~120px of the death point,
    // reusing the frost/slow pattern already used by Elite FROST affix
    // (EliteAffix.FROST, GameTypes.ts:88). If no such hook exists yet, ship
    // the +60% attack speed alone for MVP and add the slow field later.
  }
}
```

**Why build-defining:** a flat +60% attack speed (vs the +10–15% of Arsenal/Overclock) fundamentally re-tunes a player's DPS curve and makes attack-speed-scaling weapons (Piercing, Storm Vortex) explode in value — it changes which upgrades you prioritize for the rest of the run, not just a marginal bump. The on-kill slow field adds a survivability dimension that pairs with crowd builds.

> **Balance flag:** +60% attack speed stacks multiplicatively with `WEAPON_SPEED` upgrades (`UpgradeSystem.ts:37-43`, ×1.2 each) and Arsenal/Overclock. A player who finds Chrono Engine then takes several speed upgrades can trivialize the run. Recommend tuning Chrono Engine down to **+40% (1.4)** if late-game telemetry shows runaway DPS, and consider making attack-speed sources additive rather than multiplicative in a later pass. Flagged, not solved, here.

### C.4 Type change for `Relic`

Extend the `Relic` type (`RelicSystem.ts:4-11`):
```ts
export type Relic = {
  id: string;
  name: string;
  description: string;
  rarity: RelicRarity;
  weight: number;
  minPlayTimeSec?: number;  // NEW — gate by run time
  chestOnly?: boolean;      // NEW — exclude from level-up pool
  apply: (game: Game) => void;
};
```
Existing 7 relics omit the new optional fields → unchanged behavior.

---

## PART D — Integration checklist (ordered, concrete)

Do these in order. Each step compiles on its own.

1. **`src/game/types/GameTypes.ts`**
   - Add `ORBITAL_SHIELD = 'orbital_shield'` to `UpgradeId` (after line 132).

2. **`src/game/weapons/OrbitalWeapon.ts`** (new) — implement `IWeapon` per B.0. Orbiting sprites cached on the instance; per-enemy hit cooldown via enemy `data` manager (mirror `PiercingWeapon.ts:54-71`). `getProjectileSpeed()→0`, `upgradeProjectileSpeed()` no-op (mirror `ExplosiveWeapon.ts:70,79`). Texture: prefer `'proj_piercing'`/tint, fall back to `'projectile'`.

3. **`src/game/weapons/GravityWellWeapon.ts`** (new) — implement `IWeapon` per B.1. Vortex field via tweened graphics fallback (mirror `EvolvedInfernoLance.ts:98-107`); pull = nudge enemy velocity toward center, capped. Texture key `'vfx_gravity_well'` with graphics fallback.

4. **`src/game/weapons/StormVortexWeapon.ts`** (new) — implement `IWeapon` per B.2. Orbit blades + nearest-target piercing shard emission. Texture `'proj_storm'` → `'proj_piercing'` → `'projectile'`.

5. **`src/game/weapons/EvolutionRecipes.ts`** (new) — the `EvolutionRecipe` type and `EVOLUTION_RECIPES` table from A.2 (Inferno preserved as row 0; Gravity Well + Storm Vortex added).

6. **`src/game/systems/WeaponSystem.ts`**
   - Add `unlockOrbital()` mirroring `unlockExplosive()` (`WeaponSystem.ts:83-97`); call `this.checkEvolution()` at the end.
   - Replace `checkEvolution()` body (`WeaponSystem.ts:99-114`) with the data-driven loop + `tryEvolve()` from A.3.
   - Add `public checkEvolutionPublic(): void { this.checkEvolution(); }` (for Singularity Core, C.2).
   - Add `import type { Game }` for the relic-gate cast; import `EVOLUTION_RECIPES`. (Can drop the now-unused direct `EvolvedInfernoLance` import if it's only used in `checkEvolution` — it moves into `EvolutionRecipes.ts`.)

7. **`src/game/systems/UpgradeSystem.ts`**
   - Add the **Orbital Shield** entry to `availableUpgrades` (after `EXPLOSIVE_BURST`, `UpgradeSystem.ts:63-73`), `effect` → `getWeaponSystem().unlockOrbital()`.
   - Update `getRandomRelicUpgradesFiltered()` (`UpgradeSystem.ts:115-141`) to accept a `ctx` param and drop relics by `minPlayTimeSec` / `chestOnly` (Part C.1). Keep `getRandomRelicUpgrades()` as a thin wrapper passing `fromChest: false`.

8. **`src/game/systems/RelicSystem.ts`**
   - Extend the `Relic` type with `minPlayTimeSec?` and `chestOnly?` (C.4).
   - Append **Singularity Core** (C.2) and **Chrono Engine** (C.3) to `RELICS`.
   - Add suggested icon comments for `relic_singularity_core`, `relic_chrono_engine` (mirror `RelicSystem.ts:41-45`).

9. **`src/game/scenes/Game.ts`**
   - At the elite-chest call (`Game.ts:444`), pass `ctx = { playTimeSec: this.getPlayTime(), level: this.player.getStats().level, fromChest: true }`.
   - At the level-up call (`Game.ts:700`), ensure `fromChest: false` (legendaries excluded). No other change — `getRelicSystem()` (`Game.ts:619`) already exists for the WeaponSystem relic gate.

10. **`src/game/scenes/LevelUpSelection.ts`**
    - Add `case 'orbital_shield': return 'upgrade_orbital';` to `getIconKeyForUpgrade()` switch (`LevelUpSelection.ts:283-292`). Legendary coloring already handled (`LevelUpSelection.ts:303`); no change there.

11. **`src/game/scenes/Preloader.ts`**
    - Add to the `ensureIcon` placeholder list (`Preloader.ts:122-137`): `['relic_singularity_core', 0x9b59ff]`, `['relic_chrono_engine', 0x33ddff]`, `['upgrade_orbital', 0x66ffcc]`. Guarantees colored placeholders if real art is absent.

12. **`public/content.manifest.json`** (optional, polish) — add `relic_icon` entries for `relic_singularity_core`, `relic_chrono_engine`, an `upgrade_icon` for `upgrade_orbital`, and `projectile`/`vfx` entries for `proj_storm`, `vfx_gravity_well`. Set `status: "missing"` until art ships; the Preloader only loads `status: "present"` and everything falls back gracefully.

### D.1 Balance / tuning risks
- **Chrono Engine +60% atk speed stacks multiplicatively** with WEAPON_SPEED upgrades and Arsenal/Overclock → potential runaway DPS. Start at 1.6, be ready to drop to 1.4; consider additive attack-speed in a later pass. (C.3 flag.)
- **Orbital + Storm Vortex hit cadence:** per-enemy hit cooldown must be enforced via enemy `data` (not per-frame) or orbit weapons will delete the difficulty. Tune the ~400ms cooldown against `ENEMIES.BASE_HEALTH = 40` (`GameConstants.ts:12`).
- **Gravity Well pull strength** must be capped and must not pull enemies *through* the player (kill the player by stacking). Cap displacement per tick; never pull past center.
- **Recipe re-scan recursion** in A.3 is bounded by table size (3 rows) and the "already evolved" guard; safe. Watch for a recipe whose result also matches another recipe's `requires` (none today).
- **Legendary drought/flood:** with `weight: 3` and chest-only + time gate, validate that legendaries appear in roughly the back half of a run, not every elite. Tune `minPlayTimeSec` and `weight` against actual elite spawn cadence.

### D.2 Art / asset gaps (all non-blocking)
- New projectile/VFX textures: `proj_storm`, `vfx_gravity_well` — fall back to existing `proj_piercing`/`projectile` and code-drawn graphics circles (`ExplosiveWeapon.ts:51-57`, `EvolvedInfernoLance.ts:98-107`).
- New icon keys: `relic_singularity_core`, `relic_chrono_engine`, `upgrade_orbital` — covered by `Preloader.ensureIcon` placeholders once added to the list (step 11).
- Per `ART_STYLE.md`: relic icons 48×48 ≤ 8–12 KB, projectiles 16–32 px ≤ 6–8 KB, VFX ≤ 20–30 KB. Palette guidance: Storm Vortex = cyan (piercing family), Gravity Well = purple/void, Singularity Core = purple, Chrono Engine = cyan/electric. Inferno family stays orange/red.

---

## Appendix — number reference (all derived from `GameConstants.WEAPONS`)

| Weapon | Damage | Atk Speed | Proj Speed | Notes |
|---|---|---|---|---|
| Basic | 20 | 3.0 | 500 | always owned |
| Piercing (Lv1) | 16 | 3.3 | 550 | pierce 3 |
| Explosive (Lv1) | 22 | 1.5 | — | AoE every 4th shot, range 80 |
| Inferno Lance (evo) | 30 | 3.3 | 550 | pierce 2 + mini-explosions |
| **Orbital Shield (Lv1, new base)** | 12/hit | 2.5 rad/s | — | orbCount 2, radius 70, 400ms hit-cd |
| **Storm Vortex (evo)** | 18/hit | 3.6 | 500 | orbCount 3, shard pierce 2 |
| **Gravity Well (evo)** | 24/tick | 1.5 recast | — | range 140, pull, 4 ticks/field |

| Relic | Rarity | Weight | Gate | Effect |
|---|---|---|---|---|
| Singularity Core | LEGENDARY | 3 | chest-only, ≥5min | unlocks Gravity Well evo |
| Chrono Engine | LEGENDARY | 3 | chest-only, ≥5min | +60% atk speed (all weapons) + on-kill slow |
