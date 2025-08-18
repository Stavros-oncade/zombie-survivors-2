import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';

export interface IWeapon {
  fire(scene: Scene, player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void;
  upgrade(): void;
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

