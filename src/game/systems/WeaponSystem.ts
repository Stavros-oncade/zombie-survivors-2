import { Scene } from 'phaser';
import { Player } from '../entities/Player';
import { Weapon } from '../weapons/Weapon';
import { GameConstants } from '../config/GameConstants';
import { Enemy } from '../entities/Enemy';
import { PiercingWeapon } from '../weapons/PiercingWeapon';
import { ExplosiveWeapon } from '../weapons/ExplosiveWeapon';
import { EvolvedInfernoLance } from '../weapons/EvolvedInfernoLance';

export class WeaponSystem {
    private scene: Scene;
    private player: Player;
    private weapons: (Weapon | PiercingWeapon | ExplosiveWeapon | EvolvedInfernoLance)[];
    private enemies: Phaser.Physics.Arcade.Group;

    constructor(scene: Scene, player: Player, enemies: Phaser.Physics.Arcade.Group) {
        this.scene = scene;
        this.player = player;
        this.enemies = enemies;
        this.weapons = [
            new Weapon(scene, {
                damage: GameConstants.WEAPONS.BASIC_DAMAGE,
                attackSpeed: GameConstants.WEAPONS.BASIC_ATTACK_SPEED,
                projectileSpeed: GameConstants.WEAPONS.BASIC_PROJECTILE_SPEED,
                level: 1
            })
        ];
    }

    public update(): void {
        // Get enemies that are actually in the scene
        const activeEnemies = this.enemies.getChildren().filter(enemy => enemy.active) as Enemy[];
        
        if (activeEnemies.length > 0) {
            this.weapons.forEach(weapon => {
                // All weapon classes share a compatible fire signature
                (weapon as any).fire(this.scene, this.player, activeEnemies);
            });
        }
    }

    public destroy(): void {
        // Clean up any resources if needed
        this.weapons = [];
    }

    public upgradeWeaponDamage(multiplier: number): void {
        this.weapons.forEach(weapon => (weapon as any).upgradeDamage?.(multiplier));
    }

    public upgradeWeaponSpeed(multiplier: number): void {
        this.weapons.forEach(weapon => (weapon as any).upgradeSpeed?.(multiplier));
    }

    public upgradeProjectileSpeed(multiplier: number): void {
        this.weapons.forEach(weapon => (weapon as any).upgradeProjectileSpeed?.(multiplier));
    }

    // Temporary damage overlay control for timed buffs (non-compounding)
    public setTempDamageMultiplier(multiplier: number): void {
        this.weapons.forEach(weapon => (weapon as any).setTempDamageMultiplier?.(multiplier));
    }

    public getWeapons(): Weapon[] {
        return this.weapons as any;
    }

    // New: unlock or upgrade specific weapons
    public unlockPiercing(): void {
        const existing = this.weapons.find(w => w instanceof PiercingWeapon) as PiercingWeapon | undefined;
        if (existing) {
            existing.upgrade();
        } else {
            this.weapons.push(new PiercingWeapon(this.scene, {
                damage: Math.round(GameConstants.WEAPONS.BASIC_DAMAGE * 0.8),
                attackSpeed: GameConstants.WEAPONS.BASIC_ATTACK_SPEED * 1.1,
                projectileSpeed: GameConstants.WEAPONS.BASIC_PROJECTILE_SPEED * 1.1,
                level: 1,
                pierceCount: 3
            }));
        }
        this.checkEvolution();
    }

    public unlockExplosive(): void {
        const existing = this.weapons.find(w => w instanceof ExplosiveWeapon) as ExplosiveWeapon | undefined;
        if (existing) {
            existing.upgrade();
        } else {
            this.weapons.push(new ExplosiveWeapon(this.scene, {
                damage: Math.round(GameConstants.WEAPONS.BASIC_DAMAGE * 1.1),
                // Slow down cadence; smaller radius by default
                attackSpeed: GameConstants.WEAPONS.BASIC_ATTACK_SPEED * 0.5,
                range: 80,
                level: 1
            }));
        }
        this.checkEvolution();
    }

    private checkEvolution(): void {
        const hasPiercing = this.weapons.find(w => w instanceof PiercingWeapon) as any;
        const hasExplosive = this.weapons.find(w => w instanceof ExplosiveWeapon) as any;
        const hasEvolved = this.weapons.find(w => w instanceof EvolvedInfernoLance);
        if (hasEvolved) return;
        if (hasPiercing && hasExplosive && hasPiercing.level >= 2 && hasExplosive.level >= 2) {
            // Remove base weapons and add evolved
            this.weapons = this.weapons.filter(w => !(w instanceof PiercingWeapon) && !(w instanceof ExplosiveWeapon));
            this.weapons.push(new EvolvedInfernoLance(this.scene, {
                damage: Math.round(GameConstants.WEAPONS.BASIC_DAMAGE * 1.5),
                attackSpeed: GameConstants.WEAPONS.BASIC_ATTACK_SPEED * 1.1,
                projectileSpeed: GameConstants.WEAPONS.BASIC_PROJECTILE_SPEED * 1.1,
                pierceCount: 2
            }));
        }
    }
}
