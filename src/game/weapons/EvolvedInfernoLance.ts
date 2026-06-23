import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';
import { ExplosionConfig } from '../config/ExplosionConfig';
import { IWeapon } from './IWeapon';

// Assets needed:
// - evolved projectile sprite (e.g., 'proj_inferno.png')
// - optional special explosion VFX (e.g., 'explosion_inferno.png')

export class EvolvedInfernoLance implements IWeapon {
  private damage: number;
  private tempDamageMultiplier: number = 1;
  private attackSpeed: number;
  private projectileSpeed: number;
  private lastFired: number = 0;
  private pierceCount: number;
  private level: number = 1;

  constructor(_scene: Scene, config: { damage: number; attackSpeed: number; projectileSpeed: number; pierceCount?: number }) {
    this.damage = config.damage;
    this.attackSpeed = config.attackSpeed;
    this.projectileSpeed = config.projectileSpeed;
    this.pierceCount = config.pierceCount ?? 2;
  }

  public fire(scene: Scene, player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void {
    const now = scene.time.now;
    if (now - this.lastFired < 1000 / this.attackSpeed) return;
    // Find closest target
    let target: Enemy | null = null;
    let closest = Number.MAX_VALUE;
    for (const e of enemies) {
      if (!(e instanceof Enemy)) continue;
      const d = Phaser.Math.Distance.Between(player.x, player.y, e.x, e.y);
      if (d < closest) { closest = d; target = e; }
    }
    if (!target) return;
    this.lastFired = now;

    const angle = Phaser.Math.Angle.Between(player.x, player.y, target.x, target.y);
    const spawnX = player.x + Math.cos(angle) * 12;
    const spawnY = player.y + Math.sin(angle) * 12;
    const tex = scene.textures.exists('proj_inferno') ? 'proj_inferno' : (scene.textures.exists('proj_piercing') ? 'proj_piercing' : 'projectile');
    const proj = scene.add.sprite(spawnX, spawnY, tex);
    scene.physics.add.existing(proj);
    proj.setRotation(angle);
    (proj.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(angle) * this.projectileSpeed, Math.sin(angle) * this.projectileSpeed);
    proj.setDataEnabled();
    proj.data?.set('__pierced', 0);

    // Track the per-enemy overlaps so they are removed when the projectile dies;
    // otherwise every shot leaks overlaps that keep firing on destroyed objects.
    const overlaps: Phaser.Physics.Arcade.Collider[] = [];
    const destroyProj = () => {
      overlaps.forEach(o => o.destroy());
      overlaps.length = 0;
      if (proj && proj.active) proj.destroy();
    };
    enemies.forEach(enemy => {
      const overlap = scene.physics.add.overlap(proj, enemy, () => {
        if (!enemy.active || !proj.active) return;
        const pierced = (proj.data?.get('__pierced') as number) ?? 0;
        enemy.takeDamage(this.getDamage());
        proj.data?.set('__pierced', pierced + 1);
        // Create a small explosion at enemy position
        createMiniExplosion(scene, enemy.x, enemy.y);
        if (((proj.data?.get('__pierced') as number) ?? 0) >= this.pierceCount) {
          destroyProj();
        }
      });
      overlaps.push(overlap);
    });

    const maxDistance = ExplosionConfig.RADIUS * 3;
    const speed = this.projectileSpeed;
    const maxLifetime = Math.ceil((maxDistance / speed) * 1000);
    scene.time.delayedCall(Math.min(3500, maxLifetime), destroyProj);
  }

  public upgrade(): void {
    this.level += 1;
    this.damage *= 1.2;
    this.attackSpeed *= 1.15;
    this.pierceCount += 1;
  }

  public upgradeDamage(multiplier: number): void { this.damage *= multiplier; }
  public upgradeSpeed(multiplier: number): void { this.attackSpeed *= multiplier; }
  public upgradeProjectileSpeed(multiplier: number): void { this.projectileSpeed *= multiplier; }
  public getDamage(): number { return Math.max(0, this.damage * this.tempDamageMultiplier); }
  public setDamage(v: number): void { this.damage = Math.max(0, v); }
  public getAttackSpeed(): number { return this.attackSpeed; }
  public getProjectileSpeed(): number { return this.projectileSpeed; }
  public getLevel(): number { return this.level; }
  public setTempDamageMultiplier(multiplier: number): void { this.tempDamageMultiplier = Math.max(0, multiplier); }
}

function createMiniExplosion(scene: Scene, x: number, y: number) {
  // Use ExplosionConfig for visual consistency
  const r = Math.max(60, ExplosionConfig.RADIUS * 0.4);
  const g = scene.add.graphics();
  // Draw centered at local (0, 0) and move the object to (x, y) so the scale
  // tween grows the burst in place rather than scaling away from world origin.
  g.setPosition(x, y);
  g.fillStyle(0xff5500, 0.6);
  g.fillCircle(0, 0, r);
  g.lineStyle(2, 0xffffff, 0.8);
  g.strokeCircle(0, 0, r);
  scene.tweens.add({ targets: g, alpha: 0, scale: 1.3, duration: 250, onComplete: () => g.destroy() });
}
