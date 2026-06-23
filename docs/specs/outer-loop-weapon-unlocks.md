# Implementation Spec: Outer-Loop — Additional Unlockable Weapons

**Status:** Design / implementation-ready
**Author:** Game systems design
**Date:** 2026-06-20
**Scope:** Add a roster of 6 NEW weapons to `zombie-survivors-2`, each unlockable two ways — (1) as an in-run **level-up reward** in `LevelUpSelection`, and (2) as a permanent **meta-unlock** purchased with **Blueprints** that then appears in the Expedition Loadout. Introduce a declarative **weapon registry/catalog** so weapons are added as data, define **unlock gating** (level-up-only / blueprint / city-reclamation-special), the **blueprint cost curve**, **level-up-offer filtering** by unlock state, **persistence**, and **evolution hooks**.

This is a design document. It references real files and line numbers in the current codebase. No game source is modified by this spec.

**Doc 6 of the outer-loop set.** Cross-refs:
- `evolutions-and-legendary-relics.md` — the evolution recipe framework these weapons feed (Part A there: `EvolutionRecipes.ts` table). This spec's new weapons are valid recipe parents/results.
- `outer-loop-expedition-loadout.md` — the Loadout screen where blueprint-unlocked weapons become selectable starting weapons.
- `outer-loop-city-reclamation.md` — the city-reclamation meta layer that mints **special blueprints** gating the two rarest weapons here.
- `mission-system.md` — `MISSIONS` / `LoadoutManager` pattern reused for catalog + persistence shape.

---

## 0. Current state (verified against source)

### The weapon model
- `src/game/weapons/IWeapon.ts:4-16` — the interface every weapon implements: `fire(scene, player, enemies)`, `upgrade()`, `upgradeDamage(m)`, `upgradeSpeed(m)`, `upgradeProjectileSpeed(m)`, `getDamage()`, `setDamage(v)`, `getAttackSpeed()`, `getProjectileSpeed()`, `getLevel()`, `setTempDamageMultiplier(m)`.
- `src/game/weapons/Weapon.ts:13` — the **basic** weapon, always owned, constructed in `WeaponSystem` constructor (`WeaponSystem.ts:21-28`). Nearest-target homing, single hit.
- `src/game/weapons/PiercingWeapon.ts:10` — unlockable bolt that pierces `pierceCount` enemies (per-enemy hit tracked on the projectile's `data` manager, `PiercingWeapon.ts:54-71`). Constructed in `WeaponSystem.unlockPiercing()` (`WeaponSystem.ts:67-81`).
- `src/game/weapons/ExplosiveWeapon.ts:9` — player-centered AoE every 4th shot (`ExplosiveWeapon.ts:32`). `getProjectileSpeed()→0`, `upgradeProjectileSpeed()` no-op (`ExplosiveWeapon.ts:70,79`). Constructed in `WeaponSystem.unlockExplosive()` (`WeaponSystem.ts:83-97`).
- `src/game/weapons/EvolvedInfernoLance.ts:10` — the one existing evolution (Piercing 2 + Explosive 2). Texture cascade `proj_inferno → proj_piercing → projectile` (`EvolvedInfernoLance.ts:43`); graphics fallback for VFX (`EvolvedInfernoLance.ts:98-107`).

### How weapons are created/managed in a run
- `WeaponSystem` (`WeaponSystem.ts:11`) holds `private weapons: IWeapon[]` (`WeaponSystem.ts:14`), starts with one `Weapon` (`WeaponSystem.ts:21-28`), and every frame calls `weapon.fire(...)` on each owned weapon for the active enemies (`WeaponSystem.ts:31-40`).
- **Unlock pattern (the thing we generalize):** `unlockPiercing()` / `unlockExplosive()` (`WeaponSystem.ts:67-97`) each do: find existing instance → if found `upgrade()`, else `push(new XWeapon(...))`, then `checkEvolution()`. Both are **bespoke methods**. We replace them with one data-driven `unlockWeapon(id)`.
- `getWeapons()` (`WeaponSystem.ts:64`) exposes the array; `LevelUpSelection.getCurrentStats()` reads `weapons[0]` for the stat preview (`LevelUpSelection.ts:187-194`).

### How weapons get offered/unlocked today
- **In-run level-up:** `UpgradeSystem.availableUpgrades` (`UpgradeSystem.ts:8-93`) holds 9 upgrades; `PIERCING_SHOT` (`UpgradeSystem.ts:52-62`) and `EXPLOSIVE_BURST` (`UpgradeSystem.ts:63-73`) call `getWeaponSystem().unlockPiercing()/unlockExplosive()`. `UpgradeId` enum at `GameTypes.ts:123-133`. The level-up menu pulls 3 via `getRandomUpgrades(3, excludeIds)` (`UpgradeSystem.ts:95-109`, called `Game.ts:780`), where `excludeIds` comes from `Game.getCappedUpgradeIds()` (`Game.ts:671-677`). **This `excludeIds` set is exactly where we filter offers by unlock state.**
- **Meta-unlock (Blueprints):** `BlueprintSystem` (`BlueprintSystem.ts:27`) — points in `localStorage` (`zs2_bp_points`, default 5), unlocked-id list in `zs2_blueprints_v1`. `BLUEPRINTS` (`BlueprintSystem.ts:8-25`) already contains `bp_start_piercing` and `bp_start_explosive`, each `apply: (game) => game.getWeaponSystem().unlockPiercing()/unlockExplosive()`. `applyToGame()` (`BlueprintSystem.ts:82-84`) runs every owned blueprint's `apply` once in `Game.create()` (`Game.ts:164`). So **"start with weapon X" is already a solved pattern** — we extend the catalog.
- **Loadout:** `Loadout.ts` is the run-config hub (character / defensive / killstreak / mission). `LoadoutManager` (`LoadoutManager.ts:16`) persists selections to `localStorage`. The expedition-loadout doc adds a starting-weapon picker here; this spec supplies the data it lists.

### Art / asset fallback (non-blocking, verified)
- `Preloader.create()` auto-generates a 48×48 placeholder texture (`ensureIcon`) for any missing icon key (per evolutions doc §0). Weapons resolve projectile textures with `scene.textures.exists(...)` and fall back to `'projectile'` (`PiercingWeapon.ts:46`, `EvolvedInfernoLance.ts:43`), and draw VFX with graphics fallbacks (`ExplosiveWeapon.ts:51-57`). **Every new weapon ships functional with placeholders; real art is optional polish.**

---

## 1. Purpose

Today there are exactly **two** unlockable weapons (Piercing, Explosive), both feeding one evolution (Inferno Lance). The roster is too thin for an outer loop where the player's progression fantasy is "expand my arsenal across runs." This spec:

1. Adds **6 new weapons** spanning distinct archetypes — orbiting, chaining, summon/turret, area-denial, ricochet, beam — that all fit `IWeapon` (no interface change).
2. Makes them unlockable **two ways**: in-run level-up choice (variety inside a run) AND a permanent **blueprint** purchase (so they can be a *starting* weapon next run, via the Expedition Loadout).
3. Replaces the hardcoded `unlockPiercing/unlockExplosive` methods with a **declarative weapon catalog**, so a new weapon = one catalog row + one class file.
4. Defines **gating tiers**: free level-up-only, blueprint-gated, and city-reclamation-special-gated; with a **cost curve**.
5. Wires each weapon as an evolution parent so build diversity compounds (cross-ref evolutions doc).

The design is deliberately **additive and backward-compatible**: existing Piercing/Explosive/Inferno paths are migrated into the catalog with identical numbers and continue to work unchanged.

---

## 2. Weapon roster (overview table)

All numbers are multiples of `GameConstants.WEAPONS` base stats (`BASIC_DAMAGE = 20`, `BASIC_ATTACK_SPEED = 3`, `BASIC_PROJECTILE_SPEED = 500`, per evolutions doc §0) so they stay in scale. "Atk speed" = the weapon's fire/tick cadence (shots or ticks per second); for non-projectile weapons `getProjectileSpeed()` returns `0`.

| # | Weapon | Archetype | Dmg | Atk spd | Proj spd | Key stat | Unlock tier |
|---|---|---|---|---|---|---|---|
| 1 | **Tesla Arc** | chaining | 14/hit | 2.4 | — | `chainCount 3`, `chainRange 180` | Blueprint |
| 2 | **Sentry Drone** | summon / turret | 10/shot | 2.0 | 480 | `droneCount 1`, auto-fires nearest | Blueprint |
| 3 | **Frost Mine** | area-denial | 16/tick | 0.8 (deploy) | — | `range 120`, slow 40%, `mineCap 4` | Blueprint |
| 4 | **Ricochet Disc** | ricochet | 15/hit | 2.2 | 520 | `bounceCount 4`, seeks new target | Level-up-only |
| 5 | **Prism Beam** | beam / sustained | 8/tick | 8 (tick) | — | `beamRange 260`, sweeps to nearest | Blueprint |
| 6 | **Void Orb (Black Hole)** | summon + area-denial | 20/tick | 0.4 (recast) | — | `range 150`, pull, 5 ticks/field | **City-reclamation special** |

Plus a 7th already introduced by the evolutions doc and reused here as a parent:
- **Orbital Shield** (`OrbitalWeapon`, evolutions doc B.0) — orbiting bodies, 12/hit, `orbCount 2`. Treated here as a **Blueprint** weapon and a catalog row (the evolutions doc only gave it a level-up unlock; this spec adds its blueprint + catalog entry).

> Six **new** classes (Tesla Arc, Sentry Drone, Frost Mine, Ricochet Disc, Prism Beam, Void Orb) + cataloging the pre-existing Piercing/Explosive/Orbital. Void Orb is the single city-reclamation-gated weapon and is also a designed evolution parent (it can become the evolutions-doc Gravity Well, see §7).

---

## 3. Per-weapon detail

For each: fantasy, behavior, fire pattern, stats (grounded), `IWeapon` implementation notes, evolution potential, art.

### 3.1 Tesla Arc (`src/game/weapons/TeslaArcWeapon.ts`) — chaining
- **Fantasy:** lightning that leaps between clustered enemies.
- **Behavior / fire pattern:** on `fire()` (cadence-gated like every weapon, `now - lastFired < 1000/attackSpeed`, `Weapon.ts:30`), pick the nearest enemy, deal `damage`, then repeatedly hop to the nearest *unhit* enemy within `chainRange` up to `chainCount` times, each hop drawing a graphics bolt (`scene.add.graphics()` line, tween-fade like `EvolvedInfernoLance.ts:98-107`). Track hit set locally per cast (no projectile object needed).
- **Stats:** `damage = round(BASIC_DAMAGE*0.7)=14` per hit, `attackSpeed = BASIC_ATTACK_SPEED*0.8=2.4`, `chainCount=3`, `chainRange=180`.
- **`getProjectileSpeed()→0`**, `upgradeProjectileSpeed()` no-op. `upgrade()`: `level++`, `damage*=1.15`, even levels `chainCount+=1` (cap 6), else `chainRange+=20`.
- **Evolution potential:** Tesla Arc Lv3 + Prism Beam Lv2 → **Storm Caller** (a beam that chains). Tesla Arc + Orbital → orbiting tesla nodes.
- **Art:** pure graphics bolts; no texture needed. Icon key `upgrade_tesla` (placeholder color `0x66ccff`).

### 3.2 Sentry Drone (`src/game/weapons/SentryDroneWeapon.ts`) — summon / turret
- **Fantasy:** autonomous drones orbit/trail you and fire at enemies.
- **Behavior:** lazily create `droneCount` follower sprites cached on the instance (do **not** recreate per frame — same caching discipline as Orbital in evolutions doc B.0). Each frame the drones lerp toward an offset around the player; each drone independently fires a homing bolt at its nearest enemy on its own cadence. Reuse `Weapon`-style projectile spawn (`Weapon.ts:63-106`): sprite + velocity + tracked colliders that `cleanup()` on hit/timeout to avoid the collider leak the existing weapons guard against (`Weapon.ts:85-92`).
- **Stats:** `damage = round(BASIC_DAMAGE*0.5)=10`, `attackSpeed = BASIC_ATTACK_SPEED*0.67≈2.0` (per-drone fire cadence), `projectileSpeed = BASIC_PROJECTILE_SPEED*0.96≈480`, `droneCount=1`.
- **`getProjectileSpeed()` returns the bolt speed** (so `PROJECTILE_SPEED` upgrade and Chrono-style relics apply). `upgrade()`: `level++`, `damage*=1.15`, even levels `droneCount+=1` (cap 3), else `attackSpeed*=1.1`.
- **Summon lifecycle:** drones are scene sprites; track them on the instance and destroy in a new `dispose()` hook (see §4.3) so a run teardown doesn't leak them.
- **Evolution potential:** Sentry Drone Lv2 + Explosive Lv2 → **Bomber Drone** (drones drop AoE). Sentry + Tesla → drones fire chaining shots.
- **Art:** reuse `'projectile'` for bolt; drone body reuses player/enemy texture tinted, fallback `'projectile'`. Icon `upgrade_drone` (`0xffcc33`).

### 3.3 Frost Mine (`src/game/weapons/FrostMineWeapon.ts`) — area-denial
- **Fantasy:** drop chilling mines that detonate and slow.
- **Behavior:** every deploy cadence, place a stationary mine graphic at the player's current position (or just ahead of movement). A mine arms briefly then, on any enemy entering `range`, deals an AoE DoT and applies a movement slow to enemies in range. Cap simultaneous mines at `mineCap` (FIFO-destroy oldest). Slow reuses the existing FROST-affix slow pattern referenced in evolutions doc C.3 (`EliteAffix.FROST`, `GameTypes.ts:88`).
- **Stats:** `damage = round(BASIC_DAMAGE*0.8)=16` per tick, deploy `attackSpeed=0.8` (one mine ~every 1.25s), `range=120`, slow `40%` for ~1.5s, `mineCap=4`.
- **`getProjectileSpeed()→0`**, `upgradeProjectileSpeed()` no-op. `upgrade()`: `level++`, `damage*=1.15`, even levels `mineCap+=1` (cap 8), else `range+=12`.
- **Evolution potential:** Frost Mine Lv3 + Explosive Lv2 → **Cryo Cluster** (mines that chain-detonate). Frost Mine + Void Orb → freezing singularity.
- **Art:** graphics circle (cyan), fallback only. Icon `upgrade_frostmine` (`0x99eeff`).

### 3.4 Ricochet Disc (`src/game/weapons/RicochetDiscWeapon.ts`) — ricochet **(level-up-only)**
- **Fantasy:** a bouncing blade that ricochets between targets.
- **Behavior:** fire a fast disc at the nearest enemy; on hit, deal damage and redirect toward the nearest *not-recently-hit* enemy, up to `bounceCount` bounces, then expire. Single projectile object; track bounce count + last-hit id on the projectile `data` manager (mirror `__pierced` at `PiercingWeapon.ts:54-71`). On each hit, recompute velocity toward the new target (`Phaser.Math.Angle.Between` + `setVelocity`, as in `Weapon.ts:78-80`).
- **Stats:** `damage = round(BASIC_DAMAGE*0.75)=15` per hit, `attackSpeed = BASIC_ATTACK_SPEED*0.73≈2.2`, `projectileSpeed = BASIC_PROJECTILE_SPEED*1.04≈520`, `bounceCount=4`.
- **`getProjectileSpeed()` returns disc speed.** `upgrade()`: `level++`, `damage*=1.15`, `bounceCount+=1` (cap 9).
- **Why level-up-only:** it is the *introductory* "free" advanced weapon — strong, simple, and intentionally **not** a blueprint so there is always at least one new-weapon thrill available in-run without meta investment (keeps a fresh-account run from feeling empty). Cannot be a starting weapon; this preserves a reason to keep playing level-ups.
- **Evolution potential:** Ricochet Disc Lv2 + Piercing Lv2 → **Buzzsaw** (ricochet + pierce). Pairs naturally with the existing piercing family.
- **Art:** reuse `'proj_piercing' → 'projectile'` tinted. Icon `upgrade_ricochet` (`0xff66aa`).

### 3.5 Prism Beam (`src/game/weapons/PrismBeamWeapon.ts`) — beam / sustained
- **Fantasy:** a continuous beam that sweeps to the nearest threat and melts it.
- **Behavior:** while an enemy exists, lock to the nearest target and apply damage on a fast tick (`attackSpeed` as ticks/sec). Render the beam as a rotating/length-scaled graphics line or thin rectangle from the player to the target (redrawn each frame, destroyed/redrawn — no leak). Damage all enemies the beam line intersects within `beamRange` (segment-vs-circle test), making it a soft pierce. The "fire cadence gate" becomes the tick rate; the beam is effectively always-on while targets exist.
- **Stats:** `damage = round(BASIC_DAMAGE*0.4)=8` per tick, `attackSpeed=8` (8 ticks/sec → 64 dps sustained on one target), `beamRange=260`.
- **`getProjectileSpeed()→0`**, `upgradeProjectileSpeed()` no-op. `upgrade()`: `level++`, `damage*=1.12`, even levels `beamRange+=30`, else `attackSpeed*=1.1`.
- **Evolution potential:** Prism Beam Lv3 + Tesla Arc Lv2 → **Storm Caller**. Prism Beam Lv2 + Sentry Drone → beam-emitting drones.
- **Art:** graphics line/rectangle; no texture. Icon `upgrade_beam` (`0xff5577`).

### 3.6 Void Orb / Black Hole (`src/game/weapons/VoidOrbWeapon.ts`) — summon + area-denial **(city-reclamation special)**
- **Fantasy:** open a collapsing singularity that drags enemies in and grinds them.
- **Behavior:** on a slow recast cadence, spawn a stationary field at the nearest enemy cluster center. Each tick it (a) nudges nearby enemies toward the center (capped displacement — must never pull enemies *through* the player; cap per-tick like evolutions doc D.1) and (b) deals DoT to everything inside, then collapses after N ticks. This is functionally the evolutions-doc **Gravity Well** behavior shipped as a *standalone base weapon* (so it has value before evolving).
- **Stats:** `damage = round(BASIC_DAMAGE*1.0)=20` per tick, recast `attackSpeed=0.4` (a field every ~2.5s, gated by an internal counter like Explosive's every-4th, `ExplosiveWeapon.ts:32`), `range=150`, pull ~120 px/s capped, `5 ticks/field`.
- **`getProjectileSpeed()→0`**, `upgradeProjectileSpeed()` no-op. `upgrade()`: `level++`, `damage*=1.18`, `range+=12`.
- **Why city-reclamation special:** it is the rarest, most build-defining base weapon (CC + AoE + summon in one). It is gated behind a **special blueprint** minted only by reclaiming a city district (cross-ref `outer-loop-city-reclamation.md`), so the strongest tool is a reward for the deepest meta engagement, not just banked points.
- **Evolution potential:** Void Orb Lv2 + Explosive Lv3 + *Singularity Core* (legendary) → **Gravity Well** (evolutions doc B.1 — Void Orb is the `OrbitalWeapon` slot's stronger sibling; recipe can accept either). Void Orb + Frost Mine → frozen singularity.
- **Art:** graphics ring (purple/void), fallback only; optional `vfx_void_orb`. Icon `upgrade_voidorb` (`0x9b59ff`).

---

## 4. IWeapon integration contract

Every new weapon is a class implementing `IWeapon` (`IWeapon.ts:4-16`) — **no interface change is required or made.** The contract per method, with the canonical reference implementation for each shape:

| `IWeapon` member | What new weapons return/do | Reference |
|---|---|---|
| `fire(scene, player, enemies)` | Gate on `now - lastFired < 1000/attackSpeed`; do the weapon's effect; clean up colliders/overlaps. | `Weapon.ts:28-107`, `PiercingWeapon.ts:27-82` |
| `upgrade()` | `level++` and bump the weapon's signature stats (see each §3 entry). | `PiercingWeapon.ts:84-89` |
| `upgradeDamage(m)` | `this.damage *= m`. | `Weapon.ts:115-117` |
| `upgradeSpeed(m)` | `this.attackSpeed *= m`. | `Weapon.ts:119-121` |
| `upgradeProjectileSpeed(m)` | projectile weapons multiply speed; **AoE/orbit/beam/mine weapons no-op**. | `Weapon.ts:123-125` vs `ExplosiveWeapon.ts:70` |
| `getDamage()` | `Math.max(0, damage * tempDamageMultiplier)`. | `Weapon.ts:127-129` |
| `setDamage(v)` | `this.damage = Math.max(0, v)`. | `Weapon.ts:139-141` |
| `getAttackSpeed()` | the fire/tick cadence (drives external speed multipliers). | `Weapon.ts:131-133` |
| `getProjectileSpeed()` | bolt speed, or **`0`** for non-projectile weapons. | `Weapon.ts:135-137` vs `ExplosiveWeapon.ts:79` |
| `getLevel()` | `this.level`. | `Weapon.ts:149-151` |
| `setTempDamageMultiplier(m)` | set (do not compound) `tempDamageMultiplier`. | `Weapon.ts:143-147` |

### 4.1 Required boilerplate (every class)
Copy the five private fields and the trivial getters/setters from `PiercingWeapon.ts:11-25,91-103` (`damage`, `tempDamageMultiplier`, `attackSpeed`, `level`, `lastFired`, plus `projectileSpeed`/`range`/weapon-specific). This is ~20 lines of identical glue per class; only `fire()` and `upgrade()` carry real logic.

### 4.2 Collider/lifetime hygiene (mandatory)
Projectile weapons (Sentry Drone, Ricochet Disc) **must** track per-enemy colliders/overlaps and destroy them on hit/timeout, exactly as `Weapon.ts:85-92` and `PiercingWeapon.ts:59-76` do — otherwise every shot leaks a collider that keeps firing on dead objects. Graphics-only weapons (Tesla, Beam, Frost Mine, Void Orb) avoid colliders entirely by doing distance tests against the `enemies` array each cast (cheaper and leak-free).

### 4.3 New optional lifecycle hook for summon weapons (Sentry Drone, and any cached-sprite weapon)
Summon weapons own long-lived sprites (drones, persistent mines, orbiting bodies). `IWeapon` has **no `destroy()`** today and `WeaponSystem.destroy()` just clears the array (`WeaponSystem.ts:42-45`), which would orphan those sprites. Add an **optional** method (not added to the interface to avoid forcing it on stateless weapons):

```ts
// optional on a weapon; WeaponSystem calls it if present
dispose?(): void;   // destroy cached sprites/timers
```
`WeaponSystem.destroy()` becomes:
```ts
public destroy(): void {
  this.weapons.forEach(w => (w as { dispose?: () => void }).dispose?.());
  this.weapons = [];
}
```
This is the minimal change that lets summon weapons clean up without touching the `IWeapon` contract or any existing weapon.

---

## 5. Registry / catalog data model

New file: `src/game/weapons/WeaponCatalog.ts`. One declarative table; adding a weapon = one row + one class. Mirrors the `BLUEPRINTS` (`BlueprintSystem.ts:8`), `CHARACTERS` (`LoadoutManager.ts:10`), and `MISSIONS` (mission-system doc) patterns.

```ts
import { Scene } from 'phaser';
import { IWeapon } from './IWeapon';
import { GameConstants } from '../config/GameConstants';

import { PiercingWeapon } from './PiercingWeapon';
import { ExplosiveWeapon } from './ExplosiveWeapon';
import { OrbitalWeapon } from './OrbitalWeapon';        // evolutions doc B.0
import { TeslaArcWeapon } from './TeslaArcWeapon';
import { SentryDroneWeapon } from './SentryDroneWeapon';
import { FrostMineWeapon } from './FrostMineWeapon';
import { RicochetDiscWeapon } from './RicochetDiscWeapon';
import { PrismBeamWeapon } from './PrismBeamWeapon';
import { VoidOrbWeapon } from './VoidOrbWeapon';

const B = GameConstants.WEAPONS;

/** How a weapon may be obtained. */
export enum WeaponUnlockTier {
  STARTER         = 'starter',          // always owned (basic weapon)
  LEVELUP_ONLY    = 'levelup_only',     // appears in level-up; never a blueprint
  BLUEPRINT       = 'blueprint',        // level-up AND buyable as a starting weapon
  CITY_SPECIAL    = 'city_special',     // requires a city-reclamation special blueprint
}

export interface WeaponDef {
  /** Stable id. Reused as the localStorage token and the UpgradeId string. */
  id: string;                           // e.g. 'tesla_arc'
  name: string;                         // 'Tesla Arc'
  description: string;                  // level-up / loadout blurb
  tier: WeaponUnlockTier;
  /** The class, for instanceof checks in WeaponSystem (owned/upgrade detection). */
  weaponClass: new (...args: any[]) => IWeapon;
  /** Factory for a fresh level-1 instance. */
  create: (scene: Scene) => IWeapon;
  /** Icon key for LevelUpSelection / Loadout (placeholder auto-generated). */
  iconKey: string;
  /** Blueprint cost (points) for BLUEPRINT tier. Omitted for STARTER/LEVELUP_ONLY. */
  blueprintCost?: number;
  /** For CITY_SPECIAL: the special-blueprint id that must be owned (city-reclamation doc). */
  requiresCityBlueprintId?: string;
}

export const WEAPON_CATALOG: WeaponDef[] = [
  // --- migrated existing (identical numbers to WeaponSystem.ts:72-94) ---
  {
    id: 'piercing_shot', name: 'Piercing Shot',
    description: 'A bolt that pierces multiple enemies.',
    tier: WeaponUnlockTier.BLUEPRINT, weaponClass: PiercingWeapon,
    iconKey: 'upgrade_piercing', blueprintCost: 4,
    create: (s) => new PiercingWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 0.8), attackSpeed: B.BASIC_ATTACK_SPEED * 1.1,
      projectileSpeed: B.BASIC_PROJECTILE_SPEED * 1.1, level: 1, pierceCount: 3 }),
  },
  {
    id: 'explosive_burst', name: 'Explosive Burst',
    description: 'A short-range explosive burst around you.',
    tier: WeaponUnlockTier.BLUEPRINT, weaponClass: ExplosiveWeapon,
    iconKey: 'upgrade_explosive', blueprintCost: 4,
    create: (s) => new ExplosiveWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 1.1), attackSpeed: B.BASIC_ATTACK_SPEED * 0.5,
      range: 80, level: 1 }),
  },
  {
    id: 'orbital_shield', name: 'Orbital Shield',
    description: 'Guardian bodies orbit and damage nearby foes.',
    tier: WeaponUnlockTier.BLUEPRINT, weaponClass: OrbitalWeapon,
    iconKey: 'upgrade_orbital', blueprintCost: 5,
    create: (s) => new OrbitalWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 0.6), attackSpeed: 2.5, orbCount: 2, radius: 70, level: 1 }),
  },

  // --- new (this spec) ---
  {
    id: 'ricochet_disc', name: 'Ricochet Disc',
    description: 'A disc that ricochets between enemies.',
    tier: WeaponUnlockTier.LEVELUP_ONLY, weaponClass: RicochetDiscWeapon,
    iconKey: 'upgrade_ricochet',
    create: (s) => new RicochetDiscWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 0.75), attackSpeed: B.BASIC_ATTACK_SPEED * 0.73,
      projectileSpeed: B.BASIC_PROJECTILE_SPEED * 1.04, bounceCount: 4, level: 1 }),
  },
  {
    id: 'tesla_arc', name: 'Tesla Arc',
    description: 'Lightning that chains between clustered enemies.',
    tier: WeaponUnlockTier.BLUEPRINT, weaponClass: TeslaArcWeapon,
    iconKey: 'upgrade_tesla', blueprintCost: 5,
    create: (s) => new TeslaArcWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 0.7), attackSpeed: B.BASIC_ATTACK_SPEED * 0.8,
      chainCount: 3, chainRange: 180, level: 1 }),
  },
  {
    id: 'sentry_drone', name: 'Sentry Drone',
    description: 'An autonomous drone that fires at nearby foes.',
    tier: WeaponUnlockTier.BLUEPRINT, weaponClass: SentryDroneWeapon,
    iconKey: 'upgrade_drone', blueprintCost: 6,
    create: (s) => new SentryDroneWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 0.5), attackSpeed: B.BASIC_ATTACK_SPEED * 0.67,
      projectileSpeed: B.BASIC_PROJECTILE_SPEED * 0.96, droneCount: 1, level: 1 }),
  },
  {
    id: 'frost_mine', name: 'Frost Mine',
    description: 'Deploy chilling mines that slow and damage.',
    tier: WeaponUnlockTier.BLUEPRINT, weaponClass: FrostMineWeapon,
    iconKey: 'upgrade_frostmine', blueprintCost: 6,
    create: (s) => new FrostMineWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 0.8), attackSpeed: 0.8, range: 120, mineCap: 4, level: 1 }),
  },
  {
    id: 'prism_beam', name: 'Prism Beam',
    description: 'A sustained beam that melts the nearest threat.',
    tier: WeaponUnlockTier.BLUEPRINT, weaponClass: PrismBeamWeapon,
    iconKey: 'upgrade_beam', blueprintCost: 7,
    create: (s) => new PrismBeamWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 0.4), attackSpeed: 8, beamRange: 260, level: 1 }),
  },
  {
    id: 'void_orb', name: 'Void Orb',
    description: 'Collapse a singularity that pulls and grinds crowds.',
    tier: WeaponUnlockTier.CITY_SPECIAL, weaponClass: VoidOrbWeapon,
    iconKey: 'upgrade_voidorb', requiresCityBlueprintId: 'city_bp_void_core',
    create: (s) => new VoidOrbWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 1.0), attackSpeed: 0.4, range: 150, ticks: 5, level: 1 }),
  },
];

export function getWeaponDef(id: string): WeaponDef | undefined {
  return WEAPON_CATALOG.find(w => w.id === id);
}
```

### 5.1 `WeaponSystem` becomes catalog-driven
Replace the two bespoke `unlock*` methods (`WeaponSystem.ts:67-97`) with one generic method:

```ts
import { getWeaponDef } from '../weapons/WeaponCatalog';

public unlockWeapon(id: string): void {
  const def = getWeaponDef(id);
  if (!def) return;
  const existing = this.weapons.find(w => w instanceof def.weaponClass);
  if (existing) existing.upgrade();
  else this.weapons.push(def.create(this.scene));
  this.checkEvolution();   // unchanged; recipe table per evolutions doc
}

public ownsWeapon(id: string): boolean {
  const def = getWeaponDef(id);
  return !!def && this.weapons.some(w => w instanceof def.weaponClass);
}
```
Keep thin shims `unlockPiercing(){ this.unlockWeapon('piercing_shot'); }` / `unlockExplosive(){ this.unlockWeapon('explosive_burst'); }` so existing callers (`BlueprintSystem.ts:17,20`, `UpgradeSystem.ts:59,70`) compile unchanged during migration, then migrate them.

---

## 6. Unlock gating + blueprint cost curve

### 6.1 Tier semantics
- **STARTER** — only the basic `Weapon`. Always owned.
- **LEVELUP_ONLY** (Ricochet Disc) — offered in `LevelUpSelection`, **never** purchasable, **never** a starting weapon. Always eligible in-run (no gate) so a brand-new account always has a fresh advanced weapon to find.
- **BLUEPRINT** (Piercing, Explosive, Orbital, Tesla, Sentry, Frost Mine, Prism) — purchasable in the meta menu (`BlueprintSystem`). Once owned as a blueprint it (a) becomes selectable as a **starting weapon** in the Expedition Loadout, and (b) is **also** offered in-run level-ups regardless of blueprint state (a blueprint just makes it a *starting* option; the level-up path stays open for everyone). See §6.3 for the offer rule.
- **CITY_SPECIAL** (Void Orb) — requires a **special blueprint** (`city_bp_void_core`) that is *not* purchasable with normal points; it is minted by the city-reclamation layer (`outer-loop-city-reclamation.md`). Only after that special is owned does Void Orb appear in level-ups and the loadout.

### 6.2 Blueprint cost curve
Normal-point costs scale with power/complexity. Current `BlueprintSystem` starts the player at 5 points (`BlueprintSystem.ts:29`) and existing weapon blueprints cost 4 (`BlueprintSystem.ts:16,19`). New curve (in `blueprintCost`):

| Weapon | Tier | Cost | Rationale |
|---|---|---|---|
| Piercing Shot | BLUEPRINT | 4 | baseline (unchanged from `bp_start_piercing`) |
| Explosive Burst | BLUEPRINT | 4 | baseline (unchanged) |
| Orbital Shield | BLUEPRINT | 5 | passive 360° defense, strong standalone |
| Ricochet Disc | LEVELUP_ONLY | — | free in-run only |
| Tesla Arc | BLUEPRINT | 5 | strong vs crowds |
| Sentry Drone | BLUEPRINT | 6 | summon (scales hardest) |
| Frost Mine | BLUEPRINT | 6 | CC + area-denial |
| Prism Beam | BLUEPRINT | 7 | highest sustained single-target DPS |
| Void Orb | CITY_SPECIAL | — | gated by reclamation, not points |

Curve shape: **4 → 5 → 6 → 7** stepping by archetype power, capped at 7 so a dedicated player can afford one new weapon per ~2-3 winning runs (mission wins award points, `BlueprintSystem.addPoints`, `Game.ts:818`). The two summon/CC/beam weapons (6-7) are the "save up" goals; the early ones (4-5) are reachable quickly to give immediate meta payoff.

### 6.3 Blueprint catalog entries
Add to `BLUEPRINTS` (`BlueprintSystem.ts:8`). Two flavors:

1. **"Start with X" blueprints** (the existing pattern, `bp_start_piercing`) — but now generated from the catalog instead of hand-written:
```ts
// in BlueprintSystem.ts, append generated rows:
import { WEAPON_CATALOG, WeaponUnlockTier } from '../weapons/WeaponCatalog';
const WEAPON_BLUEPRINTS = WEAPON_CATALOG
  .filter(w => w.tier === WeaponUnlockTier.BLUEPRINT)
  .map(w => ({
    id: `bp_weapon_${w.id}`,
    name: `Arms: ${w.name}`,
    description: `Unlock ${w.name} for your loadout (and start with it if equipped).`,
    cost: w.blueprintCost ?? 5,
    apply: (game: Game) => {
      // Only grant at run start if the player equipped it in the Loadout.
      if (LoadoutManager.getInstance().getStartingWeaponId() === w.id) {
        game.getWeaponSystem().unlockWeapon(w.id);
      }
    },
  }));
export const BLUEPRINTS: Blueprint[] = [ /* existing non-weapon rows */, ...WEAPON_BLUEPRINTS ];
```
> **Migration note:** delete the hand-written `bp_start_piercing` / `bp_start_explosive` rows (`BlueprintSystem.ts:16-21`) once the generated rows exist, OR keep them as legacy aliases. Recommend generating and removing the duplicates to keep one source of truth.

2. **City-reclamation special** (`city_bp_void_core`) — *not* in the purchasable `BLUEPRINTS` list. It is owned/queried via the city-reclamation layer's own persistence. `BlueprintSystem` exposes a check the catalog reads:
```ts
static isCityBlueprintOwned(id: string): boolean {
  // backed by the city-reclamation doc's storage; e.g. zs2_city_blueprints_v1
  const raw = localStorage.getItem('zs2_city_blueprints_v1');
  try { return !!raw && (JSON.parse(raw) as string[]).includes(id); } catch { return false; }
}
```

### 6.4 The single eligibility predicate
One function decides whether a weapon may appear anywhere (level-up offer, loadout list). Put it in `WeaponCatalog.ts`:
```ts
export function isWeaponUnlocked(def: WeaponDef): boolean {
  switch (def.tier) {
    case WeaponUnlockTier.STARTER:      return true;
    case WeaponUnlockTier.LEVELUP_ONLY: return true;                 // always findable in-run
    case WeaponUnlockTier.BLUEPRINT:    return true;                 // level-up path open to all;
                                                                     // blueprint only gates the *starting* slot
    case WeaponUnlockTier.CITY_SPECIAL:
      return BlueprintSystem.isCityBlueprintOwned(def.requiresCityBlueprintId!);
  }
}
```
> **Design choice spelled out:** BLUEPRINT-tier weapons are offered in level-ups to *everyone* — the blueprint purchase only unlocks the **starting-weapon** option in the Loadout, it does not gate the in-run discovery. This keeps in-run variety high while still giving blueprints a concrete payoff (start the run already holding the weapon). The ONLY weapon a non-meta player cannot encounter in-run is Void Orb (CITY_SPECIAL). If instead you want blueprints to gate in-run appearance too, change the `BLUEPRINT` case to `return BlueprintSystem.isUnlocked(\`bp_weapon_${def.id}\`)` — flagged as a tuning lever, not the default.

---

## 7. Level-up-offer filtering

The level-up menu is built in `Game.ts:778-786` from `UpgradeSystem.getRandomUpgrades(3, excludeIds)`, where `excludeIds = getCappedUpgradeIds()` (`Game.ts:671-677`). Weapons appear here as `Upgrade` rows whose `effect` calls `unlockWeapon(id)`.

### 7.1 Generate weapon upgrades from the catalog
Replace the hand-written `PIERCING_SHOT` / `EXPLOSIVE_BURST` entries in `UpgradeSystem.availableUpgrades` (`UpgradeSystem.ts:52-73`) with catalog-generated rows:
```ts
import { WEAPON_CATALOG, WeaponUnlockTier, isWeaponUnlocked } from '../weapons/WeaponCatalog';

private static weaponUpgrades(): Upgrade[] {
  return WEAPON_CATALOG
    .filter(w => w.tier !== WeaponUnlockTier.STARTER)
    .map(w => ({
      id: w.id,                                  // doubles as the level-up offer id
      name: w.name,
      description: w.description,
      effect: (player: Player) => {
        const sc = player.scene?.scene?.get(SceneKey.Game);
        if (sc && sc instanceof Game) sc.getWeaponSystem().unlockWeapon(w.id);
      },
    }));
}
```
`getRandomUpgrades(count, excludeIds)` already filters by `excludeIds` (`UpgradeSystem.ts:98`). Compose the stat-upgrade list with `weaponUpgrades()` there.

### 7.2 Filter offers by unlock state + ownership cap
`Game.getCappedUpgradeIds()` (`Game.ts:671-677`) is the single place that excludes ineligible offers. Extend it:
```ts
private getCappedUpgradeIds(): Set<string> {
  const excluded = new Set<string>();
  if (this.skillSystem?.isMaxLevel()) excluded.add(UpgradeId.SKILL_MASTERY);
  for (const def of WEAPON_CATALOG) {
    if (def.tier === WeaponUnlockTier.STARTER) continue;
    // (a) gate-locked weapons never appear
    if (!isWeaponUnlocked(def)) { excluded.add(def.id); continue; }
    // (b) optional: hide a weapon once its level cap is reached (mirrors SKILL_MASTERY)
    // if (this.weaponSystem.weaponAtMaxLevel(def.id)) excluded.add(def.id);
  }
  return excluded;
}
```
This is the **whole** offer-filtering story: a `WEAPON_CATALOG` row is offered iff (it is not STARTER) ∧ `isWeaponUnlocked()` ∧ not capped. Void Orb only shows once its city special is owned; everything else shows per §6.4.

### 7.3 Icon + stat-preview wiring
- `LevelUpSelection.getIconKeyForUpgrade()` (`LevelUpSelection.ts:297-312`): add a fallthrough that returns the catalog `iconKey` for any id matching a catalog weapon (replace the per-id `case` arms). Legendary/rarity coloring is unaffected (`LevelUpSelection.ts:314-325`).
- `LevelUpSelection.getCurrentStats()` reads `weapons[0]` (`LevelUpSelection.ts:187-194`); new weapons need no special preview — they fall through to `default: description = upgrade.description` (`LevelUpSelection.ts:264-265`), which is fine. (Optional polish: show "NEW" vs "Lv N" by querying `WeaponSystem.ownsWeapon(id)`.)
- `Preloader` `ensureIcon` list: add `[upgrade_tesla 0x66ccff]`, `[upgrade_drone 0xffcc33]`, `[upgrade_frostmine 0x99eeff]`, `[upgrade_ricochet 0xff66aa]`, `[upgrade_beam 0xff5577]`, `[upgrade_voidorb 0x9b59ff]`, `[upgrade_orbital 0x66ffcc]`.

---

## 8. Persistence (localStorage shapes)

Reuse the existing `BlueprintSystem` keys; add one loadout key. No new storage engine.

| Concern | Key | Shape | Owner | Notes |
|---|---|---|---|---|
| Meta points | `zs2_bp_points` | `"5"` (int string) | `BlueprintSystem.ts:29,35` | unchanged; mission wins add points |
| Owned blueprints (incl. `bp_weapon_*`) | `zs2_blueprints_v1` | `["bp_weapon_tesla_arc", ...]` | `BlueprintSystem.ts:5,40-49` | unchanged engine; new ids flow through it |
| City special blueprints | `zs2_city_blueprints_v1` | `["city_bp_void_core", ...]` | city-reclamation doc | read-only here via `isCityBlueprintOwned` |
| Equipped starting weapon | `zs2_loadout_starting_weapon` | `"tesla_arc"` or `""` (none) | `LoadoutManager` (new) | mirrors `zs2_loadout_mission` (`LoadoutManager.ts:32-33,54-55`) |

`LoadoutManager` additions (mirror the mission getter/setter at `LoadoutManager.ts:54-55`):
```ts
private startingWeaponId: string = '';   // '' = basic only
constructor() { /* ...existing... */
  const sw = localStorage.getItem('zs2_loadout_starting_weapon');
  // accept only an owned BLUEPRINT/CITY weapon id; else clear
  if (sw && getWeaponDef(sw) && BlueprintSystem.isUnlocked(`bp_weapon_${sw}`)) this.startingWeaponId = sw;
}
public setStartingWeaponId(id: string) { this.startingWeaponId = id; localStorage.setItem('zs2_loadout_starting_weapon', id); }
public getStartingWeaponId(): string { return this.startingWeaponId; }
```
**Corruption-safety:** all reads go through the existing crash-proof `readUnlockedArray()` (`BlueprintSystem.ts:40-49`) / `Number.isFinite` (`BlueprintSystem.ts:32-33`) guards. The starting-weapon read validates against the catalog + ownership before trusting it.

---

## 9. Evolution hooks (cross-ref `evolutions-and-legendary-relics.md`)

Each new weapon is a valid evolution parent in the `EVOLUTION_RECIPES` table (evolutions doc A.2). Because recipes match by `weaponClass` (`instanceof`) and `getLevel()`, no special wiring is needed — a catalog weapon is automatically eligible. Proposed new recipes (add rows to `EvolutionRecipes.ts`; numbers in the evolutions-doc style):

| Result | Recipe | Notes |
|---|---|---|
| **Gravity Well** (existing in evo doc B.1) | Void Orb (or Orbital) Lv2 + Explosive Lv3 + *Singularity Core* legendary | Void Orb satisfies the orbit/summon parent slot; recipe `requires` accepts either class via two rows or an `anyOf` |
| **Buzzsaw** | Ricochet Disc Lv2 + Piercing Lv2 | ricochet + pierce; accessible, no relic |
| **Storm Caller** | Prism Beam Lv3 + Tesla Arc Lv2 | a chaining beam; mid-late, no relic |
| **Bomber Drone** | Sentry Drone Lv2 + Explosive Lv2 | drones drop AoE on each shot |
| **Cryo Cluster** | Frost Mine Lv3 + Explosive Lv2 | mines chain-detonate |

**Hook requirement:** `checkEvolution()` runs at the end of `unlockWeapon()` (§5.1), exactly as it did for the old `unlock*` methods (`WeaponSystem.ts:80,96`). The relic-gated recipes (Gravity Well) also need the `checkEvolutionPublic()` re-trigger when the legendary is acquired — already specified in evolutions doc C.2. No additional hook beyond keeping the `checkEvolution()` call in `unlockWeapon()`.

> If a recipe needs "either Orbital OR Void Orb" as a parent, extend `EvolutionRequirement` with an optional `anyOf?: WeaponClass[]` (small change in `EvolutionRecipes.ts`), or simply author two recipe rows producing the same result. Two rows is zero-risk and recommended for v1.

---

## 10. Edge cases

1. **Evolution consumes a blueprint-owned starting weapon.** If the player starts with Piercing (blueprint) + finds Explosive, Inferno Lance evolves and strips Piercing (evo doc A.3). That is correct and intended — the evolution is the upgrade. The blueprint still grants the *base* at the next run's start; evolution is per-run.
2. **Capped weapon flooding offers.** A maxed weapon could keep appearing. Use the `(b)` branch in §7.2 (`weaponAtMaxLevel`) to retire it, mirroring `SKILL_MASTERY` retirement (`Game.ts:673-674`). For v1, weapons have soft caps inside `upgrade()` (e.g. orb/drone counts cap) so re-offering only bumps damage — acceptable, but the hook exists.
3. **City special revoked.** If city-reclamation can lose a district, `isCityBlueprintOwned` may flip to false mid-meta. A run already in progress with Void Orb keeps it (the weapon is instantiated); only future offers/loadout-selection are gated. No mid-run revocation needed.
4. **Starting weapon equipped but blueprint refunded.** `BlueprintSystem.unequip()` (`BlueprintSystem.ts:69-80`) can remove `bp_weapon_X` while `zs2_loadout_starting_weapon` still points at X. The `LoadoutManager` constructor validates ownership and clears a stale starting weapon (§8); also re-validate in `Loadout.create()`.
5. **Summon-sprite leak on death/teardown.** Handled by the optional `dispose()` hook (§4.3) called from `WeaponSystem.destroy()`. Verify `WeaponSystem.destroy()` is invoked in `Game` shutdown (it is the per-run cleanup discipline; confirm the call site exists alongside other system teardown).
6. **Two weapons of the same class.** `unlockWeapon()` finds an existing `instanceof` and upgrades rather than adding a duplicate (§5.1) — matches existing `unlockPiercing()` semantics (`WeaponSystem.ts:68-79`).
7. **`getProjectileSpeed()` for non-projectile weapons feeding `LevelUpSelection` preview.** `weapons[0]` is always the basic `Weapon` (never removed), so the preview's `getProjectileSpeed()` read (`LevelUpSelection.ts:193`) is always valid; new `0`-returning weapons never sit at index 0.
8. **Beam/orbit weapons and external speed multipliers.** Chrono Engine / Arsenal multiply `getAttackSpeed()` via `upgradeSpeed()` (`WeaponSystem.ts:51-53`); these correctly accelerate tick-based weapons (Tesla, Beam, Void Orb recast). No special casing.
9. **LEVELUP_ONLY weapon as an evolution parent.** Ricochet Disc → Buzzsaw requires Ricochet (level-up-only) + Piercing. A blueprint-less player can still reach Buzzsaw entirely in-run if they happen to roll both — intended; level-up-only weapons are not second-class for evolution.

---

## 11. Incremental implementation checklist (ordered; each step compiles)

1. **`src/game/weapons/` — 6 new classes** implementing `IWeapon` per §3/§4: `TeslaArcWeapon.ts`, `SentryDroneWeapon.ts`, `FrostMineWeapon.ts`, `RicochetDiscWeapon.ts`, `PrismBeamWeapon.ts`, `VoidOrbWeapon.ts`. Reuse the boilerplate from `PiercingWeapon.ts:11-25,91-103`. Summon weapons add `dispose()`. (Assumes `OrbitalWeapon.ts` from the evolutions doc exists or is added in parallel.)
2. **`src/game/weapons/WeaponCatalog.ts`** (new) — `WeaponUnlockTier`, `WeaponDef`, `WEAPON_CATALOG`, `getWeaponDef`, `isWeaponUnlocked` (§5, §6.4). Migrate Piercing/Explosive numbers verbatim from `WeaponSystem.ts:72-94`.
3. **`src/game/systems/WeaponSystem.ts`** — add `unlockWeapon(id)`, `ownsWeapon(id)`; keep `unlockPiercing/unlockExplosive` as shims (§5.1); update `destroy()` to call `dispose()` (§4.3). Keep `checkEvolution()` call.
4. **`src/game/systems/BlueprintSystem.ts`** — generate `bp_weapon_*` rows from the catalog, remove duplicate `bp_start_piercing/explosive`, add `isCityBlueprintOwned()` (§6.3). Existing point/unlock engine unchanged.
5. **`src/game/systems/LoadoutManager.ts`** — add `startingWeaponId` getter/setter + validated load (§8), mirroring the mission field (`LoadoutManager.ts:32-33,54-55`).
6. **`src/game/systems/UpgradeSystem.ts`** — replace hand-written `PIERCING_SHOT`/`EXPLOSIVE_BURST` entries with catalog-generated `weaponUpgrades()` (§7.1); compose into the random-upgrade pool.
7. **`src/game/scenes/Game.ts`** — extend `getCappedUpgradeIds()` to filter by `isWeaponUnlocked` + cap (§7.2). `BlueprintSystem.applyToGame()` already runs the new `bp_weapon_*` rows at `Game.ts:164` (the `apply` checks the equipped starting weapon).
8. **`src/game/scenes/Loadout.ts`** — add a **Starting Weapon** selector group (cross-ref `outer-loop-expedition-loadout.md`), listing catalog weapons where the player owns `bp_weapon_X` (or the city special), writing `LoadoutManager.setStartingWeaponId(...)`. Same 3-column grid pattern as the Mission group (`Loadout.ts:116-156`).
9. **`src/game/scenes/LevelUpSelection.ts`** — `getIconKeyForUpgrade()` returns the catalog `iconKey` for catalog ids (§7.3).
10. **`src/game/scenes/Preloader.ts`** — add the 7 icon placeholder entries (§7.3).
11. **`src/game/weapons/EvolutionRecipes.ts`** (cross-ref evo doc) — add the 5 new recipe rows (§9). Optional: `anyOf` parent support.
12. **`public/content.manifest.json`** (optional, polish) — `upgrade_icon` / `projectile` / `vfx` entries for the new keys, `status:"missing"` until art ships; everything falls back gracefully.

### 11.1 Tuning / risk flags
- **Summon DPS scaling** (Sentry Drone): drone count × fire rate × global atk-speed relics can spike. Cap `droneCount` at 3 and watch Chrono-Engine interaction (evo doc D.1).
- **Prism Beam sustained DPS:** 8 ticks/s × 8 dmg = 64 dps on one target *before* upgrades/relics — verify it doesn't trivialize tanks; tune tick rate down if needed.
- **Void Orb pull through player:** cap per-tick displacement; never pull past center (evo doc D.1). It is also the strongest weapon AND city-gated, so guard its tuning carefully.
- **Offer flooding:** with 7 BLUEPRINT-tier weapons always eligible in level-ups, the upgrade pool grows; confirm 3-pick variety still surfaces stat upgrades often enough, or weight weapon offers down.
- **Single source of truth:** once the catalog ships, ensure no second place hardcodes weapon stats (delete the migrated `unlockPiercing/unlockExplosive` literals, keep only catalog `create`).
