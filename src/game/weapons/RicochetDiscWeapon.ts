import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';
import { IWeapon } from './IWeapon';

// Ricochet Disc: a fast disc fired at the nearest enemy that, on each hit,
// redirects toward the nearest not-just-hit enemy, up to bounceCount bounces,
// then expires. A single projectile object; bounce count + last-hit id are tracked
// on the projectile data manager. Colliders are tracked and cleaned on expiry.

export class RicochetDiscWeapon implements IWeapon {
  private damage: number;
  private tempDamageMultiplier: number = 1;
  private attackSpeed: number;
  private projectileSpeed: number;
  private level: number;
  private lastFired: number = 0;
  private bounceCount: number;

  constructor(_scene: Scene, config: { damage: number; attackSpeed: number; projectileSpeed: number; level: number; bounceCount?: number }) {
    this.damage = config.damage;
    this.attackSpeed = config.attackSpeed;
    this.projectileSpeed = config.projectileSpeed;
    this.level = config.level;
    this.bounceCount = config.bounceCount ?? 4;
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

    const angle = Phaser.Math.Angle.Between(player.x, player.y, target.x, target.y);
    const tex = scene.textures.exists('proj_piercing') ? 'proj_piercing' : 'projectile';
    const proj = scene.add.sprite(player.x + Math.cos(angle) * 12, player.y + Math.sin(angle) * 12, tex);
    scene.physics.add.existing(proj);
    proj.setScale(0.5);
    proj.setTint(0xff66aa);
    proj.setRotation(angle);
    (proj.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(angle) * this.projectileSpeed, Math.sin(angle) * this.projectileSpeed);

    proj.setDataEnabled();
    proj.data?.set('__bounces', 0);
    proj.data?.set('__lastHit', -1);

    const overlaps: Phaser.Physics.Arcade.Collider[] = [];
    const destroyProj = () => {
      overlaps.forEach(o => o.destroy());
      overlaps.length = 0;
      if (proj && proj.active) proj.destroy();
    };

    enemies.forEach((enemy, idx) => {
      const overlap = scene.physics.add.overlap(proj, enemy, () => {
        if (!enemy.active || !proj.active) return;
        if ((proj.data?.get('__lastHit') as number) === idx) return;
        enemy.takeDamage(this.getDamage());
        const bounces = ((proj.data?.get('__bounces') as number) ?? 0) + 1;
        proj.data?.set('__bounces', bounces);
        proj.data?.set('__lastHit', idx);
        if (bounces >= this.bounceCount) { destroyProj(); return; }

        // Redirect toward the nearest other living enemy.
        let next: Enemy | null = null;
        let bestD = Number.MAX_VALUE;
        enemies.forEach((other, oIdx) => {
          if (oIdx === idx || !other.active) return;
          const d = Phaser.Math.Distance.Between(proj.x, proj.y, other.x, other.y);
          if (d < bestD) { bestD = d; next = other; }
        });
        if (!next) { destroyProj(); return; }
        const t = next as Enemy;
        const na = Phaser.Math.Angle.Between(proj.x, proj.y, t.x, t.y);
        proj.setRotation(na);
        (proj.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(na) * this.projectileSpeed, Math.sin(na) * this.projectileSpeed);
      });
      overlaps.push(overlap);
    });

    scene.time.delayedCall(3000, destroyProj);
  }

  public upgrade(): void {
    this.level++;
    this.damage *= 1.15;
    this.bounceCount = Math.min(9, this.bounceCount + 1);
  }

  // Mirrors upgrade(): keep in sync if the deltas above change.
  public getUpgradePreview(): string {
    const parts = ['Dmg +15%'];
    if (this.bounceCount < 9) parts.push('Bounces +1');
    return parts.join(' · ');
  }

  public upgradeDamage(multiplier: number): void { this.damage *= multiplier; }
  public upgradeSpeed(multiplier: number): void { this.attackSpeed *= multiplier; }
  public upgradeProjectileSpeed(multiplier: number): void { this.projectileSpeed *= multiplier; }
  public getDamage(): number { return Math.max(0, this.damage * this.tempDamageMultiplier); }
  public setDamage(v: number): void { this.damage = Math.max(0, v); }
  public setTempDamageMultiplier(multiplier: number): void { this.tempDamageMultiplier = Math.max(0, multiplier); }
  public getAttackSpeed(): number { return this.attackSpeed; }
  public getProjectileSpeed(): number { return this.projectileSpeed; }
  public getLevel(): number { return this.level; }
}
