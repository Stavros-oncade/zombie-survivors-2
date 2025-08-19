import { GameConstants } from '../config/GameConstants';
import { EnemyType, PickupType } from '../types/GameTypes';
// Note: base methods accept Phaser sprites to avoid tight coupling
import { DeathEffect } from '../effects/DeathEffect';
import { Pickup } from './Pickup';
import { Game } from '../scenes/Game';
import { SceneKey } from '../config/SceneKeys';

export class Enemy extends Phaser.Physics.Arcade.Sprite {
    private health: number;
    private maxHealth: number;
    private speed: number;
    private damage: number;
    private experienceValue: number;
    protected enemyType: EnemyType;
    private isStunned: boolean = false;
    private stunTimer: Phaser.Time.TimerEvent | null = null;
    private readonly damageFlashMatrix = [
        1, 0, 0, 0, 0,   // Red channel unchanged
        0.3, 0.3, 0.3, 0, 0, // Green channel dimmed (30% of original)
        0.3, 0.3, 0.3, 0, 0, // Blue channel dimmed (30% of original)
        0, 0, 0, 1, 0    // Alpha unchanged
    ];

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
                return 'enemy_fast';
            case EnemyType.RANGED:
                return 'enemy_ranged';
            case EnemyType.CARRIER:
                return 'enemy_carrier';
            case EnemyType.TOXIC:
                return 'enemy_toxic';
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
                this.experienceValue = 30;
                break;
            case EnemyType.TANK:
                this.health = GameConstants.ENEMIES.BASE_HEALTH * 2;
                this.speed = GameConstants.ENEMIES.INITIAL_SPEED * 0.7;
                this.damage = 9;
                this.experienceValue = 35;
                break;
            case EnemyType.CARRIER:
                this.health = GameConstants.ENEMIES.BASE_HEALTH;
                this.speed = GameConstants.ENEMIES.INITIAL_SPEED * 0.8; // 20% slower
                this.damage = 6;
                this.experienceValue = 25;
                break;
            case EnemyType.TOXIC:
                this.health = GameConstants.ENEMIES.BASE_HEALTH * 1.5;
                this.speed = GameConstants.ENEMIES.INITIAL_SPEED * 0.6;
                this.damage = 7;
                this.experienceValue = 35;
                break;
            default: // BASIC
                this.health = GameConstants.ENEMIES.BASE_HEALTH;
                this.speed = GameConstants.ENEMIES.INITIAL_SPEED;
                this.damage = 6;
                this.experienceValue = 20;
        }

        this.maxHealth = this.health;
    }

    public moveTowardsPlayer(player: Phaser.Physics.Arcade.Sprite): void {
        // Skip movement if stunned
        if (this.isStunned) return;
        
        const angle = Phaser.Math.Angle.Between(
            this.x,
            this.y,
            player.x,
            player.y
        );

        this.setVelocityX(Math.cos(angle) * this.speed);
        this.setVelocityY(Math.sin(angle) * this.speed);
    }

    /**
     * Adjust current health directly. Clamped to [0, maxHealth].
     */
    public setHealth(value: number): void {
        this.health = Math.max(0, Math.min(value, this.maxHealth));
    }

    /**
     * Adjust maximum health. If current health exceeds new max, it will be clamped down.
     */
    public setMaxHealth(value: number): void {
        this.maxHealth = Math.max(0, value);
        if (this.health > this.maxHealth) {
            this.health = this.maxHealth;
        }
    }

    /**
     * Try to add a glow effect using Phaser's preFX if available.
     * Returns true if the effect was applied.
     */
    public tryAddGlow(color: number, distance: number, _quality: number, knockout: boolean, alpha: number, strength: number): boolean {
        // Use optional chaining; Phaser may or may not have preFX in this runtime
        const addGlow = this.preFX?.addGlow as ((color: number, distance: number, quality: number, knockout: boolean, alpha: number, strength: number) => void) | undefined;
        if (typeof addGlow === 'function') {
            addGlow(color, distance, 0, knockout, alpha, strength);
            return true;
        }
        return false;
    }

    public takeDamage(amount: number): void {
        this.health = Math.max(0, this.health - amount);
        
        // Apply damage flash effect
        if (this.preFX) {
            const fx = this.preFX.addColorMatrix();
            fx.set(this.damageFlashMatrix);
            
            // Reset the effect after a short delay
            this.scene.time.delayedCall(100, () => {
                // Only reset if the enemy still exists
                if (this.active && this.preFX) {
                    fx.reset();
                }
            });
        }
        
        // Hit number (juice) - occasional to reduce clutter
        if (this.scene && Math.random() < 0.3) {
            const txt = this.scene.add.text(this.x, this.y - 20, `-${Math.round(amount)}`, {
                fontSize: '14px', color: '#ff4444', stroke: '#000000', strokeThickness: 2
            }).setDepth(1000);
            this.scene.tweens.add({ targets: txt, y: this.y - 40, alpha: 0, duration: 500, onComplete: () => txt.destroy() });
        }
        
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

    protected die(): void {
        // Create death effect before destroying the enemy
        new DeathEffect(this.scene, this.x, this.y, this.texture.key, this.enemyType);
        
        // Clear any existing effects before destroying
        if (this.preFX) {
            this.preFX.clear();
        }
        
        // Check for pickup drop using constant from GameConstants
        if (Math.random() < GameConstants.ENEMIES.PICKUP_DROP_RATE) {
            this.dropPickup();
        }
        
        // Emit event for experience gain
        this.scene.events.emit('enemyKilled', this.experienceValue);
        this.destroy();
    }
    
    private dropPickup(): void {
        // Randomly select a pickup type
        const pickupTypes = [
            PickupType.HEALTH,
            PickupType.SPEED,
            PickupType.DAMAGE,
            PickupType.EXPERIENCE,
            PickupType.BOMB
        ];
        
        const randomType = pickupTypes[Math.floor(Math.random() * pickupTypes.length)];
        
        // Create the pickup at the enemy's position
        const pickup = new Pickup(this.scene, this.x, this.y, randomType);
        
        // Add to the scene
        this.scene.add.existing(pickup);
        
        // Add to the pickups physics group if the scene is a Game scene
        if (this.scene.scene.key === SceneKey.Game && this.scene instanceof Game) {
            const pickupsGroup = this.scene.getPickupsGroup();
            if (pickupsGroup) {
                pickupsGroup.add(pickup);
            }
        }
        
        // Emit event for pickup creation
        this.scene.events.emit('pickupCreated', pickup);
    }

    public getDamage(): number {
        return this.damage;
    }

    public applyKnockback(force: number, angle: number): void {
        // Cancel any existing stun timer
        if (this.stunTimer) {
            this.stunTimer.destroy();
            this.stunTimer = null;
        }
        
        // Apply knockback force
        const knockbackX = Math.cos(angle) * force;
        const knockbackY = Math.sin(angle) * force;
        
        if (this.body) {
            (this.body as Phaser.Physics.Arcade.Body).setVelocity(knockbackX, knockbackY);
        }
        
        // Set stunned state
        this.isStunned = true;
        
        // Visual indicator for stun (optional)
        if (this.preFX) {
            const originalTint = this.tint;
            this.setTint(0x888888); // Gray tint to indicate stun
            
            // Create stun timer
            this.stunTimer = this.scene.time.delayedCall(500, () => {
                this.isStunned = false;
                this.setTint(originalTint);
            });
        } else {
            // If no preFX, just create the timer
            this.stunTimer = this.scene.time.delayedCall(500, () => {
                this.isStunned = false;
            });
        }
    }

    public destroy(fromScene?: boolean): void {
        // Clean up stun timer if it exists
        if (this.stunTimer) {
            this.stunTimer.destroy();
            this.stunTimer = null;
        }
        
        super.destroy(fromScene);
    }
} 
