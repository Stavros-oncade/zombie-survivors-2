import { GameConstants } from '../config/GameConstants';
import { EnemyType } from '../types/GameTypes';
import { Player } from './Player';

export class Enemy extends Phaser.Physics.Arcade.Sprite {
    private health: number;
    private maxHealth: number;
    private speed: number;
    private damage: number;
    private experienceValue: number;
    protected enemyType: EnemyType;

    constructor(scene: Phaser.Scene, x: number, y: number, type: EnemyType) {
        const spriteKey = Enemy.getSpriteKeyForType(type);
        super(scene, x, y, spriteKey);
        this.enemyType = type;
        this.initialize();
    }

    private static getSpriteKeyForType(type: EnemyType): string {
        switch (type) {
            case EnemyType.TANK:
                return 'enemy_tank';
            case EnemyType.FAST:
                return 'enemy';
            default:
                return 'enemy';
        }
    }

    private initialize(): void {
        // Enable physics
        this.scene.physics.add.existing(this);
        this.setScale(0.5); // Scale down enemy sprite
        
        // Adjust physics body size after scaling
        const scaleFactor = 0.5;
        // Important: setSize should ideally use the *original* texture dimensions
        // If the base texture dimensions are unknown, get them before scaling or use reasonable defaults.
        // Assuming base dimensions here, replace with actual if known.
        const baseWidth = this.width / this.scaleX; // Estimate base width before scale was applied
        const baseHeight = this.height / this.scaleY; // Estimate base height before scale was applied
        this.body?.setSize(baseWidth * scaleFactor, baseHeight * scaleFactor);
        // Optional: Center body if needed after resize
        // this.body?.setOffset(offsetX, offsetY);

        // Set properties based on enemy type
        switch (this.enemyType) {
            case EnemyType.FAST:
                this.health = GameConstants.ENEMIES.BASE_HEALTH * 0.5;
                this.speed = GameConstants.ENEMIES.INITIAL_SPEED * 1.5;
                this.damage = 3;
                this.experienceValue = 15;
                break;
            case EnemyType.TANK:
                this.health = GameConstants.ENEMIES.BASE_HEALTH * 2;
                this.speed = GameConstants.ENEMIES.INITIAL_SPEED * 0.7;
                this.damage = 9;
                this.experienceValue = 25;
                break;
            default: // BASIC
                this.health = GameConstants.ENEMIES.BASE_HEALTH;
                this.speed = GameConstants.ENEMIES.INITIAL_SPEED;
                this.damage = 6;
                this.experienceValue = 20;
        }

        this.maxHealth = this.health;
    }

    public moveTowardsPlayer(player: Player): void {
        const angle = Phaser.Math.Angle.Between(
            this.x,
            this.y,
            player.x,
            player.y
        );

        this.setVelocityX(Math.cos(angle) * this.speed);
        this.setVelocityY(Math.sin(angle) * this.speed);
    }

    public takeDamage(amount: number): void {
        this.health = Math.max(0, this.health - amount);
        
        if (this.health <= 0) {
            this.die();
        }
    }

    public getHealth(): number {
        return this.health;
    }

    public getMaxHealth(): number {
        return this.maxHealth;
    }

    public heal(amount: number): void {
        this.health = Math.min(this.maxHealth, this.health + amount);
    }

    private die(): void {
        // Emit event for experience gain
        this.scene.events.emit('enemyKilled', this.experienceValue);
        this.destroy();
    }

    public getDamage(): number {
        return this.damage;
    }
} 