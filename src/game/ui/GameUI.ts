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

        // Create experience bar
        this.experienceBar = this.scene.add.graphics();
        this.experienceBar.setScrollFactor(0);

        // Create level text
        this.levelText = this.scene.add.text(padding, y, 'Level: 1', {
            fontSize: '32px',
            color: '#fff'
        });
        this.levelText.setScrollFactor(0);
        y += 40;

        // Create timer text
        this.timerText = this.scene.add.text(padding, y, 'Time: 0:00', {
            fontSize: '32px',
            color: '#fff'
        });
        this.timerText.setScrollFactor(0);
        y += 40;

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
        let y = padding + 80; // below the texts
        // Update health bar
        this.healthBar.clear();
        this.healthBar.fillStyle(0x000000, 1);
        this.healthBar.fillRect(padding, y, 200, 20);
        this.healthBar.fillStyle(0xff0000, 1);
        this.healthBar.fillRect(
            padding,
            y,
            (playerStats.health / playerStats.maxHealth) * 200,
            20
        );
        y += 28;

        // Update experience bar
        this.experienceBar.clear();
        this.experienceBar.fillStyle(0x000000, 1);
        this.experienceBar.fillRect(padding, y, 200, 20);
        this.experienceBar.fillStyle(0x00ff00, 1);
        this.experienceBar.fillRect(
            padding,
            y,
            (playerStats.experience / playerStats.experienceToNextLevel) * 200,
            20
        );

        // Update level text
        this.levelText.setText(`Level: ${playerStats.level}`);
    }

    public destroy(): void {
        this.healthBar.destroy();
        this.experienceBar.destroy();
        this.levelText.destroy();
        this.timerText.destroy();
    }
} 