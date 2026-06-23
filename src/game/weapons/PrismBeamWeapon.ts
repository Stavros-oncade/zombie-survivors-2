import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';
import { IWeapon } from './IWeapon';

// Prism Beam: a sustained beam that locks to the nearest threat and applies damage
// on a fast tick. The beam is drawn as a graphics line from the player to the
// target each tick and faded out (destroyed) — no persistent object to leak.
// Enemies whose centers fall within beamThickness of the beam segment also take
// damage (a soft pierce along the line).

export class PrismBeamWeapon implements IWeapon {
  private damage: number;
  private tempDamageMultiplier: number = 1;
  private attackSpeed: number; // ticks/sec
  private level: number;
  private lastFired: number = 0;
  private beamRange: number;
  private beamThickness: number = 22;

  constructor(_scene: Scene, config: { damage: number; attackSpeed: number; level: number; beamRange?: number }) {
    this.damage = config.damage;
    this.attackSpeed = config.attackSpeed;
    this.level = config.level;
    this.beamRange = config.beamRange ?? 260;
  }

  public fire(scene: Scene, player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void {
    const now = scene.time.now;
    if (now - this.lastFired < 1000 / this.attackSpeed) return;

    // Lock to nearest enemy within range.
    let target: Enemy | null = null;
    let closest = this.beamRange;
    for (const e of enemies) {
      if (!(e instanceof Enemy) || !e.active) continue;
      const d = Phaser.Math.Distance.Between(player.x, player.y, e.x, e.y);
      if (d <= closest) { closest = d; target = e; }
    }
    if (!target) return;
    this.lastFired = now;

    const dmg = this.getDamage();
    const tx = target.x, ty = target.y;
    const line = new Phaser.Geom.Line(player.x, player.y, tx, ty);

    // Damage every enemy whose center lies within beamThickness of the segment.
    for (const e of enemies) {
      if (!e.active) continue;
      const d = this.pointToSegment(e.x, e.y, player.x, player.y, tx, ty);
      if (d <= this.beamThickness) e.takeDamage(dmg);
    }

    this.drawBeam(scene, line);
  }

  private pointToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Phaser.Math.Distance.Between(px, py, x1, y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Phaser.Math.Clamp(t, 0, 1);
    return Phaser.Math.Distance.Between(px, py, x1 + t * dx, y1 + t * dy);
  }

  private drawBeam(scene: Scene, line: Phaser.Geom.Line): void {
    const g = scene.add.graphics();
    g.setScrollFactor(1);
    g.lineStyle(4, 0xff5577, 0.8);
    g.strokeLineShape(line);
    scene.tweens.add({ targets: g, alpha: 0, duration: 90, onComplete: () => g.destroy() });
  }

  public upgrade(): void {
    this.level++;
    this.damage *= 1.12;
    if (this.level % 2 === 0) this.beamRange += 30;
    else this.attackSpeed *= 1.1;
  }

  // Mirrors upgrade(): keep in sync if the deltas above change.
  public getUpgradePreview(): string {
    const parts = ['Dmg +12%'];
    if ((this.level + 1) % 2 === 0) parts.push('Range +30');
    else parts.push('Speed +10%');
    return parts.join(' · ');
  }

  public upgradeDamage(multiplier: number): void { this.damage *= multiplier; }
  public upgradeSpeed(multiplier: number): void { this.attackSpeed *= multiplier; }
  public upgradeProjectileSpeed(_multiplier: number): void { /* no-op for beam weapon */ }
  public getDamage(): number { return Math.max(0, this.damage * this.tempDamageMultiplier); }
  public setDamage(v: number): void { this.damage = Math.max(0, v); }
  public setTempDamageMultiplier(multiplier: number): void { this.tempDamageMultiplier = Math.max(0, multiplier); }
  public getAttackSpeed(): number { return this.attackSpeed; }
  public getProjectileSpeed(): number { return 0; }
  public getLevel(): number { return this.level; }
}
