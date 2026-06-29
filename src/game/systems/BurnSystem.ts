import Phaser from 'phaser';
import { Game } from '../scenes/Game';
import { GameConfig } from '../config/GameConfig';
import { Enemy } from '../entities/Enemy';
import { LightSystem } from './LightSystem';
import {
  FogSystem,
  FogContributor,
  FogContributorKind,
  FogContributorHandle,
} from './FogSystem';

const BURN = GameConfig.BURN;
const FLICK = GameConfig.LIGHT.FLICKER;

const GLOW_TEX_KEY = 'burn_glow_tex';
const FLAME_TEX_KEY = 'burn_flame_tex';

/**
 * Fire / Burn status (GameConfig.BURN). A self-contained system owned by Game,
 * ALWAYS constructed in create() (burning works with or without fog), driven from
 * update() right before FogSystem so contributor add/remove resolves before the
 * shroud is re-drawn, and torn down in shutdownScene() BEFORE fogSystem.destroy()
 * so contributor removal is still valid.
 *
 * A burning zombie:
 *   - takes damage over time through Enemy.takeDamage(), so death/XP/killstreak/
 *     mission-classification all "just work" (and the elite SHIELDED affix eats
 *     burn ticks until the shield breaks, exactly like any other damage source);
 *   - wears a procedural flame overlay (no art asset) + a warm tint so it reads as
 *     on fire even where its glow is capped out — the readability path;
 *   - becomes a moving LIGHT SOURCE: a radial glow + a FogSystem reveal
 *     contributor whose getPosition() tracks the live enemy, so a burning horde
 *     carves its own holes in the shroud. Only the first MAX_BURNING_LIGHTS
 *     burning zombies get a glow/contributor (one RT erase per contributor per
 *     frame is the real cost); the rest still burn and wear the flame overlay.
 *
 * Ignition sources: bombs / airstrikes (Game.createExplosionEffect, a chance on
 * survivors), contagion (a burning zombie touching another — a proximity scan on
 * a cadence, the ShriekerEnemy pattern, with generation decay + a global cap + a
 * reignite lockout so chains can't run away), and the burning trashcan barrels
 * (LightSystem.getFireSources()).
 *
 * Ownership note: this system owns ALL burn display objects (flame + glow), which
 * are scene objects, NOT children of the enemy. So no Enemy.destroy() change is
 * needed: update() prunes records whose enemy went inactive (cleaning up their
 * glow/flame/contributor), and destroy() (run at SHUTDOWN, before the DisplayList
 * teardown) authoritatively clears the rest.
 */

interface BurnRecord {
  enemy: Enemy;
  ticksLeft: number;
  nextTickAt: number;     // scene.time.now of the next DoT tick
  generation: number;     // 0 = primary (bomb/barrel), >0 = contagion-spread
  prevTint: number;       // tint snapshot, restored if the fire burns out
  phase: number;          // per-fire flicker offset so the horde doesn't strobe
  flame: Phaser.GameObjects.Image;
  glow?: Phaser.GameObjects.Image;       // only for the first MAX_BURNING_LIGHTS
  contributor?: FogContributor;
  handle?: FogContributorHandle;
}

export class BurnSystem {
  private scene: Game;
  private fog?: FogSystem;
  private lights?: LightSystem;
  private destroyed = false;

  private records: Map<Enemy, BurnRecord> = new Map();
  // Fire-immunity after a fire burns out (keyed by enemy; WeakMap so dead enemies
  // drop out with no manual cleanup).
  private immuneUntil: WeakMap<Enemy, number> = new WeakMap();

  private litCount = 0;          // burning zombies currently carrying a glow
  private flickerSec = 0;
  private scanAccum = 0;         // ms accumulator for the contagion / barrel scan

  constructor(scene: Game, fog?: FogSystem, lights?: LightSystem) {
    this.scene = scene;
    this.fog = fog;
    this.lights = lights;
    this.buildTextures();
  }

  // ─────────────────────────── Public API ───────────────────────────

  /** Is this enemy currently on fire? */
  public isBurning(enemy: Enemy): boolean {
    return this.records.has(enemy);
  }

  /**
   * Set an enemy alight. `generation` tracks contagion depth (0 = a primary
   * source: bomb / airstrike / barrel). Re-igniting a burning enemy just refreshes
   * the timer (keeping the lower generation). No-ops on dead enemies, bosses, and
   * enemies still inside their reignite lockout. NOTE: ignite() itself does NOT
   * enforce MAX_BURNING — primary sources always catch; only contagion respects
   * the cap (see runContagion).
   */
  public ignite(enemy: Enemy, generation = 0): void {
    if (this.destroyed) return;
    if (!enemy || !enemy.active || !enemy.scene) return;
    // Bosses are set-piece — never burn (the %maxHP DoT would be huge anyway).
    if (enemy.getKillClass().isBoss) return;

    const now = this.scene.time.now;

    const existing = this.records.get(enemy);
    if (existing) {
      existing.ticksLeft = BURN.TICKS;
      existing.nextTickAt = now + BURN.TICK_MS;
      existing.generation = Math.min(existing.generation, generation);
      return;
    }

    const lock = this.immuneUntil.get(enemy);
    if (lock !== undefined && now < lock) return;

    const flame = this.scene.add.image(enemy.x, enemy.y - BURN.FLAME_OFFSET_Y, FLAME_TEX_KEY);
    flame.setOrigin(0.5, 1).setDepth(BURN.FLAME_DEPTH).setBlendMode(Phaser.BlendModes.ADD);

    const prevTint = enemy.tintTopLeft;
    enemy.setTint(BURN.SPRITE_TINT);

    const rec: BurnRecord = {
      enemy,
      ticksLeft: BURN.TICKS,
      nextTickAt: now + BURN.TICK_MS,
      generation,
      prevTint,
      phase: this.phaseFor(now, enemy),
      flame,
    };
    this.records.set(enemy, rec);

    // Hand out a glow + fog contributor if a light slot is free.
    if (this.litCount < BURN.MAX_BURNING_LIGHTS) this.attachLight(rec);
  }

  // ─────────────────────────── Update ───────────────────────────

  /** Drive burns. deltaMs from Game.update(), called BEFORE fogSystem.update(). */
  public update(deltaMs: number): void {
    if (this.destroyed) return;
    this.flickerSec += deltaMs / 1000;
    const now = this.scene.time.now;

    // Snapshot so igniting / pruning during the loop never disturbs iteration.
    for (const rec of [...this.records.values()]) {
      const enemy = rec.enemy;

      // Enemy gone (killed by a weapon, a burn tick, or torn down) → clean up.
      if (!enemy.active || !enemy.scene) {
        this.cleanup(rec, false);
        this.records.delete(enemy);
        continue;
      }

      // DoT ticks. Apply through takeDamage so all downstream effects fire; bail
      // mid-burst if a tick kills the enemy.
      while (rec.ticksLeft > 0 && now >= rec.nextTickAt) {
        enemy.takeDamage(this.tickDamage(enemy));
        rec.ticksLeft--;
        rec.nextTickAt += BURN.TICK_MS;
        if (!enemy.active) break;
      }

      if (!enemy.active || !enemy.scene) {
        this.cleanup(rec, false);
        this.records.delete(enemy);
        continue;
      }

      // Burned out while still alive → extinguish + arm the reignite lockout.
      if (rec.ticksLeft <= 0) {
        this.immuneUntil.set(enemy, now + BURN.REIGNITE_LOCKOUT_MS);
        this.cleanup(rec, true);
        this.records.delete(enemy);
        continue;
      }

      // Late promotion: a burning zombie with no glow grabs a freed light slot.
      if (!rec.glow && this.litCount < BURN.MAX_BURNING_LIGHTS) this.attachLight(rec);

      this.animate(rec);
    }

    // Spread + barrel ignition run on a coarser cadence (frame-rate independent).
    this.scanAccum += deltaMs;
    if (this.scanAccum >= BURN.CONTAGION_CHECK_MS) {
      this.scanAccum = 0;
      this.runContagion(now);
      this.runBarrels(now);
    }
  }

  // ─────────────────────────── Spread / barrels ───────────────────────────

  /** Per in-contact neighbour: a chance to spread, decaying by generation. */
  private runContagion(now: number): void {
    if (this.records.size >= BURN.MAX_BURNING) return;
    const group = this.scene.getEnemiesGroup?.();
    if (!group) return;
    const children = group.getChildren() as Enemy[];
    const rSq = BURN.CONTAGION_RADIUS * BURN.CONTAGION_RADIUS;

    // Snapshot the sources: fires started THIS scan won't spread until next scan,
    // which (with the gen cap) is what keeps a dense horde from flashing over at
    // once. enemy.x/y are read live.
    for (const src of [...this.records.values()]) {
      if (src.generation >= BURN.CONTAGION_MAX_GEN) continue;
      const chance = BURN.CONTAGION_CHANCE * Math.pow(BURN.CONTAGION_GEN_DECAY, src.generation);
      const sx = src.enemy.x;
      const sy = src.enemy.y;
      for (const other of children) {
        if (other === src.enemy || !other.active) continue;
        if (this.records.has(other)) continue;
        if (this.isLocked(other, now)) continue;
        const dx = other.x - sx;
        const dy = other.y - sy;
        if (dx * dx + dy * dy > rSq) continue;
        if (Math.random() < chance) {
          this.ignite(other, src.generation + 1);
          if (this.records.size >= BURN.MAX_BURNING) return;
        }
      }
    }
  }

  /** Zombies standing in a burning trashcan barrel catch fire (primary source). */
  private runBarrels(now: number): void {
    const fires = this.lights?.getFireSources();
    if (!fires || fires.length === 0) return;
    const group = this.scene.getEnemiesGroup?.();
    if (!group) return;
    const children = group.getChildren() as Enemy[];
    const rSq = BURN.BARREL_IGNITE_RADIUS * BURN.BARREL_IGNITE_RADIUS;

    for (const enemy of children) {
      if (!enemy.active) continue;
      if (this.records.has(enemy)) continue;
      if (this.isLocked(enemy, now)) continue;
      for (const f of fires) {
        const dx = enemy.x - f.x;
        const dy = enemy.y - f.y;
        if (dx * dx + dy * dy <= rSq) {
          if (Math.random() < BURN.BARREL_IGNITE_CHANCE) this.ignite(enemy, 0);
          break;
        }
      }
    }
  }

  // ─────────────────────────── Per-record helpers ───────────────────────────

  private tickDamage(enemy: Enemy): number {
    return BURN.FLAT + BURN.PCT_MAXHP * enemy.getMaxHealth();
  }

  private isLocked(enemy: Enemy, now: number): boolean {
    const lock = this.immuneUntil.get(enemy);
    return lock !== undefined && now < lock;
  }

  /** Attach a radial glow + a fog reveal contributor that tracks the enemy. */
  private attachLight(rec: BurnRecord): void {
    const enemy = rec.enemy;
    const glow = this.scene.add.image(enemy.x, enemy.y, GLOW_TEX_KEY);
    glow.setOrigin(0.5, 0.5)
      .setDepth(GameConfig.LIGHT.GLOW_DEPTH)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(BURN.LIGHT_TINT)
      .setAlpha(BURN.LIGHT_ALPHA)
      .setScale(BURN.LIGHT_RADIUS / BURN.GLOW.BASE_RADIUS);
    rec.glow = glow;

    const contributor: FogContributor = {
      kind: FogContributorKind.DISC,
      getPosition: () => ({ x: rec.enemy.x, y: rec.enemy.y }),
      radius: BURN.LIGHT_RADIUS,
      persistentExplored: false, // a moving torch reveals; it doesn't map the area
    };
    rec.contributor = contributor;
    rec.handle = this.fog?.addContributor(contributor);
    this.litCount++;
  }

  /** Flicker + follow the flame overlay and (if present) the glow. */
  private animate(rec: BurnRecord): void {
    const enemy = rec.enemy;
    const s = Math.sin(this.flickerSec * FLICK.SPEED + rec.phase);
    const n = (Math.random() - 0.5) * 2 * FLICK.NOISE;

    const flameScale = 1 + s * FLICK.SCALE_AMPLITUDE + n;
    rec.flame.setPosition(enemy.x, enemy.y - BURN.FLAME_OFFSET_Y);
    rec.flame.setScale(flameScale);
    rec.flame.setAlpha(Phaser.Math.Clamp(1 + s * FLICK.ALPHA_AMPLITUDE, 0, 1));

    if (rec.glow) {
      rec.glow.setPosition(enemy.x, enemy.y);
      rec.glow.setScale((BURN.LIGHT_RADIUS / BURN.GLOW.BASE_RADIUS) * (1 + s * FLICK.SCALE_AMPLITUDE + n));
      rec.glow.setAlpha(BURN.LIGHT_ALPHA * Phaser.Math.Clamp(1 + s * FLICK.ALPHA_AMPLITUDE, 0, 1.5));
      if (rec.contributor) rec.contributor.radius = BURN.LIGHT_RADIUS * (1 + s * FLICK.RADIUS_AMPLITUDE);
    }
  }

  /** Remove a record's display objects + contributor. `restoreTint` on burn-out. */
  private cleanup(rec: BurnRecord, restoreTint: boolean): void {
    if (rec.handle) this.fog?.removeContributor(rec.handle);
    if (rec.glow) {
      rec.glow.destroy();
      this.litCount = Math.max(0, this.litCount - 1);
    }
    rec.flame.destroy();
    if (restoreTint && rec.enemy.active) rec.enemy.setTint(rec.prevTint);
  }

  // ─────────────────────────── Construction ───────────────────────────

  private phaseFor(now: number, enemy: Enemy): number {
    // Deterministic-ish per-fire offset (no Math.random needed) so neighbouring
    // flames don't flicker in lockstep.
    return ((now * 0.013 + enemy.x * 0.07 + enemy.y * 0.05) % (Math.PI * 2));
  }

  private buildTextures(): void {
    // Radial glow (white core → transparent), tinted + additive per use.
    if (!this.scene.textures.exists(GLOW_TEX_KEY)) {
      const size = BURN.GLOW.TEXTURE_SIZE;
      const canvas = this.scene.textures.createCanvas(GLOW_TEX_KEY, size, size);
      const ctx = canvas?.getContext();
      if (ctx) {
        const c = size / 2;
        const grad = ctx.createRadialGradient(c, c, c * BURN.GLOW.INNER_RATIO, c, c, c);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        canvas?.refresh();
      }
    }

    // Procedural flame overlay (layered teardrop tongues, no art asset). Origin
    // bottom-centre; drawn additive so it glows on the dark fog. Hot white core →
    // yellow → orange → deep-orange outer, like the trashcan-fire tongues.
    if (!this.scene.textures.exists(FLAME_TEX_KEY)) {
      const w = BURN.FLAME_TEX.WIDTH;
      const h = BURN.FLAME_TEX.HEIGHT;
      const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
      const cx = w / 2;
      const base = h - 2;
      // Outer flame (deep orange) — widest, rounded base + tall tongue.
      g.fillStyle(0xff4a12, 1);
      g.fillEllipse(cx, base - 5, w - 2, 12);
      g.fillTriangle(2, base - 2, cx, 1, w - 2, base - 2);
      // Mid flame (orange).
      g.fillStyle(0xff8a1e, 1);
      g.fillEllipse(cx, base - 4, w - 8, 10);
      g.fillTriangle(5, base - 3, cx, h * 0.28, w - 5, base - 3);
      // Inner flame (yellow).
      g.fillStyle(0xffd23a, 1);
      g.fillEllipse(cx, base - 3, w - 13, 8);
      g.fillTriangle(8, base - 3, cx, h * 0.5, w - 8, base - 3);
      // Hot core (near-white).
      g.fillStyle(0xfff2c2, 1);
      g.fillEllipse(cx, base - 3, w - 16, 6);
      g.generateTexture(FLAME_TEX_KEY, w, h);
      g.destroy();
    }
  }

  // ─────────────────────────── Teardown ───────────────────────────

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Runs at SHUTDOWN (before fogSystem.destroy and before the DisplayList tears
    // the scene down), so removing contributors + destroying our own sprites here
    // is the authoritative cleanup.
    for (const rec of this.records.values()) {
      if (rec.handle) this.fog?.removeContributor(rec.handle);
      rec.glow?.destroy();
      rec.flame.destroy();
    }
    this.records.clear();
    this.litCount = 0;
  }
}
