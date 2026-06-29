import Phaser from 'phaser';
import { Game } from '../scenes/Game';
import { GameConfig } from '../config/GameConfig';
import { LightDef } from '../types/MissionTypes';
import {
  FogSystem,
  FogContributor,
  FogContributorKind,
  FogContributorHandle,
} from './FogSystem';

const LIGHT = GameConfig.LIGHT;
const FOG = GameConfig.FOG;

/**
 * Light Sources (docs/specs/fog-of-war-light-sources.md). A self-contained system
 * owned by Game, constructed in create() ONLY when the active mission declares
 * `lights` or fog is on. It owns the procedural glow ENTITIES (radial-gradient
 * sprites + flicker) and registers each as a reveal CONTRIBUTOR on FogSystem
 * (addContributor / a SECTOR for the flashlight cone). Lights compose onto the
 * SAME reveal field as the player bubble — there is no second render path here;
 * FogSystem carves a hole at each contributor and the warm glow shows through.
 *
 * It mirrors the FogSystem lifecycle: built in create(), driven from update()
 * (after player.update so the cone/carried light track with zero lag), torn down
 * in shutdownScene() next to fogSystem?.destroy().
 *
 * If no FogSystem exists on the run, the glows still render cosmetically but the
 * contributor registration (and the flashlight bubble shrink) is skipped.
 *
 * Lights are PURELY player vision for MVP — zombies are indifferent (light-sources
 * §4). TODO(stretch "moths to flame"): a steering nudge toward getActiveLights()
 * for the enemy iteration in Game.update(); gate behind a flag.
 */

const GLOW_TEX_KEY = 'light_glow_tex';
const CORE_TEX_KEY = 'light_core_tex';
const CONE_GLOW_TEX_KEY = 'light_cone_glow_tex';

/** A flickering record shared by placed + carried lights (sine + noise jitter). */
interface FlickerRecord {
  glow: Phaser.GameObjects.Image;
  glowScale: number;       // base scale for the base radius
  glowAlpha: number;       // base alpha
  baseRadius: number;      // contributor base radius (px)
  flicker: boolean;
  phase: number;           // per-light phase offset so fires don't strobe in sync
  contributor?: FogContributor; // mutated each frame so the lit pocket flickers
}

/** A static, placed light (streetlight / trashcan fire). Permanent lit pocket. */
interface PlacedLight extends FlickerRecord {
  x: number;
  y: number;
  /** The renderable object body (placeholder shape) drawn over the glow pool. */
  obj: Phaser.GameObjects.Image;
  handle?: FogContributorHandle;
}

/** The single carryable light (lantern / flare). One at a time (§3.4 / §8 Q2). */
interface CarriedLight extends FlickerRecord {
  def: LightDef;
  tint: number;
  core: Phaser.Physics.Arcade.Image; // small world marker (physics body for grab)
  x: number;
  y: number;
  state: 'world' | 'held' | 'static';
  regrabAtMs: number;     // earliest time it may be re-grabbed after a drop
  mustExit: boolean;      // require the player to step off before a re-grab arms
  handle?: FogContributorHandle;
  overlap?: Phaser.Physics.Arcade.Collider;
}

export class LightSystem {
  private scene: Game;
  private fog?: FogSystem;
  private destroyed = false;

  private placed: PlacedLight[] = [];
  private carried?: CarriedLight;

  // Flashlight cone (equip-style toggle, default OFF — §3.3). The contributor +
  // glow always exist; toggling registers/removes the contributor and shrinks the
  // player bubble to AMBIENT_FRACTION so the cone is bonus forward reach.
  private flashlightOn = false;
  private coneContributor!: FogContributor;
  private coneHandle?: FogContributorHandle;
  private coneGlow!: Phaser.GameObjects.Image;
  private coneHalfAngle: number;
  private coneFacing = 0;

  // Transient glows spawned by flashGlow() (e.g. airstrike light-up — stage 4).
  private transientGlows: Set<Phaser.GameObjects.Image> = new Set();

  // HUD "drop light" chip (mirrors the mobile skill button region; only shown
  // while carrying). Desktop also binds drop to a key.
  private chipGraphics?: Phaser.GameObjects.Graphics;
  private chipLabel?: Phaser.GameObjects.Text;
  private onResize?: () => void;

  private flashlightKey?: Phaser.Input.Keyboard.Key;
  private dropKey?: Phaser.Input.Keyboard.Key;

  private flickerSec = 0;

  private static readonly GRAB_DIST = 44;       // px to walk over and grab
  private static readonly GRAB_CLEAR_DIST = 72;  // px to step away to re-arm a grab

  constructor(scene: Game, lights: LightDef[], fog?: FogSystem) {
    this.scene = scene;
    this.fog = fog;
    this.coneHalfAngle = Phaser.Math.DegToRad(LIGHT.CONE.HALF_ANGLE_DEG);

    this.buildTextures();
    this.buildObjectTextures();
    this.buildCone();

    for (const def of lights) {
      if (def.carryable && !this.carried) {
        this.createCarryable(def);
      } else {
        this.createPlacedLight(def);
      }
    }

    this.createDropChip();
    this.setupInput();
  }

  // ─────────────────────────── Map generation ───────────────────────────

  /**
   * Procedural light layout for an arena (docs §3.2). Lights are ALWAYS generated
   * as part of map setup so the flat world has authored-feeling landmarks: a
   * jittered grid of streetlights forms the navigable spine, a few flickering
   * trashcan fires mark intersections, and one carryable lantern spawns a short
   * walk from the player. Positions keep an edge margin and avoid a clear radius
   * around the spawn (so the immediate start stays tense, not pre-lit).
   */
  public static generateMapLayout(
    worldW: number,
    worldH: number,
    spawnX: number,
    spawnY: number,
  ): LightDef[] {
    const gen = LIGHT.GEN;
    const lights: LightDef[] = [];
    const m = gen.EDGE_MARGIN;
    const clearR = gen.SPAWN_CLEAR_RADIUS;

    // Streetlight spine: a jittered grid, skipping any cell that lands on spawn.
    for (let row = 0; row < gen.STREET_ROWS; row++) {
      for (let col = 0; col < gen.STREET_COLS; col++) {
        const cx = m + ((col + 0.5) / gen.STREET_COLS) * (worldW - m * 2);
        const cy = m + ((row + 0.5) / gen.STREET_ROWS) * (worldH - m * 2);
        const x = Phaser.Math.Clamp(cx + (Math.random() * 2 - 1) * gen.JITTER, m, worldW - m);
        const y = Phaser.Math.Clamp(cy + (Math.random() * 2 - 1) * gen.JITTER, m, worldH - m);
        if (Phaser.Math.Distance.Between(x, y, spawnX, spawnY) < clearR) continue;
        lights.push({ kind: 'streetlight', x, y });
      }
    }

    // Flickering trashcan fires at random spots away from spawn.
    for (let i = 0; i < gen.FIRE_COUNT; i++) {
      const p = LightSystem.randomAwayFromSpawn(worldW, worldH, m, spawnX, spawnY, clearR);
      lights.push({ kind: 'trashcanFire', x: p.x, y: p.y });
    }

    // One carryable lantern a short walk from spawn (so the player can pick light
    // up and carry/drop it from the very start).
    const ang = Math.random() * Math.PI * 2;
    lights.push({
      kind: 'lantern',
      x: Phaser.Math.Clamp(spawnX + Math.cos(ang) * gen.CARRYABLE_DIST, m, worldW - m),
      y: Phaser.Math.Clamp(spawnY + Math.sin(ang) * gen.CARRYABLE_DIST, m, worldH - m),
      carryable: true,
    });

    return lights;
  }

  /** Pick a random in-bounds point at least clearR from the spawn (few tries). */
  private static randomAwayFromSpawn(
    w: number,
    h: number,
    margin: number,
    sx: number,
    sy: number,
    clearR: number,
  ): { x: number; y: number } {
    for (let tries = 0; tries < 8; tries++) {
      const x = margin + Math.random() * (w - margin * 2);
      const y = margin + Math.random() * (h - margin * 2);
      if (Phaser.Math.Distance.Between(x, y, sx, sy) >= clearR) return { x, y };
    }
    return { x: margin, y: margin };
  }

  // ─────────────────────────── Public API ───────────────────────────

  /** Equip/unequip the flashlight cone (default OFF). */
  public setFlashlightEnabled(on: boolean): void {
    if (on === this.flashlightOn) return;
    this.flashlightOn = on;
    if (on) {
      // Shrink the always-on disc; the cone is the bonus forward reach (§3.3).
      this.fog?.setPlayerRadiusScale(LIGHT.CONE.AMBIENT_FRACTION);
      if (this.fog && !this.coneHandle) {
        this.coneHandle = this.fog.addContributor(this.coneContributor);
      }
      this.coneGlow.setVisible(true);
      this.floatText('Flashlight ON', LIGHT.CONE.TINT);
    } else {
      this.fog?.setPlayerRadiusScale(1);
      if (this.coneHandle) {
        this.fog?.removeContributor(this.coneHandle);
        this.coneHandle = undefined;
      }
      this.coneGlow.setVisible(false);
      this.floatText('Flashlight OFF', 0xaaaaaa);
    }
  }

  public toggleFlashlight(): void {
    this.setFlashlightEnabled(!this.flashlightOn);
  }

  public isFlashlightEnabled(): boolean {
    return this.flashlightOn;
  }

  /**
   * Set the carried light down at the player's cell as a static contributor
   * (drop-to-hold-a-position — §3.4). Bound to the HUD chip and the desktop drop
   * key; no-op unless a light is currently held.
   */
  public dropCarried(): void {
    if (!this.carried || this.carried.state !== 'held') return;
    const player = this.scene.getPlayer();
    const cs = FOG.CELL_SIZE;
    // Snap to the player's cell center so it reads as "placed on the grid".
    this.carried.x = Math.floor(player.x / cs) * cs + cs / 2;
    this.carried.y = Math.floor(player.y / cs) * cs + cs / 2;
    this.carried.state = 'static';
    this.carried.regrabAtMs = this.scene.time.now + LIGHT.REGRAB_COOLDOWN_MS;
    this.carried.mustExit = true;
    this.refreshCarriedVisuals();
    this.setChipVisible(false);
    // "Takes hold" flash on set-down.
    this.flashGlow(this.carried.x, this.carried.y, this.carried.baseRadius * 0.6, this.carried.tint, 350, {
      alpha: this.carried.glowAlpha,
      maxScaleMul: 1.5,
    });
  }

  /**
   * Spawn a self-fading cosmetic glow (no contributor). Pair this with
   * FogSystem.addTimedReveal for a transient lit event — e.g. the stage-4
   * airstrike light-up: `fog.addTimedReveal(...)` for the reveal +
   * `lightSystem.flashGlow(...)` for the warm pool. Auto-destroys after durationMs.
   */
  public flashGlow(
    x: number,
    y: number,
    radius: number,
    tint: number,
    durationMs: number,
    opts?: { alpha?: number; maxScaleMul?: number; depth?: number }
  ): Phaser.GameObjects.Image {
    const glow = this.createGlowSprite(x, y, radius, tint, opts?.alpha ?? 0.6, opts?.depth);
    this.transientGlows.add(glow);
    this.scene.tweens.add({
      targets: glow,
      alpha: 0,
      scale: glow.scale * (opts?.maxScaleMul ?? 1),
      duration: durationMs,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.transientGlows.delete(glow);
        glow.destroy();
      },
    });
    return glow;
  }

  /**
   * Active light positions + radii (player-facing helper). Reserved for the
   * stretch "moths to flame" enemy attraction (§4); unused by the MVP.
   */
  public getActiveLights(): Array<{ x: number; y: number; radius: number }> {
    const out: Array<{ x: number; y: number; radius: number }> = [];
    for (const p of this.placed) out.push({ x: p.x, y: p.y, radius: p.baseRadius });
    if (this.carried) out.push({ x: this.carried.x, y: this.carried.y, radius: this.carried.baseRadius });
    return out;
  }

  // ─────────────────────────── Update ───────────────────────────

  /** Drive dynamic lights. deltaMs from Game.update(), after player.update(...). */
  public update(deltaMs: number): void {
    if (this.destroyed) return;
    this.flickerSec += deltaMs / 1000;

    // Input (desktop): F toggles the flashlight, the drop key sets a held light down.
    if (this.flashlightKey && Phaser.Input.Keyboard.JustDown(this.flashlightKey)) {
      this.toggleFlashlight();
    }
    if (this.dropKey && Phaser.Input.Keyboard.JustDown(this.dropKey)) {
      this.dropCarried();
    }

    const player = this.scene.getPlayer();

    // Flashlight cone: heading = the player's last non-zero facing (held when idle).
    const facing = player.getFacing();
    this.coneFacing = Math.atan2(facing.y, facing.x);
    this.coneContributor.facing = this.coneFacing;
    if (this.flashlightOn) {
      const dm = this.fog?.getDarknessMult() ?? 1;
      const r = LIGHT.CONE.R_CONE * dm;
      this.coneGlow
        .setPosition(player.x, player.y)
        .setRotation(this.coneFacing)
        .setScale(r / LIGHT.CONE_GLOW.BASE_RADIUS);
    }

    // Carried light: follow the player while held; proximity grab otherwise.
    if (this.carried) {
      const c = this.carried;
      if (c.state === 'held') {
        c.x = player.x;
        c.y = player.y;
        c.glow.setPosition(c.x, c.y);
        c.core.setPosition(c.x, c.y);
      } else {
        const d = Phaser.Math.Distance.Between(player.x, player.y, c.x, c.y);
        if (c.mustExit && d > LightSystem.GRAB_CLEAR_DIST) c.mustExit = false;
      }
    }

    // Flicker placed + carried lights (sine + small per-frame noise).
    for (const p of this.placed) this.applyFlicker(p);
    if (this.carried) this.applyFlicker(this.carried);
  }

  private applyFlicker(rec: FlickerRecord): void {
    if (!rec.flicker) return;
    const F = LIGHT.FLICKER;
    const s = Math.sin(this.flickerSec * F.SPEED + rec.phase);
    const n = (Math.random() - 0.5) * 2 * F.NOISE;
    const scaleMul = 1 + s * F.SCALE_AMPLITUDE + n;
    rec.glow.setScale(rec.glowScale * scaleMul);
    rec.glow.setAlpha(rec.glowAlpha * Phaser.Math.Clamp(1 + s * F.ALPHA_AMPLITUDE, 0, 1.5));
    if (rec.contributor) rec.contributor.radius = rec.baseRadius * (1 + s * F.RADIUS_AMPLITUDE);
  }

  // ─────────────────────────── Construction ───────────────────────────

  private createPlacedLight(def: LightDef): void {
    const cfg = LIGHT.KINDS[def.kind];
    const radius = def.radius ?? cfg.RADIUS;
    const glow = this.createGlowSprite(def.x, def.y, radius, cfg.TINT, cfg.GLOW_ALPHA);
    // The renderable object body (placeholder shape) sits ON TOP of its glow pool,
    // below the fog (depth 500) so it's only seen inside its own lit pocket.
    const obj = this.scene.add
      .image(def.x, def.y, LightSystem.objTexKey(def.kind))
      .setOrigin(0.5, 0.5)
      .setDepth(LIGHT.CORE_DEPTH);
    const contributor: FogContributor = {
      kind: FogContributorKind.DISC,
      getPosition: () => ({ x: def.x, y: def.y }),
      radius,
      persistentExplored: true,
    };
    const handle = this.fog?.addContributor(contributor);
    this.placed.push({
      glow,
      obj,
      glowScale: glow.scale,
      glowAlpha: cfg.GLOW_ALPHA,
      baseRadius: radius,
      flicker: cfg.FLICKER,
      phase: Math.random() * Math.PI * 2,
      contributor,
      x: def.x,
      y: def.y,
      handle,
    });
  }

  private createCarryable(def: LightDef): void {
    const cfg = LIGHT.KINDS[def.kind];
    const radius = def.radius ?? cfg.RADIUS;
    const glow = this.createGlowSprite(def.x, def.y, radius, cfg.TINT, cfg.GLOW_ALPHA);

    // Walk-over marker with a physics body for the proximity grab (mirrors the
    // BlueprintDrop overlap pattern). Uses the per-kind renderable object shape so
    // the player can SEE the lantern/flare to pick up. It stays put (zero velocity,
    // no gravity); we reposition it manually via setPosition when held / dropped.
    const core = this.scene.physics.add.image(def.x, def.y, LightSystem.objTexKey(def.kind));
    core.setDepth(LIGHT.CORE_DEPTH);

    const carried: CarriedLight = {
      def,
      tint: cfg.TINT,
      glow,
      core,
      glowScale: glow.scale,
      glowAlpha: cfg.GLOW_ALPHA,
      baseRadius: radius,
      flicker: cfg.FLICKER,
      phase: Math.random() * Math.PI * 2,
      x: def.x,
      y: def.y,
      state: 'world',
      regrabAtMs: 0,
      mustExit: false,
    };
    // Light contributor follows the carryable's logical position (fixed when on
    // the ground / dropped; the player while held).
    carried.contributor = {
      kind: FogContributorKind.DISC,
      getPosition: () => ({ x: carried.x, y: carried.y }),
      radius,
      persistentExplored: true,
    };
    carried.handle = this.fog?.addContributor(carried.contributor);

    // Proximity grab — reuse the pickup overlap pattern (walk over it, no button).
    carried.overlap = this.scene.physics.add.overlap(this.scene.getPlayer(), core, () => {
      if (!this.carried || this.carried.state === 'held' || this.carried.mustExit) return;
      if (this.scene.time.now < this.carried.regrabAtMs) return;
      if (Phaser.Math.Distance.Between(this.scene.getPlayer().x, this.scene.getPlayer().y, this.carried.x, this.carried.y) > LightSystem.GRAB_DIST) return;
      this.grabCarried();
    });

    this.carried = carried;
  }

  private grabCarried(): void {
    if (!this.carried) return;
    this.carried.state = 'held';
    this.carried.core.setVisible(false);
    this.setChipVisible(true);
    this.floatText('Light grabbed (drop: G / chip)', this.carried.tint);
  }

  private refreshCarriedVisuals(): void {
    if (!this.carried) return;
    const c = this.carried;
    c.glow.setPosition(c.x, c.y);
    c.core.setPosition(c.x, c.y).setVisible(c.state !== 'held');
  }

  private createGlowSprite(
    x: number,
    y: number,
    radius: number,
    tint: number,
    alpha: number,
    depth?: number
  ): Phaser.GameObjects.Image {
    const img = this.scene.add.image(x, y, GLOW_TEX_KEY);
    img.setOrigin(0.5, 0.5);
    img.setDepth(depth ?? LIGHT.GLOW_DEPTH);
    img.setBlendMode(Phaser.BlendModes.ADD); // additive-but-subtle (ART_STYLE)
    img.setTint(tint);
    img.setAlpha(alpha);
    img.setScale(radius / LIGHT.GLOW.BASE_RADIUS);
    return img;
  }

  private buildCone(): void {
    const player = this.scene.getPlayer();
    this.coneContributor = {
      kind: FogContributorKind.SECTOR,
      getPosition: () => ({ x: player.x, y: player.y }),
      radius: LIGHT.CONE.R_CONE,
      facing: 0,
      halfAngle: this.coneHalfAngle,
      persistentExplored: false, // active vision, not a permanent pocket
    };
    this.coneGlow = this.scene.add.image(player.x, player.y, CONE_GLOW_TEX_KEY);
    this.coneGlow.setOrigin(0.5, 0.5);
    this.coneGlow.setDepth(LIGHT.GLOW_DEPTH);
    this.coneGlow.setBlendMode(Phaser.BlendModes.ADD);
    this.coneGlow.setTint(LIGHT.CONE.TINT);
    this.coneGlow.setAlpha(LIGHT.CONE.GLOW_ALPHA);
    this.coneGlow.setScale(LIGHT.CONE.R_CONE / LIGHT.CONE_GLOW.BASE_RADIUS);
    this.coneGlow.setVisible(false);
  }

  private buildTextures(): void {
    // Radial glow (white core -> transparent). Tinted per light, additive blend.
    if (!this.scene.textures.exists(GLOW_TEX_KEY)) {
      const size = LIGHT.GLOW.TEXTURE_SIZE;
      const canvas = this.scene.textures.createCanvas(GLOW_TEX_KEY, size, size);
      const ctx = canvas?.getContext();
      if (ctx) {
        const c = size / 2;
        const grad = ctx.createRadialGradient(c, c, c * LIGHT.GLOW.INNER_RATIO, c, c, c);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        canvas?.refresh();
      }
    }

    // Small bright world marker so a carryable reads as a walk-over pickup.
    if (!this.scene.textures.exists(CORE_TEX_KEY)) {
      const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(12, 12, 7);
      g.lineStyle(2, 0xffffff, 0.85);
      g.strokeCircle(12, 12, 10);
      g.generateTexture(CORE_TEX_KEY, 24, 24);
      g.destroy();
    }

    // Warm cone glow (pie-slice radial gradient pointing +x, apex at center) for
    // the flashlight visual — matches the FogSystem cone erase shape.
    if (!this.scene.textures.exists(CONE_GLOW_TEX_KEY)) {
      const size = LIGHT.CONE_GLOW.TEXTURE_SIZE;
      const canvas = this.scene.textures.createCanvas(CONE_GLOW_TEX_KEY, size, size);
      const ctx = canvas?.getContext();
      if (ctx) {
        const c = size / 2;
        const ha = this.coneHalfAngle;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.arc(c, c, c, -ha, ha, false);
        ctx.closePath();
        ctx.clip();
        const grad = ctx.createRadialGradient(c, c, c * 0.06, c, c, c);
        grad.addColorStop(0, 'rgba(255,255,255,0.9)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        ctx.restore();
        canvas?.refresh();
      }
    }
  }

  // ───────────────────── Placeholder object art ─────────────────────
  // NOTE: these are PROCEDURAL PLACEHOLDER shapes (no real art assets yet —
  // user request). Swap for proper sprites when the art exists; only these
  // texture builders + the keys below need to change.

  private static objTexKey(kind: LightDef['kind']): string {
    return 'light_obj_' + kind;
  }

  /** Build the (cached) placeholder object textures, one per light kind. */
  private buildObjectTextures(): void {
    const g = this.scene.make.graphics({ x: 0, y: 0 }, false);

    // Streetlight: a post with a glowing lamp head.
    if (!this.scene.textures.exists('light_obj_streetlight')) {
      g.clear();
      g.fillStyle(0x3a4150, 1); g.fillEllipse(18, 58, 22, 8);   // ground base
      g.fillStyle(0x4a5160, 1); g.fillRect(16, 14, 4, 42);      // pole
      g.fillStyle(0x2a2f3a, 1); g.fillRect(8, 5, 20, 9);        // lamp housing
      g.fillStyle(0xffe9a8, 1); g.fillCircle(18, 11, 7);        // lamp
      g.fillStyle(0xfff6d8, 1); g.fillCircle(18, 11, 4);        // hot center
      g.generateTexture('light_obj_streetlight', 36, 64);
    }

    // Trashcan fire: a can topped with layered flames.
    if (!this.scene.textures.exists('light_obj_trashcanFire')) {
      g.clear();
      g.fillStyle(0x44484f, 1); g.fillRect(8, 20, 16, 20);      // can body
      g.fillStyle(0x5a5f68, 1); g.fillRect(7, 18, 18, 3);       // rim
      g.fillStyle(0xff5a1e, 1); g.fillTriangle(9, 21, 16, 2, 23, 21);   // outer flame
      g.fillStyle(0xffa42a, 1); g.fillTriangle(12, 21, 16, 8, 20, 21);  // mid flame
      g.fillStyle(0xffe24a, 1); g.fillTriangle(14, 21, 16, 13, 18, 21); // core flame
      g.generateTexture('light_obj_trashcanFire', 32, 44);
    }

    // Lantern: a framed amber glass with a top handle.
    if (!this.scene.textures.exists('light_obj_lantern')) {
      g.clear();
      g.lineStyle(2, 0x8a6a2f, 1);
      g.beginPath(); g.arc(13, 9, 6, Math.PI, 0, false); g.strokePath(); // handle
      g.fillStyle(0x6b4a1f, 1); g.fillRoundedRect(5, 9, 16, 21, 3);      // frame
      g.fillStyle(0xffd27f, 1); g.fillRoundedRect(8, 12, 10, 15, 2);     // glass
      g.fillStyle(0xfff2cf, 1); g.fillRect(11, 14, 4, 10);              // flame
      g.generateTexture('light_obj_lantern', 26, 36);
    }

    // Flare: a stick with a hot burning tip.
    if (!this.scene.textures.exists('light_obj_flare')) {
      g.clear();
      g.fillStyle(0xbfbfbf, 1); g.fillRect(8, 10, 2, 22);   // stick
      g.fillStyle(0xff5a2b, 1); g.fillCircle(9, 9, 6);      // tip glow
      g.fillStyle(0xffd0a0, 1); g.fillCircle(9, 9, 3);
      g.fillStyle(0xffffff, 1); g.fillCircle(9, 9, 1.5);    // hot core
      g.generateTexture('light_obj_flare', 18, 36);
    }

    g.destroy();
  }

  // ─────────────────────────── HUD drop chip ───────────────────────────

  private createDropChip(): void {
    const g = this.scene.add.graphics();
    g.setScrollFactor(0).setDepth(2000);
    this.chipGraphics = g;
    this.chipLabel = this.scene.add
      .text(0, 0, 'Drop\nLight', {
        fontSize: '13px',
        color: '#ffd27f',
        align: 'center',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(2001);
    this.layoutChip();
    g.on('pointerdown', () => this.dropCarried());
    this.setChipVisible(false);

    this.onResize = () => this.layoutChip();
    this.scene.scale.on('resize', this.onResize);
  }

  /** Position the chip just above the mobile skill button slot (bottom-right). */
  private layoutChip(): void {
    if (!this.chipGraphics || !this.chipLabel) return;
    const cam = this.scene.cameras.main;
    const cx = cam.width - 70;
    const cy = cam.height - 160;
    const r = 38;
    const g = this.chipGraphics;
    g.clear();
    g.fillStyle(0x332b1a, 0.7);
    g.fillCircle(cx, cy, r);
    g.lineStyle(3, 0xffd27f, 0.9);
    g.strokeCircle(cx, cy, r);
    g.setInteractive(new Phaser.Geom.Circle(cx, cy, r), Phaser.Geom.Circle.Contains);
    this.chipLabel.setPosition(cx, cy);
  }

  private setChipVisible(v: boolean): void {
    this.chipGraphics?.setVisible(v);
    this.chipLabel?.setVisible(v);
  }

  // ─────────────────────────── Input + feedback ───────────────────────────

  private setupInput(): void {
    const kb = this.scene.input.keyboard;
    if (!kb) return;
    // F toggles the flashlight; G sets a held light down (desktop drop, mirrors
    // the HUD chip). Q is taken by the medkit; Shift by the skill; Esc by pause.
    this.flashlightKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.dropKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.G);
  }

  private floatText(text: string, color: number): void {
    const player = this.scene.getPlayer();
    const t = this.scene.add
      .text(player.x, player.y - 36, text, {
        fontSize: '14px',
        color: '#' + color.toString(16).padStart(6, '0'),
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(2001);
    this.scene.tweens.add({
      targets: t,
      y: t.y - 36,
      alpha: 0,
      duration: 900,
      onComplete: () => t.destroy(),
    });
  }

  // ─────────────────────────── Teardown ───────────────────────────

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    // Restore the player bubble in case the flashlight shrank it.
    this.fog?.setPlayerRadiusScale(1);
    if (this.coneHandle) this.fog?.removeContributor(this.coneHandle);
    this.coneGlow?.destroy();

    for (const p of this.placed) {
      if (p.handle) this.fog?.removeContributor(p.handle);
      p.glow.destroy();
      p.obj.destroy();
    }
    this.placed = [];

    if (this.carried) {
      if (this.carried.handle) this.fog?.removeContributor(this.carried.handle);
      this.carried.overlap?.destroy();
      this.carried.glow.destroy();
      this.carried.core.destroy();
      this.carried = undefined;
    }

    for (const g of this.transientGlows) g.destroy();
    this.transientGlows.clear();

    this.chipGraphics?.destroy();
    this.chipLabel?.destroy();
    if (this.onResize) this.scene.scale.off('resize', this.onResize);

    const kb = this.scene.input.keyboard;
    if (kb) {
      if (this.flashlightKey) kb.removeKey(this.flashlightKey);
      if (this.dropKey) kb.removeKey(this.dropKey);
    }
  }
}
