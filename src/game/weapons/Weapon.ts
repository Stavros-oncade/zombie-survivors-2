import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';
import { IWeapon } from './IWeapon';
import { ExplosionConfig } from '../config/ExplosionConfig';
import { GameConstants } from '../config/GameConstants';

interface WeaponConfig {
    damage: number;
    attackSpeed: number;
    projectileSpeed: number;
    level: number;
}

export class Weapon implements IWeapon {
    private damage: number;
    private tempDamageMultiplier: number = 1;
    private attackSpeed: number;
    private projectileSpeed: number;
    private level: number;
    private lastFired: number = 0;

    constructor(_scene: Scene, config: WeaponConfig) {
        this.damage = config.damage;
        this.attackSpeed = config.attackSpeed;
        this.projectileSpeed = config.projectileSpeed;
        this.level = config.level;
    }

    public fire(scene: Scene, player: Phaser.Physics.Arcade.Sprite, enemies: Enemy[]): void {
        const currentTime = scene.time.now;
        if (currentTime - this.lastFired < 1000 / this.attackSpeed) return;

        // Find closest enemy
        let closestEnemy: Enemy | null = null;
        let closestDistance = Number.MAX_VALUE;
        
        for (const enemy of enemies) {
            if (!(enemy instanceof Enemy)) continue;
            const distance = Phaser.Math.Distance.Between(
                player.x, player.y,
                enemy.x, enemy.y
            );
            if (distance < closestDistance) {
                closestDistance = distance;
                closestEnemy = enemy;
            }
        }

        if (!closestEnemy) return;

        this.lastFired = currentTime;

        // Calculate angle to closest enemy
        const angle = Phaser.Math.Angle.Between(
            player.x, player.y,
            closestEnemy.x, closestEnemy.y
        );

        // Calculate spawn position 1% along the vector towards enemy
        const spawnDistance = 10; // 1% of the way
        const spawnX = player.x + (closestEnemy.x - player.x) * (spawnDistance / 100);
        const spawnY = player.y + (closestEnemy.y - player.y) * (spawnDistance / 100);

        // Create projectile and add to scene
        const projectile = scene.add.sprite(
            spawnX,
            spawnY,
            'projectile'
        );
        
        // Enable physics after adding to scene
        scene.physics.add.existing(projectile);

        // Set projectile properties
        projectile.setScale(0.5); // Make projectile smaller
        projectile.setRotation(angle); // Point projectile towards target
        
        // Calculate velocity towards enemy
        const velocityX = this.projectileSpeed * Math.cos(angle);
        const velocityY = this.projectileSpeed * Math.sin(angle);
        (projectile.body as Phaser.Physics.Arcade.Body).setVelocity(velocityX, velocityY);

        // Add collision with enemies. Track the colliders so they can be removed
        // when the projectile dies — otherwise every shot leaks a per-enemy collider
        // that keeps firing on destroyed projectiles/enemies.
        const colliders: Phaser.Physics.Arcade.Collider[] = [];
        const cleanup = () => {
            colliders.forEach(c => c.destroy());
            colliders.length = 0;
            if (projectile && projectile.active) {
                projectile.destroy();
            }
        };
        enemies.forEach(enemy => {
            if (!(enemy instanceof Enemy)) return;
            const collider = scene.physics.add.collider(projectile, enemy, () => {
                if (!projectile.active || !enemy.active) return;
                enemy.takeDamage(this.getDamage());
                cleanup();
            });
            colliders.push(collider);
        });

        // Destroy projectile (and its colliders) after traveling max range or timeout
        const maxDistance = ExplosionConfig.RADIUS * 3;
        const maxLifetime = Math.ceil((maxDistance / this.projectileSpeed) * 1000);
        scene.time.delayedCall(Math.min(4000, maxLifetime), cleanup);
    }

    public upgrade(): void {
        this.level++;
        this.damage *= 1.2;
        this.attackSpeed *= 1.1;
    }

    public upgradeDamage(multiplier: number): void {
        this.damage *= multiplier;
    }

    public upgradeSpeed(multiplier: number): void {
        // Clamp to the hard cap so the Weapon Speed upgrade can actually max out
        // (and then be filtered from the level-up pool instead of showing 4 -> 4).
        this.attackSpeed = Math.min(this.attackSpeed * multiplier, GameConstants.WEAPONS.MAX_ATTACK_SPEED);
    }

    /** True once the basic weapon's attack speed has hit its hard cap. Used by the
     *  level-up filter to drop the (now no-op) Weapon Speed upgrade from the pool. */
    public isAttackSpeedMaxed(): boolean {
        return this.attackSpeed >= GameConstants.WEAPONS.MAX_ATTACK_SPEED;
    }

    public upgradeProjectileSpeed(multiplier: number): void {
        this.projectileSpeed *= multiplier;
    }

    public getDamage(): number {
        return Math.max(0, this.damage * this.tempDamageMultiplier);
    }

    public getAttackSpeed(): number {
        return this.attackSpeed;
    }

    public getProjectileSpeed(): number {
        return this.projectileSpeed;
    }

    public setDamage(value: number): void {
        this.damage = Math.max(0, value);
    }

    // Temporary damage multiplier support (e.g., timed buffs)
    public setTempDamageMultiplier(multiplier: number): void {
        // Directly set so applying twice with same value doesn't compound
        this.tempDamageMultiplier = Math.max(0, multiplier);
    }

    public getLevel(): number {
        return this.level;
    }
}
