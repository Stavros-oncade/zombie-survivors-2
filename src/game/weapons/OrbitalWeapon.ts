import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';
import { IWeapon } from './IWeapon';

// Assets needed:
// - orbiting body sprite (e.g., 'proj_piercing' tinted). Falls back to 'projectile'.
//
// Orbital Shield: a small number of bodies orbit the player and damage anything
// they pass through. Pure 360 defense / zone control. The orbit sprites are
// created lazily and cached on the instance (never recreated per frame). A short
// per-enemy hit cooldown stored in the enemy data manager prevents a stationary
// enemy from being hit every frame.

export class OrbitalWeapon implements IWeapon {
  private damage: number;
  private tempDamageMultiplier: number = 1;
  private attackSpeed: number; // orbit hit-tick rate (used by Arsenal/Overclock multipliers)
  private level: number;
  private orbCount: number;
  private radius: number;
  private angularSpeed: number; // rad/s
  private hitCooldownMs: number;
  private angle: number = 0;
  private orbs: Phaser.GameObjects.Sprite[] = [];
  private lastUpdate: number = 0;

  constructor(_scene: Scene, config: {
    damage: number;
    attackSpeed: number;
    level: number;
    orbCount?: number;
    radius?: number;
    angularSpeed?: number;
    hitCooldownMs?: number;
  }) {
    this.damage = config.damage;
    this.attackSpeed = config.attackSpeed;
    this.level = config.level;
    this.orbCount = config.orbCount ?? 2;
    this.radius = config.radius ?? 70;
    this.angularSpeed = config.angularSpeed ?? 2.5;
    this.hitCooldownMs = config.hitCooldownMs ?? 400;
  }

  private ensureOrbs(scene: Scene): void {
    if (this.orbs.length === this.orbCount) return;
    // (Re)build the orb pool when orbCount changes (e.g. after upgrade()).
    this.orbs.forEach(o => o.destroy());
    this.orbs = [];
    const tex = scene.textures.exists('proj_piercing') ? 'proj_piercing' : 'projectile';
    for (let i = 0; i < this.orbCount; i++) {
      const orb = scene.add.sprite(0, 0, tex);
      orb.setScale(0.4);
      orb.setTint(0x66ffcc);
      this.orbs.push(orb);
    }
  }

  public fire(scene: Scene, player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void {
    this.ensureOrbs(scene);

    const now = scene.time.now;
    const dt = this.lastUpdate === 0 ? 0 : Math.min(0.05, (now - this.lastUpdate) / 1000);
    this.lastUpdate = now;
    this.angle += this.angularSpeed * dt;

    const dmg = this.getDamage();
    for (let i = 0; i < this.orbs.length; i++) {
      const a = this.angle + (i * Math.PI * 2) / this.orbs.length;
      const ox = player.x + Math.cos(a) * this.radius;
      const oy = player.y + Math.sin(a) * this.radius;
      const orb = this.orbs[i];
      orb.setPosition(ox, oy);

      for (const e of enemies) {
        if (!e.active) continue;
        const d = Phaser.Math.Distance.Between(ox, oy, e.x, e.y);
        if (d > 28) continue;
        const lastHit = (e.getData('__orbitHit') as number) ?? 0;
        if (now - lastHit < this.hitCooldownMs) continue;
        e.setData('__orbitHit', now);
        e.takeDamage(dmg);
      }
    }
  }

  public upgrade(): void {
    this.level++;
    this.damage *= 1.15;
    // Even levels add an orb (cap 4), odd levels grow the orbit radius.
    if (this.level % 2 === 0) {
      this.orbCount = Math.min(4, this.orbCount + 1);
    } else {
      this.radius += 8;
    }
  }

  // Mirrors upgrade(): keep in sync if the deltas above change.
  public getUpgradePreview(): string {
    const parts = ['Dmg +15%'];
    if ((this.level + 1) % 2 === 0) {
      if (this.orbCount < 4) parts.push('Orbs +1');
    } else {
      parts.push('Radius +8');
    }
    return parts.join(' · ');
  }

  public upgradeDamage(multiplier: number): void { this.damage *= multiplier; }
  public upgradeSpeed(multiplier: number): void { this.attackSpeed *= multiplier; this.angularSpeed *= multiplier; }
  public upgradeProjectileSpeed(_multiplier: number): void { /* no-op for orbital weapon */ }
  public getDamage(): number { return Math.max(0, this.damage * this.tempDamageMultiplier); }
  public setDamage(v: number): void { this.damage = Math.max(0, v); }
  public setTempDamageMultiplier(multiplier: number): void { this.tempDamageMultiplier = Math.max(0, multiplier); }
  public getAttackSpeed(): number { return this.attackSpeed; }
  public getProjectileSpeed(): number { return 0; }
  public getLevel(): number { return this.level; }
}
