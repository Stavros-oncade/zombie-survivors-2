import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';
import { ExplosionConfig } from '../config/ExplosionConfig';
import { IWeapon } from './IWeapon';

// Sentry Drone: autonomous drones trail the player and fire homing bolts at the
// nearest enemy on their own cadence. The drone bodies are long-lived sprites
// cached on the instance — created lazily, never per frame — and destroyed in
// dispose() so a run teardown does not leak them. Each bolt tracks its colliders
// and cleans them up on hit/timeout (same discipline as Weapon.ts).

export class SentryDroneWeapon implements IWeapon {
  private damage: number;
  private tempDamageMultiplier: number = 1;
  private attackSpeed: number; // per-drone fire cadence (shots/sec)
  private projectileSpeed: number;
  private level: number;
  private droneCount: number;
  private drones: Phaser.GameObjects.Sprite[] = [];
  private droneLastFired: number[] = [];
  // Per-drone roaming target offset (relative to player) and bob phase so the
  // companions wander organically instead of orbiting on a fixed circle.
  private roamTarget: { x: number; y: number }[] = [];
  private bobPhase: number[] = [];

  constructor(_scene: Scene, config: { damage: number; attackSpeed: number; projectileSpeed: number; level: number; droneCount?: number }) {
    this.damage = config.damage;
    this.attackSpeed = config.attackSpeed;
    this.projectileSpeed = config.projectileSpeed;
    this.level = config.level;
    this.droneCount = config.droneCount ?? 1;
  }

  // Small roaming radius the companion hovers within (px from player).
  private static readonly ROAM_RADIUS = 60;
  // Distance at which a drone is "close enough" and picks a new wander target.
  private static readonly ARRIVE_DIST = 10;

  private ensureDrones(scene: Scene): void {
    if (this.drones.length === this.droneCount) return;
    this.drones.forEach(d => d.destroy());
    this.drones = [];
    this.droneLastFired = [];
    this.roamTarget = [];
    this.bobPhase = [];
    for (let i = 0; i < this.droneCount; i++) {
      const drone = scene.add.sprite(0, 0, 'sentry_drone');
      drone.setScale(0.9);
      this.drones.push(drone);
      this.droneLastFired.push(0);
      // Spread initial roam targets so multiple drones don't stack.
      this.roamTarget.push(this.pickRoamOffset(i));
      this.bobPhase.push(Math.random() * Math.PI * 2);
    }
  }

  // Pick a random offset within the small roaming radius. A per-drone angular
  // bias keeps multiple drones in different arcs around the player.
  private pickRoamOffset(index: number): { x: number; y: number } {
    const bias = (index * Math.PI * 2) / Math.max(1, this.droneCount);
    const ang = bias + (Math.random() - 0.5) * Math.PI * 1.2;
    const r = SentryDroneWeapon.ROAM_RADIUS * (0.45 + Math.random() * 0.55);
    return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
  }

  /**
   * Per-frame movement decoupled from firing so the companion keeps wandering
   * even when no enemies are present. Drones lerp toward a random nearby target
   * offset from the player and pick a fresh one once they arrive, with a gentle
   * vertical bob layered on top. dt is in ms; the lerp is made frame-rate-aware.
   */
  public update(scene: Scene, player: Phaser.Physics.Arcade.Sprite, dt: number): void {
    this.ensureDrones(scene);
    const now = scene.time.now;
    // Frame-rate-aware smoothing: ~0.105 lerp at 60fps, scaled by dt.
    const t = 1 - Math.pow(1 - 0.105, dt / (1000 / 60));

    for (let i = 0; i < this.drones.length; i++) {
      const drone = this.drones[i];
      const target = this.roamTarget[i];
      const bob = Math.sin(now * 0.004 + this.bobPhase[i]) * 4;
      const tx = player.x + target.x;
      const ty = player.y + target.y + bob;
      drone.setPosition(
        Phaser.Math.Linear(drone.x, tx, t),
        Phaser.Math.Linear(drone.y, ty, t)
      );
      // Arrived near the current target → wander to a new nearby point.
      if (Phaser.Math.Distance.Between(drone.x, drone.y, tx, ty) < SentryDroneWeapon.ARRIVE_DIST) {
        this.roamTarget[i] = this.pickRoamOffset(i);
      }
    }
  }

  public fire(scene: Scene, _player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void {
    this.ensureDrones(scene);
    const now = scene.time.now;
    const cadence = 1000 / this.attackSpeed;

    for (let i = 0; i < this.drones.length; i++) {
      const drone = this.drones[i];

      if (now - this.droneLastFired[i] < cadence) continue;

      // Nearest enemy for this drone.
      let target: Enemy | null = null;
      let closest = Number.MAX_VALUE;
      for (const e of enemies) {
        if (!(e instanceof Enemy) || !e.active) continue;
        const d = Phaser.Math.Distance.Between(drone.x, drone.y, e.x, e.y);
        if (d < closest) { closest = d; target = e; }
      }
      if (!target) continue;
      this.droneLastFired[i] = now;
      this.fireBolt(scene, drone.x, drone.y, target, enemies);
    }
  }

  private fireBolt(scene: Scene, sx: number, sy: number, target: Enemy, enemies: Enemy[]): void {
    const angle = Phaser.Math.Angle.Between(sx, sy, target.x, target.y);
    const proj = scene.add.sprite(sx, sy, 'projectile');
    scene.physics.add.existing(proj);
    proj.setScale(0.4);
    proj.setRotation(angle);
    (proj.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(angle) * this.projectileSpeed, Math.sin(angle) * this.projectileSpeed);

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

    const maxDistance = ExplosionConfig.RADIUS * 3;
    const maxLifetime = Math.ceil((maxDistance / this.projectileSpeed) * 1000);
    scene.time.delayedCall(Math.min(3000, maxLifetime), cleanup);
  }

  public upgrade(): void {
    this.level++;
    this.damage *= 1.15;
    if (this.level % 2 === 0) this.droneCount = Math.min(3, this.droneCount + 1);
    else this.attackSpeed *= 1.1;
  }

  // Mirrors upgrade(): keep in sync if the deltas above change.
  public getUpgradePreview(): string {
    const parts = ['Dmg +15%'];
    if ((this.level + 1) % 2 === 0) {
      if (this.droneCount < 3) parts.push('Drones +1');
    } else {
      parts.push('Speed +10%');
    }
    return parts.join(' · ');
  }

  // Summon lifecycle: destroy cached drone sprites on run teardown.
  public dispose(): void {
    this.drones.forEach(d => d.destroy());
    this.drones = [];
    this.droneLastFired = [];
    this.roamTarget = [];
    this.bobPhase = [];
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
