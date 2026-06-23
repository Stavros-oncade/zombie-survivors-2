import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';
import { IWeapon } from './IWeapon';

// Frost Mine: deploy chilling mines on a slow cadence. A mine sits where dropped
// and, once an enemy enters its range, detonates — dealing AoE damage and slowing
// everything nearby. Mines are capped (FIFO-destroy oldest) and are long-lived
// graphics objects, so they are tracked on the instance and torn down in dispose().

interface Mine {
  g: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  armed: boolean;
}

export class FrostMineWeapon implements IWeapon {
  private damage: number;
  private tempDamageMultiplier: number = 1;
  private attackSpeed: number; // deploy cadence (mines/sec)
  private level: number;
  private lastFired: number = 0;
  private range: number;
  private mineCap: number;
  private mines: Mine[] = [];

  constructor(_scene: Scene, config: { damage: number; attackSpeed: number; level: number; range?: number; mineCap?: number }) {
    this.damage = config.damage;
    this.attackSpeed = config.attackSpeed;
    this.level = config.level;
    this.range = config.range ?? 120;
    this.mineCap = config.mineCap ?? 4;
  }

  public fire(scene: Scene, player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void {
    const now = scene.time.now;

    // Detonation check for armed mines.
    for (const mine of [...this.mines]) {
      if (!mine.armed) continue;
      const inRange = enemies.filter(e => e.active && Phaser.Math.Distance.Between(mine.x, mine.y, e.x, e.y) <= this.range);
      if (inRange.length > 0) {
        const dmg = this.getDamage();
        inRange.forEach(e => { e.takeDamage(dmg); e.applySlow(0.6, 1500); });
        this.detonateVfx(scene, mine.x, mine.y);
        this.removeMine(mine);
      }
    }

    // Deploy a new mine on cadence.
    if (now - this.lastFired < 1000 / this.attackSpeed) return;
    this.lastFired = now;
    this.deployMine(scene, player.x, player.y);
  }

  private deployMine(scene: Scene, x: number, y: number): void {
    while (this.mines.length >= this.mineCap) {
      this.removeMine(this.mines[0]);
    }
    const g = scene.add.graphics();
    g.setScrollFactor(1);
    g.setPosition(x, y);
    g.fillStyle(0x99eeff, 0.5);
    g.fillCircle(0, 0, 8);
    g.lineStyle(2, 0x99eeff, 0.8);
    g.strokeCircle(0, 0, 12);
    const mine: Mine = { g, x, y, armed: false };
    this.mines.push(mine);
    // Arm shortly after deploy so a mine doesn't instantly pop next to the player.
    scene.time.delayedCall(400, () => { mine.armed = true; });
  }

  private detonateVfx(scene: Scene, x: number, y: number): void {
    const g = scene.add.graphics();
    g.setScrollFactor(1);
    g.setPosition(x, y);
    g.fillStyle(0x99eeff, 0.25);
    g.fillCircle(0, 0, this.range);
    scene.tweens.add({ targets: g, alpha: 0, duration: 200, onComplete: () => g.destroy() });
  }

  private removeMine(mine: Mine): void {
    const idx = this.mines.indexOf(mine);
    if (idx !== -1) this.mines.splice(idx, 1);
    if (mine.g.active) mine.g.destroy();
  }

  public upgrade(): void {
    this.level++;
    this.damage *= 1.15;
    if (this.level % 2 === 0) this.mineCap = Math.min(8, this.mineCap + 1);
    else this.range += 12;
  }

  // Mirrors upgrade(): keep in sync if the deltas above change.
  public getUpgradePreview(): string {
    const parts = ['Dmg +15%'];
    if ((this.level + 1) % 2 === 0) {
      if (this.mineCap < 8) parts.push('Mines +1');
    } else {
      parts.push('Range +12');
    }
    return parts.join(' · ');
  }

  // Summon lifecycle: destroy cached mine graphics on run teardown.
  public dispose(): void {
    this.mines.forEach(m => { if (m.g.active) m.g.destroy(); });
    this.mines = [];
  }

  public upgradeDamage(multiplier: number): void { this.damage *= multiplier; }
  public upgradeSpeed(multiplier: number): void { this.attackSpeed *= multiplier; }
  public upgradeProjectileSpeed(_multiplier: number): void { /* no-op for area-denial weapon */ }
  public getDamage(): number { return Math.max(0, this.damage * this.tempDamageMultiplier); }
  public setDamage(v: number): void { this.damage = Math.max(0, v); }
  public setTempDamageMultiplier(multiplier: number): void { this.tempDamageMultiplier = Math.max(0, multiplier); }
  public getAttackSpeed(): number { return this.attackSpeed; }
  public getProjectileSpeed(): number { return 0; }
  public getLevel(): number { return this.level; }
}
