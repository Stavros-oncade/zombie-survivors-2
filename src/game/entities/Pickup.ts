import { PickupType } from '../types/GameTypes';
import { Game } from '../scenes/Game';

export class Pickup extends Phaser.Physics.Arcade.Sprite {
    private pickupType: PickupType;
    private value: number;
    private floatTween: Phaser.Tweens.Tween | null = null;
    private glowEffect: Phaser.FX.Glow | null = null;

    constructor(scene: Phaser.Scene, x: number, y: number, type: PickupType) {
        const spriteKey = Pickup.getSpriteKeyForType(type);
        super(scene, x, y, spriteKey);
        this.pickupType = type;
        this.initialize();
    }

    private static getSpriteKeyForType(type: PickupType): string {
        switch (type) {
            case PickupType.HEALTH:
                return 'pickup_health';
            case PickupType.SPEED:
                return 'pickup_speed';
            case PickupType.DAMAGE:
                return 'pickup_dmg';
            case PickupType.EXPERIENCE:
                return 'pickup_xp';
            case PickupType.BOMB:
                return 'pickup_bomb';
            default:
                return 'pickup_health';
        }
    }

    private initialize(): void {
        // Enable physics
        this.scene.physics.add.existing(this);
        
        // Set properties based on pickup type
        switch (this.pickupType) {
            case PickupType.HEALTH:
                this.value = 20; // Heal 20 HP
                // No tint needed for health pickup as it uses the asset
                break;
            case PickupType.SPEED:
                this.value = 1.5; // 50% speed boost for 5 seconds
                this.setTint(0x00ff00); // Green tint
                break;
            case PickupType.DAMAGE:
                this.value = 1.3; // 30% damage boost for 5 seconds
                break;
            case PickupType.EXPERIENCE:
                this.value = 50; // 50 XP
                this.setTint(0xffff00); // Yellow tint
                break;
            case PickupType.BOMB:
                this.value = 10; // 10x weapon damage multiplier
                break;
        }

        // Add floating animation
        this.startFloatingAnimation();
        
        // Add glow effect
        this.addGlowEffect();
    }

    private startFloatingAnimation(): void {
        // Create a floating animation
        this.floatTween = this.scene.tweens.add({
            targets: this,
            y: this.y - 10,
            duration: 1000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    private addGlowEffect(): void {
        if (this.preFX) {
            this.glowEffect = this.preFX.addGlow(0xffffff, 4, 0, false, 0.1, 16);
        }
    }

    public getType(): PickupType {
        return this.pickupType;
    }

    public getValue(): number {
        return this.value;
    }

    public collect(): void {
        // Stop the floating animation
        if (this.floatTween) {
            this.floatTween.stop();
        }
        
        // Remove glow effect
        if (this.glowEffect && this.preFX) {
            this.glowEffect.destroy();
        }
        
        // Play collection animation
        this.scene.tweens.add({
            targets: this,
            alpha: 0,
            scale: 1.5,
            duration: 200,
            onComplete: () => {
                // Remove from collected pickups set if the scene is a Game scene
                if (this.scene.scene.key === 'Game' && this.scene instanceof Game) {
                    this.scene.removeFromCollectedPickups(this);
                }
                this.destroy();
            }
        });
    }

    public destroy(fromScene?: boolean): void {
        // Clean up tweens when destroyed
        if (this.floatTween) {
            this.floatTween.stop();
        }
        
        super.destroy(fromScene);
    }
} 