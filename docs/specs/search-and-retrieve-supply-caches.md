# Search & Retrieve: Supply Cache Missions — Design Pitch

Status: Draft / design pitch (no code yet) — 3 open questions locked, see below
Author: Game design
Target: `zombie-survivors-2` (Phaser 3.88 + React + Vite + TypeScript)

**Locked decisions (post-pitch review):**
- **Caches per mission: 1–3.** Confirmed as proposed — not raised, not lowered.
- **`SCARCITY` does not touch caches.** Confirmed: stays scoped to `Pickup.ts`
  walk-over drop rate only; never reduces cache count/value.
- **Do not stack with Extraction missions yet.** Confirmed: ship Search &
  Retrieve and Extraction as mutually exclusive until both are independently
  tuned; revisit combining them later.

> Companion to `extraction-mission-end.md`, `mono-weapon-mission-mode.md`, and
> `fog-of-war-light-sources.md`. Like those specs, this sits *around* the existing
> run loop and reuses proven seams — the per-mission opt-in flag pattern
> (`Mission.extraction?`, `MissionTypes.ts:143`), the HOLD_ZONE
> stand-in-a-radius-and-dwell precedent (`MissionSystem.ts:63-95, 237-251`), and the
> Job Board's template-composition pattern (`JobTemplates.ts:85-86`). It proposes
> **no new input scheme** and **no new UI chrome** beyond a radial progress ring.

---

## The hook

Right now, a mission's resource reward is a number that appears on a ledger screen
after the fact. You kill 200 zombies, hold a zone, survive a timer — and food,
water, and medicine simply materialize in `CycleReport` once you reach GameOver.
The player never *touches* the thing they were supposedly fighting for. It's an
abstraction wearing a flavor-text label ("Supply Run: West Yards") over a kill
quota.

Search & Retrieve makes the reward diegetic. The food, the meds, the water — they're
a duffel bag sitting in the same arena as the horde, lit by the same streetlight,
guarded by nothing but proximity to danger. Spotting one and deciding *when* to go
get it becomes a real moment-to-moment choice, not a post-run statistic. And because
grabbing it means standing still in a small circle with your weapon silent while the
spawn director keeps doing its job, every cache is a held breath: *do I commit to
this, or do I let it sit and keep moving?*

This is the same move `HOLD_ZONE` and Extraction already made for *win conditions* —
turning an abstract progress bar into a place on the map you have to physically
hold under pressure. Search & Retrieve applies that same trick to *rewards*,
repeated several times a run instead of once at the end. It directly counters the
dominant strategy the current pickup model encourages — orbit the safe edge of the
screen and let auto-fire farm kills — by planting something the player actually
wants in a spot they have to choose to be exposed at.

---

## Core loop

1. **Spot** — a cache exists in the world from mission start (or spawns on a
   trigger; see open questions). It reads visually distinct from a walk-over
   `Pickup` (duffel/crate sprite, not a glowing orb) and, per `fog-of-war.md`, is
   *not* a light source itself — finding one in a dim pocket between streetlights
   is part of the tension.
2. **Approach** — no special input. The player walks toward it exactly as they
   would toward anything else in the arena.
3. **Small-radius trigger** — entering a tight activation radius (proposed
   40–56px, deliberately tighter than a typical `HOLD_ZONE` objective) auto-arms
   the search, mirroring `HOLD_ZONE`'s "no button, just be there" trigger model
   (`MissionSystem.ts:237-242`).
4. **Search interaction** — a timed channel begins (see below). The player's
   weapon goes silent. The player can still strafe, but only inside the radius.
5. **Commit or abort** — leaving the radius pauses the channel without losing all
   progress (cumulative, like `HOLD_ZONE`'s `continuous: false` mode,
   `MissionSystem.ts:245-246` shows the alternative — we deliberately pick the
   *forgiving* cumulative variant here, see "The search interaction" below for why).
   This is the live risk/reward decision: stay and finish, or peel off to fight and
   come back later.
6. **Payout on retrieval, not on mission win** — the cache's resource is granted
   the instant the channel completes, with its own small pickup beat (flash + SFX,
   reusing the existing `Pickup.collect()` punch — fade/scale tween,
   `Pickup.ts:121-134`). Nothing is held in escrow until GameOver; what you grab,
   you keep, immediately, mid-run.

This is a deliberate, explicit departure from `Pickup.ts` today: every existing
pickup type (HEALTH/SPEED/DAMAGE/EXPERIENCE/BOMB/AIRSTRIKE/FLARE) is instant,
walk-over, zero-commitment, zero-risk (`Pickup.ts:43–82`, overlap-collected via
`physics.add.overlap(this.player, this.pickups, ...)` at `Game.ts:561`,
`handlePlayerPickupCollision` at `Game.ts:1663`). Supply caches should look and
feel *nothing* like that loop on purpose — if a cache could be grabbed by jogging
through it, none of this works.

---

## The search interaction: "channel the cache"

A concrete, lightweight proposal — not a Tarkov-style drag-and-drop grid (far too
slow for this game's pace), but adapted from the same fantasy: tense, vulnerable,
time-costly rummaging.

- **Radius**: ~48px gameplay radius, drawn as a pulsing ring using the same
  `Graphics` pattern `MissionSystem.drawZoneMarker` already uses
  (`MissionSystem.ts:74-95`) — translucent fill, solid inner outline, breathing
  outer pulse. Reuse the visual language players already associate with "stand
  here."
- **Trigger**: automatic on entry, exactly like `HOLD_ZONE` — no new keybind, no
  "hold E" prompt. This matters more than it sounds (see Mobile controls below).
- **Duration**: a fixed channel, proposed baseline 3 seconds, tunable per
  cache/mission (bigger reward = longer channel is a reasonable knob).
- **Visual feedback for "vulnerable"**: a radial progress dial fills around the
  player or the cache, color-shifting cool blue → hot amber as it nears
  completion (urgency ramps visually, no extra HUD text needed). The HUD weapon
  icon dims/crosshatches to make "my gun is off" legible at a glance, since the
  player otherwise has no UI cue that fire input is being eaten.
- **Movement, not a root**: the player can still strafe *within* the radius during
  the channel. A full stun/root would feel terrible stacked against a horde — this
  keeps a sliver of agency (you can still dodge a melee swing) while removing the
  one thing that actually matters in combat: damage output.
- **Interruption model — pause, not reset**: leaving the radius pauses the channel;
  progress is retained and resumes on re-entry. This is the *cumulative*
  `HOLD_ZONE` variant (`continuous: false`, `MissionSystem.ts:245-246` shows what
  the alternative "reset on leave" branch looks like) rather than the punishing
  one. Being hit by an enemy while channeling knocks off a flat chunk of progress
  (proposed ~25%) plus a red ring-flash, instead of zeroing it outright — this
  keeps "vulnerability" feeling like *real risk* (you can get punished mid-search)
  without making a single chip-damage hit from a crowd erase 2.5 seconds of
  commitment, which would just feel bad rather than tense.
  - Dying while channeling is not special-cased — it's a normal death; the cache
    stays unretrieved.
- **No decay-over-time** in v1 — progress sits indefinitely once paused, so a
  player can nibble at a cache across multiple visits if they're patient. Flagged
  below as a balance lever to revisit if this trivializes the risk.

This is small, readable, and entirely reuses art/code idioms already in the game
(pulsing world-space ring, radial fill, tween-based feedback) rather than
introducing inventory UI.

---

## Vulnerability and weapon-disable: where the tension actually comes from

The gate point is exactly where the brief expects it: `WeaponSystem.update()`
calls `weapon.fire(this.scene, this.player, activeEnemies)` once per frame per
equipped weapon whenever enemies are active (`WeaponSystem.ts:60-72`, the call
itself at `WeaponSystem.ts:71`). A `searching` boolean — owned by a new system,
read by `WeaponSystem` — guards that call. `weapon.update()` (movement-only, e.g.
summon entities like drones/mines repositioning) is a separate call on the line
above and is **not** obviously gated by the same flag; whether companion weapons
keep operating during a search is an open call (see below).

The reason this creates real tension rather than busywork: this game's horde
pressure is continuous and escalating by design — the spawn director doesn't stop
because the player decided to loot. Choosing to stand still and go weaponless for
3+ seconds is a bet that *this specific patch of arena, right now,* is survivable
without retaliation. That's precisely the bet Extraction already proved works at
the macro scale (commit to a zone, survive uncapped directional spawning,
`extraction-mission-end.md §3-4`) — Search & Retrieve runs the same bet in
miniature, repeatably, mid-run instead of once at the very end.

It also composes naturally with fog/lights (`fog-of-war-light-sources.md`):
placing caches in dim pockets between streetlights means *finding* one already
costs the safety of the lit "spine," and a carryable lantern/flare creates a real
trade while searching — light yourself up to see incoming threats during the
channel, or stay dark and trust your ears. Worth one explicit beat in any follow-up
visual spec, not a blocker for v1.

---

## Reward contingency — what happens if you don't retrieve everything

This is the load-bearing design call the brief flags, and it has to interact
cleanly with how rewards flow today: `Game.finishWin()` (`Game.ts:1491-1574`)
resolves blueprint points and hands off to `GameOver`, which calls
`CampSystem.advanceCycle({ missionReward, ... })` exactly once
(`GameOver.ts:122-169`) to apply the full `CampReward` (food/water/medicine/
hordePressureReduction/survivorsRescued/blueprintPoints) atomically.

Three options considered:

1. **All-or-nothing gate**: mission can't complete until every cache is
   retrieved. Rejected — it would require *inventing* a new completion gate
   bolted onto every `MissionConditionKind` (KILL_COUNT, SURVIVE_TIME, HOLD_ZONE,
   ...), since none of them today know anything about cache state. It also risks
   a soft-lock feel: a `SURVIVE_TIME` mission's timer can run out while a cache
   sits in a hot zone the player reasonably avoided, and now the *entire mission*
   is stuck.
2. **All-or-nothing forfeiture per resource line**: mission completes via its
   existing condition untouched, but skip the medicine cache → get exactly 0
   medicine.
3. **Proportional payout** *(recommended)*: mission completes via its existing
   condition untouched; the cache-backed `CampReward` fields scale by
   `(caches retrieved / caches seeded)`. Two of three caches grabbed → 2/3 of the
   authored food/water/medicine for this mission.

**Recommendation: proportional (option 3).** Reasons:
- It leaves `MissionConditionKind`/`MissionProgress`/`finishWin`'s win-condition
  machinery completely untouched — caches become an orthogonal reward layer
  riding alongside the win condition, not a new kind of win condition. That
  matches this codebase's hard convention: `extraction?`, `monoWeapon?`, `fog?`
  all *layer onto* the existing condition rather than replacing or gating it
  (`MissionTypes.ts:139-176`).
- All-or-nothing (option 1 or 2) is swingy in a way that fights the roguelite's
  forward-momentum feel — a single missed cache zeroing an entire run's food
  reward is the kind of "lost 20 minutes for nothing" outcome that reads as
  unfair rather than tense.
- It still delivers on the brief's core ask: resources are **contingent on
  retrieval**, not auto-granted. The floor moves from "100% guaranteed" (today)
  to "0% if you never engage a single cache, scaling up with how much you
  actually retrieved" — that's a real behavioral lever, not the all-or-nothing
  punishment the brief specifically asked us to weigh.
- Non-cache `CampReward` fields (blueprintPoints, hordePressureReduction,
  survivorsRescued) are unaffected by retrieval ratio — only the specific
  resource amounts explicitly tied to caches scale down. This requires splitting
  "flat reward" from "cache-backed reward" conceptually; sketch only:

```ts
// Conceptual shape, NOT an implementation — illustrates the split, not the API.
supplyCache?: {
  enabled: boolean;
  caches: { location: WorldPoint; radius?: number; searchSeconds?: number }[];
  cacheReward: CampReward;   // the portion of Mission.reward gated on retrieval ratio
};
```

Surface a "Caches retrieved: 2/3" line on the GameOver summary so the shortfall
reads as a player choice, not a hidden penalty.

---

## Mission-type integration: opt-in flag vs. distinct archetype

Two real options, weighed explicitly per the brief:

**A. Opt-in flag on any `Mission`** (`Mission.supplyCache?: {...}`), mirroring
`extraction?` / `monoWeapon?` / `fog?` (`MissionTypes.ts:143,157-164,171`).
Missions without the flag are byte-for-byte unchanged — same guarantee those three
features already make.

**B. Distinct special archetype**, mirroring `JobLaunchKind`
(`GAME_RUN` / `LONG_RECON` / `CITY_RECLAMATION`, `JobBoardTypes.ts:94-98`), which
routes a Job Board offer to a *different scene* entirely.

**Recommendation: A, not B.** `JobLaunchKind` exists because `LONG_RECON` and
`CITY_RECLAMATION` genuinely launch different scenes with different structural
loops (a route-map sub-loop, a district-reclamation flow) — they are not "the
Game scene, but spicier." Search & Retrieve is exactly the opposite: same `Game`
scene, same enemy spawn director, same win condition, with one additional
world-object system layered in. That's structurally identical to what
`extraction?`/`monoWeapon?`/`fog?` already are. Inventing a new `JobLaunchKind` for
this would be over-engineering relative to the actual scope of the change.

To still deliver the *player-facing* feel of "this is a distinct mission type" that
the brief asks for, without an engine-side fork: give it a Job Board **template**,
the same way `JobTemplates.ts` already composes a `SCARCITY` modifier plus flavor
text onto a generated `Mission` (`JobTemplates.ts:85-86`). A "Supply Run" template
sets `supplyCache.enabled = true`, seeds 1–3 cache locations, titles itself "Supply
Run: <district>," and is weighted into `JobBoardSystem`'s difficulty/reward
scoring the same way `SCARCITY` already contributes
(`JobBoardSystem.ts:335,431`). Players see and feel a distinct mission archetype
on the board; the runtime is just another opt-in flag.

---

## Risks / open design questions

- **Pacing vs. horde pressure.** Is a 3–4s no-fire window survivable mid/late-run
  without trivializing the spawn director's escalation, or without feeling
  unfairly punishing? Needs playtesting. Propose `searchSeconds` as a tunable per
  mission/difficulty, and consider excluding cache placement from
  high-pressure windows (e.g., not stacked right before a `SLAY_BOSS` spawn).
- **Companion/summon weapons during a search.** Should drones/turrets/mines keep
  operating while the primary weapon is silenced (`weapon.update()` vs.
  `weapon.fire()` are separate calls, `WeaponSystem.ts:62,70-72`)? Leaving them
  active softens the tension for builds that lean on summons; gating them too
  removes a meaningful build-diversity lever. Recommend leaving `update()`
  (movement/repositioning) untouched and gating only `fire()`, then playtesting
  whether summon-heavy builds trivialize the risk.
- **Mobile / touch feasibility — turns out to be a non-issue, but worth stating
  explicitly.** The only existing input model is movement: keyboard (cursors +
  WASD) and a virtual joystick (`MovementInput.ts:11-59`); there is no existing
  "interact" button anywhere in the game. Because the trigger is auto-arm-on-radius
  (the `HOLD_ZONE` pattern), "stand still inside a circle" costs touch controls
  exactly nothing extra — no new button, no new UI affordance. This is a strong
  argument *for* the auto-trigger design specifically; a "hold to interact" button
  design would have required new touch chrome and should be avoided.
- ~~Interaction with `SCARCITY`~~ — **LOCKED**, see decisions above. Today this
  modifier is scored/displayed but not actually wired to any drop system yet
  (`Game.ts:1581` TODO comment; `JobBoardSystem.ts:335,431` only compute its
  difficulty/reward weight). When it is wired, it must stay scoped to
  `Pickup.ts`'s walk-over drop *rate* (health/speed/damage/xp/bomb) and never
  touch cache *count* or *value* — caches are a fixed, authored, mandatory
  resource per mission, and letting a difficulty modifier silently delete one
  would double-dip two "make resources scarce" levers on the same run and risk
  a mission that can't pay out its own reward.
- ~~Caches per mission~~ — **LOCKED at 1–3**, see decisions above. More than
  that risks tipping the game into "extraction shooter with zombies" territory
  and away from horde-survivor pace; fewer than that means a single bad
  placement swings an entire run's resource payout disproportionately
  (interacts with the proportional-payout recommendation above — fewer caches
  means coarser granularity, e.g. 1 cache means it's effectively all-or-nothing
  again by accident).
- **Does this fit every mission, or only some?** Recommend scoping to missions
  whose `CampReward` already includes `food`/`water`/`medicine` — i.e., don't
  retrofit a pure-`blueprintPoints` `KILL_COUNT` mission with caches it has no
  reward reason to carry. Likely surfaced primarily through the Job Board's
  "Supply Run" template rather than appearing ambiently on arbitrary missions.
- ~~Stacking with `extraction?` / `monoWeapon?`~~ — **LOCKED**, see decisions
  above: do not stack with Extraction yet. Mono-Weapon doesn't conflict
  mechanically (a search is already "no weapon," compatible with any loadout)
  and is fine to combine. Extraction is the one held back — stacking "must
  search N caches" on top of Extraction's uncapped late-run spawn pressure
  could be excessive; revisit combining the two only after both are
  independently tuned and playtested.
- **Bonus loot beyond the mandatory resource.** Tempting follow-up: an occasional
  cache rolls a bonus (a relic-tier drop, a small flat BP bump) on top of its
  guaranteed resource, rewarding thoroughness even after the mandatory caches are
  found. Explicitly out of scope for v1 — flag as a v2 idea so it doesn't creep
  into the first cut.
- **Placement algorithm.** Needs a real "place N caches, minimum distance from
  player start, minimum mutual spacing" pass at mission start. `ExtractionSystem`
  already proves a clamp-to-world-bounds placement routine for a single zone
  (`extraction-mission-end.md §2`, `placeZone`); generalizing it to multiple
  mutually-spaced points is new but small.
- **Readability without a minimap.** Confirmed: this game has no minimap. Caches
  need an on-screen indicator when off-screen (an edge arrow/ping), reusing the
  precedent `ExtractionSystem` already establishes for its "HUD direction
  pointer + countdown" toward an off-screen zone (`extraction-mission-end.md §2`).
  Without this, caches in a 2048×1536 world (`GameConfig.ts:3-6`) are too easy to
  simply never notice.

---

## Files

If this moves to implementation, the likely touch points (no code in this pitch):

- `src/game/types/MissionTypes.ts` — new `Mission.supplyCache?` opt-in shape,
  mirroring `extraction?`/`monoWeapon?`/`fog?` (`MissionTypes.ts:143,157-171`).
- New: `src/game/entities/SupplyCache.ts` — world object; mirrors
  `BlueprintDrop.ts`/`Pickup.ts` shape but overlap drives a radius-trigger state,
  not instant collection.
- New: `src/game/systems/SupplyCacheSystem.ts` — mirrors `MissionSystem`'s
  HOLD_ZONE marker + dwell pattern (`MissionSystem.ts:63-95, 237-251`) and
  `ExtractionSystem`'s zone-placement routine; owns per-cache progress and exposes
  the `searching` flag.
- `src/game/systems/WeaponSystem.ts` — gate the `weapon.fire(...)` call
  (`WeaponSystem.ts:71`) behind the `searching` flag from `SupplyCacheSystem`.
- `src/game/scenes/Game.ts` — construct/drive `SupplyCacheSystem`; compute the
  retrieval ratio into the cache-backed portion of the reward before handing off
  to `GameOver` (`finishWin`, `Game.ts:1491-1574`).
- `src/game/scenes/GameOver.ts` — apply the scaled `cacheReward` alongside the
  existing flat reward through `CampSystem.advanceCycle` (`GameOver.ts:122-169`);
  surface a "Caches retrieved: X/Y" summary line.
- `src/game/types/CampTypes.ts` — no structural change required; `CampReward`
  stays the same shape, just split conceptually into flat vs. cache-gated at the
  `Mission`/`JobReward` level.
- `src/game/config/JobTemplates.ts` — a "Supply Run" template composing
  `supplyCache.enabled = true` plus flavor text, precedent at
  `JobTemplates.ts:85-86` (`SCARCITY` composition).
- `src/game/systems/JobBoardSystem.ts` — difficulty/reward weighting for
  supply-cache missions, precedent at `JobBoardSystem.ts:335,431` (`SCARCITY`
  weighting/display).
