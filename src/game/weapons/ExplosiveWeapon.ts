import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';
import { IWeapon } from './IWeapon';

// Assets needed:
// - explosion sprite or spritesheet (e.g., 'explosion_small.png') for burst VFX.
//   Fallback: uses a graphics circle if asset not present.

export class ExplosiveWeapon implements IWeapon {
  private damage: number;
  private tempDamageMultiplier: number = 1;
  private attackSpeed: number;
  private range: number; // burst radius
  private level: number;
  private lastFired: number = 0;
  private shotCounter: number = 0; // only fire AoE every N shots

  constructor(_scene: Scene, config: { damage: number; attackSpeed: number; range: number; level: number }) {
    this.damage = config.damage;
    this.attackSpeed = config.attackSpeed;
    this.range = config.range;
    this.level = config.level;
  }

  public fire(scene: Scene, player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void {
    const now = scene.time.now;
    if (now - this.lastFired < 1000 / this.attackSpeed) return;
    this.lastFired = now;
    this.shotCounter++;

    // Only trigger AoE every 4th shot to reduce frequency
    if (this.shotCounter % 4 !== 0) return;

    // Deal AoE around player
    const px = player.x, py = player.y;
    const affected = enemies.filter(e => e.active && Phaser.Math.Distance.Between(px, py, e.x, e.y) <= this.range);
    // Apply damage first
    const dmg = this.getDamage();
    affected.forEach(e => e.takeDamage(dmg));

    // Visual burst only if at least one enemy was hit (avoid constant flashing)
    if (affected.length > 0) {
      if (scene.textures.exists('explosion_small')) {
        const s = scene.add.sprite(px, py, 'explosion_small');
        s.setOrigin(0.5, 0.5).setScrollFactor(1);
        s.setScale(Math.max(0.5, this.range / 160));
        // Ensure no physics moves this visual
        const body = s.body as (Phaser.Physics.Arcade.Body | undefined);
        if (body) { body.setVelocity(0, 0); body.allowGravity = false; body.moves = false; }
        scene.tweens.add({ targets: s, alpha: 0, scale: 1.35, duration: 220, onComplete: () => s.destroy() });
      } else {
        const g = scene.add.graphics();
        g.setScrollFactor(1);
        g.setPosition(px, py);
        g.fillStyle(0xffaa00, 0.25);
        g.fillCircle(0, 0, this.range);
        scene.tweens.add({ targets: g, alpha: 0, duration: 160, onComplete: () => g.destroy() });
      }
    }
  }

  public upgrade(): void {
    this.level++;
    this.damage *= 1.15;
    this.attackSpeed *= 1.1;
    this.range += 10;
  }

  // Mirrors upgrade(): keep in sync if the deltas above change.
  public getUpgradePreview(): string {
    return 'Dmg +15% · Speed +10% · Range +10';
  }

  public upgradeDamage(multiplier: number): void { this.damage *= multiplier; }
  public upgradeSpeed(multiplier: number): void { this.attackSpeed *= multiplier; }
  public upgradeProjectileSpeed(_multiplier: number): void { /* no-op for AoE weapon */ }
  public getDamage(): number { return Math.max(0, this.damage * this.tempDamageMultiplier); }
  public setDamage(v: number): void { this.damage = Math.max(0, v); }

  public setTempDamageMultiplier(multiplier: number): void {
    this.tempDamageMultiplier = Math.max(0, multiplier);
  }

  public getAttackSpeed(): number { return this.attackSpeed; }
  public getProjectileSpeed(): number { return 0; }
  public getLevel(): number { return this.level; }
}
