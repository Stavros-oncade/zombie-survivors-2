export const GameConfig = {
    // World dimensions
    WORLD: {
        WIDTH: 2048,  // 4x the default width
        HEIGHT: 1536  // 4x the default height
    },

    // Background settings
    BACKGROUND: {
        DEPTH: -1
    },

    // ─────────────────────────── Fog of War ───────────────────────────
    // See docs/specs/fog-of-war.md. Tunables for FogSystem (the shroud render,
    // the reveal-contributor model, and the blackout wave modifier). All values
    // are constants here per AGENTS.md (constants over literals). Fog is OFF by
    // default — only constructed when a mission opts in via Mission.fog.
    FOG: {
        // Render layer: clearly above world gameplay/VFX (depth <= ~102) and
        // clearly below the HUD band (999+) and intro overlays (2002).
        DEPTH: 500,
        // Coarse reveal grid: 64px cells over the 2048x1536 world => 32x24 = 768.
        CELL_SIZE: 64,
        // Player reveal radius (px). Generous — larger than any contact-damage
        // range so fog hides the MAP, never the active firefight (spec §4.1).
        REVEAL_RADIUS: 420,
        // Fog is ON by default (docs/specs/fog-of-war.md). Missions at or below
        // this difficulty opt OUT unless they set fog.enabled === true — "some easy
        // missions have it turned off." VEIL / fog.enabled:true always force it on.
        EASY_OPTOUT_MAX_DIFFICULTY: 1,
        // Hard floor on the PLAYER reveal radius after every multiplier (blackout
        // / VEIL). Keeps the combat bubble >= contact range (spec §4.5 fairness).
        MIN_REVEAL_RADIUS: 160,
        // Floor for non-player (light / timed) contributors — never reach zero.
        MIN_CONTRIBUTOR_RADIUS: 48,
        // Soft feathered edge: fully-clear inner radius as a fraction of the
        // reveal radius; feathers from here out to the full radius (spec §3.2).
        INNER_CLEAR_RATIO: 0.7,
        // Shroud is a dark desaturated navy/charcoal — NOT pure black — so the
        // dimmed background + neon accents still read (spec §5.1, ART_STYLE).
        SHROUD_COLOR: 0x0a0d14,
        HIDDEN_ALPHA: 0.92,   // never entered: opaque shroud
        EXPLORED_ALPHA: 0.55, // seen before, not currently lit: dimmed shroud
        // Peel-back: when a cell first becomes visible its shroud fades from
        // HIDDEN_ALPHA to EXPLORED_ALPHA over this long (spec §5.1).
        PEEL_FADE_MS: 150,
        // A subtle radius "breathe" so the lit bubble feels like a carried light.
        BREATHE_AMPLITUDE: 6,
        BREATHE_SPEED: 1.5,
        // Blackout wave modifier (spec §4.5): on a flagged spawn state, shrink
        // every reveal radius together via darknessMult, then restore.
        BLACKOUT: {
            DARKNESS_MULT: 0.55, // reveal multiplier while a flagged wave is active
            FLOOR: 0.45,         // hard floor on darknessMult (clamp, never darker)
            TWEEN_MS: 500,       // ease into / out of the dim
            VIGNETTE_COLOR: 0x05070d,
            VIGNETTE_ALPHA: 0.5,
            VIGNETTE_PULSE_MS: 700,
        },
        // Procedural soft brush authored once and scaled per contributor.
        BRUSH: {
            BASE_RADIUS: 256,
            TEXTURE_SIZE: 512,
        },
    },

    // ─────────────────────────── Light Sources ───────────────────────────
    // See docs/specs/fog-of-war-light-sources.md. Tunables for LightSystem
    // (procedural glow entities + their FogSystem reveal contributors). Lights
    // compose ONTO the fog reveal field; a mission with no `lights` and fog off
    // never constructs LightSystem (zero behavior change). Constants over
    // literals per AGENTS.md.
    LIGHT: {
        // Render band for the procedural glow pools: above the background (-1)
        // and below the entities (0) so light reads as cast on the ground and
        // the player/enemies stand on top of it — same band as the zone ring
        // (-0.5). Well below FOG_DEPTH (500): the fog erases a hole at each
        // contributor and the warm glow shows through that hole.
        GLOW_DEPTH: -0.4,
        // The small world marker for a carryable (so you can see it to walk over
        // it). Above the entities and always inside its own lit pocket.
        CORE_DEPTH: 4,
        // Procedural map-generation layout (lights are ALWAYS spawned as part of
        // arena setup — docs/specs/fog-of-war-light-sources.md §3.2). A jittered
        // grid of streetlights forms the spine, a few trashcan fires mark
        // intersections, and one carryable lantern spawns a short walk from start.
        GEN: {
            EDGE_MARGIN: 220,        // keep lights this far inside the world bounds
            SPAWN_CLEAR_RADIUS: 300, // keep the immediate spawn area unlit (tension)
            DENSITY: 0.5,            // global multiplier on procedural light count
                                     // (streetlights + fires). 0.5 = half as many
                                     // spawned lights; the carryable lantern is exempt.
            STREET_COLS: 3,
            STREET_ROWS: 3,
            JITTER: 180,             // per-cell random offset so the grid isn't rigid
            FIRE_COUNT: 3,           // flickering trashcan fires (before DENSITY)
            CARRYABLE_DIST: 320,     // lantern spawn distance from the player
        },
        // Per-kind base reveal radius (px, before darknessMult), glow tint, glow
        // alpha and whether the kind flickers (fire/flare jitter; lamps steady).
        KINDS: {
            streetlight:  { RADIUS: 320, TINT: 0xcfe8ff, GLOW_ALPHA: 0.45, FLICKER: false },
            trashcanFire: { RADIUS: 210, TINT: 0xff8a3c, GLOW_ALPHA: 0.55, FLICKER: true  },
            lantern:      { RADIUS: 260, TINT: 0xffd27f, GLOW_ALPHA: 0.50, FLICKER: false },
            flare:        { RADIUS: 300, TINT: 0xfff0e6, GLOW_ALPHA: 0.60, FLICKER: true  },
        },
        // Flashlight cone (v1, equip/relic-style toggle — default OFF). A SECTOR
        // contributor of reach R_CONE and half-angle ±HALF_ANGLE_DEG along the
        // player's last non-zero facing. When ON the player's own bubble shrinks
        // to AMBIENT_FRACTION of its radius (the fairness backstop, §3.3) and the
        // cone is bonus forward reach with dark flanks.
        CONE: {
            R_CONE: 660,            // forward reach (longer than player REVEAL_RADIUS 420)
            HALF_ANGLE_DEG: 35,     // sector half-angle
            AMBIENT_FRACTION: 0.6,  // reduced always-on disc while the cone is equipped
            TINT: 0xfff6d8,         // warm flashlight glow
            GLOW_ALPHA: 0.32,
        },
        // Flicker (sine + small per-frame noise on scale/alpha/radius). Small and
        // alive, not strobing (ART_STYLE readability first).
        FLICKER: {
            SCALE_AMPLITUDE: 0.06,
            ALPHA_AMPLITUDE: 0.14,
            RADIUS_AMPLITUDE: 0.05,
            SPEED: 7.0,             // base sine speed (rad/s)
            NOISE: 0.05,            // random per-frame jitter
        },
        // Procedural radial glow texture authored once, scaled per light so a
        // glow of reveal radius R draws at scale R / BASE_RADIUS.
        GLOW: {
            TEXTURE_SIZE: 256,
            BASE_RADIUS: 128,
            INNER_RATIO: 0.12,      // bright core fraction before the falloff
        },
        // Procedural cone glow texture (warm pie-slice) for the flashlight visual.
        CONE_GLOW: {
            TEXTURE_SIZE: 512,
            BASE_RADIUS: 256,
        },
        // Cooldown after dropping a carried light before it can be re-grabbed, so
        // setting it down at your feet doesn't instantly snap it back (ms).
        REGRAB_COOLDOWN_MS: 700,
    },

    // ─────────────────────────── Flare Pickup ───────────────────────────
    // See docs/specs/fog-of-war.md (stage 3). A rare enemy-dropped consumable
    // that, on pickup, blows the fog far back for a few seconds then fades. It
    // pairs FogSystem.addTimedReveal (the actual reveal) with a warm cosmetic
    // glow from LightSystem.flashGlow so the area reads as LIT, not merely
    // unfogged. Pointless on non-fog missions, so it is only added to the drop
    // table when fog is active (Enemy.dropPickup gates on Game.isFogActive()).
    // Constants over literals per AGENTS.md.
    FLARE: {
        // Reveal disc radius (px). Clearly larger than the player's own bubble
        // (FOG.REVEAL_RADIUS 420) so the dark peels far back when grabbed.
        REVEAL_RADIUS: 1000,
        // How long the reveal holds at full radius before the fade tail (ms).
        REVEAL_DURATION_MS: 5000,
        // Tail of the lifetime over which the reveal radius eases to zero (ms).
        REVEAL_FADE_MS: 1200,
        // Cosmetic warm-glow lifetime (LightSystem.flashGlow), ~ reveal lifetime.
        GLOW_DURATION_MS: 5500,
        // Weighted drop chance — rare-ish, on the order of AIRSTRIKE (weight 2).
        DROP_WEIGHT: 3,
        // Bright red/orange flare color: the map marker tint AND the warm glow.
        TINT: 0xff5a2b,
    },

    // ─────────────────────────── Fire Ring Pickup ───────────────────────────
    // A single expanding ring pulse: on collect, a growing radius ignites any
    // enemy it catches (BurnSystem.ignite) — no direct damage, the DoT is the
    // whole effect. Reuses the 'pickup_bomb' texture with a distinct tint, same
    // as AIRSTRIKE/FLARE. Constants over literals per AGENTS.md.
    FIRE_RING: {
        MAX_RADIUS: 220,
        DURATION_MS: 900,
        // Distinct from FLARE's TINT (0xff5a2b) and the AIRSTRIKE pickup tint
        // (0x66ccff) so the ground sprite reads as its own pickup.
        TINT: 0xff9500,
    },

    // ─────────────────────────── Airstrike Impact Light ───────────────────────────
    // See docs/specs/fog-of-war.md (stage 4). Each airstrike bomb briefly lights
    // up the area around its impact so the explosions read as glowing, fire-lit
    // craters on the fogged battlefield. Like FLARE it pairs the actual fog
    // reveal (FogSystem.addTimedReveal) with a warm cosmetic glow
    // (LightSystem.flashGlow). Both are guarded — non-fog missions are unaffected.
    // Constants over literals per AGENTS.md.
    AIRSTRIKE: {
        // Reveal/glow radius (px) around each impact — bigger than the blast so
        // the crater glow reads, but smaller than the flare's full reveal.
        IMPACT_LIGHT_RADIUS: 320,
        // How long each crater stays lit before the fade tail (ms) — a few seconds
        // so the staggered impacts leave a chain of briefly-lit craters.
        IMPACT_LIGHT_DURATION_MS: 3500,
        // Tail over which the reveal eases out so it dims rather than snaps off (ms).
        IMPACT_LIGHT_FADE_MS: 1000,
        // Warm orange explosion/fire tint for the crater glow.
        IMPACT_LIGHT_TINT: 0xff7a2e,
    },

    // ─────────────────────────── Fire / Burn Status ───────────────────────────
    // A zombie can CATCH FIRE (BurnSystem). While burning it takes damage over
    // time, becomes a moving light source (a procedural glow + a FogSystem reveal
    // contributor, so a burning horde lights itself out of the shroud), and wears
    // a procedural flame overlay so it stays readable even where the glow is
    // capped out. Ignition sources: bombs / airstrikes (a chance on enemies they
    // DAMAGE but do not kill), contagion (a burning zombie touching another), and
    // the burning trashcan barrels (LIGHT.trashcanFire). Constants over literals
    // per AGENTS.md. BurnSystem mirrors the FogSystem / LightSystem lifecycle.
    BURN: {
        // ── Damage over time ──────────────────────────────────────────────
        // Tick cadence and tick count → DURATION = TICK_MS * TICKS (8 * 500 = 4s).
        TICK_MS: 500,
        TICKS: 8,
        // Per tick: a FLAT amount + a fraction of the target's MAX health. The flat
        // part makes fire LETHAL to the rank-and-file (BASE_HEALTH 40: 8 ticks of
        // (5 + 0.03*40)=6.2 ⇒ ~50, dead by ~tick 7) — design: "fire kills basics".
        // The %maxHP part scales the burn to Tanks/elites without nuking them
        // (Tank 80 ⇒ ~59 over 4s ≈ a heavy softener; Elite 400 ⇒ a slow bonfire).
        FLAT: 5,
        PCT_MAXHP: 0.03,

        // ── Ignition chances ──────────────────────────────────────────────
        // Bomb / airstrike: chance to ignite an enemy that SURVIVES the blast.
        IGNITE_CHANCE: 0.35,

        // ── Contagion (zombie-to-zombie spread) ───────────────────────────
        // No enemy↔enemy physics collider exists, so "touch" is a proximity scan
        // (the ShriekerEnemy aura pattern) run on a cadence, not per-frame.
        CONTAGION_RADIUS: 40,        // px — roughly two 0.5-scaled bodies touching
        CONTAGION_CHECK_MS: 250,     // how often the spread + barrel scans run
        CONTAGION_CHANCE: 0.25,      // per in-contact neighbour per check (gen 0)
        // Runaway guards: a contagion-started fire spreads at CHANCE * DECAY^gen and
        // can't spread at all past MAX_GEN; once MAX_BURNING zombies are alight,
        // contagion stops igniting (primary sources — bombs/barrels — still can).
        CONTAGION_GEN_DECAY: 0.6,
        CONTAGION_MAX_GEN: 3,
        MAX_BURNING: 24,
        // After a fire BURNS OUT (survived), the zombie is fire-immune this long so
        // two neighbours can't become an eternal back-and-forth bonfire.
        REIGNITE_LOCKOUT_MS: 1500,

        // ── Burning trashcan barrels ──────────────────────────────────────
        // The placed trashcanFire lights ignite zombies that wander into the flame.
        BARREL_IGNITE_RADIUS: 54,    // px from the barrel — "stand in the fire"
        BARREL_IGNITE_CHANCE: 0.6,   // per zombie in range per CONTAGION_CHECK_MS

        // ── Light source while burning ────────────────────────────────────
        // Smaller than a streetlight (320) or trashcan fire (210): one zombie is a
        // small torch. Only the first MAX_BURNING_LIGHTS burning zombies register a
        // glow + fog contributor (the per-contributor RT erase is the real cost);
        // the rest still burn + wear the flame overlay but don't carve the fog.
        LIGHT_RADIUS: 130,
        LIGHT_TINT: 0xff6a2e,
        LIGHT_ALPHA: 0.45,
        MAX_BURNING_LIGHTS: 8,
        GLOW: {
            TEXTURE_SIZE: 256,
            BASE_RADIUS: 128,        // glow drawn at scale LIGHT_RADIUS / BASE_RADIUS
            INNER_RATIO: 0.12,
        },

        // ── On-sprite flame overlay (readability) ─────────────────────────
        // A procedural flame sprite (no art asset) layered over the burning zombie
        // so it reads as "on fire" even when its glow is capped out or it's lit by
        // someone else. Origin bottom-centre; sits a touch above the body, below
        // the fog so it shows wherever the area is revealed.
        SPRITE_TINT: 0xff8a3c,       // warm tint on the zombie itself
        FLAME_DEPTH: 60,             // above entities (~0-4), below fog (500)
        FLAME_OFFSET_Y: 6,           // px the flame base sits above the body centre
        FLAME_TEX: { WIDTH: 22, HEIGHT: 30 },
    },

    // ─────────────────────────── Ground Decals ───────────────────────────
    // Lasting marks left ON the ground by violence: a charred scorch where a bomb
    // / airstrike blast lands, and a small green stain where a toxic enemy dies.
    // Owned by DecalSystem (mirrors the BurnSystem lifecycle: built in create(),
    // ticked in update(), torn down in shutdownScene()). Purely cosmetic — decals
    // never touch fog, physics or damage. They fade out on a long timer and a hard
    // MAX cap recycles the oldest so a long mission can't accumulate them forever.
    DECAL: {
        // Render just above the background (BACKGROUND.DEPTH -1) so marks lie ON
        // the ground — below gas clouds (-0.5), explosion particles (0) and every
        // entity (~0+). Stacked decals draw in spawn order at this one depth.
        DEPTH: -0.95,
        // Hard cap on simultaneous decals; past this the OLDEST is destroyed first.
        MAX: 48,

        // ── Blast scorch (bombs + airstrikes) ──
        SCORCH: {
            TEXTURE_SIZE: 192,     // square canvas (px) the scorch is baked into
            // Scorch radius as a fraction of the blast's explosion radius — a
            // charred patch the size of the bright inner blast (which is also 0.5x),
            // so it reads as a crater, not a full-screen stain.
            RADIUS_RATIO: 0.5,
            BASE_ALPHA: 0.75,      // peak opacity once faded in
            FADE_IN_MS: 150,       // quick darken as the blast flash clears
            LIFETIME_MS: 22000,    // hold at full opacity before the fade tail
            FADE_OUT_MS: 4000,     // slow fade so the crater dims rather than pops
            JITTER: 0.18,          // ± per-scorch scale so craters aren't clones
        },

        // ── Toxic death stain (ToxicTankEnemy.die) ──
        TOXIC: {
            TEXTURE_SIZE: 96,      // square canvas (px) the stain is baked into
            RADIUS: 34,            // px — a small green splat under the corpse
            BASE_ALPHA: 0.55,
            FADE_IN_MS: 200,
            LIFETIME_MS: 16000,
            FADE_OUT_MS: 3500,
            JITTER: 0.2,           // ± per-stain scale so splats aren't clones
        },
    }
};