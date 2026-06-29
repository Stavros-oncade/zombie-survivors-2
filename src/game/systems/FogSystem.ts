import Phaser from 'phaser';
import { Game } from '../scenes/Game';
import { GameConfig } from '../config/GameConfig';

const FOG = GameConfig.FOG;

/**
 * Fog of War (docs/specs/fog-of-war.md). A self-contained system owned by Game,
 * constructed ONLY when the active mission opts into fog (Mission.fog) or a fog
 * risk-modifier forces it. Mirrors the MissionSystem/ExtractionSystem lifecycle:
 * built in create(), driven from update(), torn down in shutdownScene().
 *
 * Rendering (v1, spec §6.2):
 *  - A coarse 64px reveal grid over the 2048x1536 world (32x24 = 768 cells) with
 *    three states: HIDDEN (opaque shroud) / EXPLORED (dim shroud) / VISIBLE
 *    (clear). Explored is permanent for the run (no re-fogging, anti-goal §3).
 *  - The persistent HIDDEN/EXPLORED memory lives in an off-screen world-space
 *    RenderTexture (`memoryRT`), updated incrementally only as cells transition
 *    (O(rim), independent of enemy count — spec §6.4).
 *  - Each frame the displayed `fogRT` is rebuilt cheaply: clear -> blit memoryRT
 *    (one GPU quad) -> erase a soft feathered brush at each reveal CONTRIBUTOR.
 *    The moving feather is the lantern edge and the visible peel-back.
 *
 * Reveal CONTRIBUTORS (spec §3 / companion light-sources doc): reveal is modelled
 * as a list of contributors that stamp visibility into the grid each frame, NOT
 * "player only". The player is just the first contributor. Later stages register
 * streetlights / carried lights (addContributor) and timed reveals — a flare or
 * an airstrike light-up (addTimedReveal). Every contributor radius multiplies by
 * a single `darknessMult` (the blackout dial) and is clamped so it never reaches
 * zero (and the player's never drops below contact-damage range).
 */

const HIDDEN = 0;
const EXPLORED = 1;

export enum FogContributorKind {
  DISC = 'disc',
  SECTOR = 'sector',
}

/**
 * A reveal contributor. Stamped into the grid + fog RT every frame. `radius` is
 * the BASE radius in world px; the effective radius is `radius * darknessMult`
 * clamped to a floor (see FogSystem.effectiveRadius).
 */
export interface FogContributor {
  kind: FogContributorKind;
  /** World-space center of the reveal, read fresh each frame. */
  getPosition(): { x: number; y: number };
  /** Base reveal radius in world px (before darknessMult). */
  radius: number;
  /** SECTOR only: facing direction in radians (stage-2 flashlight cone). */
  facing?: number;
  /** SECTOR only: half-angle of the cone in radians. */
  halfAngle?: number;
  /** If false, the cells this contributor covers do NOT persist as explored. */
  persistentExplored?: boolean;
  /** Optional per-contributor floor after darknessMult (defaults per kind). */
  minRadius?: number;
}

/** Opaque handle returned by addContributor / addTimedReveal for removal. */
export interface FogContributorHandle {
  readonly id: number;
}

/** Options for a self-expiring reveal (flare pickup §stage3, airstrike §stage4). */
export interface TimedRevealOptions {
  x: number;
  y: number;
  radius: number;
  durationMs: number;
  /** Tail of the lifetime over which the radius eases to zero (default 400ms). */
  fadeMs?: number;
  /** Whether the lit area persists as explored after the reveal expires. */
  persistentExplored?: boolean;
  /** Floor for the effective radius after darknessMult (never zero). */
  minRadius?: number;
}

interface ManagedContributor {
  id: number;
  contributor: FogContributor;
  isPlayer: boolean;
  /** Present for timed reveals; drives the auto-expiring radius. */
  timed?: { startMs: number; durationMs: number; fadeMs: number; baseRadius: number };
}

export interface FogSystemConfig {
  /** Resolved player reveal radius in px (default * any SCANNER/VEIL mult). */
  revealRadius: number;
  /** SpawnState ids that dim the world while active (blackout, §4.5). */
  blackoutStates: string[];
}

export class FogSystem {
  private scene: Game;
  private worldWidth: number;
  private worldHeight: number;
  private cols: number;
  private rows: number;

  // Grid state + per-cell peel-back fade bookkeeping. Tiny (768 cells).
  private state: Uint8Array;
  private fadeStartMs: Float32Array;
  private fadingCells: Set<number> = new Set();

  // Render targets: memoryRT is the persistent (off-screen) HIDDEN/EXPLORED
  // memory; fogRT is the displayed shroud, rebuilt from memoryRT every frame.
  private memoryRT!: Phaser.GameObjects.RenderTexture;
  private fogRT!: Phaser.GameObjects.RenderTexture;

  // Reusable procedural stamps (no assets, per ART_STYLE.md).
  private brush!: Phaser.GameObjects.Image;       // soft feathered reveal brush
  private cellEraser!: Phaser.GameObjects.Image;   // solid CELL x CELL clear stamp
  // SECTOR (flashlight cone) erase stamps, lazily built per unique half-angle and
  // cached by rounded degrees. The cone is a pie-slice radial gradient pointing
  // along +x (apex at the texture center) — rotated to `facing` and scaled to the
  // contributor radius at erase time (stage-2 light sources doc §3.3 / §6.2).
  private coneBrushes: Map<number, Phaser.GameObjects.Image> = new Map();
  private static readonly BRUSH_TEX_KEY = 'fog_brush_tex';
  private static readonly CELL_TEX_KEY = 'fog_cell_tex';
  private static readonly VIGNETTE_TEX_KEY = 'fog_vignette_tex';
  private static readonly CONE_TEX_PREFIX = 'fog_cone_tex_';
  private static readonly CONE_BASE_RADIUS = 256; // reach of the cone texture (size/2)
  private static readonly CONE_TEX_SIZE = 512;

  // Reveal contributors. The player is element 0.
  private contributors: ManagedContributor[] = [];
  private nextContributorId = 1;
  private playerRevealRadius: number;
  // Extra multiplier applied ONLY to the player bubble (the flashlight cone, when
  // equipped, shrinks the always-on disc to AMBIENT_FRACTION so the cone is bonus
  // forward reach — light-sources doc §3.3). 1 = unchanged. Kept separate from
  // playerRevealRadius so it never disturbs the SCANNER/VEIL reveal-radius path.
  private playerRadiusScale = 1;

  // Blackout dial (spec §4.5). Multiplies every contributor radius.
  private darknessMult = 1;
  private darknessTween?: Phaser.Tweens.Tween;
  private blackoutStates: Set<string>;
  private onSpawnStateChanged?: (p: { state: string }) => void;

  // Brief screen-edge vignette pulse on entering a blackout (screen-space).
  private vignette?: Phaser.GameObjects.Image;
  private onResize?: () => void;

  private breatheSec = 0;
  private destroyed = false;

  constructor(scene: Game, config: FogSystemConfig) {
    this.scene = scene;
    this.worldWidth = GameConfig.WORLD.WIDTH;
    this.worldHeight = GameConfig.WORLD.HEIGHT;
    this.cols = Math.ceil(this.worldWidth / FOG.CELL_SIZE);
    this.rows = Math.ceil(this.worldHeight / FOG.CELL_SIZE);
    this.playerRevealRadius = config.revealRadius;
    this.blackoutStates = new Set(config.blackoutStates ?? []);

    const cellCount = this.cols * this.rows;
    this.state = new Uint8Array(cellCount); // all HIDDEN (0)
    this.fadeStartMs = new Float32Array(cellCount);

    this.buildTextures();
    this.buildRenderTargets();
    this.buildVignette();

    // The player's own reveal is just the first contributor (spec §6.2 / item 2).
    const player = this.scene.getPlayer();
    this.contributors.push({
      id: 0,
      isPlayer: true,
      contributor: {
        kind: FogContributorKind.DISC,
        getPosition: () => ({ x: player.x, y: player.y }),
        radius: this.playerRevealRadius,
        persistentExplored: true,
      },
    });

    // Blackout wave modifier: listen (read-only) for spawn-state transitions.
    this.onSpawnStateChanged = (p) => this.handleSpawnStateChanged(p?.state);
    this.scene.events.on('spawn_state_changed', this.onSpawnStateChanged);
  }

  // ─────────────────────────── Public API ───────────────────────────
  // Stages 2-4 (light sources / flare / airstrike) call these verbatim.

  /** Register a persistent reveal contributor (e.g. a streetlight or carried light). */
  public addContributor(contributor: FogContributor): FogContributorHandle {
    const id = this.nextContributorId++;
    this.contributors.push({ id, isPlayer: false, contributor });
    return { id };
  }

  /** Remove a previously added contributor. Safe to call with a stale handle. */
  public removeContributor(handle: FogContributorHandle): void {
    if (!handle) return;
    const idx = this.contributors.findIndex((c) => c.id === handle.id && !c.isPlayer);
    if (idx >= 0) this.contributors.splice(idx, 1);
  }

  /**
   * Add a self-expiring disc reveal that auto-removes after durationMs (flare /
   * airstrike light-up). The effective radius eases to zero over the final
   * `fadeMs`, then the contributor is removed. Returns a handle so the caller can
   * cancel early via removeContributor.
   */
  public addTimedReveal(opts: TimedRevealOptions): FogContributorHandle {
    const id = this.nextContributorId++;
    const fadeMs = Math.min(opts.fadeMs ?? 400, opts.durationMs);
    const managed: ManagedContributor = {
      id,
      isPlayer: false,
      timed: {
        startMs: this.scene.time.now,
        durationMs: opts.durationMs,
        fadeMs,
        baseRadius: opts.radius,
      },
      contributor: {
        kind: FogContributorKind.DISC,
        getPosition: () => ({ x: opts.x, y: opts.y }),
        radius: opts.radius,
        persistentExplored: opts.persistentExplored ?? true,
        minRadius: opts.minRadius,
      },
    };
    this.contributors.push(managed);
    return { id };
  }

  /** Set the player's base reveal radius (SCANNER widens / VEIL narrows). */
  public setRevealRadius(radiusPx: number): void {
    this.playerRevealRadius = Math.max(FOG.MIN_REVEAL_RADIUS, radiusPx);
    const player = this.contributors.find((c) => c.isPlayer);
    if (player) player.contributor.radius = this.playerRevealRadius;
  }

  /** Current player base reveal radius (used by the HUD objective beacon). */
  public getRevealRadius(): number {
    return this.playerRevealRadius;
  }

  /**
   * Scale ONLY the player's always-on bubble (the flashlight cone equips this to
   * AMBIENT_FRACTION so its forward cone is bonus reach — light-sources §3.3).
   * Separate from setRevealRadius so the SCANNER/VEIL path is untouched. 1 = off.
   */
  public setPlayerRadiusScale(scale: number): void {
    this.playerRadiusScale = Phaser.Math.Clamp(scale, 0.1, 4);
  }

  /** Current blackout dial in [FLOOR, 1]. 1 = normal, lower = darker. */
  public getDarknessMult(): number {
    return this.darknessMult;
  }

  /** Effective player reveal radius right now (base * darkness, clamped). */
  public getEffectivePlayerRadius(): number {
    return this.effectiveRadius(this.contributors.find((c) => c.isPlayer)!);
  }

  // ─────────────────────────── Update / render ───────────────────────────

  /** Drive the fog. deltaMs from Game.update(), after player.update(...). */
  public update(deltaMs: number): void {
    if (this.destroyed) return;
    const now = this.scene.time.now;
    this.breatheSec += deltaMs / 1000;

    // Expire finished timed reveals.
    for (let i = this.contributors.length - 1; i >= 0; i--) {
      const m = this.contributors[i];
      if (m.timed && now - m.timed.startMs >= m.timed.durationMs) {
        this.contributors.splice(i, 1);
      }
    }

    // 1. Stamp explored memory for every contributor (grid bookkeeping, O(rim)).
    for (const m of this.contributors) {
      const persist = m.contributor.persistentExplored !== false;
      if (!persist) continue;
      this.markExplored(m, now);
    }

    // 2. Advance per-cell peel-back fades into the memory RT (bounded by rim).
    this.advanceFades(now);

    // 3. Rebuild the displayed shroud: blit memory, then carve the lantern holes.
    this.fogRT.clear();
    this.fogRT.draw(this.memoryRT, 0, 0);
    for (const m of this.contributors) {
      this.eraseBrush(m);
    }
  }

  /** Cells covered by a contributor become EXPLORED (and begin their peel fade). */
  private markExplored(m: ManagedContributor, now: number): void {
    const pos = m.contributor.getPosition();
    const r = this.effectiveRadius(m);
    const cs = FOG.CELL_SIZE;
    const minCol = Phaser.Math.Clamp(Math.floor((pos.x - r) / cs), 0, this.cols - 1);
    const maxCol = Phaser.Math.Clamp(Math.floor((pos.x + r) / cs), 0, this.cols - 1);
    const minRow = Phaser.Math.Clamp(Math.floor((pos.y - r) / cs), 0, this.rows - 1);
    const maxRow = Phaser.Math.Clamp(Math.floor((pos.y + r) / cs), 0, this.rows - 1);
    const r2 = r * r;
    // SECTOR (cone) contributors only cover cells whose bearing from the source
    // is within ±halfAngle of `facing`; DISC contributors cover the full circle.
    const isSector =
      m.contributor.kind === FogContributorKind.SECTOR &&
      m.contributor.halfAngle !== undefined &&
      m.contributor.facing !== undefined;
    const facing = m.contributor.facing ?? 0;
    const halfAngle = m.contributor.halfAngle ?? 0;
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const ccx = col * cs + cs / 2;
        const ccy = row * cs + cs / 2;
        const dx = ccx - pos.x;
        const dy = ccy - pos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        // The apex cell (right on the source) is always covered; elsewhere gate
        // the cone on the bearing so the explored pocket matches the lit cone.
        if (isSector && d2 > 1) {
          const diff = Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - facing);
          if (Math.abs(diff) > halfAngle) continue;
        }
        const idx = row * this.cols + col;
        if (this.state[idx] !== HIDDEN) continue;
        this.state[idx] = EXPLORED;
        this.fadeStartMs[idx] = now;
        this.fadingCells.add(idx);
      }
    }
  }

  /** Tween newly-explored cells from HIDDEN_ALPHA to EXPLORED_ALPHA in memoryRT. */
  private advanceFades(now: number): void {
    if (this.fadingCells.size === 0) return;
    const done: number[] = [];
    for (const idx of this.fadingCells) {
      const t = Phaser.Math.Clamp((now - this.fadeStartMs[idx]) / FOG.PEEL_FADE_MS, 0, 1);
      const alpha = Phaser.Math.Linear(FOG.HIDDEN_ALPHA, FOG.EXPLORED_ALPHA, t);
      const col = idx % this.cols;
      const row = Math.floor(idx / this.cols);
      this.paintCell(col, row, alpha);
      if (t >= 1) done.push(idx);
    }
    for (const idx of done) this.fadingCells.delete(idx);
  }

  /** Replace a single cell's shroud alpha in memoryRT (erase then fill). */
  private paintCell(col: number, row: number, alpha: number): void {
    const cs = FOG.CELL_SIZE;
    const x = col * cs;
    const y = row * cs;
    // Clear the cell to transparent, then lay down the target shroud alpha.
    this.cellEraser.setScale(1);
    this.memoryRT.erase(this.cellEraser, x, y);
    this.memoryRT.fill(FOG.SHROUD_COLOR, alpha, x, y, cs, cs);
  }

  /** Carve a soft feathered hole for one contributor into the displayed fogRT. */
  private eraseBrush(m: ManagedContributor): void {
    const pos = m.contributor.getPosition();
    let r = this.effectiveRadius(m);
    if (m.isPlayer) {
      // Subtle "breathe" so the bubble reads as a carried light, not a stencil.
      r += Math.sin(this.breatheSec * FOG.BREATHE_SPEED) * FOG.BREATHE_AMPLITUDE;
    }
    if (r <= 0) return;
    // SECTOR (flashlight cone): erase a rotated, scaled pie-slice. The cone brush
    // is a radial-gradient slice pointing +x with its apex at the texture center
    // (origin 0.5), so rotating to `facing` and drawing at the source position
    // carves a forward cone — soft-edged like a held flashlight, not a stencil.
    if (
      m.contributor.kind === FogContributorKind.SECTOR &&
      m.contributor.halfAngle !== undefined &&
      m.contributor.facing !== undefined
    ) {
      const cone = this.getConeBrush(m.contributor.halfAngle);
      cone.setRotation(m.contributor.facing);
      cone.setScale(r / FogSystem.CONE_BASE_RADIUS);
      this.fogRT.erase(cone, pos.x, pos.y);
      return;
    }
    // DISC: the brush feather starts at INNER_CLEAR_RATIO of its radius, so
    // scaling by r/BASE_RADIUS keeps the same proportional soft edge at any size.
    this.brush.setScale(r / FOG.BRUSH.BASE_RADIUS);
    this.fogRT.erase(this.brush, pos.x, pos.y);
  }

  /**
   * Lazily build (and cache) a cone erase brush for a given half-angle. The
   * texture is a pie-slice radial gradient (opaque core -> transparent rim)
   * pointing along +x with its apex at the center; origin 0.5 so the apex maps
   * to the draw point. Cached by rounded degrees (MVP uses a single half-angle).
   */
  private getConeBrush(halfAngle: number): Phaser.GameObjects.Image {
    const key = Math.round(Phaser.Math.RadToDeg(halfAngle));
    const cached = this.coneBrushes.get(key);
    if (cached) return cached;

    const texKey = FogSystem.CONE_TEX_PREFIX + key;
    if (!this.scene.textures.exists(texKey)) {
      const size = FogSystem.CONE_TEX_SIZE;
      const canvas = this.scene.textures.createCanvas(texKey, size, size);
      const ctx = canvas?.getContext();
      if (ctx) {
        const c = size / 2;
        ctx.save();
        // Clip to the forward sector, then fill a radial gradient through it.
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.arc(c, c, c, -halfAngle, halfAngle, false);
        ctx.closePath();
        ctx.clip();
        const grad = ctx.createRadialGradient(c, c, c * FOG.INNER_CLEAR_RATIO * 0.5, c, c, c);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        ctx.restore();
        canvas?.refresh();
      }
    }
    const img = this.scene.make.image({ key: texKey, add: false });
    img.setOrigin(0.5, 0.5);
    this.coneBrushes.set(key, img);
    return img;
  }

  /** radius * darknessMult, clamped to a floor so it never reaches zero. */
  private effectiveRadius(m: ManagedContributor): number {
    let base = m.contributor.radius;
    if (m.timed) {
      // Ease the radius to zero over the fade tail of the timed lifetime.
      const elapsed = this.scene.time.now - m.timed.startMs;
      const fadeStart = m.timed.durationMs - m.timed.fadeMs;
      if (elapsed > fadeStart && m.timed.fadeMs > 0) {
        const k = Phaser.Math.Clamp(1 - (elapsed - fadeStart) / m.timed.fadeMs, 0, 1);
        base = m.timed.baseRadius * k;
      } else {
        base = m.timed.baseRadius;
      }
    }
    const floor = m.contributor.minRadius
      ?? (m.isPlayer ? FOG.MIN_REVEAL_RADIUS : FOG.MIN_CONTRIBUTOR_RADIUS);
    // The player bubble also folds in the flashlight ambient scale (§3.3); other
    // contributors (lights / timed reveals) are unaffected by it.
    const scaled = base * this.darknessMult * (m.isPlayer ? this.playerRadiusScale : 1);
    // Timed reveals that have eased below the floor should be allowed to vanish,
    // so only clamp them once they are still meaningfully alive.
    if (m.timed && base <= floor) return Math.max(0, scaled);
    return Math.max(floor, scaled);
  }

  // ─────────────────────────── Blackout (§4.5) ───────────────────────────

  private handleSpawnStateChanged(state?: string): void {
    if (!state) return;
    const dark = this.blackoutStates.has(state);
    const target = dark ? FOG.BLACKOUT.DARKNESS_MULT : 1;
    if (Math.abs(target - this.darknessMult) < 0.001) return;
    this.darknessTween?.stop();
    this.darknessTween = this.scene.tweens.add({
      targets: this,
      darknessMult: Math.max(FOG.BLACKOUT.FLOOR, target),
      duration: FOG.BLACKOUT.TWEEN_MS,
      ease: 'Sine.easeInOut',
    });
    if (dark) this.pulseVignette();
  }

  /** Brief screen-edge vignette flash so a blackout never just "goes dark". */
  private pulseVignette(): void {
    if (!this.vignette) return;
    this.fitVignette();
    this.vignette.setAlpha(0);
    this.vignette.setVisible(true);
    this.scene.tweens.add({
      targets: this.vignette,
      alpha: FOG.BLACKOUT.VIGNETTE_ALPHA,
      duration: FOG.BLACKOUT.VIGNETTE_PULSE_MS * 0.4,
      yoyo: true,
      hold: FOG.BLACKOUT.VIGNETTE_PULSE_MS * 0.2,
      ease: 'Sine.easeInOut',
      onComplete: () => this.vignette?.setVisible(false),
    });
  }

  // ─────────────────────────── Construction ───────────────────────────

  private buildTextures(): void {
    // Soft radial reveal brush (white core fading to transparent). Used as an
    // ERASE stamp: opaque core => fully clear shroud; transparent rim => shroud
    // untouched. Procedural radial gradient via a canvas texture (no asset).
    if (!this.scene.textures.exists(FogSystem.BRUSH_TEX_KEY)) {
      const size = FOG.BRUSH.TEXTURE_SIZE;
      const canvas = this.scene.textures.createCanvas(FogSystem.BRUSH_TEX_KEY, size, size);
      const ctx = canvas?.getContext();
      if (ctx) {
        const c = size / 2;
        const inner = c * FOG.INNER_CLEAR_RATIO;
        const grad = ctx.createRadialGradient(c, c, inner, c, c, c);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        canvas?.refresh();
      }
    }
    // Solid 1px white square scaled to a cell — clears a cell region in memoryRT.
    if (!this.scene.textures.exists(FogSystem.CELL_TEX_KEY)) {
      const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, FOG.CELL_SIZE, FOG.CELL_SIZE);
      g.generateTexture(FogSystem.CELL_TEX_KEY, FOG.CELL_SIZE, FOG.CELL_SIZE);
      g.destroy();
    }

    this.brush = this.scene.make.image({ key: FogSystem.BRUSH_TEX_KEY, add: false });
    this.brush.setOrigin(0.5, 0.5);
    this.cellEraser = this.scene.make.image({ key: FogSystem.CELL_TEX_KEY, add: false });
    this.cellEraser.setOrigin(0, 0);
  }

  private buildRenderTargets(): void {
    // Off-screen persistent memory (HIDDEN/EXPLORED). Not on the display list but
    // still a valid texture source for fogRT.draw().
    this.memoryRT = this.scene.make.renderTexture(
      { x: 0, y: 0, width: this.worldWidth, height: this.worldHeight },
      false // not added to the display list — it never self-renders, only a draw source
    );
    this.memoryRT.setOrigin(0, 0);
    // Whole world starts as opaque shroud.
    this.memoryRT.fill(FOG.SHROUD_COLOR, FOG.HIDDEN_ALPHA, 0, 0, this.worldWidth, this.worldHeight);

    // Displayed shroud, world-space, above gameplay and below the HUD.
    this.fogRT = this.scene.add.renderTexture(0, 0, this.worldWidth, this.worldHeight);
    this.fogRT.setOrigin(0, 0);
    this.fogRT.setScrollFactor(1);
    this.fogRT.setDepth(FOG.DEPTH);
    this.fogRT.draw(this.memoryRT, 0, 0);
  }

  private buildVignette(): void {
    if (!this.scene.textures.exists(FogSystem.VIGNETTE_TEX_KEY)) {
      const size = 512;
      const canvas = this.scene.textures.createCanvas(FogSystem.VIGNETTE_TEX_KEY, size, size);
      const ctx = canvas?.getContext();
      if (ctx) {
        const c = size / 2;
        const grad = ctx.createRadialGradient(c, c, c * 0.45, c, c, c);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        canvas?.refresh();
      }
    }
    const cam = this.scene.cameras.main;
    this.vignette = this.scene.add.image(cam.width / 2, cam.height / 2, FogSystem.VIGNETTE_TEX_KEY);
    this.vignette.setScrollFactor(0);
    this.vignette.setDepth(FOG.DEPTH + 1); // above the fog, still below the HUD
    this.vignette.setTint(FOG.BLACKOUT.VIGNETTE_COLOR);
    this.vignette.setVisible(false);
    this.fitVignette();

    this.onResize = () => this.fitVignette();
    this.scene.scale.on('resize', this.onResize);
  }

  /** Keep the screen-space vignette covering the (resizable) viewport. */
  private fitVignette(): void {
    // The 'resize' handler lives on the GLOBAL ScaleManager, which outlives this
    // scene. If a resize fires after teardown (or before the camera exists), bail
    // rather than dereference a gone camera.
    if (this.destroyed || !this.vignette) return;
    const cam = this.scene.cameras?.main;
    if (!cam) return;
    this.vignette.setPosition(cam.width / 2, cam.height / 2);
    // Cover the viewport corner-to-corner (radial gradient reads at any size).
    const cover = Math.hypot(cam.width, cam.height) / 512;
    this.vignette.setScale(cover);
  }

  // ─────────────────────────── Teardown ───────────────────────────

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.onSpawnStateChanged) {
      this.scene.events.off('spawn_state_changed', this.onSpawnStateChanged);
    }
    if (this.onResize) this.scene.scale.off('resize', this.onResize);
    this.darknessTween?.stop();
    this.brush?.destroy();
    this.cellEraser?.destroy();
    for (const cone of this.coneBrushes.values()) cone.destroy();
    this.coneBrushes.clear();
    this.vignette?.destroy();
    this.fogRT?.destroy();
    this.memoryRT?.destroy();
    this.contributors = [];
    this.fadingCells.clear();
  }
}
