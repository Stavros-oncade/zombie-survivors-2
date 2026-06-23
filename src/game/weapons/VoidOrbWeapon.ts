import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';
import { IWeapon } from './IWeapon';

// Void Orb (Black Hole): on a slow recast cadence, opens a collapsing singularity
// at the nearest enemy cluster. Each tick it pulls nearby enemies toward the
// center (capped per-tick so they are never yanked past it) and grinds everything
// inside with DoT, then collapses after N ticks. Functionally the standalone
// sibling of Gravity Well; gated as a city-reclamation special weapon.

const TICK_INTERVAL_MS = 250;
const PULL_PX_PER_SEC = 120;

export class VoidOrbWeapon implements IWeapon {
  private damage: number;
  private tempDamageMultiplier: number = 1;
  private attackSpeed: number; // recast cadence (fields per second)
  private range: number;
  private ticks: number;
  private level: number;
  private lastFired: number = 0;

  constructor(_scene: Scene, config: { damage: number; attackSpeed: number; level: number; range?: number; ticks?: number }) {
    this.damage = config.damage;
    this.attackSpeed = config.attackSpeed;
    this.level = config.level;
    this.range = config.range ?? 150;
    this.ticks = config.ticks ?? 5;
  }

  public fire(scene: Scene, player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void {
    const now = scene.time.now;
    if (now - this.lastFired < 1000 / this.attackSpeed) return;

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
    let elapsed = 0;
    const timer = scene.time.addEvent({
      delay: TICK_INTERVAL_MS,
      repeat: this.ticks - 1,
      callback: () => {
        elapsed++;
        const dmg = this.getDamage();
        for (const e of enemies) {
          if (!e.active) continue;
          const d = Phaser.Math.Distance.Between(cx, cy, e.x, e.y);
          if (d > radius) continue;
          e.takeDamage(dmg);
          if (d > 1) {
            const pull = Math.min(maxPullPerTick, d * 0.9);
            e.x += ((cx - e.x) / d) * pull;
            e.y += ((cy - e.y) / d) * pull;
          }
        }
        if (elapsed >= this.ticks) timer.remove();
      }
    });
  }

  private createVisual(scene: Scene, cx: number, cy: number, radius: number): void {
    const lifetime = this.ticks * TICK_INTERVAL_MS;
    if (scene.textures.exists('vfx_void_orb')) {
      const s = scene.add.sprite(cx, cy, 'vfx_void_orb');
      s.setOrigin(0.5, 0.5);
      s.setScale(Math.max(0.5, (radius * 2) / s.width));
      scene.tweens.add({ targets: s, angle: 360, duration: lifetime, ease: 'Linear' });
      scene.tweens.add({ targets: s, alpha: 0, scale: s.scale * 0.3, delay: lifetime - 220, duration: 220, onComplete: () => s.destroy() });
      return;
    }
    const g = scene.add.graphics();
    g.setScrollFactor(1);
    g.fillStyle(0x2a004f, 0.3);
    g.fillCircle(cx, cy, radius);
    g.lineStyle(3, 0x9b59ff, 0.8);
    g.strokeCircle(cx, cy, radius);
    g.strokeCircle(cx, cy, radius * 0.45);
    scene.tweens.add({ targets: g, alpha: 0, duration: lifetime, ease: 'Quad.easeIn', onComplete: () => g.destroy() });
  }

  public upgrade(): void {
    this.level++;
    this.damage *= 1.18;
    this.range += 12;
  }

  // Mirrors upgrade(): keep in sync if the deltas above change.
  public getUpgradePreview(): string {
    return 'Dmg +18% · Range +12';
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
