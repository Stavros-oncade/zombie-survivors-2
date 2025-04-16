import { PlayerStats } from '../types/GameTypes';

export class GameUI {
    private healthBar: Phaser.GameObjects.Graphics;
    private experienceBar: Phaser.GameObjects.Graphics;
    private levelText: Phaser.GameObjects.Text;
    private timerText: Phaser.GameObjects.Text;
    private scene: Phaser.Scene;
    private gameTime: number;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.gameTime = 0;
        this.initialize();
    }

    private initialize(): void {
        const padding = 16;
        let y = padding;

        // Create health bar
        this.healthBar = this.scene.add.graphics();
        this.healthBar.setScrollFactor(0);
        // Position relative to camera view (defaults to 0,0 which is correct for scrollFactor 0)
        // this.healthBar.setPosition(this.scene.cameras.main.x, this.scene.cameras.main.y); // REMOVED

        // Create experience bar
        this.experienceBar = this.scene.add.graphics();
        this.experienceBar.setScrollFactor(0);
        // Position relative to camera view (defaults to 0,0 which is correct for scrollFactor 0)
        // this.experienceBar.setPosition(this.scene.cameras.main.x, this.scene.cameras.main.y); // REMOVED

        // Create level text - Position relative to camera view
        this.levelText = this.scene.add.text(padding, y, 'Level: 1', { // REMOVED camera coordinates
            fontSize: '16px',
            color: '#fff',
            stroke: '#000000',
            strokeThickness: 4
        });
        this.levelText.setScrollFactor(0);
        y += 20;

        // Create timer text - Position relative to camera view
        this.timerText = this.scene.add.text(padding, y, 'Time: 0:00', { // REMOVED camera coordinates
            fontSize: '16px',
            color: '#fff',
            stroke: '#000000',
            strokeThickness: 4
        });
        this.timerText.setScrollFactor(0);
        y += 20;

        // Start timer
        this.scene.time.addEvent({
            delay: 1000,
            callback: this.updateTimer,
            callbackScope: this,
            loop: true
        });
    }

    private updateTimer(): void {
        this.gameTime++;
        const minutes = Math.floor(this.gameTime / 60);
        const seconds = this.gameTime % 60;
        this.timerText.setText(`Time: ${minutes}:${seconds.toString().padStart(2, '0')}`);
    }

    public update(playerStats: PlayerStats): void {
        const padding = 16;
        // Start Y position below the text elements
        // Level Text Y: padding, Timer Text Y: padding + 40
        // Start bars below Timer Text
        let y = padding + 40 + 40; 

        // Update health bar - Draw relative to the Graphics object's origin (which is view's top-left)
        this.healthBar.clear();
        this.healthBar.fillStyle(0x000000, 1);
        // Use coordinates relative to the view: (padding, y)
        this.healthBar.fillRect(padding, y, 200, 20); // REMOVED camera y coordinate
        this.healthBar.fillStyle(0xff0000, 1);
        this.healthBar.fillRect(
            padding,
            y, // REMOVED camera y coordinate
            (playerStats.health / playerStats.maxHealth) * 200,
            20
        );
        y += 28; // Space between bars

        // Update experience bar - Draw relative to the Graphics object's origin (which is view's top-left)
        this.experienceBar.clear();
        this.experienceBar.fillStyle(0x000000, 1);
        // Use coordinates relative to the view: (padding, y)
        this.experienceBar.fillRect(padding, y, 200, 20); // REMOVED camera x and y coordinates
        this.experienceBar.fillStyle(0x00ff00, 1);
        this.experienceBar.fillRect(
            padding,
            y, // REMOVED camera x and y coordinates
            (playerStats.experience / playerStats.experienceToNextLevel) * 200,
            20
        );

        // Update level text position (it might drift slightly otherwise, ensure it stays put)
        this.levelText.setPosition(padding, padding); // Ensure position stays correct
        this.levelText.setText(`Level: ${playerStats.level}`);

        // Update timer text position
        this.timerText.setPosition(padding, padding + 40); // Ensure position stays correct
    }

    public destroy(): void {
        this.healthBar.destroy();
        this.experienceBar.destroy();
        this.levelText.destroy();
        this.timerText.destroy();
    }
} 