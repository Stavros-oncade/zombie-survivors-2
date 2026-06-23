import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';
import { IWeapon } from './IWeapon';

// Assets needed:
// - vortex VFX sprite (e.g., 'vfx_gravity_well'). Falls back to a code-drawn
//   graphics ring (mirrors ExplosiveWeapon / EvolvedInfernoLance fallbacks).
//
// Gravity Well (evolution of Explosive + Orbital): periodically casts a
// stationary vortex field at the nearest enemy. The field (a) pulls nearby
// enemies toward its center each tick and (b) deals damage-over-time to
// everything inside, then collapses. Zone denial, distinct from both parents.

const TICKS_PER_FIELD = 4;
const TICK_INTERVAL_MS = 250;
const PULL_PX_PER_SEC = 120;

export class GravityWellWeapon implements IWeapon {
  private damage: number;
  private tempDamageMultiplier: number = 1;
  private attackSpeed: number; // re-cast cadence (fields per second)
  private range: number; // field radius
  private level: number = 1;
  private lastFired: number = 0;

  constructor(_scene: Scene, config: { damage: number; attackSpeed: number; range: number }) {
    this.damage = config.damage;
    this.attackSpeed = config.attackSpeed;
    this.range = config.range;
  }

  public fire(scene: Scene, player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void {
    const now = scene.time.now;
    if (now - this.lastFired < 1000 / this.attackSpeed) return;

    // Cast at the nearest enemy (cluster anchor).
    let target: Enemy | null = null;
    let closest = Number.MAX_VALUE;
    for (const e of enemies) {
      if (!(e instanceof Enemy) || !e.active) continue;
      const d = Phaser.Math.Distance.Between(player.x, player.y, e.x, e.y);
      if (d < closest) { closest = d; target = e; }
    }
    if (!target) return;
    this.lastFired = now;

    this.castField(scene, target.x, target.y, enemies);
  }

  private castField(scene: Scene, cx: number, cy: number, enemies: Enemy[]): void {
    const radius = this.range;
    this.createVisual(scene, cx, cy, radius);

    const maxPullPerTick = PULL_PX_PER_SEC * (TICK_INTERVAL_MS / 1000);
    let ticks = 0;
    const timer = scene.time.addEvent({
      delay: TICK_INTERVAL_MS,
      repeat: TICKS_PER_FIELD - 1,
      callback: () => {
        ticks++;
        const dmg = this.getDamage();
        for (const e of enemies) {
          if (!e.active) continue;
          const d = Phaser.Math.Distance.Between(cx, cy, e.x, e.y);
          if (d > radius) continue;
          e.takeDamage(dmg);
          // Pull toward center, capped so fast enemies aren't yanked past it.
          if (d > 1) {
            const pull = Math.min(maxPullPerTick, d * 0.9);
            e.x += ((cx - e.x) / d) * pull;
            e.y += ((cy - e.y) / d) * pull;
          }
        }
        if (ticks >= TICKS_PER_FIELD) {
          timer.remove();
        }
      }
    });
  }

  private createVisual(scene: Scene, cx: number, cy: number, radius: number): void {
    const lifetime = TICKS_PER_FIELD * TICK_INTERVAL_MS;
    if (scene.textures.exists('vfx_gravity_well')) {
      const s = scene.add.sprite(cx, cy, 'vfx_gravity_well');
      s.setOrigin(0.5, 0.5);
      s.setScale(Math.max(0.5, (radius * 2) / s.width));
      scene.tweens.add({ targets: s, angle: 360, duration: lifetime, ease: 'Linear' });
      scene.tweens.add({ targets: s, alpha: 0, scale: s.scale * 0.4, delay: lifetime - 220, duration: 220, onComplete: () => s.destroy() });
      return;
    }
    const g = scene.add.graphics();
    g.setScrollFactor(1);
    g.fillStyle(0x9b59ff, 0.18);
    g.fillCircle(cx, cy, radius);
    g.lineStyle(3, 0xbb88ff, 0.7);
    g.strokeCircle(cx, cy, radius);
    g.strokeCircle(cx, cy, radius * 0.55);
    scene.tweens.add({ targets: g, alpha: 0, duration: lifetime, ease: 'Quad.easeIn', onComplete: () => g.destroy() });
  }

  public upgrade(): void {
    this.level++;
    this.damage *= 1.2;
    this.range += 12;
  }

  public upgradeDamage(multiplier: number): void { this.damage *= multiplier; }
  public upgradeSpeed(multiplier: number): void { this.attackSpeed *= multiplier; }
  public upgradeProjectileSpeed(_multiplier: number): void { /* no-op for field weapon */ }
  public getDamage(): number { return Math.max(0, this.damage * this.tempDamageMultiplier); }
  public setDamage(v: number): void { this.damage = Math.max(0, v); }
  public setTempDamageMultiplier(multiplier: number): void { this.tempDamageMultiplier = Math.max(0, multiplier); }
  public getAttackSpeed(): number { return this.attackSpeed; }
  public getProjectileSpeed(): number { return 0; }
  public getLevel(): number { return this.level; }
}
