import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';
import { IWeapon } from './IWeapon';

// Tesla Arc: lightning that leaps between clustered enemies. Pure graphics bolts
// (no projectile object, no colliders) — each cast does distance tests against the
// live enemies array, so there is nothing to leak.

export class TeslaArcWeapon implements IWeapon {
  private damage: number;
  private tempDamageMultiplier: number = 1;
  private attackSpeed: number;
  private level: number;
  private lastFired: number = 0;
  private chainCount: number;
  private chainRange: number;

  constructor(_scene: Scene, config: { damage: number; attackSpeed: number; level: number; chainCount?: number; chainRange?: number }) {
    this.damage = config.damage;
    this.attackSpeed = config.attackSpeed;
    this.level = config.level;
    this.chainCount = config.chainCount ?? 3;
    this.chainRange = config.chainRange ?? 180;
  }

  public fire(scene: Scene, player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void {
    const now = scene.time.now;
    if (now - this.lastFired < 1000 / this.attackSpeed) return;

    // Nearest enemy is the first hop.
    let target: Enemy | null = null;
    let closest = Number.MAX_VALUE;
    for (const e of enemies) {
      if (!(e instanceof Enemy) || !e.active) continue;
      const d = Phaser.Math.Distance.Between(player.x, player.y, e.x, e.y);
      if (d < closest) { closest = d; target = e; }
    }
    if (!target) return;
    this.lastFired = now;

    const dmg = this.getDamage();
    const hit = new Set<Enemy>();
    let fromX = player.x, fromY = player.y;
    let current: Enemy | null = target;

    for (let hop = 0; hop < this.chainCount && current; hop++) {
      current.takeDamage(dmg);
      hit.add(current);
      this.drawBolt(scene, fromX, fromY, current.x, current.y);
      fromX = current.x; fromY = current.y;

      // Find nearest un-hit enemy within chainRange to continue the arc.
      let next: Enemy | null = null;
      let bestD = this.chainRange;
      for (const e of enemies) {
        if (!(e instanceof Enemy) || !e.active || hit.has(e)) continue;
        const d = Phaser.Math.Distance.Between(fromX, fromY, e.x, e.y);
        if (d <= bestD) { bestD = d; next = e; }
      }
      current = next;
    }
  }

  private drawBolt(scene: Scene, x1: number, y1: number, x2: number, y2: number): void {
    const g = scene.add.graphics();
    g.setScrollFactor(1);
    g.lineStyle(2, 0x66ccff, 0.9);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.strokePath();
    scene.tweens.add({ targets: g, alpha: 0, duration: 140, onComplete: () => g.destroy() });
  }

  public upgrade(): void {
    this.level++;
    this.damage *= 1.15;
    if (this.level % 2 === 0) this.chainCount = Math.min(6, this.chainCount + 1);
    else this.chainRange += 20;
  }

  // Mirrors upgrade(): keep in sync if the deltas above change.
  public getUpgradePreview(): string {
    const parts = ['Dmg +15%'];
    if ((this.level + 1) % 2 === 0) {
      if (this.chainCount < 6) parts.push('Chains +1');
    } else {
      parts.push('Range +20');
    }
    return parts.join(' · ');
  }

  public upgradeDamage(multiplier: number): void { this.damage *= multiplier; }
  public upgradeSpeed(multiplier: number): void { this.attackSpeed *= multiplier; }
  public upgradeProjectileSpeed(_multiplier: number): void { /* no-op for chaining weapon */ }
  public getDamage(): number { return Math.max(0, this.damage * this.tempDamageMultiplier); }
  public setDamage(v: number): void { this.damage = Math.max(0, v); }
  public setTempDamageMultiplier(multiplier: number): void { this.tempDamageMultiplier = Math.max(0, multiplier); }
  public getAttackSpeed(): number { return this.attackSpeed; }
  public getProjectileSpeed(): number { return 0; }
  public getLevel(): number { return this.level; }
}
