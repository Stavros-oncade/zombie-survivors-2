# Mono-Weapon (Specialist) Mission Mode — Feature Design Doc / Pitch

Status: Draft / design pitch (no code yet)
Author: Game design + technical design
Target: `zombie-survivors-2` (Phaser 3.88 + React + Vite + TypeScript)

> Companion to `extraction-mission-end.md`, `fog-of-war.md`, and
> `mission-system.md`. Like those specs, Mono-Weapon sits *around* the existing run
> code and reuses proven seams: the per-mission opt-in flag pattern
> (`Mission.extraction?`, `MissionTypes.ts:118`), the single upgrade-pool filter
> choke point (`Game.getCappedUpgradeIds()`, `Game.ts:843-864`), the data-driven
> weapon registry (`WeaponCatalog.ts` / `WeaponFactory.ts`), and the run-modifier
> economy (`JobModifier` / `RunModifierSink`). It adds **no new asset pipeline** and
> **no new input** — it is almost entirely a *filter* plus a *starting-loadout
> override*.

---

## 0. Grounding: how weapons actually work in this game

Every design decision below is constrained by these verified facts.

- **The player always starts with one always-present "basic" weapon.**
  `WeaponSystem`'s constructor seeds `this.weapons = [ new Weapon(...) ]` with the
  basic peashooter (`WeaponSystem.ts:22-29`). `weapons[0]` being the basic `Weapon`
  is assumed in two places: `isWeaponSpeedMaxed()` (`WeaponSystem.ts:67-70`,
  `weapons[0] instanceof Weapon`) and the level-up stat preview
  (`LevelUpSelection.getCurrentStats()`, `:251`).
- **All other weapons are catalog weapons, layered on top.** A run *adds* catalog
  weapons via `WeaponSystem.unlockWeapon(id)` (`WeaponSystem.ts:88-96`): it finds an
  existing instance of that weapon's class and calls `upgrade()`, else builds a
  fresh level-1 instance from `WEAPON_FACTORY` (`WeaponFactory.ts:29-90`). So today
  a "Demolitionist starting with Explosive Burst" actually carries **basic +
  explosive**, not explosive alone (`Game.ts:230-232`).
- **There are exactly three ways to gain a weapon, and none of them are pickups.**
  1. **Starting loadout** — `LoadoutManager.startingWeaponId` (`LoadoutManager.ts:72-73`),
     applied at run start by `BlueprintSystem.applyToGame()` → `unlockWeapon(w.id)`
     when that weapon is equipped (`BlueprintSystem.ts:36-38`, called from
     `Game.ts:235`); plus the `DEMOLITIONIST` character grant (`Game.ts:230-232`).
  2. **Level-up cards** — `UpgradeSystem.weaponUpgrades()` generates one offer per
     non-STARTER catalog weapon (`UpgradeSystem.ts:78-90`); chosen via
     `getRandomUpgrades(3, excludeIds)` at level-up (`Game.ts:1051-1053`).
  3. **Relic chests** (elite/boss reward) — primarily relics, but they *top up* with
     `getRandomUpgrades(...)` when relics run low (`Game.ts:1113-1114`), so a chest
     **can** surface a new-weapon card too.
  **Pickups never grant weapons** — `PickupType` is HEALTH/SPEED/DAMAGE/EXPERIENCE/
  BOMB/AIRSTRIKE only (`Pickup.ts:18-66`). This dramatically narrows the surface we
  must lock.
- **Both level-up and chest paths funnel through ONE filter.**
  `Game.getCappedUpgradeIds()` (`Game.ts:843-864`) returns a `Set<string>` of
  excluded offer ids and is the *only* argument that gates weapon offers in both
  `getRandomUpgrades` calls (`Game.ts:1053`, `:1114`). It already excludes STARTER
  and gate-locked weapons (`isWeaponUnlocked`, `WeaponCatalog.ts:122-131`). **This is
  the single seam that turns "many weapons" into "one weapon."**
- **Weapons level and evolve.** A catalog weapon's own level-up card calls
  `existing.upgrade()` (raises level + bespoke stats); the global stat upgrades
  (`WEAPON_DAMAGE +25%`, `WEAPON_SPEED +20%`, `PROJECTILE_SPEED +30%`,
  `UpgradeSystem.ts:30-60`) `forEach` across **all** weapons
  (`WeaponSystem.ts:55-74`). **Evolution requires *two* source weapons** at minimum
  levels (`EVOLUTION_RECIPES`, `EvolutionRecipes.ts:44-112`; e.g. Inferno Lance =
  Piercing L2 + Explosive L2), checked by `tryEvolve()` (`WeaponSystem.ts:153-177`).
  This two-source requirement is the load-bearing problem for a one-weapon run (§3.4).
- **Per-mission opt-in flags are an established pattern.** `Mission.extraction?:
  { enabled; radius?; dwellSeconds? }` (`MissionTypes.ts:118`) is read in `create()`
  and `handleMissionComplete`, leaving non-flagged missions 100% unchanged. Fog of
  War proposes the identical `Mission.fog?`. Mono-Weapon should mirror this exactly.

**Implication:** "only one weapon for the whole mission" is **~90% a pool filter and
a starting-loadout override**, not a new combat system. The mechanics already
support a single weapon scaling indefinitely; we are *removing* offers, forcing the
starting weapon, and authoring single-source evolutions. That is what makes this a
small, safe, high-leverage feature.

---

## 1. One-line pitch & player fantasy

**Pitch:** *This mission hands you one weapon — say, the Tesla Arc — takes every
other weapon off the table, and asks: how deep can you take a single tool? Every
level-up, every chest, every passive pours into that one weapon and the body
carrying it.*

**Player fantasy (specific to this game):** the run becomes a **mastery puzzle**
instead of a draft. In a normal run you're juggling a grab-bag of weapons hoping the
RNG hands you an evolution pair. In a Specialist run you *know your tool* from the
first second and you build a survivor *around* it — stack attack speed and pierce on
the Piercing Shot until it's a wall of bolts; feed the Orbital Shield radius and
extra orbs until you're a blender; ramp the Prism Beam's damage and learn to kite so
its single beam never stops melting. It delivers three things the base game lacks:

- **Deterministic builds** — no "I never rolled Explosive so my Inferno Lance evo
  never came." You opted into exactly this fantasy.
- **Challenge-run identity** — "shotgun-only," "beam-only," "orbital-only" are
  instantly legible, streamable, leaderboard-able constraints.
- **Replayability from the *same* arena** — eight weapons × the mission catalog is a
  combinatorial content multiplier with near-zero art cost (the weapons already exist).

It also gives the outer loop a new reward-bearing knob (a Specialist risk modifier,
§4.2) and a natural home for weapon-mastery meta-progression (§7).

---

## 2. Design goals & anti-goals

### Goals
1. **Feel like deep mastery, not deprivation.** Funneling every pick into one weapon
   should make that weapon feel *absurd* by the midgame. The player should end a
   Specialist run thinking "I had no idea the Frost Mine could do *that*," not "I was
   starved." Lean into the over-scaling (§5), don't fight it.
2. **Never soft-lock progression or the level-up menu.** The upgrade pool with
   weapons removed must always have ≥3 meaningful options (the specialist's own
   level-up card + stat upgrades + passives + relics). The existing pool already
   degrades gracefully when ids are excluded (`getRandomUpgrades` just draws from
   what's left, `UpgradeSystem.ts:105-121`); we must keep ≥3 live ids at all times.
3. **Keep upgrade choices meaningful with weapons off the table.** Removing 8 weapon
   offers must not turn level-ups into "press the only button." The specialist's own
   repeatable level-up card stays in the pool and competes against passives, so every
   level-up is still "more weapon vs. more body."
4. **Be a per-mission modifier, off by default.** Mirror `Mission.extraction?` —
   missions without the flag are byte-for-byte unchanged. The base draft experience
   is the default; Specialist is opt-in content.
5. **Author-friendly + designer-deterministic.** A mission author must be able to say
   *"this mission = Shotgun only"* in one data field (§4), for themed missions, while
   other entry points (random-from-set, player-chosen) reuse the same machinery.

### Anti-goals
1. **Do NOT ship a weapon that can't clear the mission it's bolted to.** Single-target
   weapons (Prism Beam, `WeaponFactory.ts:78`) are death against a `KILL_COUNT` horde
   or the uncapped Extraction swarm. The forced weapon and the win condition must be
   curated *together* (§5.3). This is the #1 balance trap.
2. **Do NOT silently confuse the player.** A Specialist player who never sees a new
   weapon must *understand why*. Communicate the lock pre-mission, at run start, and
   persistently in-HUD (§6) — never leave them wondering if the game is broken.
3. **Do NOT break evolutions for one-weapon runs without a plan.** Today every
   evolution needs two weapons (`EvolutionRecipes.ts`), so a mono run can never evolve
   under current data. Either author single-source evolutions or explicitly accept
   "no evolution this mode." Decide, don't drift (§3.4).
4. **Do NOT widen `Game`'s public API more than necessary.** Follow the
   `RunModifierSink` philosophy (`ExpeditionTypes.ts:149-167`): add the *smallest*
   new surface (one `WeaponSystem` method + one `Game` field).
5. **No new input, no new combat code.** Movement-only stays movement-only; firing
   stays automatic. We only change *which* weapon exists and *which* offers appear.

---

## 3. Core mechanic — exactly what is locked and what is still offered

### 3.1 Starting-weapon override (what you get)
When the active mission has Mono-Weapon enabled, the run starts with **exactly one**
weapon, resolved from the mission data (§4), instead of the player's normal loadout:

- The forced weapon **overrides** the player's `LoadoutManager.startingWeaponId`
  choice and the `DEMOLITIONIST` Explosive grant (`Game.ts:230-232`). In a
  "Tesla-only" mission, a Demolitionist still gets Tesla, not Explosive.
- **`replaceBasic` (recommended default `true`):** the forced weapon *replaces* the
  basic peashooter, so the player truly wields one weapon. (`replaceBasic: false`
  keeps the basic weapon as a floor — useful if the chosen specialist is slow-firing,
  e.g. Frost Mine — so you're never weaponless; it's the gentler variant.)
- If the mission designates **the basic weapon itself** as the specialist (a "pure
  peashooter mastery" run), there is no catalog weapon to install — we simply keep
  `weapons[0]` and lock the pool. The pool is then all-passive (§3.3), which is thin;
  reserve this case for short missions or pair it with a richer passive set (§5.4).

### 3.2 Weapon-pool lockout (what you can no longer get)
Every other weapon is removed from **all** acquisition vectors:

- **Level-up cards:** excluded via `getCappedUpgradeIds()` (§6.3) — every catalog id
  except the specialist's is added to the exclude set.
- **Relic-chest top-ups:** the same exclude set is already passed to the chest's
  `getRandomUpgrades` top-up (`Game.ts:1114`), so chests can't smuggle a weapon in.
- **Pickups:** nothing to do — pickups never grant weapons (`Pickup.ts:18-66`).
- **DEMOLITIONIST / starting-weapon grants:** neutralized by the override (§3.1).

Net effect: the only weapon that can ever exist for the entire mission is the one you
started with.

### 3.3 What the level-up pool offers *instead*
With weapons (except the specialist) filtered out, every level-up and chest draws
from:

- **The specialist's own level-up card** — repeatable; calls `existing.upgrade()`
  (`WeaponSystem.ts:92-93`), rendering as "Lv N → N+1 · <deltas>"
  (`LevelUpSelection.getWeaponDescription`, `:341-349`). This is the headline pick.
- **Weapon stat upgrades** — `WEAPON_DAMAGE`, `WEAPON_SPEED` (until its hard cap,
  then auto-dropped, `WeaponSystem.ts:67-70` / `Weapon.ts:123-130`),
  `PROJECTILE_SPEED` (`UpgradeSystem.ts:30-60`). These `forEach` across the
  specialist too, so they're never dead picks.
- **Body / passive upgrades** — `HEALTH_BOOST`, `SPEED_BOOST` (until movement cap,
  `Game.ts:853-855`), `HEALTH_REGEN`, `SKILL_MASTERY` (until skill max,
  `Game.ts:845-847`).
- **Relics** — the 15% relic-roll at level-up (`Game.ts:1051-1052`) and the
  elite/boss relic chests (`Game.ts:1108-1112`) are untouched. Relics become the
  *primary* source of build variety in a Specialist run, which is exactly the right
  pressure-release valve (§5.4).

This keeps every level-up a real decision ("sharpen the weapon vs. harden the body
vs. gamble on a relic"), satisfying goal #3.

### 3.4 Evolution handling (the dependency problem)
Evolutions today require **two** weapons (`EvolutionRecipes.ts:44-112`), so under
current data a one-weapon run **can never evolve**. Three options, in order of
recommendation:

- **(Recommended, v1) Author single-source "specialist evolutions."** The
  `tryEvolve()` machinery already iterates an arbitrary `requires[]` array and matches
  instances by class + min level (`WeaponSystem.ts:163-169`), so a recipe with a
  **single** requirement *already works with zero engine change* — it's pure data.
  Example new rows in `EVOLUTION_RECIPES`:
  ```ts
  { id: 'mono_piercing', resultName: 'Storm Vortex',
    requires: [{ weapon: PiercingWeapon, minLevel: 8 }],
    resultClass: StormVortexWeapon, build: (s) => new StormVortexWeapon(s, {...}) }
  ```
  Gate them behind the mode so they don't leak into normal play: add an optional
  `monoOnly?: boolean` to `EvolutionRecipe` and skip such rows in `tryEvolve()` unless
  `this.monoWeaponId` is set (one `if`). The high `minLevel` (8+) is the cost — you
  *earn* the evolution by pouring the run into one weapon, which is the fantasy.
- **(MVP) No evolution.** Ship the mode with evolutions simply unreachable; the raw
  level/stat scaling already makes the weapon monstrous. Honest and zero-risk. The
  banner copy just shouldn't promise an evolution.
- **(Alt) Relic-substituted evolution.** `EvolutionRecipe.requiresRelicId` already
  exists (`EvolutionRecipes.ts:30-31`); author a recipe that needs `specialist L6 +
  <relic>` so the "second ingredient" is a relic the player can roll. Reuses an
  existing field, but couples the evo to relic RNG — weaker than the authored
  single-source path.

**Recommendation:** MVP ships with no evolution; v1 adds `monoOnly` single-source
recipes (one data table + one guard line).

### 3.5 What happens to weapon-granting chests/pickups
- **Relic chests:** unchanged in cadence and reward *except* their weapon top-ups are
  filtered out by the shared exclude set (§3.2). They still hand out relics — which is
  good, because relics are the variety engine here.
- **Pickups:** unchanged (no weapons to lock).
- **BOMB / AIRSTRIKE pickups** (`Pickup.ts:59-65`) are weapon-*agnostic* burst
  effects, so they keep working and remain a satisfying "clear the screen" moment for
  a single-target specialist who's getting swarmed.

---

## 4. Mode variants & configurability

The data model must serve a fixed themed weapon *and* random/chosen variants from one
shape. Proposed `Mission.monoWeapon?` (mirrors `Mission.extraction?`,
`MissionTypes.ts:118`):

```ts
// src/game/types/MissionTypes.ts — added to interface Mission
monoWeapon?: {
  enabled: boolean;
  /** Fixed specialist for THEMED missions (e.g. 'tesla_arc'). Catalog id from
   *  WEAPON_CATALOG, or '' / 'basic' to lock to the default peashooter. */
  weaponId?: string;
  /** Random-from-set: if weaponId is omitted, pick one of these at run start. */
  weaponPool?: string[];
  /** Let the player choose at mission start (from weaponPool, else all unlocked). */
  playerChoice?: boolean;
  /** true = the specialist REPLACES the basic weapon (true mono, default true);
   *  false = specialist is layered on top of basic (gentler floor). */
  replaceBasic?: boolean;
  /** Enable the monoOnly single-source evolution recipes for this run (§3.4). */
  allowEvolution?: boolean;
};
```

Resolution order at run start (in `Game.create()`, §6.3):
1. `weaponId` present → **fixed** (themed mission — "this mission = Shotgun only").
2. else `playerChoice` → present a one-time picker at mission start from `weaponPool`
   (or all `isWeaponSelectableAsStarter` weapons, `WeaponCatalog.ts:138-147`).
3. else `weaponPool` present → **random** pick (roguelike variety; great for daily/
   replayable jobs).
4. else fall back to the player's `LoadoutManager.startingWeaponId`, or basic.

This single field covers all three asks: **fixed** (themed), **random-from-set**
(variety), and **player-chosen** (agency), with the same install path.

### 4.2 Alternative seam: a reward-bearing run modifier
A Specialist run is a *challenge* → it should be able to *pay*. Two homes:

- **Job Board `JobModifier`** (`JobBoardTypes.ts:18-70`): add
  `JobModifierKind.WEAPON_LOCK { weaponId }`. `applyRunModifiers()` already has a
  `switch` with a `default` warn-branch for un-backed kinds (`Game.ts:1357-1389`); add
  a case that calls the same `installMonoWeapon()` setter (§6.3). The offer's
  `difficulty`/reward already scale with modifiers, so Specialist jobs pay more for
  free.
- **Expedition `RiskModifierId`** (`Expedition.ts:120-171`): add a `SPECIALIST` risk
  modifier with `rewardBonus`/`dangerBonus`, mirroring `IRONMAN` — whose `apply` is a
  no-op "enforced by validation" (`Expedition.ts:162-170`). Specialist is the same
  shape: the *flag* is what matters, not a stat mutation, so it sets a run field the
  scene reads, exactly like Ironman.

**Recommendation:** **`Mission.monoWeapon?` is the primary seam** (it must influence
both the starting loadout *and* the upgrade filter — both scene-level, which a pure
`RunModifierSink` stat-mutator can't express cleanly). Layer the `WEAPON_LOCK`
`JobModifier` / `SPECIALIST` risk modifier on top in v1 so the outer-loop reward
economy can monetize the challenge. Both ultimately call one `installMonoWeapon()`.

---

## 5. Fit with progression & balance

### 5.1 The over-scaling reality
Normally a run's ~15-25 upgrade picks are split across 2-4 weapons + body + relics. In
a Specialist run, **every weapon-relevant pick lands on one weapon**: its own level-up
card appears far more often (it's one of very few weapon ids left in the pool), and
all three global weapon-stat upgrades stack onto it. By midgame the specialist will be
**dramatically** stronger than that weapon ever is in a normal run. *This is the
feature, not a bug* — but it must be balanced against the world, not nerfed into
sadness.

### 5.2 Balance levers (prefer scaling the world, not capping the weapon)
- **Scale enemies, not the player (preferred).** Reuse the knobs the recon tier
  scaling and risk modifiers already drive: `setEnemyDensityMult`,
  `setEliteIntervalMult`, `setEnemyDamageMult` (`EnemySpawnSystem`, wired at
  `Game.ts:258-259`, `:1357-1389`, `Expedition.ts:120-171`). A Specialist mission can
  ship with a baked-in density/ferocity bump so the over-scaled weapon meets an
  over-scaled horde. This preserves the "I am a god with this weapon" payoff.
- **Optional soft level cap (use sparingly).** If a specific weapon's bespoke per-
  level growth breaks (e.g. Orbital orb count), cap *that weapon's* level via its own
  `upgrade()` and drop its level-up card from the pool past the cap (same mechanism as
  `isWeaponSpeedMaxed` → exclude `WEAPON_SPEED`, `Game.ts:850-852`). Excess picks then
  flow to body/relics. Prefer this only for outliers; blanket caps undercut the
  fantasy.
- **Richer passive/relic pool as the pressure valve.** With ~8 weapon offers gone, the
  pool is thinner; relics carry variety (§3.3). v1 should make relics roll a bit more
  often in Specialist runs (bump the 15% relic chance at `Game.ts:1051` when
  `monoWeaponId` is set) so the player still gets a *draft-like* texture from relics.

### 5.3 Reconcile with Extraction / Elites / Shrieker
- **Extraction** (`extraction-mission-end.md`) ends in an **uncapped ~32 zombies/sec
  swarm**. A single-target specialist (Prism Beam) cannot survive that. **Rule:**
  never author a fixed single-target weapon onto an Extraction-enabled mission; for
  Extraction missions prefer crowd-clear weapons (Tesla Arc, Frost Mine, Orbital,
  Ricochet) or use `weaponPool`/`playerChoice` so the player can pick a crowd tool.
- **Elites / Shrieker** demand burst single-target. A pure crowd weapon with no
  single-target punch (e.g. a weak Frost Mine) may stall on an elite wall or a
  `ShriekerEnemy`. **Rule:** the `KILL_ELITES` / `SLAY_BOSS` missions should force a
  weapon with real single-target damage (Piercing, Prism, Sentry) — or, again, let the
  player choose.
- **General rule:** *weapon archetype and win condition are authored as a pair.* The
  themed `weaponId` path puts the burden on the designer to match them; the
  `weaponPool`/`playerChoice` paths offload it to the player. The mission catalog
  should never combine a hard objective with a weapon that can't satisfy it.

### 5.4 Don't starve the menu
The pool must always yield ≥3 live ids. Worst case (basic-weapon-only mono, all caps
hit): the live set is `HEALTH_BOOST`, `HEALTH_REGEN`, `PROJECTILE_SPEED`,
`WEAPON_DAMAGE`, relics — comfortably ≥3. For catalog-weapon mono, the specialist's
own card guarantees a fourth. Add a guard/test asserting `availablePoolSize ≥ 3`
under the mono exclude set so a future cap tweak can't soft-lock the menu (goal #2).

---

## 6. UX

### 6.1 Pre-mission (Loadout / Job Board / mission select)
- **Mission badge.** Render a `SPECIALIST · <Weapon>` chip on the mission card (Job
  Board offer and `Loadout` mission row). For a fixed `weaponId`, name the weapon
  ("SPECIALIST · Tesla Arc only"); for pool/choice, say "SPECIALIST · choose one."
- **Override the Starting-Weapon picker.** `Loadout.buildStartingWeaponGroup()`
  (`Loadout.ts:203-244`) currently lets the player pick a starter. When the selected
  mission has `monoWeapon.weaponId`, **disable/replace** that group with a read-only
  callout: *"This mission locks your weapon to Tesla Arc."* For `playerChoice`, repaint
  the group as the mission's choice picker (reuse the existing button list, just bound
  to the mission's allowed set instead of `LoadoutManager`). This prevents the
  confusing state where the player picks a starter the mission will ignore.

### 6.2 Run start
- **Banner.** `showMissionBanner()` (`Game.ts:1413-1428`) already prints
  OBJECTIVE/name/description. Append a `WEAPON LOCKED: <Weapon>` line (or a second
  short banner) so the lock is unmistakable from second one.
- **Player-choice picker.** If `playerChoice`, launch a one-time selection (reuse the
  `LevelUpSelection` card layout, `LevelUpSelection.ts:38-239`, fed weapon cards) at
  run start, before the timer/spawns begin.

### 6.3 In-run
- **Persistent HUD chip.** Add a small `SPECIALIST · <Weapon>` chip to `GameUI`
  (`ui/GameUI.ts`, HUD depth band, `scrollFactor(0)`), so a player who *never sees a
  new-weapon card* always understands why. This is the single most important
  anti-confusion element (anti-goal #2).
- **Level-up cards need no special states.** Because excluded weapons simply don't
  enter the pool, the cards already render correctly — the specialist's card shows
  "Lv N → N+1 · <deltas>" via the existing `getWeaponDescription` path
  (`LevelUpSelection.ts:341-349`); passives/relics render as today. No "greyed-out
  locked weapon" card is needed (and would be worse UX than just not showing it).

### 6.4 Onboarding
First Specialist mission shows a one-line tip via the banner pattern: *"Specialist
mission: you have one weapon for the whole run — every upgrade makes it stronger."*

---

## 7. Technical implementation sketch (grounded in the real code)

### 7.1 The two seams (this is the whole feature)

**Seam A — install the sole weapon (run start).** Add one method to `WeaponSystem`:

```ts
// src/game/systems/WeaponSystem.ts
/** Rebuild the loadout to a single weapon for a Mono-Weapon mission.
 *  '' / 'basic' keeps the basic Weapon; any catalog id installs that weapon as
 *  the sole weapon. replaceBasic=false keeps the basic weapon as a floor. */
public installMonoWeapon(weaponId: string, replaceBasic = true): void {
  // tear down summon sprites the same way destroy() does
  this.weapons.forEach(w => (w as { dispose?: () => void }).dispose?.());
  const basic = new Weapon(this.scene, { /* GameConstants.WEAPONS.* as ctor today */ });
  this.weapons = replaceBasic ? [] : [basic];
  const factory = getWeaponFactory(weaponId);
  if (factory) this.weapons.push(factory.create(this.scene));
  else if (replaceBasic) this.weapons = [basic]; // basic-only mono / unknown id guard
}
```

Call it from `Game.create()` **after** the mission is resolved
(`Game.ts:252-267`) and after `applyReconCarryState` (`Game.ts:255`), so it dominates
any carried weapons (recon edge case). Because it runs *last*, we don't need to
reorder the existing weapon-grant block (`Game.ts:230-235`) — `installMonoWeapon`
simply rebuilds `this.weapons`, discarding the basic/Demolitionist/starting grants.
Store the resolved id on the scene: `this.monoWeaponId: string | null`.

> Note on `weapons[0]` assumptions: with `replaceBasic: true` and a catalog
> specialist, `weapons[0]` is no longer a basic `Weapon`. Two readers assume it is:
> `isWeaponSpeedMaxed()` (`WeaponSystem.ts:67-70`) and `LevelUpSelection`'s stat
> preview (`:251`). Both already guard with `instanceof Weapon` / `getDamage()` and
> degrade fine (a non-basic `weapons[0]` just means "Weapon Speed never auto-caps" and
> "the stat panel reads the specialist's numbers" — both acceptable). Harden
> `isWeaponSpeedMaxed` to return `false` when `weapons[0]` isn't a basic `Weapon` (it
> already does the `instanceof` check) so the `WEAPON_SPEED` card stays available.

**Seam B — filter the upgrade pool.** One block in the existing choke point:

```ts
// src/game/scenes/Game.ts — inside getCappedUpgradeIds() (:843-864)
if (this.monoWeaponId !== null) {
  for (const def of WEAPON_CATALOG) {
    if (def.id !== this.monoWeaponId) excluded.add(def.id); // lock every other weapon
  }
}
```

Because `getCappedUpgradeIds()` feeds **both** the level-up draw (`Game.ts:1053`)
**and** the chest top-up (`Game.ts:1114`), this single block closes every weapon
acquisition vector at once. No change to `UpgradeSystem`, `LevelUpSelection`, or the
chest flow is required.

### 7.2 Opt-in plumbing
- **`MissionTypes.ts`** — add `Mission.monoWeapon?` (§4) next to `Mission.extraction?`
  (`:118`).
- **`Missions.ts`** — set `monoWeapon: { enabled: true, weaponId: 'tesla_arc' }` (etc.)
  on chosen / new Specialist missions, exactly like the `extraction: { enabled: true }`
  opt-ins already present (`Missions.ts:14, 53`).
- **`Game.create()`** — after mission resolution, resolve the weapon (fixed / pool /
  choice, §4), set `this.monoWeaponId`, and call `installMonoWeapon`. Append the HUD
  chip + banner line.
- **Evolution (v1)** — add `monoOnly?: boolean` to `EvolutionRecipe`
  (`EvolutionRecipes.ts:23-40`); skip such recipes in `tryEvolve()` unless
  `this.monoWeaponId` is set (one guard, `WeaponSystem.ts:153-177`); pass the
  mono-state into `WeaponSystem` (constructor arg or setter).
- **Run-modifier path (v1, optional)** — `JobModifierKind.WEAPON_LOCK` in
  `JobBoardTypes.ts` + a case in `applyRunModifiers()` (`Game.ts:1357-1389`) calling
  `installMonoWeapon`; and/or a `SPECIALIST` `RiskModifierId` mirroring `IRONMAN`
  (`Expedition.ts:162-170`).
- **Teardown** — none needed beyond existing: `WeaponSystem.destroy()`
  (`WeaponSystem.ts:48-53`) already disposes weapon sprites in `shutdownScene`
  (`Game.ts:1819-1841`). `this.monoWeaponId` is a plain field reset on scene init.

### 7.3 UX surfaces
- `Loadout.ts:203-244` — override/disable the starting-weapon group for mono missions.
- `Game.ts:1413-1428` (`showMissionBanner`) — append the weapon-lock line.
- `ui/GameUI.ts` — persistent Specialist HUD chip.
- (player-choice) reuse `LevelUpSelection.ts:38-239` card layout for the start picker.

### 7.4 Why this is cheap and safe
The combat loop, projectile code, evolution machinery, chest flow, and level-up UI are
**all untouched**. We add one `WeaponSystem` method, one `getCappedUpgradeIds()` block,
one Mission field, one scene field, and presentation. A mission without `monoWeapon`
has `this.monoWeaponId === null` ⇒ both seams are no-ops ⇒ **zero behavior change**,
exactly like `extraction`/`fog`.

---

## 8. Scope tiers & effort

| Tier | Scope | Effort (1 eng) |
| --- | --- | --- |
| **MVP** | `Mission.monoWeapon?` flag with **fixed `weaponId`** only. `WeaponSystem.installMonoWeapon` + `this.monoWeaponId` + the `getCappedUpgradeIds` filter block. Banner weapon-lock line. 1-2 hand-authored Specialist missions (weapon + win condition curated together, §5.3). **No evolution**, `replaceBasic: true`. Loadout starting-weapon picker disabled for mono missions. | **~1.5-2.5 days** |
| **v1** | Add **`weaponPool` (random)** + **`playerChoice`** (start picker reusing LevelUpSelection cards). Persistent **HUD chip**. **`monoOnly` single-source evolutions** (data + one guard). Balance pass: per-mission enemy-scaling defaults (§5.2), slightly richer relic roll. `Loadout`/Job-Board **Specialist badge**. Pool-size ≥3 guard/test. | **~1-1.5 weeks** |
| **Stretch** | **`WEAPON_LOCK` JobModifier** + **`SPECIALIST` RiskModifier** (reward economy, §4.2). **Weapon-mastery meta-progression** (per-weapon XP / mastery levels persisted via the established localStorage pattern, e.g. `BlueprintSystem` keys) that unlock cosmetic tiers or the mono-evolutions. **Achievements** ("clear any Extraction mission as Beam-only"). Daily "random Specialist" job. Per-weapon tuned single-source evolutions for all 8 weapons. | **~1-3 weeks, pick-and-choose** |

Clean kill-switch at every tier: `Mission.monoWeapon?.enabled !== true` (default) ⇒
zero behavior change.

---

## 9. Risks & open questions

**Risks**
- **Weapon ↔ objective mismatch (highest).** A single-target specialist on a horde/
  Extraction mission is unwinnable; a pure crowd weapon stalls on elites/Shrieker
  (§5.3). Mitigation: curate fixed pairings; default hard missions to
  `weaponPool`/`playerChoice`; QA every authored pairing to completion.
- **Menu starvation / soft-lock.** Removing 8 weapon ids thins the pool; a future cap
  tweak could drop it below 3 live options. Mitigation: the ≥3-pool guard/test (§5.4)
  and keeping relics in the pool.
- **`weapons[0]`-is-basic assumptions.** `isWeaponSpeedMaxed` and the stat preview read
  `weapons[0]` (`WeaponSystem.ts:67-70`, `LevelUpSelection.ts:251`). Both already
  `instanceof`-guard; verify they degrade correctly when `weapons[0]` is the
  specialist (§7.1).
- **Over-scaling trivializes content.** One weapon eating every pick can faceroll a
  normally-tuned mission. Mitigation: scale the *world* per mission (§5.2), not the
  weapon — keep the power fantasy, raise the floor under it.
- **Recon carry-state collision.** `applyReconCarryState` re-adds carried weapons
  (`Game.ts:255`, `WeaponSystem.ts:1157`); `installMonoWeapon` must run **after** it so
  it wins (§7.1). Verify in a mono recon node.

**Open questions**
1. Default `replaceBasic` — `true` (pure mono, stronger fantasy) or `false` (basic as a
   safety floor for slow specialists)? Leaning `true`, with `false` reserved for
   Frost-Mine-style slow weapons.
2. Does the specialist's level-up card need a **boosted appearance weight** so it
   reliably shows up, or is "one of few weapon ids left" already enough? (Measure
   appearance rate in playtest.)
3. Should `playerChoice` draw from **all unlocked** weapons or only a mission-authored
   `weaponPool`? (Themed missions want a pool; "free specialist" jobs want all.)
4. Do we ship **mono-evolutions** in v1, or hold them for the mastery meta so the
   evolution is a *meta unlock* reward?
5. Should a **Specialist run pay more** by default (auto-applied reward bonus) or only
   when taken as an explicit risk modifier? (Reward economy / §4.2.)

---

## 10. Playtest plan & success metrics

**Playtest probes**
- Run each of the 8 weapons through a matched Specialist mission to completion; flag
  any weapon/objective pair that is unwinnable or trivial (§5.3).
- A/B `replaceBasic` true vs false on a slow specialist (Frost Mine) — does the basic
  floor help or dilute the fantasy?
- Sweep per-mission enemy density: find the bump where the over-scaled weapon feels
  *powerful but pressured*, not bored.
- Confirm the menu always offers ≥3 meaningful picks late-game with all caps hit.

**Success metrics**
- **Completion parity:** Specialist missions complete within ~5-10pp of their normal
  counterparts (challenge, not a wall) — *except* deliberately hard authored ones.
- **No soft-locks:** zero observed level-up menus with <3 options; zero "why can't I
  get a new weapon" confusion reports (HUD chip + banner working).
- **Mastery feel:** self-reported "my weapon felt incredible by the end" high;
  end-of-run specialist weapon level visibly higher than the same weapon in normal runs.
- **Replay pull:** players who clear one Specialist mission attempt a *different*
  weapon variant at a healthy rate (the combinatorial content is landing).
- **Economy adoption (stretch):** players opt into the `SPECIALIST` risk modifier /
  Specialist jobs for the reward bump at a healthy rate.

---

## 11. Files touched (summary)

- `src/game/types/MissionTypes.ts` — add `Mission.monoWeapon?: { enabled; weaponId?;
  weaponPool?; playerChoice?; replaceBasic?; allowEvolution? }` (mirror
  `Mission.extraction?`, `:118`).
- `src/game/systems/WeaponSystem.ts` — new `installMonoWeapon(weaponId, replaceBasic)`
  (§7.1); harden `isWeaponSpeedMaxed()` for a non-basic `weapons[0]` (`:67-70`);
  (v1) thread mono-state into `tryEvolve()` (`:153-177`).
- `src/game/scenes/Game.ts` — `monoWeaponId` field; resolve + `installMonoWeapon` after
  mission resolution (`:252-267`); mono filter block in `getCappedUpgradeIds()`
  (`:843-864`); banner weapon-lock line in `showMissionBanner()` (`:1413-1428`);
  (v1) `WEAPON_LOCK` case in `applyRunModifiers()` (`:1357-1389`).
- `src/game/config/Missions.ts` — `monoWeapon` opt-in on chosen / new Specialist
  missions (pattern of the existing `extraction` opt-ins, `:14, 53`).
- `src/game/scenes/Loadout.ts` — override/disable the starting-weapon group for mono
  missions (`buildStartingWeaponGroup`, `:203-244`); Specialist mission badge.
- `src/game/ui/GameUI.ts` — persistent Specialist HUD chip.
- *(v1)* `src/game/weapons/EvolutionRecipes.ts` — `monoOnly?: boolean` +
  single-source recipes (`:23-40, 44-112`).
- *(v1/stretch)* `src/game/types/JobBoardTypes.ts` (`WEAPON_LOCK` `JobModifier`),
  `src/game/types/ExpeditionTypes.ts` + `src/game/config/Expedition.ts` (`SPECIALIST`
  risk modifier mirroring `IRONMAN`, `:162-170`).
- *(player-choice)* reuse `src/game/scenes/LevelUpSelection.ts` (`:38-239`) card layout
  for the run-start weapon picker — no new scene needed.
```
