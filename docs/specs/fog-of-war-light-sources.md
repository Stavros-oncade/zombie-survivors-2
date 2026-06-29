# Fog of War — Light Sources (Follow-up Spec)

Status: Draft / design pitch (no code yet)
Author: Game design + technical design
Target: `zombie-survivors-2` (Phaser 3.88 + React + Vite + TypeScript)

> **Follow-up to `fog-of-war.md`.** That spec establishes the shroud, the
> player-centered reveal bubble, the reveal grid + world-space render target (§6.2),
> the `FOG_DEPTH = 500` band, the objective beacon, and the **Blackout wave modifier**
> (§4.5). This doc adds **light sources** — placeable and carryable things that emit
> their *own* light into that same reveal field. Read the parent first; everything
> here composes onto it rather than replacing it.

---

## 0. Grounding: what we reuse

All verified in code; this feature is mostly "more reveal contributors," not new systems.

- **One reveal field, many contributors.** The parent's MVP is a single
  player-centered vignette; v1 is a coarse **reveal grid** (64px cells, 32×24=768)
  rendered into a world-space `RenderTexture` at `FOG_DEPTH` (`fog-of-war.md §6.2`).
  A light source is just *another thing that stamps "visible" into that grid* — the
  grid was always designed to take more than one stamp.
- **World-space marker precedent.** Objective rings are drawn as a per-frame
  `scene.add.graphics()` at a fixed world position (`MissionSystem.drawZoneMarker`
  `MissionSystem.ts:74-95`, `ExtractionSystem.drawZoneMarker`
  `ExtractionSystem.ts:148-165`, depth `-0.5`). A static streetlight glow uses the
  exact same pattern — a sprite/graphic pinned to a world coordinate.
- **Player facing is already computed.** `readMovementDirection(...)` returns a
  **normalized `Phaser.Math.Vector2`** (`MovementInput.ts:11-58`); the player already
  consumes it (`Player.update` → `Player.ts:249`, and `setFlipX(direction.x < 0)`
  `Player.ts:71`). The flashlight cone points along the *last non-zero* direction —
  no new input, no aiming.
- **Proximity pickup is already the interaction model.** Pickups are an Arcade group
  (`classType: Pickup`, `Game.ts:191`) collected on **physics overlap**
  (`physics.add.overlap(... handlePlayerPickupCollision)` `Game.ts:446-456`,
  handler `:1430`, `collectedPickups` set `:62`, `pickupCreated` event `:463`).
  `BlueprintDrop` is a second precedent for a "special" world object with its own
  overlap (`Game.ts:1007`). A carryable light reuses this — walk over it to grab it.
- **Per-frame system loop + teardown.** Systems are driven from `Game.update()`
  after `player.update(...)` (`Game.ts:740`, player via `getPlayer()` `:880`) and
  destroyed in `shutdownScene()` (`:1837-1841`). `LightSystem` lives here exactly
  like `FogSystem`.
- **Mission opt-in pattern.** `Mission.fog?` (parent §4.4, `MissionTypes.ts:118`,
  authored in `Missions.ts`) is the seam; light placement rides alongside it.
- **Resize.** `Scale.RESIZE` with a re-resize on window change (`main.ts:81-86`);
  world-space lights are resolution-independent, screen-space affordances subscribe
  to `scene.scale.on('resize', …)`.

**Implication:** lights are a *content + composition* feature on top of an
already-designed reveal field. The only genuinely new code is (a) a `LightSource`
contributor type, (b) the cone stamp, and (c) the carry/drop interaction.

---

## 1. One-line pitch & player fantasy

**Pitch:** *The city still has power in places. A streetlight throws a pool of safety
into the dark; a trashcan fire flickers at an intersection; your flashlight cuts a
cone ahead — and you can grab a flare and carry the light with you, or set it down to
hold a corner. Light becomes terrain.*

**Fantasy (specific to this game):** the parent spec makes the arena dark and your
senses a bubble. Light sources make that darkness *legible and tactical*. The flat,
empty 2048×1536 box — which today has **no in-level geometry at all**
(`fog-of-war.md §0`) — suddenly has **authored landmarks**: lit islands to fight on,
dark gaps to risk crossing, a flickering fire that says "an intersection is here."
You stop wandering a void and start reading a place. And during a **Blackout**
(parent §4.5), the streetlight you found becomes a literal sanctuary — the one spot
the dark can't take.

This is the cheapest way to give the game spatial identity: lights are level design.

---

## 2. Design goals & anti-goals

### Goals
1. **Make darkness tactical, not just moody.** Lit pockets are decisions —
   where to fight, what to cross, what to light up.
2. **Give the flat arena authored landmarks** at near-zero art cost (procedural
   glows), so missions feel like *places*.
3. **Compose, don't fork.** Every light feeds the *same* reveal grid/RT as the player
   bubble (parent §6.2). One render path.
4. **No new buttons on the critical path.** Carrying/dropping reuses the
   proximity-overlap pickup model and, at most, one HUD affordance that mirrors the
   existing mobile skill button.
5. **Synergy with Blackout (parent §4.5):** when the player's own radius shrinks,
   placed/carried lights are what's left — they make the blackout survivable and
   reward players who scouted the map.

### Anti-goals
1. **Don't blind the combat bubble.** Same rule as the parent: the player keeps a
   small **always-on ambient disc** even when relying on the cone, so nothing that can
   touch you is ever in the dark (§3.3).
2. **Don't add fiddly inventory.** A carried light is a single held object with a
   one-tap drop, not a slot system.
3. **Don't tank perf.** Static lights stamp their pocket essentially once; dynamic
   lights are a handful of disc/sector stamps per frame, independent of enemy count.
4. **Don't make lights mandatory to win.** They're advantages and risk/reward, not
   keys. Missions stay completable in raw player-light.

---

## 3. Core mechanic

### 3.1 Everything is a "reveal contributor"
`FogSystem` (parent) currently reveals cells within `R_reveal` of the player each
frame. Generalize that to a list of **contributors**, each with a shape:

| Contributor | Shape | Position | Persistence |
| --- | --- | --- | --- |
| Player bubble | disc, `R_reveal` | follows player | already in parent |
| **Streetlight** | disc, `R_light` | fixed world cell | permanent pocket |
| **Trashcan fire** | disc, smaller + flicker | fixed world cell | permanent pocket |
| **Flashlight cone** | sector, `R_cone`, angle `±θ` | player, along facing | active-vision |
| **Carried light** | disc | follows carrier; static when dropped | active while held; pocket when dropped |

Each frame the VISIBLE pass iterates contributors instead of just the player. Static
lights also mark their cells **EXPLORED once** (their pocket stays lit on the map even
after you leave), while still marking VISIBLE when you're in range so *live enemies*
inside the pool are shown. This single list is the whole composition story.

All contributor radii multiply by the parent's global `darknessMult` (§4.5), so a
Blackout dims lights and player together from one variable — but lights are clamped to
never reach zero, keeping them as sanctuaries.

### 3.2 Static world lights — streetlight & trashcan fire
Placed by the level/mission author at fixed world coordinates. They carve a
**persistent lit pocket** in the shroud, independent of the player.
- **Streetlight:** larger, steady, cool-white pool. Reads as "a safe stretch of
  road." A few per mission define the navigable spine of the map.
- **Trashcan fire:** smaller, warm, **flickering** (radius/alpha jitter on a sine +
  small noise — same code-driven approach as the zone-ring pulse) so it draws the eye
  as a landmark. Reads as "an intersection / a place someone camped."
- Multiple lights compose freely; overlapping pools just both read as visible.
- Authoring: a `lights: LightDef[]` array on the mission (see §6), e.g.
  `{ kind: 'streetlight', x, y }`. Designers paint the map's lit geometry as data.

### 3.3 Flashlight — a forward cone
The "arc of light." It is **directional**, unlike the player's radial bubble.
- **Direction = movement facing.** Use the last non-zero `readMovementDirection`
  vector (`MovementInput.ts:57`) — cache it (the player already tracks facing for
  `setFlipX`, `Player.ts:71`) so the cone doesn't snap to zero when you stop; it holds
  the last heading. This makes *which way you face* a real decision in a genre that
  normally has none.
- **Shape:** a sector of radius `R_cone` (longer than `R_reveal`) and half-angle `θ`
  (e.g. 35°). You see *further ahead* but your flanks/rear fall into shadow.
- **Fairness backstop (load-bearing):** the cone does **not** replace the player
  bubble — it *adds* to a reduced always-on **ambient disc** (e.g. `0.6 · R_reveal`).
  So your immediate melee bubble is never dark; the cone is bonus forward reach. This
  reconciles with the parent's "fog hides the map, never the fight" (§4.1).
- **Recommendation:** ship the cone as an **equip/relic** ("Flashlight"), not the
  default vision, so base fog stays the simple bubble and the cone is a *build* choice
  with a clear tradeoff (reach vs. peripheral awareness). It can also be the shape a
  *carried* flashlight emits (§3.4).

### 3.4 Movable light — carry & drop
The "movable object." A pickup-style light you can carry as a tactical resource.
- **Pick up:** walk over it — proximity **overlap**, identical to pickups
  (`Game.ts:446-456`). No button. While held, it emits its light **from the player**
  (a disc for a lantern/flare, or the cone for a flashlight).
- **Drop:** one HUD affordance — a small "set down light" chip that mirrors the
  existing **mobile skill button** (`Game.ts:674-690`, bottom-right slot pattern).
  Tap it and the light becomes a **static contributor at your current cell**. Now you
  can light a chokepoint or the extraction approach and walk away — or grab it again
  later. This drop-to-hold-a-position loop is the tactical heart of the feature.
- **Why a chip and not "no UI":** once a light is held it's no longer a world object
  to walk over, so auto-drop has no natural trigger; a single, always-same HUD button
  is the cleanest mobile answer and adds no new world input. (Alternative considered:
  auto-drop when you pick up a *second* light — kept as a convenience, not the
  primary.)
- **Examples:** a **flare** (bright, short — see stretch burn-down) or a **lantern**
  (dimmer, permanent). Trashcan fire is *not* carryable (it's a landmark); the
  carryable is the flare/lantern/flashlight.

---

## 4. Tactical layer

- **Lit pockets are safe islands.** With dynamic enemies only visible inside light,
  a streetlight pool is where you can actually *see the fight*. Players will leapfrog
  between lights and dread the dark gaps between them.
- **Risk/reward of lighting up.** Lights help *you* see — but they're also the
  obvious place to get cornered, and (tunable, below) may draw the horde. Pushing into
  an unlit gap to flank, vs. holding a lit pocket, becomes a real choice.
- **Shrieker as the anti-light.** The `ShriekerEnemy` (parent §4.3) is the natural
  threat that makes a lit pocket *unsafe* — a stretch goal is a Shrieker that **douses
  nearby lights** on its shriek, briefly collapsing your sanctuary (great horror beat,
  pairs with Blackout).
- **Blackout synergy (parent §4.5).** When `darknessMult` shrinks the player bubble,
  placed/carried lights are clamped and remain — so the streetlight you found, or the
  flare you dropped on the extraction point, is what carries you through the dark
  wave. Lights turn a blackout from punishing into *earned survivable*.
- **Do zombies react to light?** Pick a stance, expose it as a tunable:
  - **MVP: indifferent** — light is purely *player vision*, no AI change. Simplest,
    fully fair, ships first.
  - **Stretch: "moths to flame"** — a mild attraction bias so lighting up draws
    pressure (turns lights into bait/kite tools and sharpens the risk/reward). Hooks
    the existing enemy iteration (`this.enemies.getChildren()`, `Game.ts:753`); a
    small steering nudge toward the nearest active light. Gated behind a flag so we can
    A/B it.

---

## 5. Game feel & UX

### 5.1 Visuals (consistent with ART_STYLE.md)
- **Procedural glows, no assets.** Each light is a generated radial-gradient texture
  (`scene.make.graphics()` + `generateTexture()`, the same trick the parent uses for
  the vignette and the touch indicator, `Game.ts:335-341`) tinted per kind:
  streetlight cool-white, trashcan fire warm-orange, flare hot-white, lantern amber.
  Matches ART_STYLE's "prefer code-driven effects."
- **Flicker** on fire/flare via a sine+noise tween on radius/alpha (small, alive, not
  strobing — ART_STYLE readability first). Streetlights are steady with a faint hum
  pulse.
- **The cone** renders as a soft-edged sector with a faint warm gradient, brightest
  near the player — looks like a held flashlight, not a stencil.
- **Drop/pickup feedback:** a small "tween-up" flash when a carried light is set down
  and "takes hold," and a soft pulse on pickup — reuse the existing tween vocabulary.

### 5.2 Mobile-first interaction
- **Pick up = walk over it.** Zero new input; identical to every other pickup.
- **Drop = one HUD chip** in the existing skill-button region (`Game.ts:674-690`),
  `scrollFactor(0)`, HUD depth band — thumb-reachable, never overlaps the floating
  joystick (which originates wherever the thumb lands, `Game.ts:328-377`). The chip
  only appears while you're carrying a light.
- **Carried-light indicator:** a small icon next to the chip shows what you're holding
  and (stretch) a burn-down ring for flares.
- No corner real estate consumed; consistent on phone and desktop (desktop binds drop
  to a key, e.g. `Q`).

### 5.3 Onboarding
First mission with lights shows a one-line tip on first proximity to a streetlight
("Light is safety — and you can carry it. Tap to set a light down."). Reuse the
banner pattern (`showMissionBanner`, `Game.ts:1413`).

---

## 6. Technical implementation sketch (grounded in real code)

### 6.1 Where it lives
A small **`src/game/systems/LightSystem.ts`**, owned by `Game`, constructed in
`create()` when the mission declares lights, driven from `update()` after
`player.update(...)` (`Game.ts:740`), torn down in `shutdownScene()` alongside
`fogSystem?.destroy()` / `extractionSystem?.destroy()` (`Game.ts:1837-1841`). It does
**not** own rendering of the shroud — it owns the *light entities* and feeds
contributors to `FogSystem`. (For a first cut it can live inside `FogSystem`; split
out once carry/cone land.)

### 6.2 The one composition point
`FogSystem` exposes a contributor list (parent §6.2). `LightSystem` registers each
light as a contributor and updates dynamic ones per frame:

```
// pseudo — FogSystem.update(), the VISIBLE pass
for (const c of contributors) {
  if (c.shape === 'disc')   stampDisc(grid, c.x, c.y, c.radius * darknessMult)
  if (c.shape === 'sector') stampSector(grid, c.x, c.y, c.radius * darknessMult,
                                        c.facing, c.halfAngle)
  if (c.static && !c.exploredStamped) { markExplored(grid, c); c.exploredStamped = true }
}
```

- **Disc stamp** already exists for the player (parent's "~13×13-cell disc around the
  player"). Streetlight/trashcan/lantern reuse it verbatim at a fixed/dynamic point.
- **Sector stamp (new):** cells within `radius` **and** whose bearing from the source
  is within `±halfAngle` of `facing`. A few dozen cells — cheap. `facing` = cached
  last-non-zero `readMovementDirection` (`MovementInput.ts:57`).
- **Static lights** mark EXPLORED exactly once (permanent pocket), VISIBLE while the
  player is in range (so live enemies in the pool render). Their per-frame cost after
  the first stamp is ~nil.
- Result: lights and the player blob share one grid → one RenderTexture redraw of
  changed rim cells. No second render path, no extra full-grid scans.

### 6.3 Light entities & placement
- **Data:** add `lights?: LightDef[]` to `Mission` (`MissionTypes.ts`, beside `fog?`
  at `:118`); author in `Missions.ts` (same place fog/extraction are opted in).
  `LightDef = { kind: 'streetlight'|'trashcanFire'|'lantern'|'flare', x, y, radius?,
  carryable? }`.
- **World object:** each static light is a glow sprite at a world position + depth in
  the world band (below `FOG_DEPTH=500`, like the zone rings at `-0.5`), following the
  `MissionSystem.drawZoneMarker` precedent (`MissionSystem.ts:74-95`). The fire's
  flicker tween lives on the sprite.
- **Carryable:** spawned as an overlap-collectable, reusing the pickup group/overlap
  machinery (`Game.ts:191, 446-456`); on overlap, `LightSystem` flips it to "held"
  (contributor follows `getPlayer()` `:880`); the HUD drop chip flips it back to a
  static contributor at the player cell. `BlueprintDrop` (`Game.ts:1007`) is the
  precedent for a special non-pickup world object if we want bespoke behavior.

### 6.4 Hooks (named, concrete)
- **Cone facing:** cache last-non-zero direction from `readMovementDirection`
  (`MovementInput.ts:11-58`); the player already computes this each frame
  (`Player.ts:249`).
- **Carry/drop UI:** HUD chip mirrors the mobile skill button (`Game.ts:674-690`),
  `scrollFactor(0)`, HUD depth band (`999+`); desktop key bind via the existing input
  setup.
- **Blackout:** nothing to wire here — lights already multiply by `FogSystem`'s
  `darknessMult` (parent §4.5), so a blackout dims them automatically (clamped > 0).
- **Elite/boss intros:** the parent already reveals around the intro pan target
  (`fog-of-war.md §6.3`, `Game.ts:472-614`); static lights inside that frame just read
  normally — no extra work.
- **Resize:** world-space lights are resolution-independent; only the HUD drop chip
  subscribes to `scene.scale.on('resize', …)` (`main.ts:81-86`).
- **Teardown:** `lightSystem?.destroy()` in `shutdownScene()` (`Game.ts:1837-1841`);
  destroy glow sprites + flicker tweens.
- **Constants:** a `LIGHT` block in `GameConstants.ts`/`GameConfig.ts` (radii per
  kind, cone half-angle + `R_cone`, ambient-disc fraction, flicker amplitude, tint
  colors) — AGENTS.md "constants over literals."

### 6.5 Performance
- Static lights: one stamp at register time + a cheap in-range check per frame.
- Dynamic (cone + carried): a handful of disc/sector stamps per frame, independent of
  enemy count — safe under the uncapped extraction swarm (parent §6.4).
- Glow sprites are pre-generated textures; flicker is a tween, not a redraw.

---

## 7. Scope tiers & effort

| Tier | Scope | Effort (1 eng) |
| --- | --- | --- |
| **MVP** | Contributor list in `FogSystem` + **static lights** (streetlight, trashcan fire) authored via `Mission.lights`. Permanent lit pockets, flicker on fire, procedural glows. Zombies **indifferent** to light. Composes with Blackout for free. | **~2–4 days** |
| **v1** | **Flashlight cone** (equip/relic) with ambient-disc backstop + facing cache. **One carryable light** (flare/lantern) with proximity pickup + HUD drop chip → drop-to-hold-a-position. Tints/flicker polish. Onboarding tip. | **~1–1.5 weeks** |
| **Stretch** | (a) **Zombie light-attraction** ("moths to flame") behind a flag. (b) **Flares as consumables** with burn-down timer + count. (c) **Shrieker douses lights** on shriek. (d) **Relightable grid** — find a fuse/generator to switch a dark district's streetlights back on (objective content). (e) Light **as a puzzle/objective** layer in Recon missions. | **~1–2 weeks, pick-and-choose** |

Kill-switch: a mission with no `lights` and no flashlight equip behaves exactly like
base fog — zero change.

---

## 8. Risks & open questions

**Risks**
- **Cone fairness.** A forward cone with dark flanks can feel cheap if the ambient
  disc is too small — tune the ambient fraction first, playtest hard (mirrors the
  parent's radius-tuning risk).
- **Cone direction jitter** when the player wiggles/stops. Mitigation: cache last
  non-zero facing + a small smoothing/dead-zone, so the cone holds heading.
- **Readability vs neon art.** Warm fire glow over neon enemy accents must not wash
  out the enemies — keep glows additive-but-subtle, desaturated shroud underneath
  (ART_STYLE: gameplay readability wins).
- **Drop-chip discoverability** on mobile (new affordance). Mitigation: chip only
  appears while carrying, with a first-time tip.
- **Too many static lights** trivialize fog. Treat light count as a level-design
  budget (a few per mission), not a default.

**Open questions**
1. Is the flashlight the player's **innate** vision shape or an **equip/relic**?
   (Recommend equip — keeps base fog simple, makes the cone a build choice.)
2. Do **dropped** lights persist for the rest of the run (yes, within run) — and can
   you carry only one at a time? (Recommend one-at-a-time for clarity.)
3. **Moths-to-flame** on by default for "lights are bait" tension, or opt-in per
   mission? (Recommend opt-in/stretch; default indifferent for fairness.)
4. Should `SupplyId.SCANNER` also **boost light radii**, or only the player bubble?
5. Do flares **burn down** (consumable tension) or are lanterns permanent? (Likely
   both, as two different carryables.)

---

## 9. Files touched (summary)

- **New:** `src/game/systems/LightSystem.ts` — light entities (glow sprites, flicker),
  contributor registration, cone facing, carry/drop state. *(May start folded into
  `FogSystem`.)*
- `src/game/systems/FogSystem.ts` *(from parent)* — generalize the reveal pass to a
  **contributor list** (disc + sector stamps); radii scale by `darknessMult`.
- `src/game/scenes/Game.ts` — construct/drive/teardown `LightSystem` (mirrors
  `fogSystem`, `:1837-1841`); spawn carryable lights via the pickup overlap machinery
  (`:191, 446-456`); HUD drop chip in the mobile-skill-button region (`:674-690`).
- `src/game/types/MissionTypes.ts` — `Mission.lights?: LightDef[]` (beside `fog?`,
  `:118`).
- `src/game/config/Missions.ts` — author light placements per mission.
- `src/game/config/GameConstants.ts` (or `GameConfig.ts`) — `LIGHT` block (per-kind
  radii, cone `R_cone`/half-angle, ambient-disc fraction, flicker, tints).
- `src/game/entities/Player.ts` — expose cached last-non-zero facing for the cone
  (already computes direction at `:249`).
- *(Stretch)* `src/game/entities/ShriekerEnemy.ts` — "douse nearby lights" on shriek;
  enemy steering nudge toward lights (via `this.enemies.getChildren()`, `Game.ts:753`)
  for the moths-to-flame option.
