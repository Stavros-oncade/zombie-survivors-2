import Phaser from 'phaser';
import { Game } from '../scenes/Game';
import { GameConfig } from '../config/GameConfig';

const DECAL = GameConfig.DECAL;

const SCORCH_TEX_KEY = 'decal_scorch_tex';
const TOXIC_TEX_KEY = 'decal_toxic_tex';

/**
 * Ground decals (GameConfig.DECAL). A self-contained, purely-cosmetic system owned
 * by Game and ALWAYS constructed in create(). It leaves lasting marks on the floor:
 *   - a charred SCORCH where a bomb / airstrike blast lands
 *     (Game.createExplosionEffect → addScorch, so the single hook covers BOMB and
 *     every AIRSTRIKE sub-blast, which funnel through the same method); and
 *   - a small green STAIN where a toxic enemy dies (ToxicTankEnemy.die → Game
 *     .spawnToxicDecal → addToxicStain).
 *
 * Each decal is one Image at DECAL.DEPTH (just above the background, below gas
 * clouds / particles / entities), baked from a procedural canvas texture (no art
 * asset) and given a random rotation + scale jitter so repeats don't look stamped.
 * Decals hold at full opacity then fade out on a long timer, ticked from update();
 * a hard MAX cap destroys the oldest first so a long mission can't accumulate them
 * unbounded. Nothing here touches fog, physics or damage.
 *
 * Lifecycle mirrors BurnSystem: built in create(), update() each frame, destroy()
 * at SHUTDOWN (authoritatively frees any decals still on screen).
 */

interface DecalRecord {
  img: Phaser.GameObjects.Image;
  bornAt: number;     // scene.time.now at spawn
  lifeMs: number;     // full-opacity hold before the fade tail starts
  fadeInMs: number;
  fadeOutMs: number;
  baseAlpha: number;  // peak opacity
}

export class DecalSystem {
  private scene: Game;
  private destroyed = false;
  private decals: DecalRecord[] = [];

  constructor(scene: Game) {
    this.scene = scene;
    this.buildTextures();
  }

  // ─────────────────────────── Public API ───────────────────────────

  /**
   * Charred mark left by a bomb / airstrike blast at (x, y). `blastRadius` is the
   * blast's explosion radius; the scorch is drawn at SCORCH.RADIUS_RATIO of it.
   */
  public addScorch(x: number, y: number, blastRadius: number): void {
    if (this.destroyed) return;
    const cfg = DECAL.SCORCH;
    const targetR = blastRadius * cfg.RADIUS_RATIO;
    const jitter = 1 + (Math.random() - 0.5) * 2 * cfg.JITTER;
    const scale = (targetR / (cfg.TEXTURE_SIZE / 2)) * jitter;
    this.spawn(SCORCH_TEX_KEY, x, y, scale, cfg);
  }

  /** Small green stain left where a toxic enemy dies. */
  public addToxicStain(x: number, y: number): void {
    if (this.destroyed) return;
    const cfg = DECAL.TOXIC;
    const jitter = 1 + (Math.random() - 0.5) * 2 * cfg.JITTER;
    const scale = (cfg.RADIUS / (cfg.TEXTURE_SIZE / 2)) * jitter;
    this.spawn(TOXIC_TEX_KEY, x, y, scale, cfg);
  }

  // ─────────────────────────── Update ───────────────────────────

  /** Fade decals through their lifetime and prune expired ones. */
  public update(_deltaMs: number): void {
    if (this.destroyed) return;
    const now = this.scene.time.now;

    for (let i = this.decals.length - 1; i >= 0; i--) {
      const rec = this.decals[i];
      const age = now - rec.bornAt;

      // Lived out the full fade tail → free it.
      if (age >= rec.lifeMs + rec.fadeOutMs) {
        rec.img.destroy();
        this.decals.splice(i, 1);
        continue;
      }

      let alpha = rec.baseAlpha;
      if (age < rec.fadeInMs) {
        alpha = rec.baseAlpha * (age / rec.fadeInMs);
      } else if (age > rec.lifeMs) {
        alpha = rec.baseAlpha * (1 - (age - rec.lifeMs) / rec.fadeOutMs);
      }
      rec.img.setAlpha(Phaser.Math.Clamp(alpha, 0, 1));
    }
  }

  // ─────────────────────────── Internals ───────────────────────────

  private spawn(
    texKey: string,
    x: number,
    y: number,
    scale: number,
    cfg: { BASE_ALPHA: number; FADE_IN_MS: number; LIFETIME_MS: number; FADE_OUT_MS: number },
  ): void {
    const img = this.scene.add.image(x, y, texKey);
    img.setDepth(DECAL.DEPTH)
      .setScrollFactor(1)
      .setScale(scale)
      .setRotation(Math.random() * Math.PI * 2)
      .setAlpha(0); // faded up in update()

    this.decals.push({
      img,
      bornAt: this.scene.time.now,
      lifeMs: cfg.LIFETIME_MS,
      fadeInMs: cfg.FADE_IN_MS,
      fadeOutMs: cfg.FADE_OUT_MS,
      baseAlpha: cfg.BASE_ALPHA,
    });

    // Enforce the cap — destroy the oldest first.
    while (this.decals.length > DECAL.MAX) {
      const old = this.decals.shift();
      old?.img.destroy();
    }
  }

  // ─────────────────────────── Construction ───────────────────────────

  private buildTextures(): void {
    this.buildScorchTexture();
    this.buildToxicTexture();
  }

  /** Charred disc: dark core → transparent edge, with irregular darker splotches
   *  so no two scorches (after random rotation/scale) read as the same stamp. */
  private buildScorchTexture(): void {
    if (this.scene.textures.exists(SCORCH_TEX_KEY)) return;
    const size = DECAL.SCORCH.TEXTURE_SIZE;
    const canvas = this.scene.textures.createCanvas(SCORCH_TEX_KEY, size, size);
    const ctx = canvas?.getContext();
    if (!ctx) return;

    const c = size / 2;
    const r = c;
    const grad = ctx.createRadialGradient(c, c, r * 0.1, c, c, r);
    grad.addColorStop(0, 'rgba(18,14,10,0.95)');
    grad.addColorStop(0.45, 'rgba(28,20,14,0.8)');
    grad.addColorStop(0.8, 'rgba(35,26,18,0.35)');
    grad.addColorStop(1, 'rgba(40,30,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();

    // Uneven char: a handful of soft dark blobs so the rim isn't a clean disc.
    for (let i = 0; i < 10; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = r * (0.2 + Math.random() * 0.6);
      const bx = c + Math.cos(ang) * dist;
      const by = c + Math.sin(ang) * dist;
      const br = r * (0.12 + Math.random() * 0.22);
      const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      bg.addColorStop(0, 'rgba(8,6,4,0.5)');
      bg.addColorStop(1, 'rgba(8,6,4,0)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }

    canvas?.refresh();
  }

  /** Sickly-green splat: bright green core → transparent edge, with a few darker
   *  green pools for a wet, uneven toxic look. */
  private buildToxicTexture(): void {
    if (this.scene.textures.exists(TOXIC_TEX_KEY)) return;
    const size = DECAL.TOXIC.TEXTURE_SIZE;
    const canvas = this.scene.textures.createCanvas(TOXIC_TEX_KEY, size, size);
    const ctx = canvas?.getContext();
    if (!ctx) return;

    const c = size / 2;
    const r = c;
    const grad = ctx.createRadialGradient(c, c, r * 0.1, c, c, r);
    grad.addColorStop(0, 'rgba(150,235,110,0.95)');
    grad.addColorStop(0.5, 'rgba(95,190,70,0.7)');
    grad.addColorStop(0.85, 'rgba(70,150,50,0.3)');
    grad.addColorStop(1, 'rgba(70,150,50,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 6; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = r * (0.2 + Math.random() * 0.55);
      const bx = c + Math.cos(ang) * dist;
      const by = c + Math.sin(ang) * dist;
      const br = r * (0.1 + Math.random() * 0.2);
      const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      bg.addColorStop(0, 'rgba(45,110,30,0.55)');
      bg.addColorStop(1, 'rgba(45,110,30,0)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }

    canvas?.refresh();
  }

  // ─────────────────────────── Teardown ───────────────────────────

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const rec of this.decals) rec.img.destroy();
    this.decals = [];
  }
}
