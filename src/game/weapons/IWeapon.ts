import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';

export interface IWeapon {
  fire(scene: Scene, player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void;
  /** Optional per-frame hook that runs regardless of whether enemies are present
   *  (e.g. companion/summon movement that should never freeze). dt is in ms. */
  update?(scene: Scene, player: Phaser.Physics.Arcade.Sprite, dt: number): void;
  upgrade(): void;
  /** Human-readable deltas the NEXT upgrade() will apply, for the level-up card
   *  (e.g. "Dmg +15% · Chains +1"). Optional: weapons without it show level only. */
  getUpgradePreview?(): string;
  upgradeDamage(multiplier: number): void;
  upgradeSpeed(multiplier: number): void;
  upgradeProjectileSpeed(multiplier: number): void;
  getDamage(): number;
  setDamage(value: number): void;
  getAttackSpeed(): number;
  getProjectileSpeed(): number;
  getLevel(): number;
  setTempDamageMultiplier(multiplier: number): void;
}

