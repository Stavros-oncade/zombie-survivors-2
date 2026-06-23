import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';
import { ExplosionConfig } from '../config/ExplosionConfig';
import { IWeapon } from './IWeapon';

// Assets needed:
// - shard sprite 'proj_storm' -> falls back to 'proj_piercing' -> 'projectile'.
//   Orbit blades reuse the piercing texture tinted cyan.
//
// Storm Vortex (evolution of Piercing + Orbital): maintains fast-spinning
// piercing blades that orbit the player AND, on each emit tick, the blade
// nearest an enemy launches a short-range piercing shard outward (homes the
// nearest target, pierces pierceCount). Defensive orbit + offensive emitter.

const ORBIT_RADIUS = 70;
const ORBIT_ANGULAR_SPEED = 4.0; // rad/s (fast spin)
const CONTACT_HIT_COOLDOWN_MS = 350;

export class StormVortexWeapon implements IWeapon {
  private damage: number;
  private tempDamageMultiplier: number = 1;
  private attackSpeed: number; // orbit/emit tick rate
  private projectileSpeed: number;
  private level: number = 1;
  private orbCount: number;
  private pierceCount: number;
  private angle: number = 0;
  private lastUpdate: number = 0;
  private lastEmit: number = 0;
  private blades: Phaser.GameObjects.Sprite[] = [];

  constructor(_scene: Scene, config: {
    damage: number;
    attackSpeed: number;
    projectileSpeed: number;
    orbCount?: number;
    pierceCount?: number;
  }) {
    this.damage = config.damage;
    this.attackSpeed = config.attackSpeed;
    this.projectileSpeed = config.projectileSpeed;
    this.orbCount = config.orbCount ?? 3;
    this.pierceCount = config.pierceCount ?? 2;
  }

  private ensureBlades(scene: Scene): void {
    if (this.blades.length === this.orbCount) return;
    this.blades.forEach(b => b.destroy());
    this.blades = [];
    const tex = scene.textures.exists('proj_piercing') ? 'proj_piercing' : 'projectile';
    for (let i = 0; i < this.orbCount; i++) {
      const blade = scene.add.sprite(0, 0, tex);
      blade.setScale(0.45);
      blade.setTint(0x33ffff);
      this.blades.push(blade);
    }
  }

  public fire(scene: Scene, player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void {
    this.ensureBlades(scene);

    const now = scene.time.now;
    const dt = this.lastUpdate === 0 ? 0 : Math.min(0.05, (now - this.lastUpdate) / 1000);
    this.lastUpdate = now;
    this.angle += ORBIT_ANGULAR_SPEED * dt;

    const dmg = this.getDamage();
    // Position blades and apply contact damage with a per-enemy cooldown.
    for (let i = 0; i < this.blades.length; i++) {
      const a = this.angle + (i * Math.PI * 2) / this.blades.length;
      const bx = player.x + Math.cos(a) * ORBIT_RADIUS;
      const by = player.y + Math.sin(a) * ORBIT_RADIUS;
      const blade = this.blades[i];
      blade.setPosition(bx, by);
      blade.setRotation(a);

      for (const e of enemies) {
        if (!e.active) continue;
        if (Phaser.Math.Distance.Between(bx, by, e.x, e.y) > 28) continue;
        const lastHit = (e.getData('__stormHit') as number) ?? 0;
        if (now - lastHit < CONTACT_HIT_COOLDOWN_MS) continue;
        e.setData('__stormHit', now);
        e.takeDamage(dmg);
      }
    }

    // Emit a homing piercing shard on cadence from the blade nearest an enemy.
    if (now - this.lastEmit >= 1000 / this.attackSpeed) {
      this.emitShard(scene, player, enemies);
    }
  }

  private emitShard(scene: Scene, player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void {
    // Nearest enemy overall is the shard's target.
    let target: Enemy | null = null;
    let closest = Number.MAX_VALUE;
    for (const e of enemies) {
      if (!(e instanceof Enemy) || !e.active) continue;
      const d = Phaser.Math.Distance.Between(player.x, player.y, e.x, e.y);
      if (d < closest) { closest = d; target = e; }
    }
    if (!target) return;
    this.lastEmit = scene.time.now;

    // Launch from whichever blade is closest to that target.
    let origin = this.blades[0];
    let bClosest = Number.MAX_VALUE;
    for (const b of this.blades) {
      const d = Phaser.Math.Distance.Between(b.x, b.y, target.x, target.y);
      if (d < bClosest) { bClosest = d; origin = b; }
    }
    if (!origin) return;

    const angle = Phaser.Math.Angle.Between(origin.x, origin.y, target.x, target.y);
    const tex = scene.textures.exists('proj_storm')
      ? 'proj_storm'
      : (scene.textures.exists('proj_piercing') ? 'proj_piercing' : 'projectile');
    const proj = scene.add.sprite(origin.x, origin.y, tex);
    scene.physics.add.existing(proj);
    proj.setScale(0.4);
    proj.setTint(0x33ffff);
    proj.setRotation(angle);
    (proj.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(angle) * this.projectileSpeed, Math.sin(angle) * this.projectileSpeed);

    proj.setDataEnabled();
    proj.data?.set('__pierced', 0);
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
        if (((proj.data?.get('__pierced') as number) ?? 0) >= this.pierceCount) {
          destroyProj();
        }
      });
      overlaps.push(overlap);
    });

    // Short-range shard.
    const maxDistance = ExplosionConfig.RADIUS * 2;
    const maxLifetime = Math.ceil((maxDistance / this.projectileSpeed) * 1000);
    scene.time.delayedCall(Math.min(1500, maxLifetime), destroyProj);
  }

  public upgrade(): void {
    this.level++;
    this.damage *= 1.18;
    // Even levels add a blade (cap 5), odd levels add pierce.
    if (this.level % 2 === 0) {
      this.orbCount = Math.min(5, this.orbCount + 1);
    } else {
      this.pierceCount += 1;
    }
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
