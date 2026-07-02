import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';
import { IWeapon } from './IWeapon';

// Sniper Rifle: very slow, single high-alpha-strike shot that always targets
// the FARTHEST enemy within its own long range (the opposite of every other
// weapon's nearest-enemy targeting) — a "pick off the straggler at the edge
// of the pack" niche weapon rather than a sustained-DPS one.

export class SniperRifleWeapon implements IWeapon {
  private damage: number;
  private tempDamageMultiplier: number = 1;
  private attackSpeed: number; // shots per second
  private projectileSpeed: number;
  private level: number;
  private lastFired: number = 0;
  private range: number;

  constructor(_scene: Scene, config: { damage: number; attackSpeed: number; projectileSpeed: number; range: number; level: number }) {
    this.damage = config.damage;
    this.attackSpeed = config.attackSpeed;
    this.projectileSpeed = config.projectileSpeed;
    this.range = config.range;
    this.level = config.level;
  }

  public fire(scene: Scene, player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void {
    const now = scene.time.now;
    if (now - this.lastFired < 1000 / this.attackSpeed) return;

    // Find the FARTHEST enemy within range (no-op if nothing is in range).
    let target: Enemy | null = null;
    let farthest = 0;
    for (const e of enemies) {
      if (!(e instanceof Enemy) || !e.active) continue;
      const d = Phaser.Math.Distance.Between(player.x, player.y, e.x, e.y);
      if (d <= this.range && d > farthest) { farthest = d; target = e; }
    }
    if (!target) return;
    this.lastFired = now;

    const angle = Phaser.Math.Angle.Between(player.x, player.y, target.x, target.y);
    const spawnX = player.x + Math.cos(angle) * 12;
    const spawnY = player.y + Math.sin(angle) * 12;
    const tex = scene.textures.exists('proj_sniper') ? 'proj_sniper' : 'projectile';
    const proj = scene.add.sprite(spawnX, spawnY, tex);
    scene.physics.add.existing(proj);
    proj.setScale(0.5);
    proj.setRotation(angle);
    (proj.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(angle) * this.projectileSpeed, Math.sin(angle) * this.projectileSpeed);

    // Single-target, one-hit collider (mirrors Weapon.ts's base pattern) — no pierce.
    const colliders: Phaser.Physics.Arcade.Collider[] = [];
    const cleanup = () => {
      colliders.forEach(c => c.destroy());
      colliders.length = 0;
      if (proj && proj.active) proj.destroy();
    };
    enemies.forEach(enemy => {
      if (!(enemy instanceof Enemy)) return;
      const collider = scene.physics.add.collider(proj, enemy, () => {
        if (!proj.active || !enemy.active) return;
        enemy.takeDamage(this.getDamage());
        cleanup();
      });
      colliders.push(collider);
    });

    // Lifetime must be based on THIS weapon's own (long) range, not the shared
    // ExplosionConfig-derived constant other weapons use — that's shorter than
    // this weapon's range and would kill the shot before it reaches a far target.
    const maxLifetime = Math.ceil((this.range / this.projectileSpeed) * 1000);
    scene.time.delayedCall(Math.min(2000, maxLifetime), cleanup);
  }

  public upgrade(): void {
    this.level++;
    this.damage *= 1.2;
    // Deliberately slow attack-speed growth so the "very slow" identity holds at high levels.
    this.attackSpeed *= 1.05;
    if (this.level % 3 === 0) this.range += 100;
  }

  // Mirrors upgrade(): keep in sync if the deltas above change.
  public getUpgradePreview(): string {
    const parts = ['Dmg +20% · Speed +5%'];
    if ((this.level + 1) % 3 === 0) parts.push('Range +100');
    return parts.join(' · ');
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
