import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';
import { ExplosionConfig } from '../config/ExplosionConfig';

// Assets needed:
// - evolved projectile sprite (e.g., 'proj_inferno.png')
// - optional special explosion VFX (e.g., 'explosion_inferno.png')

export class EvolvedInfernoLance {
  private damage: number;
  private tempDamageMultiplier: number = 1;
  private attackSpeed: number;
  private projectileSpeed: number;
  private lastFired: number = 0;
  private pierceCount: number;

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
    (proj as any).__pierced = 0;

    enemies.forEach(enemy => {
      scene.physics.add.overlap(proj, enemy, () => {
        if (!enemy.active || !proj.active) return;
        const pierced = (proj as any).__pierced as number;
        enemy.takeDamage(this.getDamage());
        (proj as any).__pierced = pierced + 1;
        // Create a small explosion at enemy position
        createMiniExplosion(scene, enemy.x, enemy.y);
        if ((proj as any).__pierced >= this.pierceCount) {
          proj.destroy();
        }
      });
    });

    const maxDistance = ExplosionConfig.RADIUS * 3;
    const speed = this.projectileSpeed;
    const maxLifetime = Math.ceil((maxDistance / speed) * 1000);
    scene.time.delayedCall(Math.min(3500, maxLifetime), () => proj?.destroy());
  }

  public upgrade(): void {
    this.damage *= 1.2;
    this.attackSpeed *= 1.15;
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
}

function createMiniExplosion(scene: Scene, x: number, y: number) {
  // Use ExplosionConfig for visual consistency
  const r = Math.max(60, ExplosionConfig.RADIUS * 0.4);
  const g = scene.add.graphics();
  g.fillStyle(0xff5500, 0.6);
  g.fillCircle(x, y, r);
  g.lineStyle(2, 0xffffff, 0.8);
  g.strokeCircle(x, y, r);
  scene.tweens.add({ targets: g, alpha: 0, scale: 1.3, duration: 250, onComplete: () => g.destroy() });
}
