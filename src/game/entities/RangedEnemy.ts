import { Enemy } from './Enemy';
import { EnemyType } from '../types/GameTypes';
import { ExplosionConfig } from '../config/ExplosionConfig';

type RangedVariant = 'single' | 'burst' | 'arc';

export class RangedEnemy extends Enemy {
  private minRange = 320;
  private maxRange = 520;
  private lastShot = 0;
  private fireInterval = 1000; // ms
  private projectileSpeed = 180; // slow enough to dodge
  private projectileLifetime = 4000; // ms
  private variant: RangedVariant = 'single';
  private bursting = false;
  private glowSprite: Phaser.GameObjects.Sprite | null = null;
  private glowFollowEvent?: Phaser.Time.TimerEvent;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, EnemyType.RANGED);
    this.setTint(0x66ccff);
    // Add a soft blue glow to make ranged enemies identifiable
    if ((this as any).preFX) {
      // Stronger glow so ranged enemies are highly visible
      (this as any).preFX.addGlow(0x66ccff, 8, 0, false, 0.2, 16);
    } else {
      // Fallback glow for environments without preFX (e.g., Canvas renderer)
      this.glowSprite = this.scene.add.sprite(this.x, this.y, this.texture.key);
      this.glowSprite.setScale(this.scaleX * 1.25, this.scaleY * 1.25);
      this.glowSprite.setTint(0x66ccff).setAlpha(0.35);
      this.glowSprite.setBlendMode(Phaser.BlendModes.ADD);
      this.glowSprite.setDepth(this.depth - 1);
      // Follow position periodically
      this.glowFollowEvent = this.scene.time.addEvent({ delay: 16, loop: true, callback: () => {
        if (this.glowSprite && this.active) this.glowSprite.setPosition(this.x, this.y);
      }});
    }
    // Ensure standoff distance is at least 50% larger than bomb radius
    const safeMin = Math.ceil(ExplosionConfig.RADIUS * 1.6); // 60% larger than bomb radius
    this.minRange = safeMin;
    this.maxRange = safeMin + 250;
    // Randomly choose a variant: 50% single, 25% burst, 25% arc
    const r = Math.random();
    if (r < 0.5) this.variant = 'single';
    else if (r < 0.75) this.variant = 'burst';
    else this.variant = 'arc';
  }

  public updateBehavior(player: Phaser.Physics.Arcade.Sprite): void {
    if (!this.active) return;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);
    // Maintain distance band
    if (dist < this.minRange) {
      // move away (speed reduced by 30%)
      const ang = Math.atan2(dy, dx) + Math.PI; // opposite
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(ang) * (120 * 0.7), Math.sin(ang) * (120 * 0.7));
    } else if (dist > this.maxRange) {
      // move toward (speed reduced by 30%)
      const ang = Math.atan2(dy, dx);
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(ang) * (100 * 0.7), Math.sin(ang) * (100 * 0.7));
    } else {
      // hold position (slight drift)
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    }

    // Fire when interval elapsed
    const now = this.scene.time.now;
    if (now - this.lastShot >= this.fireInterval && dist <= this.maxRange + 20) {
      this.lastShot = now;
      this.fireAt(player);
    }
  }

  private fireAt(player: Phaser.Physics.Arcade.Sprite) {
    // Base aim with small randomness +/- 5 degrees
    const baseAngle = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
    const spread = Phaser.Math.DegToRad(Phaser.Math.Between(-5, 5));
    const aim = baseAngle + spread;

    if (this.variant === 'single') {
      this.spawnProjectile(aim, player);
      return;
    }

    if (this.variant === 'arc') {
      const offset = Phaser.Math.DegToRad(10);
      this.spawnProjectile(aim - offset, player);
      this.spawnProjectile(aim, player);
      this.spawnProjectile(aim + offset, player);
      return;
    }

    // burst variant: 3 shots with 0.5s gaps
    if (this.variant === 'burst') {
      if (this.bursting) return;
      this.bursting = true;
      this.spawnProjectile(aim, player);
      this.scene.time.delayedCall(500, () => { if (this.active) this.spawnProjectile(aim + Phaser.Math.DegToRad(Phaser.Math.Between(-3,3)), player); });
      this.scene.time.delayedCall(1000, () => { if (this.active) { this.spawnProjectile(aim + Phaser.Math.DegToRad(Phaser.Math.Between(-3,3)), player); this.bursting = false; } });
      return;
    }
  }

  private spawnProjectile(angle: number, player: Phaser.Physics.Arcade.Sprite) {
    const proj = this.scene.add.sprite(this.x, this.y, this.scene.textures.exists('projectile') ? 'projectile' : undefined);
    proj.setTint(0xff8844);
    this.scene.physics.add.existing(proj);
    (proj.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(angle) * this.projectileSpeed, Math.sin(angle) * this.projectileSpeed);
    proj.setScale(0.6);
    // Overlap with player to deal damage
    this.scene.physics.add.overlap(proj, player, () => {
      if (!proj.active) return;
      (player as any).takeDamage?.(18, this); // triple damage
      proj.destroy();
    });
    // Lifetime cleanup
    this.scene.time.delayedCall(this.projectileLifetime, () => { if (proj && proj.active) proj.destroy(); });
  }

  public override destroy(fromScene?: boolean): void {
    if (this.glowFollowEvent) this.glowFollowEvent.destroy();
    if (this.glowSprite) this.glowSprite.destroy();
    super.destroy(fromScene);
  }
}
