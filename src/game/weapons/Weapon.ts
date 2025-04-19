import { Scene } from 'phaser';
import { Enemy } from '../entities/Enemy';

interface WeaponConfig {
    damage: number;
    attackSpeed: number;
    projectileSpeed: number;
    level: number;
}

export class Weapon {
    private damage: number;
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

        // Add collision with enemies
        enemies.forEach(enemy => {
            if (!(enemy instanceof Enemy)) return;
            scene.physics.add.collider(projectile, enemy, () => {
                enemy.takeDamage(this.damage);
                projectile.destroy();
            });
        });

        // Destroy projectile after 2 seconds
        scene.time.delayedCall(4000, () => {
            if (projectile && projectile.active) {
                projectile.destroy();
            }
        });
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
        this.attackSpeed *= multiplier;
    }

    public upgradeProjectileSpeed(multiplier: number): void {
        this.projectileSpeed *= multiplier;
    }

    public getDamage(): number {
        return this.damage;
    }

    public getAttackSpeed(): number {
        return this.attackSpeed;
    }

    public getProjectileSpeed(): number {
        return this.projectileSpeed;
    }
} 