import { Scene } from 'phaser';
import { Player } from '../entities/Player';
import { Weapon } from '../weapons/Weapon';
import { GameConstants } from '../config/GameConstants';
import { Enemy } from '../entities/Enemy';

export class WeaponSystem {
    private scene: Scene;
    private player: Player;
    private weapons: Weapon[];
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
                weapon.fire(this.scene, this.player, activeEnemies);
            });
        }
    }

    public destroy(): void {
        // Clean up any resources if needed
        this.weapons = [];
    }

    public upgradeWeaponDamage(multiplier: number): void {
        this.weapons.forEach(weapon => {
            weapon.upgradeDamage(multiplier);
        });
    }

    public upgradeWeaponSpeed(multiplier: number): void {
        this.weapons.forEach(weapon => {
            weapon.upgradeSpeed(multiplier);
        });
    }

    public upgradeProjectileSpeed(multiplier: number): void {
        this.weapons.forEach(weapon => {
            weapon.upgradeProjectileSpeed(multiplier);
        });
    }

    public getWeapons(): Weapon[] {
        return this.weapons;
    }
} 