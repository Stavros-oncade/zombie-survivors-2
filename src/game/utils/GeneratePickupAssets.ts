import { Scene } from 'phaser';

export class PickupAssetGenerator {
    private scene: Scene;

    constructor(scene: Scene) {
        this.scene = scene;
    }

    public generatePickupAssets(): void {
    }

    private generatePickupTexture(key: string, color: number): void {
        // Create a graphics object
        const graphics = this.scene.add.graphics();
        
        // Draw a circle with the specified color
        graphics.fillStyle(color);
        graphics.fillCircle(16, 16, 16);
        
        // Add a white border
        graphics.lineStyle(2, 0xffffff);
        graphics.strokeCircle(16, 16, 16);
        
        // Add a small white dot in the center
        graphics.fillStyle(0xffffff);
        graphics.fillCircle(16, 16, 4);
        
        // Generate texture from graphics
        graphics.generateTexture(key, 32, 32);
        
        // Destroy the graphics object
        graphics.destroy();
    }
} 