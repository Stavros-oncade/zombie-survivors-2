import { Scene } from 'phaser';
import { EnemyType } from '../types/GameTypes';

export class DeathEffect {
    private sprite: Phaser.GameObjects.Sprite;
    private scene: Scene;
    private readonly grayMatrix = [
        0.3, 0.3, 0.3, 0, 0,
        0.3, 0.3, 0.3, 0, 0,
        0.3, 0.3, 0.3, 0, 0,
        0,   0,   0,   1, 0
    ];

    constructor(scene: Scene, x: number, y: number, texture: string, enemyType?: EnemyType) {
        this.scene = scene;
        this.sprite = scene.add.sprite(x, y, texture);
        this.sprite.setScale(0.5); // Match enemy scale
        
        // Apply effects based on enemy type
        if (this.sprite.preFX) {
            // For tank enemies, add a bloom effect that flashes briefly
            if (enemyType === EnemyType.TANK) {
                const bloomFX = this.sprite.preFX.addBloom(0xffffff, 0, 0, 1, 2, 4);
                
                // Remove bloom after a short flash and then apply grayscale
                this.scene.time.delayedCall(100, () => {
                    // Check if bloomFX exists before trying to destroy it
                    if (bloomFX && this.sprite.preFX) {
                        bloomFX.destroy();
                    }
                    
                    // Apply grayscale after bloom is removed
                    if (this.sprite.preFX) {
                        const colorFX = this.sprite.preFX.addColorMatrix();
                        colorFX.set(this.grayMatrix);
                    }
                    
                    // Start fade out
                    this.startFadeOut();
                });
            } else {
                // For non-tank enemies, just apply grayscale and fade
                const colorFX = this.sprite.preFX.addColorMatrix();
                colorFX.set(this.grayMatrix);
                
                // Start fade out immediately
                this.startFadeOut();
            }
        }
    }
    
    private startFadeOut(): void {
        // Add fade effect using Phaser's tween system
        this.scene.tweens.add({
            targets: this.sprite,
            alpha: 0,
            duration: 500,
            onComplete: () => {
                this.sprite.destroy();
            }
        });
    }
} 