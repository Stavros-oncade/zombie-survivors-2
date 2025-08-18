import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';
import { ExplosionConfig } from '../config/ExplosionConfig';
import { IWeapon } from './IWeapon';

// Assets needed:
// - projectile sprite for piercing shot (e.g., 'proj_piercing.png')
//   Fallback: uses existing 'projectile' if custom asset is not loaded.

export class PiercingWeapon implements IWeapon {
  private damage: number;
  private tempDamageMultiplier: number = 1;
  private attackSpeed: number; // shots per second
  private projectileSpeed: number;
  private level: number;
  private lastFired: number = 0;
  private pierceCount: number; // how many enemies a projectile can pierce

  constructor(_scene: Scene, config: { damage: number; attackSpeed: number; projectileSpeed: number; level: number; pierceCount?: number }) {
    this.damage = config.damage;
    this.attackSpeed = config.attackSpeed;
    this.projectileSpeed = config.projectileSpeed;
    this.level = config.level;
    this.pierceCount = config.pierceCount ?? 3;
  }

  public fire(scene: Scene, player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void {
    const now = scene.time.now;
    if (now - this.lastFired < 1000 / this.attackSpeed) return;

    // Find closest enemy
    let target: Enemy | null = null;
    let closest = Number.MAX_VALUE;
    for (const e of enemies) {
      if (!(e instanceof Enemy)) continue;
      const d = Phaser.Math.Distance.Between(player.x, player.y, e.x, e.y);
      if (d < closest) { closest = d; target = e; }
    }
    if (!target) return;
    this.lastFired = now;

    // Direction
    const angle = Phaser.Math.Angle.Between(player.x, player.y, target.x, target.y);
    const spawnX = player.x + Math.cos(angle) * 12;
    const spawnY = player.y + Math.sin(angle) * 12;
    const tex = scene.textures.exists('proj_piercing') ? 'proj_piercing' : 'projectile';
    const proj = scene.add.sprite(spawnX, spawnY, tex);
    scene.physics.add.existing(proj);
    proj.setRotation(angle);
    (proj.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(angle) * this.projectileSpeed, Math.sin(angle) * this.projectileSpeed);

    // Track how many enemies pierced
    (proj as any).__pierced = 0;
    // Add overlap for each enemy
    enemies.forEach(enemy => {
      scene.physics.add.overlap(proj, enemy, () => {
        if (!enemy.active || !proj.active) return;
        const pierced = (proj as any).__pierced as number;
        enemy.takeDamage(this.getDamage());
        (proj as any).__pierced = pierced + 1;
        if ((proj as any).__pierced >= this.pierceCount) {
          proj.destroy();
        }
      });
    });

    // Lifetime: limit by max range (3x bomb radius)
    const maxDistance = ExplosionConfig.RADIUS * 3;
    const maxLifetime = Math.ceil((maxDistance / this.projectileSpeed) * 1000);
    scene.time.delayedCall(Math.min(3000, maxLifetime), () => proj?.destroy());
  }

  public upgrade(): void {
    this.level++;
    this.damage *= 1.15;
    this.attackSpeed *= 1.1;
    this.pierceCount += 1;
  }

  public upgradeDamage(multiplier: number): void { this.damage *= multiplier; }
  public upgradeSpeed(multiplier: number): void { this.attackSpeed *= multiplier; }
  public upgradeProjectileSpeed(multiplier: number): void { this.projectileSpeed *= multiplier; }
  public getDamage(): number { return Math.max(0, this.damage * this.tempDamageMultiplier); }
  public setDamage(v: number): void { this.damage = Math.max(0, v); }

  public setTempDamageMultiplier(multiplier: number): void {
    this.tempDamageMultiplier = Math.max(0, multiplier);
  }

  public getAttackSpeed(): number { return this.attackSpeed; }
  public getProjectileSpeed(): number { return this.projectileSpeed; }
  public getLevel(): number { return this.level; }
}
