# Fog of War — Feature Design Doc / Pitch

Status: Draft / design pitch (no code yet)
Author: Game design + technical design
Target: `zombie-survivors-2` (Phaser 3.88 + React + Vite + TypeScript)

> Companion to `extraction-mission-end.md` and `outer-loop-overview.md`. Like those
> specs, Fog of War sits *around* the existing run code and reuses proven seams —
> the camera-follow render loop, the world-space `Graphics` marker pattern
> (`MissionSystem`/`ExtractionSystem`), and the already-shipped vision vocabulary
> (`SupplyId.SCANNER`, `RiskModifierId.VEIL`, `RunModifierSink.setVision`).

---

## 0. Grounding: what this game actually is

Before pitching, the facts the design has to respect (all verified in code):

- **Genre:** a Vampire-Survivors-style auto-attacker. The player **only moves**
  (`Player.update` → `readMovementDirection`, WASD/arrows/virtual joystick);
  weapons fire automatically (`WeaponSystem.update()` in `Game.update()`,
  `Game.ts:743`). The fun is positioning relative to a swarm, not aiming.
- **The map is one flat image, not a tilemap.** The world is a fixed
  **2048×1536** rectangle (`GameConfig.WORLD`, `GameConfig.ts:3-6`) with a single
  `background` sprite stretched to fill it at depth `-1`
  (`Game.ts:151-159`). There is **no tilemap, no chunk system, no procedural
  in-level geometry, and no occluders.** "Terrain" today is purely cosmetic.
- **Camera:** `cameras.main.startFollow(player)` + `setBounds(0,0,W,H)`
  (`Game.ts:182-183`). Default zoom `1`. Zoom is already *repurposed as vision*:
  `setVision(m) => cameras.main.setZoom(1 / max(0.25, m))` (`Game.ts:973-977`).
- **Enemies already emerge from just off-screen.** `EnemySpawnSystem` spawns at
  the edges of `cam.worldView` (`getRandomSpawnPositionOnSide` `:549-562`,
  `projectToViewportEdge` `:667-680`). Because the camera follows the player,
  "off-screen edge" ≈ "ring around the player." This is the single most important
  fact for fog: **the threat model is already radial and already partly hidden.**
- **No minimap exists.** The HUD (`GameUI`) draws health/XP/level/timer, a skill
  cooldown arc, a killstreak chip, and the objective tracker — nothing spatial.
- **World-space objective markers already exist** as a reusable pattern: a pulsing
  `scene.add.graphics()` ring at depth `-0.5`, redrawn each frame
  (`MissionSystem.drawZoneMarker` `:74-95`, `ExtractionSystem.drawZoneMarker`
  `:148-165`). HOLD_ZONE and Extraction both drop an objective **~600px away,
  off-screen**, and expect the player to navigate to it.
- **Depth bands (Game scene):** world gameplay/VFX live at depth ≤ ~102
  (background `-1`, zone rings `-0.5`, entities ~`0`, explosions `-1`/`0`); the HUD
  band is `999–1001`; mission/elite/boss intro overlays are `2002`; touch controls
  `9999/10000`. A fog layer slots cleanly in the gap **above gameplay, below HUD.**
- **The meta layer already speaks "fog."** City Reclamation literally renders a
  "fog of war feel" — a black alpha overlay whose opacity scales with infestation
  (`CityReclamation.ts:119-126`). `SupplyId.SCANNER` ("+25% vision",
  `Expedition.ts:61-65`) and `RiskModifierId.VEIL` ("Reduced vision (fog)",
  `Expedition.ts:146-151`) exist but are crude camera-zoom stand-ins today. Fog of
  War is the real mechanic those names have been waiting for.

**Implication:** this is *not* a top-down explorer like a roguelike dungeon. There
is no maze to reveal. So Fog of War here is **not** "uncover the dungeon" — it's
**"the arena is dark; your senses are a bubble; the swarm and the objective are out
there in the black."** That reframing is what makes the rest of this doc fair.

---

## 1. One-line pitch & player fantasy

**Pitch:** *Drop the lights. Each expedition now plays inside a shroud — you see a
bubble of light around your survivor, the rest of the ruined city is darkness, and
you have to push into the black to find the objective, the loot, and whatever is
breathing out there.*

**Player fantasy (specific to this game):** you are the human remnant's point
scout pushing through a blacked-out, infested city block. The Vampire-Survivors
power fantasy is "I am a moving wall of death" — Fog of War adds the missing
counter-feeling: **dread and discovery.** You still mulch the horde, but now every
push forward is a small gamble: that pickup glinting at the edge of your light, the
extraction beacon pulsing through the murk, the *shape* that just crossed your
vision boundary. It turns the existing aimless "wander the 2048×1536 box" into
**directed exploration with stakes**, and it gives the outer-loop currencies
(SCANNER supplies, the VEIL risk modifier, a future "scanned map" upgrade) a real
mechanic to modify.

It is also the cheapest possible way to make the *same* arena feel like a new
biome every mission: darkness is a content multiplier.

---

## 2. Design goals & anti-goals

### Goals
1. **Add exploration tension to a game that currently has none.** The map is a flat
   box you wander; fog gives "out there" a meaning and a pull (objective + loot in
   the dark).
2. **Reuse, don't rebuild.** Hook the existing camera-follow loop, the
   `Graphics`-marker pattern, the `setVision` sink, and localStorage meta-state. No
   new asset pipeline (fog is procedural — consistent with ART_STYLE.md's
   "prefer code-driven tweens/particles over frame sequences").
3. **Be a *modifier*, not a global mode.** Fog should be a per-mission / per-biome /
   per-risk-modifier property, off by default, so the base game is unchanged (same
   philosophy as `Mission.extraction?: { enabled }`).
4. **Give the dark a sense of direction.** Shipping fog is the excuse to add the
   spatial orientation this game lacks — primarily a thumb-friendly objective
   *beacon* (§5.2), with an optional tap-to-expand map (§5.3) as the explorer's
   reward — so darkness never means "lost."

### Anti-goals
1. **Do NOT blind the firefight.** This is an auto-battler; the player must always
   see the enemies they are actively fighting. The reveal radius is **generous —
   larger than any contact-damage range** — so fog hides the *map*, never your
   *combat bubble*. (See §4.)
2. **Do NOT hide threats unfairly.** Enemies crossing into your light must be
   readable *before* they can hurt you; threats at the boundary get telegraphed
   (silhouettes + audio). No "instakill out of the black."
3. **Do NOT make it tedious.** No re-fogging of fully-explored areas into pure
   black on a short timer; no pixel-hunting. Explored = permanently dimmed, not
   re-hidden (per-run). The objective always has a fog-piercing beacon so the
   player is never lost.
4. **Do NOT tank performance.** Extraction already spawns ~32 zombies/sec uncapped
   (`extraction-mission-end.md §4`); fog must be O(1)-ish per frame, not a
   per-enemy or per-pixel cost. (See §6.)
5. **No new input.** Movement-only stays movement-only. Any "scan/ping" is an
   *optional* layer on the existing Shift defensive-skill slot, not a new button.

---

## 3. Core mechanic

> **See also:** `fog-of-war-light-sources.md` — a companion spec that builds on this
> reveal model with placeable **light sources** (streetlights, trashcan fires, a
> flashlight cone, and a carryable light) that carve their own pockets in the shroud.
> Those lights are additional *reveal contributors* feeding the same grid/RT described
> in §6.2, and they are the safe islands during a Blackout wave (§4.5).

### 3.1 Three visibility states (classic fog, adapted)
Per **reveal cell** (a coarse world grid, see §6):

| State | Meaning | Render |
| --- | --- | --- |
| **Hidden** | never entered your senses | opaque shroud (dark, ~0.92 alpha — *not* pure black) |
| **Explored** | seen before, not currently lit | dimmed shroud (~0.55 alpha) — terrain visible, dynamic entities hidden |
| **Visible** | inside the reveal radius right now | clear |

Explored stays explored for the rest of the run (no re-fogging) — anti-goal #3.
Pickups and objectives you've discovered persist as "explored" (and show on the
optional map overlay when opened, §5.3); live *enemies* are only shown while
**Visible** (you don't get to track the horde through walls of dark).

### 3.2 Reveal shape: radius, not line-of-sight (for MVP/v1)
Because there are **no occluders in the world** (flat background), **line-of-sight
buys nothing** for MVP/v1 — a soft radial reveal is the correct, cheap model and
reads perfectly with a camera that's centered on the player. Reveal = a soft-edged
circle of radius `R_reveal` centered on the player, world-space.

- `R_reveal` default ≈ **420px** (tunable). Rationale: the camera viewport half-
  height at 1024×768 is 384px, so the player can always see roughly their full
  vertical screen but **not across the 2048×1536 arena** (which is ~2–4 viewports
  wide). This is the sweet spot: full combat bubble, hidden map.
- **Soft edge** (inner fully-clear radius ≈ `0.7·R`, feathering to shroud at `R`)
  so the boundary is a gradient, not a hard circle — this is where silhouettes live
  (§4.3) and it looks like a lantern, not a stencil.

Line-of-sight occluders are a **stretch** (§7) and only become meaningful if/when
the world gains real geometry (walls/cover).

### 3.3 What gets hidden
- **Terrain / background:** shrouded for atmosphere only (no gameplay info lost —
  it's a flat image). This is the "mood" win, essentially free.
- **Enemies:** hidden in shroud, **telegraphed at the boundary** (§4.3). This is
  the load-bearing fairness decision.
- **Pickups** (`Pickup`, `BlueprintDrop`): hidden in shroud → creates "is that loot
  worth the detour into the dark?" greed tension. Once discovered (entered your
  light) their discovered marker persists even if you leave (and on the optional map
  overlay, §5.3).
- **Objective zones** (HOLD_ZONE, Extraction): the *world ring* is shrouded until
  approached, but a **fog-piercing directional beacon** always points to it (§5.3)
  so the player has a goal, never a scavenger hunt.
- **Elites / Boss:** their existing camera intros (`elite_spawned`,
  `boss_spawned`, `Game.ts:472-614`) pan to and frame them — fog should **clear
  around the intro target** during the cinematic so the reveal still works. (They
  announce themselves; that's fair.)

---

## 4. Fit with the core loop & the auto-battler fairness problem

This is the crux and deserves to be addressed head-on: **VS-likes usually want you
to see the swarm coming.** Fog fights that. Here's how we keep it fair and *fun*
rather than frustrating, leaning on systems that already exist.

### 4.1 Fog hides the MAP, never the FIGHT
`R_reveal` (≈420px) is deliberately bigger than:
- contact-damage range (enemies damage on `collider` overlap, `Game.ts:401-412`),
- ranged-enemy engagement (RANGED/Shrieker act within their own short bands).

So anything that can actually *touch* you this second is inside your light. Fog
only removes your ability to see **across the whole arena** — which today gives you
free oversight of spawns 1000+px away. You lose *strategic* foresight, not
*tactical* survival.

### 4.2 Spawns already come from the edge — let them emerge from the fog
`EnemySpawnSystem` spawns at `cam.worldView` edges (off-screen). With fog, the
boundary they cross is now *visible darkness* instead of *screen edge*. **Keep the
existing spawn positions** — zombies walking out of the shroud into your light is
exactly the desired horror-survivors feel, and requires **zero spawn-system
changes** for MVP. (The extraction rear-bias sampler, `getBiasedSpawnPosition`
`:630-661`, is untouched and still works.)

### 4.3 Telegraph threats at the fog boundary (the fairness layer)
Two cheap, high-impact cues so nothing is a cheap shot:
- **Edge silhouettes:** for any active enemy within a thin band just outside
  `R_reveal` (e.g. `R` to `R+90`), draw a dim, desaturated blob/outline at the fog
  boundary — a "shape in the dark" — rather than fully hiding it. Cheap (only
  enemies near the player qualify; the rest are far off-screen anyway). This is the
  marquee feel moment.
- **Audio/visual horde tells:** the **Shrieker** (`ShriekerEnemy`) becomes a
  natural fog instrument — its rally aura/announcement is a *fog-piercing* "the
  horde is massing nearby" cue. The existing `spawn_state_changed` banners ("HORDE
  SPOTTED!!", `EnemySpawnSystem.defaultDisplayConfigs`) are diegetic warnings that
  a PEAK wave is incoming even when you can't see it yet.

### 4.4 Fog is opt-in and tunable per run — it plugs into the outer loop
- **`Mission.fog?: { enabled: boolean; revealRadius?: number; mode?: FogMode }`** —
  mirrors the proven `Mission.extraction?` opt-in (`MissionTypes.ts:118`). Missions
  without it are 100% unchanged (anti-goal: don't disturb the base game).
- **`RiskModifierId.VEIL`** stops being a fake "zoom in" and becomes "this run is
  fogged (smaller reveal) for +reward" — finally honest to its name
  (`Expedition.ts:146-151`).
- **`SupplyId.SCANNER`** stops being a fake "zoom out" and becomes "+25% reveal
  radius / periodic auto-ping" (`Expedition.ts:61-65`). Both already route through
  `RunModifierSink` (`ExpeditionTypes.ts:166`) — we add `setFog`/`setRevealRadius`
  alongside the existing `setVision`.
- **New mission archetype (content, not engine):** a **Recon / Search** mission =
  fog ON + a HOLD_ZONE or COLLECT_DROPS objective placed far across the map. The
  win condition literally *is* "explore to find it." Reuses MissionSystem wholesale.

### 4.5 Blackout wave modifier — "the lights are dying"
A wave-driven event that makes the world *darker for a stretch*: it shrinks the
player's reveal radius **and every light-source radius** (§ companion doc) together,
then restores them. This turns the existing wave cadence into a fog dial — a PEAK
wave can now also be a *blackout*, so the horde arrives exactly when you can see
least. It's the single highest-drama use of fog and it's cheap, because the wave
machinery already exists.

**Hook (real code).** `EnemySpawnSystem` already drives discrete wave states
(`SpawnState`: `NORMAL`/`PEAK`/`COOLDOWN`/`RANGED_PACK`/…) and **broadcasts every
transition**: `switchState()` (`EnemySpawnSystem.ts:291-312`) and the public
`forceState()` (`:315`) both `emit('spawn_state_changed', { state, displayConfig,
formattedText })` (`:305`). `FogSystem` just **listens** for that event — no spawn
logic changes.

**Mechanic.** `FogSystem` keeps a single `darknessMult` (default `1`). On entering a
blackout-flagged state it **tweens `darknessMult` down** (e.g. to `0.55`) over
~0.5s; on leaving, tweens back to `1`. Because every reveal contributor — the player
blob *and* each light source — multiplies its radius by `darknessMult`, the whole
lit world contracts uniformly from one variable. The wave's own `duration`
(`SpawnStateConfig.duration`, `getScaledConfig` `:267`) sets how long the dark lasts.

**Two ways to wire it (pick per scope):**
- **v1 — overlay on an existing state.** Flag chosen states (e.g. `PEAK`) as "dark"
  in `Mission.fog`; when `spawn_state_changed` reports one, apply the dim. Zero new
  spawn states; reuses the existing "HORDE SPOTTED" banner as the tell.
- **Stretch — a first-class `BLACKOUT` wave.** Add a `SpawnState.BLACKOUT` to
  `stateConfigs` (`EnemySpawnSystem.ts:130-181`) with its own banner ("⚡ POWER OUT")
  and a denser/faster spawn profile, so the scheduler can roll a genuine
  darkness-plus-swarm beat, or `forceState(BLACKOUT)` can script it at a story moment.

**Fairness (respects anti-goals §2).** The dim is **telegraphed** — it rides the
existing wave banner (`spawn_state_changed.displayConfig`) plus a brief screen-edge
vignette pulse and an audio cue, so it never just "goes dark." And the shrunk radius
is **clamped to never drop below contact-damage range** (§4.1) — a blackout hides
*more map*, never the enemy currently swinging at you. Crucially, **light sources do
not dim to zero**: a streetlight or a dropped flare you found earlier becomes a
literal sanctuary during a blackout (companion doc §4) — the mechanic rewards the
player who lit the map.

**Tunable / fits the loop.** Blackout depth + frequency are `Mission.fog` fields, and
`RiskModifierId.VEIL` (§4.4) can naturally mean "blackouts are deeper / more often"
for a reward bump. `SupplyId.SCANNER` softens them.

---

## 5. Game feel & UX

### 5.1 Visual style (consistent with ART_STYLE.md)
- **Procedural, not an asset.** Fog is a generated radial-gradient texture / render
  target, not a PNG — matches ART_STYLE's "prefer code-driven effects" and avoids a
  manifest entry. The shroud is a **dark desaturated navy/charcoal** (e.g.
  `#0a0d14`), **not pure black**, at <1 alpha, so silhouettes and the dimmed
  background still read (ART_STYLE: "contrast vs background," "gameplay readability
  wins").
- **Lantern, not stencil:** soft feathered edge, a faint warm inner falloff so the
  lit bubble feels like a light source the cyberpunk scout is carrying. A subtle
  slow "breathe" on the radius (±a few px, sine — same trick as the zone-ring pulse)
  keeps it alive without distraction.
- **Reveal animation:** when fog first lifts off a cell (first time it becomes
  Visible) tween that cell's shroud alpha down over ~150ms so the dark *peels back*
  as you move, rather than popping.

### 5.2 "Where do I go?" — a mobile-first directional beacon (primary)
The arena is dark, so the player needs a heading — but a corner minimap fights this
game's mobile HUD (see §5.3). The lean, thumb-readable default is a **screen-edge
directional objective beacon**: an arrow pinned to the HUD edge pointing from the
player toward the active spatial objective, bleeding through the shroud.
- **It points at real data.** The zone center is already exposed:
  `MissionSystem.getZoneTarget()`/`getZoneRadius()` (`MissionSystem.ts:340-352`) and
  `ExtractionSystem.getZone()` (`ExtractionSystem.ts:186-188`). Compute the angle
  player→zone, clamp the arrow to the viewport edge, show distance ("320m"). When
  the zone enters the reveal bubble the arrow fades out (you can see it now).
- **Degrades gracefully.** Missions with no spatial objective (KILL_COUNT,
  SURVIVE_TIME, KILL_TYPE…) simply hide the beacon — `getZoneTarget()` already
  returns `null` for those. Extraction missions get a beacon the instant
  `beginExtraction` arms the zone (`Game.ts:1223`).
- **Cheap & HUD-correct, identical on phone and desktop:** one `scrollFactor(0)`
  arrow + label in `GameUI`, drawn in the HUD depth band, repositioned each frame
  from a single angle calc. No grid, no render target, no corner real estate.
- Objective banners (`showMissionBanner`/`showExtractionBanner`, `Game.ts:1413,
  1244`) already say *what* to do; the beacon says *which way*.

### 5.3 Minimap — OPTIONAL, tap-to-expand on mobile (demoted to stretch)
A full reveal-grid minimap reads well on desktop but is a poor fit for this game's
mobile HUD, so it is **not** the default:
- **The corners are already taken on mobile.** Top-left is the stat stack
  (health/XP/level/timer/skill-arc/killstreak/objective, all `scrollFactor(0)`,
  `GameUI.initialize()` `GameUI.ts:24-90`); top-right is the pause button
  (`Game.ts:380-398`); bottom-right is the mobile **Skill** button
  (`Game.ts:674-690`). An always-on corner minimap collides with all three.
- **Touch input can originate anywhere.** The control is a *floating* virtual
  joystick — `pointerdown` drops the indicator wherever the thumb lands and a center
  dot tracks the drag (`Game.ts:328-377`, `updateCenterDot` `:1794-1815`). A corner
  widget would sit under the thumb / drag arc and swallow touches.
- **Phone DPI readability.** With `Scale.RESIZE` down to a 320×240 floor
  (`main.ts:55-69`), a corner map small enough not to crowd the screen is too small
  to read the reveal grid at phone DPI.
- **Recommendation:** ship the **beacon** (§5.2) as the spatial UI. If a full map is
  wanted, make it a **tap-to-expand fullscreen overlay** (dedicated map button or a
  two-finger tap that pauses and shows the whole reveal grid filling in), not an
  always-on corner widget — zero HUD real estate during combat. **Stretch** (§7),
  built on the same reveal grid that feeds the fog RT (§6.2). When shown, gate live
  enemy dots to the current Visible radius so the map can't defeat the fog.

### 5.4 Onboarding
First fogged mission shows a one-line tip ("It's dark out here — push forward to
find the objective; watch the edges of your light"). Reuse the banner pattern.

---

## 6. Technical implementation sketch (grounded in the real code)

### 6.1 Where it lives
New self-contained system **`src/game/systems/FogSystem.ts`**, owned by `Game`,
constructed in `create()` only when the active mission/plan enables fog. It mirrors
the lifecycle of `MissionSystem`/`ExtractionSystem`: constructed in `create()`,
driven from `update()`, torn down in `shutdownScene()` (add to the existing
`extractionSystem?.destroy()` / `missionSystem?.destroy()` block, `Game.ts:1837-1841`).
A `FOG_DEPTH` constant (recommend **`500`** — clearly above all world gameplay/VFX
at depth ≤ ~102, clearly below the HUD band `999+` and intro overlays `2002`) goes
in `GameConfig.ts` or `GameConstants.ts` per AGENTS.md (constants over literals).

### 6.2 Recommended rendering approach

**MVP — screen-anchored soft-vignette reveal (cheapest correct thing):**
- Generate **once** a radial-gradient "spotlight" texture (dark shroud square with a
  soft transparent hole) via `scene.make.graphics()` + `generateTexture()` — the
  same generate-texture trick already used for the touch indicator
  (`Game.ts:335-341`).
- Add it as one `Image` at `FOG_DEPTH`, **sized to cover the viewport**. Each frame,
  set its position to the **player's screen position**: `cam.getWorldPoint` inverse,
  i.e. `screenX = (player.x - cam.worldView.x) * cam.zoom`, so it stays centered on
  the player **even when the camera clamps at world bounds** (player drifts
  off-center near edges — a naive `scrollFactor(0)` vignette pinned to screen-center
  would reveal the wrong spot; this fixes that). One sprite, one position write per
  frame. ~Free.
- This MVP is **pure active-vision fog** (you only ever see your bubble; no
  persistent "explored" memory, no minimap). It already delivers the dread/feel and
  is shippable on its own.

**v1 — persistent reveal grid + world-space render target (the real feature):**
- A coarse grid over the world: **64px cells → 32×24 = 768 cells** for 2048×1536.
  Store a `Uint8Array` of states (HIDDEN/EXPLORED/VISIBLE). Tiny.
- Each frame: clear last frame's VISIBLE flags, then mark cells within `R_reveal` of
  the player VISIBLE + EXPLORED (a few-dozen-cell stamp around the player, not a
  full-grid scan).
- Render fog into a **world-space `RenderTexture`** (size = world, or a tiled/
  scaled-down RT) at `FOG_DEPTH`: paint HIDDEN cells full shroud, EXPLORED dim,
  VISIBLE clear, with the soft brush stamped at the player for the feathered edge.
  Only redraw cells whose state changed this frame (the moving bubble's rim) — the
  interior is static. This is the standard cheap fog render and stays O(rim), not
  O(grid) or O(pixels).
- The same grid feeds the optional tap-to-expand map (§5.3) and "discovered pickup"
  persistence — one source of truth.

**Not recommended:** `Light2D` pipeline / geometry-mask-per-frame. Light2D needs
normal maps and a pipeline switch (heavy, and pointless with a flat background);
rebuilding a geometry mask every frame is more expensive than a grid stamp. Revisit
masks only for the LOS stretch goal (§7).

### 6.3 Hooks into existing systems (named, concrete)
- **Camera:** read `cameras.main.worldView` / `.zoom` (already the spawn system's
  source of truth, `EnemySpawnSystem:551`) to place the vignette / compute the
  visible band. No camera behavior change.
- **Player position:** `Game.getPlayer()` (`:880`) — fog re-centers on it each
  `update()`, after the existing `player.update(...)` call (`Game.ts:740`).
- **Vision sink:** extend `RunModifierSink` (`ExpeditionTypes.ts:153-167`) with
  `setFog(enabled)` / `setRevealRadius(mult)` next to `setVision`; wire them in
  `makeRunModifierSink()` (`Game.ts:955-978`). Repoint `SCANNER` (`Expedition.ts:65`)
  and `VEIL` (`Expedition.ts:151`) at the new hooks.
- **Mission opt-in:** add `Mission.fog?` to `MissionTypes.ts` (mirror
  `Mission.extraction?`, `:118`); branch in `create()` where the mission is resolved
  (`Game.ts:252-269`).
- **Objective beacon:** consume `MissionSystem.getZoneTarget()` / `getZoneRadius()`
  (`:340-352`) and `ExtractionSystem.getZone()` (`:186`) — already public.
- **Elite/boss intros:** in the `elite_spawned`/`elites_group_spawned`/`boss_spawned`
  handlers (`Game.ts:472-614`) tell `FogSystem` to temporarily reveal around the pan
  target so the cinematic isn't staring at shroud. Clear on resume.
- **Enemy edge-silhouettes:** iterate the existing `this.enemies.getChildren()` (the
  update loop already does this, `Game.ts:753`) and flag those in the boundary band;
  draw their silhouettes into the fog RT. No new data structures.
- **Blackout wave modifier (§4.5):** `FogSystem` subscribes to the existing
  `spawn_state_changed` event (emitted by `EnemySpawnSystem.switchState`/`forceState`,
  `:305`) and tweens a global `darknessMult` that scales the player blob and every
  light radius. Read-only on the spawn system — no spawn-logic change.
- **Resize:** the game is `Scale.RESIZE` and `main.ts` already re-resizes on window
  resize (`main.ts:81-86`). The MVP vignette `Image` and any screen-space layers
  must subscribe to `scene.scale.on('resize', …)` and re-fit. (The world-space RT
  grid is resolution-independent and needs nothing.)

### 6.4 Performance budget
- MVP: 1 sprite + 1 position write/frame. Negligible.
- v1: 768-cell `Uint8Array`; per-frame work = stamp a ~13×13-cell disc around the
  player + redraw only changed rim cells into the RT. Independent of enemy count —
  safe even during the uncapped extraction swarm. Silhouette pass is bounded by
  "enemies near the player," which is already a small set.
- Mobile: keep cell size coarse (64px) and the shroud a flat alpha (no per-pixel
  blur). Generate the soft brush texture once.

### 6.5 Persistence
In-run fog is **ephemeral** (no save needed). A *stretch* "scanned territory" meta-
upgrade would persist discovered cells per zone via the established localStorage
pattern (`BlueprintSystem`, `CityReclamationSystem` `STORAGE_REVEALED`
`:30`) — a known, low-risk seam if we want it.

---

## 7. Scope tiers & effort

| Tier | Scope | Effort (1 eng) |
| --- | --- | --- |
| **MVP** | `FogSystem` + screen-anchored soft-vignette reveal (player-centered, edge-correct). Pure active-vision (no persistence, no minimap). `Mission.fog?` opt-in on 1–2 missions. Generous `R_reveal`. Repoint `VEIL`→real fog. Reveal-on-elite/boss-intro. | **~2–3 days** |
| **v1** | Persistent reveal grid (3-state) + world-space fog RT with soft peel-back animation. **Objective beacon** pointer (§5.2). **Edge-of-fog enemy silhouettes.** **Blackout wave modifier** (§4.5, overlay-on-PEAK form) — radii shrink on dark waves. `SupplyId.SCANNER`→+reveal/ping. Discovered-pickup persistence. The new **Recon/Search** mission archetype (content). | **~1.5–2.5 weeks** |
| **Stretch** | (a) **SCANNER ping** as an optional layer on the Shift skill slot (`SkillSystem`) — flash-reveal a wide radius on cooldown. (b) **Line-of-sight occluders** *if* the world gains wall/cover geometry. (c) **Persistent "scanned map"** meta-upgrade via localStorage. (d) Fog as a **biome/city property** in City Reclamation so darker zones read as scarier on the macro map. (e) **Tap-to-expand fullscreen map** overlay (§5.3) built on the reveal grid. (f) A first-class **`BLACKOUT` spawn state** (§4.5) — total-darkness-plus-swarm climax where only light sources remain. | **~1–3 weeks, pick-and-choose** |

A clean kill-switch at every tier: `Mission.fog?.enabled === false` (default) ⇒
zero behavior change, exactly like `extraction`.

---

## 8. Risks & open questions

**Risks**
- **Auto-battler fairness (highest).** If `R_reveal` is too small or silhouettes are
  weak, fog reads as "cheap deaths," not "tension." Mitigation: generous radius
  (§4.1), boundary silhouettes (§4.3), playtest the radius hard. **Ship MVP behind a
  per-mission flag specifically so we can A/B the radius before going wide.**
- **Readability vs ART_STYLE.** Shroud must stay desaturated-dark-but-not-black or
  the neon enemy accents and pickups vanish (ART_STYLE: gameplay readability wins).
- **Mobile perf / small screens.** A 320×240-min viewport with fog could feel
  claustrophobic; reveal radius may need to scale with viewport, not be absolute px.
- **Map overlay defeating fog.** If the optional tap-to-expand map (§5.3) showed the
  whole horde it would undo the mechanic — gate live enemies to the Visible radius.
- **Intro cinematics over shroud.** Elite/boss/extraction pans must punch a hole or
  they frame darkness (handled in §6.3, but it's wiring to get right).

**Open questions**
1. Is `R_reveal` **absolute px** or **a fraction of viewport** (better for the
   RESIZE/mobile range)? Leaning fraction-of-min-dimension.
2. Should `VEIL` reduce reveal radius, raise re-fog, *or* enable LOS? (Pick one for
   honesty; recommend radius for v1.)
3. Do discovered **pickups** persist on the map overlay (§5.3), or only while
   Visible? (Greed tension says persist; purity says Visible-only.)
4. Does the **Shrieker** get an explicit fog interaction (e.g. a faint aura ring
   visible through shroud), making it a deliberate "fog radar" enemy?
5. Should fog ever **re-grow** (explored→hidden after long absence) for a harder
   biome, or is that just the "power-outage" stretch event?

---

## 9. Playtest plan & success metrics

**Playtest probes**
- Sweep `R_reveal` (e.g. 320 / 420 / 520px) on a fogged HOLD_ZONE mission; find the
  radius where players report "tense, not cheap."
- Toggle edge silhouettes on/off — measure deaths-from-unseen-enemies and
  self-reported frustration.
- Does the objective beacon keep players oriented (time-to-find-objective should not
  balloon vs the non-fog baseline)?

**Success metrics**
- **Engagement:** completion rate of fogged vs non-fogged missions within ~5–10pp
  (fog adds spice, not a difficulty wall).
- **Fairness:** share of deaths attributable to "enemy first seen <0.5s before
  contact" stays low (telegraphs working).
- **Reward pull:** measurable increase in map coverage / pickups collected per run
  on fogged missions (players *do* push into the dark).
- **Adoption:** players opt into `VEIL`/fogged jobs for the reward bump at a healthy
  rate (the risk economy values it).
- **Perf:** no frame-time regression during the uncapped extraction swarm with fog
  on (the stress case).

---

## 10. Files touched (summary)

- **New:** `src/game/systems/FogSystem.ts` (grid, render target/vignette,
  contributor list for light sources, optional map-overlay feed, beacon math,
  silhouette pass, `darknessMult` for the blackout modifier).
- `src/game/scenes/Game.ts` — construct/drive/teardown `FogSystem` (mirrors
  `extractionSystem`); reveal-on-intro hooks in the elite/boss handlers
  (`:472-614`); wire `setFog`/`setRevealRadius` in `makeRunModifierSink()`
  (`:955-978`); forward `spawn_state_changed` (`EnemySpawnSystem:305`) to `FogSystem`
  for the blackout wave modifier (§4.5).
- `src/game/ui/GameUI.ts` — objective beacon (core HUD element); optional
  tap-to-expand map overlay (stretch). Both `scrollFactor(0)`, HUD depth band.
- *(Optional, stretch)* `src/game/systems/EnemySpawnSystem.ts` — only if adding a
  first-class `SpawnState.BLACKOUT` (`:130-181`); the v1 overlay form touches nothing
  here (read-only on the existing `spawn_state_changed` event).
- `src/game/types/MissionTypes.ts` — `Mission.fog?: { enabled; revealRadius?; mode? }`.
- `src/game/types/ExpeditionTypes.ts` — add `setFog`/`setRevealRadius` to
  `RunModifierSink` next to `setVision` (`:166`).
- `src/game/config/Expedition.ts` — repoint `SCANNER` (`:65`) and `VEIL` (`:151`) at
  the real fog hooks.
- `src/game/config/Missions.ts` — opt fog onto the chosen / new Recon missions.
- `src/game/config/GameConstants.ts` (or `GameConfig.ts`) — `FOG` block:
  `REVEAL_RADIUS`, `CELL_SIZE`, `DEPTH`, shroud colors/alphas, edge-band width.
- *(Stretch)* `src/game/systems/SkillSystem.ts` — optional SCANNER ping;
  localStorage "scanned map" meta-state; City Reclamation biome-fog flavor.
