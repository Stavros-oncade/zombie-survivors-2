# Control Zone Code Siege — Design Pitch

Status: Draft / design pitch (no code yet). One decision locked (2026-07-01): this
ships as its own `MissionConditionKind`, not a Mission-level opt-in flag (§9.2,
resolves Open Question §10.1). Everything else still open, see §10.
Author: Game design
Target: `zombie-survivors-2` (Phaser 3.88 + React + Vite + TypeScript)

> Companion to `extraction-mission-end.md` and `search-and-retrieve-supply-caches.md`.
> Like those specs, this sits *around* the existing run loop and reuses proven seams
> rather than inventing new ones: the HOLD_ZONE pulsing-ring + dwell-timer precedent
> (`MissionSystem.ts:63-95`, `:237-251` — this pitch's win condition is evaluated the
> same way, as a native `MissionConditionKind`, not the opt-in-flag pattern used by
> `Mission.extraction?`/`Mission.supplyCache?`, see §9.2), Extraction's uncapped
> directional spawning (`ExtractionSystem.ts`, `extraction-mission-end.md`), and
> Search & Retrieve's channel-a-thing-while-your-gun-is-silent interaction
> (`SupplyCacheSystem.ts`, `search-and-retrieve-supply-caches.md`). It proposes **no
> new input scheme** and reuses the existing off-screen-pointer / world-space-ring HUD
> language wholesale.

---

## The hook

Every existing mission objective is either "keep doing a thing" (kill count, survive,
collect) or "stand in one place" (Hold the Zone, Extraction). Nothing in the catalog
today asks the player to **explore with a purpose** — to treat the arena as a puzzle
with pieces scattered across it, before the real fight even starts. Control Zone Code
Siege gives a mission a shape other than "number go up": scout for scattered relay
terminals while the ambient horde keeps pressing, decrypt each one under fire, and the
moment you crack the last fragment, the exit you've been circling this whole time
lights up **and the horde knows it too**. The back half is the payoff: a fixed-position
siege, omnidirectional, uncapped, uncompromising — the closest thing this game has to
a boss fight that isn't a boss.

Mechanically this is not a new invention so much as a *composition* of three things the
game already proves work: Search & Retrieve's channel interaction (the "research" beat),
HOLD_ZONE's pulsing-ring-and-dwell-timer (both the small zones and the big one), and
Extraction's "the real fight begins the moment the gate opens" phase transition (the
siege). What's new is the multi-stage structure gating one into the next, and an
omnidirectional spawn bias where Extraction's is directional — both addressed below.

---

## Core loop

1. **Scout** — from mission start, N control zones are live in the arena (not
   revealed progressively — see §5), plus one larger hold zone, visible but drawn in a
   dim, **locked** state (grey ring, no pulse, no dwell logic active). The ambient
   spawn director runs completely normally throughout — this phase is not a safe
   sandbox; the player is doing this *while* the horde is still doing its normal thing.
2. **Decrypt** — walking into a control zone's small radius auto-arms a channel,
   identical in shape to Search & Retrieve's cache interaction (§3): weapon silenced,
   radial progress fills, pause-not-reset on leaving, a flat progress penalty on taking
   a hit while channeling.
3. **Assemble** — once all N zones are decrypted (order-independent, no extra
   "combine" step — see §4), the hold zone marker flips instantly from locked-grey to
   armed-pulsing, a banner announces it, and the omnidirectional siege spawning begins
   **immediately** — not when the player arrives (see §5/§6). The horde starts closing
   in on the zone the second the code cracks, whether or not the player is standing
   there yet.
4. **Siege** — the player must reach the now-unlocked zone and hold it for a
   continuous window while spawn pressure is uncapped and converges from every
   direction. Leaving resets the dwell (not an instant fail); dying is a normal loss.
5. **Win** — dwell timer completes inside the zone → mission win, same payout path
   every other mission uses (`finishWin`, `Game.ts:1553`).

---

## 1. Name

**Mission type: "Override Protocol"** (in-catalog flavor name; e.g. "Override
Protocol: Substation 4"). Internal/technical name: **Control Zone Code Siege**,
`MissionConditionKind.CONTROL_ZONE_SIEGE` (§9.1 — locked as a condition kind, not a
`Mission.*?` field). Filename follows the existing convention of naming the doc after
the mechanic, not the flavor text (`extraction-mission-end.md`,
`search-and-retrieve-supply-caches.md`, `mono-weapon-mission-mode.md`).

---

## 2. Zone count & layout

**Control zones: 3 by default, tunable 2–4** (`condition.zoneCount`, §9.1).
Rationale for defaulting higher than Search & Retrieve's cache default of 2
(`SupplyCacheSystem.DEFAULT_COUNT`, `SupplyCacheSystem.ts:19`): caches are an optional
reward layer where 1–3 is deliberately kept small so a single bad placement doesn't
swing the whole run (`search-and-retrieve-supply-caches.md` §"Caches per mission"
locked decision); control zones are the **mandatory spine of the whole mission**, so 3
gives "multi-stage capture-the-fragments" enough stages to read as a sequence, not a
coin-flip. 2 is the accessible floor; 4 risks tipping into fetch-quest tedium given
each zone also costs a `decryptSeconds` channel (§3).

**Placement — scattered around the hold zone, not around the player.** This is a
deliberate deviation from both precedents' player-centric placement:

- `ExtractionSystem.placeZone` (`ExtractionSystem.ts:72-105`) picks the *single* zone
  at a fixed distance from the **player's current position** at trigger time (a
  post-hoc epilogue zone).
- `SupplyCacheSystem.placeCaches` (`SupplyCacheSystem.ts:60-106`) scatters *N* points
  in a distance band from the **player's start position** (`MIN_DIST_FROM_PLAYER=280`,
  `MAX_DIST_FROM_PLAYER=850`, `MIN_MUTUAL_SPACING=360`, `SupplyCacheSystem.ts:26-29`).

Here, place the **hold zone first** (reuse `placeZone`'s fixed-distance/random-angle/
clamped-to-bounds algorithm, anchored on the player's spawn point, distance ≈700–900px
— far enough that finding it isn't instant, close enough it's reachable), then scatter
the N control zones in a distance band **around the hold zone center** (generalizing
`placeCaches`'s band-and-mutual-spacing algorithm, just re-centered), e.g.
`MIN_DIST_FROM_HOLDZONE≈280`, `MAX_DIST_FROM_HOLDZONE≈700`, same `MIN_MUTUAL_SPACING`
idea between zones, plus a floor distance from the player's own spawn point so no zone
lands on top of them. The effect: as the player collects fragments, they are — without
being told to — converging geographically on the siege location. The exploration and
the approach march are the same walk.

---

## 3. The "research a code" interaction

**Recommendation: reuse `SupplyCacheSystem`'s channel mechanic near-verbatim,
re-skinned, not reinvented.** The task brief already flags this as the better fit than
a passive HOLD_ZONE dwell, and the precedent bears it out:

- Small trigger radius (default 48px, matches `SupplyCacheSystem.DEFAULT_RADIUS`,
  `SupplyCacheSystem.ts:20`), auto-arm on entry — zero new input, matching the
  "no interact button anywhere in this game" constraint the Search & Retrieve pitch
  already established as a hard requirement for touch parity
  (`search-and-retrieve-supply-caches.md` §"Mobile / touch feasibility").
- Timed channel, weapon silenced via the same `WeaponSystem.fire()` gate
  (`WeaponSystem.ts:71`) already wired for caches — OR the new system's "channeling"
  flag alongside `SupplyCacheSystem.isSearching()` into
  `weaponSystem.setFireSuppressed(...)` (`Game.ts:916`) rather than replacing it.
- **Pause-not-reset** on leaving (`SupplyCacheSystem.update`, `SupplyCacheSystem.ts:
  108-137`) and a flat **~25% progress penalty on taking a hit while channeling**
  (`handlePlayerHit`, `SupplyCacheSystem.ts:139-153`, `HIT_PENALTY = 0.25`) — both
  proven to keep "stand still and go weaponless" tense without being punishing.
- Player can still strafe within the radius during the channel (not a root) — same
  reasoning as caches: a full stun feels terrible against a horde that never stops.

**Recommended difference from caches: a slightly longer default, `decryptSeconds ≈ 5`**
(vs. caches' `DEFAULT_SEARCH_SECONDS = 3`, `SupplyCacheSystem.ts:21`). "Researching a
code fragment" should read as a meatier beat than "grabbing a duffel bag" — it's the
spine of the mission, not a side-reward. At 3–4 zones × 5s that's 15–20s of total
weapon-silent exposure spread across the run, comparable in aggregate to one Extraction
dwell, which is an acceptable trade given it's spread out rather than one lump sum.

**Visual differentiation from caches** (so a mission that somehow combined both — see
§8 — or a player's muscle memory wouldn't confuse them): a "terminal/relay" visual
distinct from the duffel-bag cache read, and a cyan/green "decrypting…" progress dial
rather than the cache's generic radial fill, reusing the same `Graphics`
pulsing-ring idiom (`MissionSystem.drawZoneMarker`, `MissionSystem.ts:74-95`) that both
this feature and caches already borrow from.

---

## 4. How fragments compose

**Order-independent. Visiting all N auto-unlocks — no additional "assemble" step, no
inventory UI.** This mirrors the same reasoning the Search & Retrieve pitch used to
reject a Tarkov-style grid interaction: it would be new UI chrome this codebase has
never needed, for a beat that reads exactly as clearly with "reach 3/3" and a banner.
The moment the Nth channel completes:

- Emit a new scene event (e.g. `control_zone_code_assembled`).
- The hold zone marker flips **instantly** from locked-grey to armed-pulsing (same
  `Graphics.clear()`/redraw idiom `MissionSystem.drawZoneMarker` already uses to swap
  color on inside/outside state, `MissionSystem.ts:74-95` — repurposed here for
  locked/unlocked instead of inside/outside).
- A brief banner ("CODE ASSEMBLED — override unlocked"), matching the existing
  `showExtractionBanner`-style toast pattern (`Game.ts:1516-1531`,
  `onSupplyCacheRetrieved`, `Game.ts:1534-1548`).
- **Uncapped omnidirectional spawning begins immediately** — not gated on the player
  reaching the zone. This mirrors `beginExtraction()` starting
  `enemySpawnSystem.beginExtractionSpawning(zone)` the instant the zone is armed, before
  the player has necessarily moved an inch toward it (`Game.ts:1495-1506`). The design
  intent: cracking the code should feel like tripping an alarm, not like calmly
  opening a door. If the player is far from the zone when the last fragment completes,
  the run to get there is itself a tense beat.

---

## 5. Reveal & unlock timing

**The hold zone is visible from mission start, in a distinct locked state — not
hidden until the code is assembled.** This is an explicit design call, not the default
assumption:

- This game has **no minimap** (`search-and-retrieve-supply-caches.md` §"Readability
  without a minimap"), and every existing spatial objective (HOLD_ZONE, Extraction)
  already depends on an off-screen directional pointer toward a *known* coordinate
  (`MissionSystem.ts §5.2`/off-screen arrow precedent, `extraction-mission-end.md`
  §2 "HUD direction pointer + countdown"). Hiding the hold zone until unlock would
  require inventing a wholly new "ping toward a not-yet-real target" affordance with
  no precedent anywhere in the codebase — real engineering cost for a "mystery" beat
  the brief didn't ask for.
- Showing it locked-but-visible from the start gives the player a spatial anchor
  ("that's where this is going") and lets them plan their scouting route relative to
  it, which is exactly what makes the "zones scattered around the hold zone" layout
  (§2) legible — the player can *see* they're converging.
- The locked state is drawn with the same `Graphics` ring primitive, just visually
  inert: dim grey, no pulse animation, no dwell math running, functionally identical
  to how a `HOLD_ZONE` marker exists but MissionSystem simply never accumulates
  `zoneTimer` for it (`MissionSystem.ts:237-251`) until the siege system says it's live.

**Alternative considered and rejected for v1:** a "dramatic reveal" where the hold zone
doesn't even exist/render until assembly — more cinematic, but doubles the
"where do I even go" cognitive load this mission already asks of the player (find N
zones *and* then find a zone you've never seen) and has no HUD-pointer precedent to
build on. Flagged as a possible "hard mode" variant later (§10), not a v1 default.

---

## 6. The hold-phase siege

**Duration:** default `holdSeconds ≈ 40`, tunable. Deliberately longer than Extraction's
`DEFAULT_DWELL = 3` (`ExtractionSystem.ts:34`) — Extraction's dwell is a "confirm you
made it" beat; this is meant to be the mission's climax fight, closer in spirit to a
`HOLD_ZONE` mission's `holdSeconds` (20–45 in the existing catalog, e.g.
`m_hold_zone`'s 30s, `Missions.ts:41`) but under far heavier spawn pressure.

**Continuous, not cumulative — leaving resets to zero, it does not instant-fail.**
`HoldZoneCondition.continuous` (`MissionTypes.ts:84`) already models exactly this
choice (`true` = reset-on-leave, `false` = cumulative/pause). Recommend `continuous:
true`-equivalent behavior here, which is a **deviation from Search & Retrieve's
"pause, not reset" channel philosophy** (§3) — deliberately, because the two mechanics
are doing different jobs: a control-zone channel is a *quiet, low-pressure* research
beat where punishing a single chip-damage hit would feel unfair
(`search-and-retrieve-supply-caches.md` §"pause, not reset"); the siege is the
mission's stated climax under uncapped omnidirectional pressure, where "you got pushed
off the point and have to fight back to it" is the entire dramatic shape of a siege.
Resetting (not cumulative-banking) means the player can't nibble at 40 seconds of hold
time across five separate trips — they have to actually win the fight for the zone.
**Not instant-fail**, though: leaving is not treated as a hard loss, because this
game's core loop is move-and-shoot, not turret-camping, and a single dodge-roll outside
the ring to avoid a Tank charge should not end the run. No existing zone mechanic in
this codebase treats "briefly stepping outside a ring" as an instant fail; inventing
that specifically for the hardest, most spawn-dense phase in the game would be a bad
first outing for that pattern.

**Spawn curve/intensity:** reuse Extraction's uncapped-batch-loop infrastructure
directly — a fixed-interval timer (`EXTRACT_SPAWN_DELAY = 250ms`,
`EnemySpawnSystem.ts:90`) spawning a fixed batch (`EXTRACT_BATCH = 8`,
`EnemySpawnSystem.ts:91`, ≈32 zombies/sec) that **bypasses `getScaledConfig()`
difficulty ceilings** entirely (`beginExtractionSpawning`, `EnemySpawnSystem.ts:
637-654`). Same call shape, new entry point — see spawn bias below for why it can't be
the *same* function. Optionally crescendo `EXTRACT_BATCH`-equivalent batch size over
the hold window (more zombies as the timer nears completion) — flagged as a follow-on
tuning idea, not committed for v1, mirroring how `extraction-mission-end.md` §4 flags
its own crescendo idea the same way ("Optionally tune").

**Spawn direction bias: omnidirectional/converging, a deliberate deviation from
Extraction's rear-bias.** Extraction's bias formula
(`weight(δ) = baseFloor + (1-baseFloor)·((1-cos δ)/2)^k`, `EnemySpawnSystem.ts:
684-721`) exists because Extraction has a *direction of travel* — an exit corridor —
and the design goal is "hardest behind you, safest lane ahead," rewarding forward
momentum toward a known escape point. A fixed-position siege has no such lane: the
player is meant to be static (holding one spot), so there is no "ahead" to keep safer
— an omnidirectional bias where every heading is (on average) equally dangerous is
the honest mechanical expression of "the horde floods in from all sides." Concretely,
propose a **new** `getConvergingSpawnPosition(zoneCenter)` on `EnemySpawnSystem`:
uniform random angle around `zoneCenter` (not the player, since the player is expected
to be near-stationary inside the zone and using the player as center would let them
drift the "safe" side by moving — anchoring on the fixed zone avoids that), projected
to the viewport edge via the existing `projectToViewportEdge` helper
(`EnemySpawnSystem.ts:727-740`, reused verbatim). To avoid pure RNG occasionally
clustering several consecutive batches on the same side (a real risk with naive
uniform sampling over only 8 rolls/batch), recommend **sector round-robin**: divide
360° into a fixed number of sectors (e.g. 8) and cycle each batch's spawns through
sectors in order with small per-spawn jitter, guaranteeing every side gets pressure
within a couple of batches rather than relying on chance. This is new logic, not a
reuse of Extraction's rejection-sampling bias formula — that formula's entire purpose
is *asymmetric* weighting, which is precisely what this mechanic should not have.

**Difficulty ceiling:** bypassed, same as Extraction — this is meant to be the single
most dangerous sustained window in the mission, and the existing uncapped
infrastructure already proves this doesn't need a soft cap unless FPS suffers
(`extraction-mission-end.md` §4).

---

## 7. Failure & edge cases

- **Player dies mid-siege:** normal `Player.die()` → `GameOver` lose path, no special
  casing beyond teardown — mirrors `ExtractionSystem.destroy()`'s responsibility to
  stop uncapped spawning and drop the marker so nothing leaks into `GameOver`
  (`ExtractionSystem.ts:194-201`). The new system needs the identical teardown
  discipline: stop the converging-spawn timer, destroy the hold-zone marker.
- **Player leaves the hold zone mid-siege:** dwell resets to 0 (§6) — not an instant
  fail. Documented above as a deliberate choice distinct from a hard-fail model.
- **Player never finds all control zones:** **no bespoke timeout invented for this
  feature.** The existing spawn director already scales density over run time and adds
  elite (90s cadence) / boss (5:00) pressure regardless of mission
  (`mission-system.md` §7), so a player who dawdles scouting faces an organically
  escalating threat without new failure code. If a specific job template wants hard
  time pressure on top of that, **compose with the existing `TIME_LIMIT` job modifier**
  (`JobModifierKind.TIME_LIMIT`, `JobBoardTypes.ts:121-124`, expiry = LOSE) rather than
  inventing a second, mission-local timeout mechanism that would duplicate it.

---

## 8. Interaction with existing mission modifiers

- **`extraction?` — mutually exclusive.** Both features are "a phase that begins after
  some condition, with a zone + uncapped spawning." Stacking them means two
  back-to-back uncapped-spawn finales in one run, which is excessive and structurally
  redundant (Control Zone Code Siege's hold phase already *is* this mission's
  Extraction-equivalent). Guard defensively at construction, mirroring the existing
  `supplyCache`+`extraction` guard (`Game.ts:343-346`, currently a `console.warn` +
  disable-one pattern) — extend that same guard to a three-way check.
- **`supplyCache?` — mutually exclusive for v1.** Both are "channel a thing, weapon
  silenced, near a radius" mechanics. Mechanically nothing stops them combining (the
  `WeaponSystem.setFireSuppressed` gate can OR multiple sources), but stacking two
  independent silence-your-weapon systems into one run doubles the exposed-standing-
  still beats and complicates HUD/beacon real estate (which beacon does the player
  chase — a cache or a control zone?) before either is independently tuned. Ship
  mutually exclusive, following the exact convention the Search & Retrieve pitch
  already locked for its own relationship with Extraction ("ship as mutually exclusive
  until both are tuned; revisit combining them later",
  `search-and-retrieve-supply-caches.md` §"Stacking with extraction?/monoWeapon?").
- **`fog?` — safe, and actively synergistic; recommend allowing from day one.** This
  is the strongest combo candidate in the catalog: light the hold zone itself with a
  `streetlight` `LightDef` at its coordinates (exactly the pattern `m_hold_zone`
  already uses — a streetlight literally at the zone center, `Missions.ts:55`) so it
  reads as a beacon in the dark; leave control zones in dim, unlit pockets so finding
  them costs the safety of the lit "spine," reprising Search & Retrieve's explicit
  design note that caches "in a dim pocket between streetlights is part of the tension"
  (`search-and-retrieve-supply-caches.md` §"Spot"). No mechanical conflict at all.
- **`monoWeapon?` — safe, recommend allowing from day one.** No mechanical conflict:
  channeling silences whatever single weapon is equipped regardless of loadout, and
  the siege phase is a normal combat window compatible with any specialist build.
  Mirrors Search & Retrieve's identical conclusion about `monoWeapon?`
  (`search-and-retrieve-supply-caches.md` §"Stacking" — "Mono-Weapon doesn't conflict
  mechanically... fine to combine").

---

## 9. Data-shape proposal

### 9.1 `MissionConditionKind.CONTROL_ZONE_SIEGE` (locked — see §9.2)

**Locked decision (2026-07-01): this ships as a 10th `MissionConditionKind`, evaluated
by `MissionSystem` itself, not a Mission-level opt-in flag.** `Mission.condition`
carries the whole shape directly — no separate `controlZoneSiege?` object alongside
it, unlike `extraction?`/`monoWeapon?`/`fog?`/`supplyCache?`:

```ts
// Conceptual shape, NOT an implementation. New variant of the MissionCondition union
// (MissionTypes.ts), alongside KILL_COUNT/SURVIVE_TIME/.../HOLD_ZONE.
{
  kind: MissionConditionKind.CONTROL_ZONE_SIEGE;
  zoneCount?: number;        // control zones to place; default 3, clamp 2-4
  zoneRadius?: number;       // per-zone channel trigger radius (px); default 48
  decryptSeconds?: number;   // per-zone channel duration; default 5
  holdZoneRadius?: number;   // final hold-zone radius (px); default 220
  holdSeconds?: number;      // continuous siege dwell required; default 40
}
```

### 9.2 Why a condition kind, not a flag (locked, resolves §10.1)

Unlike `extraction?`/`monoWeapon?`/`fog?`/`supplyCache?`, which all layer onto an
**independent** win condition (a `KILL_COUNT`/`SURVIVE_TIME`/etc. the player is
pursuing regardless), Control Zone Code Siege effectively **is** the win condition —
there's no natural "primary objective" running underneath it the way Extraction wraps
a genuine `KILL_COUNT` before its epilogue. The user confirmed this reasoning and
locked it as a proper `MissionConditionKind` rather than a bolt-on flag.

Concretely, this means:

- `MissionSystem` gains a new case in its condition switch (`MissionSystem.ts:99`,
  `:125`, `:223` — the "polled" bucket alongside `SURVIVE_TIME`/`HOLD_ZONE`, since it
  needs `playerX`/`playerY` every frame like `HOLD_ZONE` does, `MissionSystem.ts:219`).
  Given how much more state this condition carries than any existing case (N
  channelable control zones + a separate hold-zone marker + dwell + siege-spawn
  coupling, vs. HOLD_ZONE's single marker + timer), `MissionSystem` should construct
  and delegate to a dedicated internal helper (`ControlZoneSiegeState` or similar) for
  that bookkeeping rather than inlining it into the switch — but the important part is
  `MissionSystem` **owns** it and evaluates completion itself, the same as every other
  condition kind.
- Completion emits the **standard** `mission_complete` event through the **normal**
  `handleMissionComplete()` route — no bypass to `finishWin()` the way
  `extraction_complete` deliberately bypasses it (`Game.ts:1509-1510`). There's no
  primary-objective/epilogue split here, so there's nothing to bypass around; this is
  a genuine simplification over Extraction's model, not just a stylistic choice.
- **New architectural wrinkle worth flagging**: unlike existing polled conditions,
  the final siege phase needs uncapped spawning
  (`EnemySpawnSystem.beginExtractionSpawning`-style), which `MissionSystem` cannot
  drive today — only `Game`/`ExtractionSystem` currently hold a reference to
  `EnemySpawnSystem`. `MissionSystem` will need that reference injected (constructor
  param, mirroring how `ExtractionSystem` takes `spawnSystem?` today), which is a
  small but real precedent-setting change — flagged as new Open Question §10.9.
- Bonus side effect worth naming explicitly: because `JobTemplate.buildCondition()`
  already produces whatever `MissionCondition` a template declares via
  `conditionKind` (`JobTemplates.ts:27-29`), and `JobBoardSystem.instantiate()`
  already copies `condition` onto every instantiated `Mission` unconditionally
  (`const condition = tmpl.buildCondition(rng, tier)`, `JobBoardSystem.ts:259`), this
  choice **sidesteps entirely** the class of bug just found and fixed for
  `extraction?` (§9.3) — there is no separate opt-in field to forget to copy through.

### 9.3 No `JobTemplate` copy-through gap to repeat (moot, by construction)

For context, there was a **real bug** (found investigating why the player never saw
Extraction missions, fixed 2026-07-01): `JobTemplate` (`JobTemplates.ts:23-45`)
declared `monoWeapon?`/`supplyCache?` fields that `JobBoardSystem.instantiate()`
copied onto the generated `Mission`, but had no `extraction?` field at all — so no
procedurally-generated Job Board offer could ever carry `extraction.enabled = true`,
even though the Job Board is the main mission-launch path. That's now fixed
(`JobTemplates.ts` gained `extraction?: Mission['extraction']`, `instantiate()` copies
it, and `t_specialist_storm` was authored with `extraction: { enabled: true }` to
mirror `Missions.ts`'s `m_mono_tesla_horde`).

Per §9.2, this pitch's `CONTROL_ZONE_SIEGE` **cannot** repeat that bug shape: since it
rides on `condition`/`conditionKind`/`buildCondition` — the same generic plumbing
every other mission kind already uses — there is no extra field for a future
`instantiate()` to forget. An authored `JobTemplate` for this feature (e.g.
`t_override_protocol`) just needs:

```ts
conditionKind: MissionConditionKind.CONTROL_ZONE_SIEGE,
buildCondition: (rng, tier) => ({
  kind: MissionConditionKind.CONTROL_ZONE_SIEGE,
  zoneCount: 3,
  holdSeconds: 40, // + tier scaling, TBD
}),
```
— same shape as any other template, no special-case copy line in `JobBoardSystem.ts`.

---

## 10. Open questions

1. ~~`MissionConditionKind` #10 vs. Mission-level flag.~~ **RESOLVED (2026-07-01):
   `MissionConditionKind.CONTROL_ZONE_SIEGE`, evaluated inside `MissionSystem` itself —
   not a bolt-on flag.** See §9.2 for the locked rationale and its consequences
   (`MissionSystem` needs `EnemySpawnSystem` access, new Open Question §10.9).
2. **Zone count default (3) and per-zone duration (5s).** Both are reasoned-but-
   unplaytested numbers. Needs a pass to confirm 3×5s of aggregate weapon-silent
   exposure, spread across active horde pressure, is tense rather than tedious or
   trivial.
3. **Hold-zone reveal timing (§5).** Locked-but-visible-from-start is the recommended
   default; a hidden-until-assembled "hard mode" variant is explicitly deferred, not
   rejected outright — worth a decision on whether it's ever worth building given the
   HUD-pointer precedent gap it would require.
4. **Siege duration (40s) and spawn intensity (~32/sec, uncapped) together.** Is a
   40-second continuous hold survivable under omnidirectional uncapped pressure without
   trivializing it with a strong late-run build, or without being close to unwinnable
   early-run? Needs the same kind of playtesting pass `extraction-mission-end.md`
   flagged for its own dwell/spawn-rate combination.
5. **Sector round-robin vs. pure uniform-random for the converging spawn bias (§6).**
   Recommended for guaranteed omnidirectional coverage, but adds a new algorithm not
   proven anywhere else in the codebase (unlike the rejection-sampling formula, which
   is already shipped and tuned for Extraction). Worth confirming it's worth the extra
   complexity over just widening Extraction's existing formula to `k=0` (fully
   uniform, simpler, already-proven code path).
6. ~~Should `mission.condition` still matter at all for these missions?~~ **Moot as of
   the §9.2 decision** — `CONTROL_ZONE_SIEGE` *is* `mission.condition`, not a backstop
   alongside it.
7. **Crescendo spawn intensity during the hold** (batch size ramping as the dwell timer
   progresses) — flagged as a follow-on idea, not v1-committed, same as Extraction's
   own deferred crescendo idea. Confirm it stays out of v1 scope.
8. ~~Should `extraction?` get its missing `JobTemplate` field in the same change?~~
   **Done, independently, 2026-07-01** — `extraction?` was added to `JobTemplate` and
   copied in `instantiate()` ahead of this feature, not as part of it (§9.3).
9. **New from §9.2: `MissionSystem` needs `EnemySpawnSystem` access for the siege
   phase.** Today only `Game`/`ExtractionSystem` touch `EnemySpawnSystem` directly;
   this is the first polled `MissionSystem` condition that needs to drive spawning
   itself (to start/stop the uncapped converging spawn). Worth deciding whether
   `MissionSystem` takes a constructor reference to `EnemySpawnSystem` (precedent-
   setting for future conditions) or whether `Game` stays the sole driver and
   `MissionSystem` only exposes a `isSiegeArmed()`-style query that `Game.update()`
   polls to call `beginSiegeSpawning`/`endSiegeSpawning` itself (keeps `MissionSystem`
   spawn-agnostic, more consistent with its current role, more plumbing in `Game.ts`).

---

## Files

If this moves to implementation, the likely touch points (no code in this pitch):

- `src/game/types/MissionTypes.ts` — add `CONTROL_ZONE_SIEGE` to the
  `MissionConditionKind` enum and a new variant to the `MissionCondition` union
  (§9.1), alongside `KILL_COUNT`/`SURVIVE_TIME`/.../`HOLD_ZONE`. No new `Mission.*?`
  opt-in field (§9.2 — locked decision).
- `src/game/systems/MissionSystem.ts` — new case in the condition switch(es)
  (`:99`, `:125`, `:223`), in the polled bucket alongside `HOLD_ZONE`/`SURVIVE_TIME`
  (`:219`). Given the amount of state involved (N control zones + hold zone + siege
  coupling, §9.2), delegate to a dedicated internal helper for placement (hold zone
  via `ExtractionSystem.placeZone`-style algorithm, control zones via
  `SupplyCacheSystem.placeCaches`-style band-and-spacing re-centered on the hold
  zone, §2) and per-zone channel state (mirrors `SupplyCacheSystem`'s
  update/hit-penalty/pause-not-reset, §3) and the locked→armed marker flip (§4/§5) —
  but `MissionSystem` itself evaluates completion and emits the standard
  `mission_complete` (§9.2), no bypass to `finishWin()`.
- `src/game/systems/EnemySpawnSystem.ts` — new `beginSiegeSpawning(zoneCenter)` /
  `endSiegeSpawning()` (mirrors `beginExtractionSpawning`/`endExtractionSpawning`,
  `EnemySpawnSystem.ts:637-669`) and a new `getConvergingSpawnPosition(zoneCenter)`
  (sector round-robin, reusing `projectToViewportEdge`, `EnemySpawnSystem.ts:727-740`,
  but NOT reusing the directional bias formula, §6).
- `src/game/systems/WeaponSystem.ts` — OR the new logic's channeling flag into the
  existing `setFireSuppressed` gate (`Game.ts:916`) alongside `SupplyCacheSystem`'s.
- `src/game/scenes/Game.ts` — depends on Open Question §10.9 (whether `MissionSystem`
  takes an `EnemySpawnSystem` reference directly, or `Game.update()` polls a
  `MissionSystem` query and drives `beginSiegeSpawning`/`endSiegeSpawning` itself);
  either way, extend the mutual-exclusivity guard (`Game.ts:343-346`) to cover
  `CONTROL_ZONE_SIEGE` alongside `extraction?`/`supplyCache?` (§8); no direct
  `finishWin()` wiring needed since completion routes through the normal
  `handleMissionComplete()` path (§9.2), unlike `extraction_complete`
  (`Game.ts:1509-1510`).
- `src/game/config/Missions.ts` — at least one authored catalog entry demonstrating
  the feature (mirrors `m_hold_zone`'s `condition`-driven style, `Missions.ts:32-61`),
  likely combined with `fog?`/`lights` per the recommended synergy (§8).
- `src/game/config/JobTemplates.ts` — at least one template (e.g.
  `t_override_protocol`) with `conditionKind: MissionConditionKind.CONTROL_ZONE_SIEGE`
  and a matching `buildCondition` (§9.3) — same shape as any other template, no new
  `JobTemplate` field and no `JobBoardSystem.instantiate()` change required, since
  `condition` is already copied through generically (§9.2's sidestepped-bug-class
  point).
- `src/game/types/JobBoardTypes.ts` — no structural change required; the existing
  `TIME_LIMIT` modifier (`JobBoardTypes.ts:121-124`) is reused as-is for optional time
  pressure (§7) rather than inventing a mission-local timeout.
