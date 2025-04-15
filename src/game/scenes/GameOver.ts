import { EventBus } from '../EventBus';
import { Scene } from 'phaser';

export class GameOver extends Scene
{
    camera: Phaser.Cameras.Scene2D.Camera;
    background: Phaser.GameObjects.Image;
    gameOverText: Phaser.GameObjects.Text;
    statsText: Phaser.GameObjects.Text;
    menuButton: Phaser.GameObjects.Text;
    
    // Player stats
    enemiesKilled: number = 0;
    xpGained: number = 0;

    constructor ()
    {
        super('GameOver');
    }

    init(data: { enemiesKilled?: number, xpGained?: number })
    {
        // Get stats passed from the Game scene
        if (data.enemiesKilled !== undefined) this.enemiesKilled = data.enemiesKilled;
        if (data.xpGained !== undefined) this.xpGained = data.xpGained;
    }

    create ()
    {
        this.camera = this.cameras.main
        this.camera.setBackgroundColor(0xff0000);

        this.background = this.add.image(512, 384, 'background');
        this.background.setAlpha(0.5);

        this.gameOverText = this.add.text(512, 250, 'Game Over', {
            fontFamily: 'Arial Black', fontSize: 64, color: '#ffffff',
            stroke: '#000000', strokeThickness: 8,
            align: 'center'
        }).setOrigin(0.5).setDepth(100);
        
        // Display player stats
        this.statsText = this.add.text(512, 350, 
            `Enemies Killed: ${this.enemiesKilled}\nXP Gained: ${this.xpGained}`, {
            fontFamily: 'Arial', fontSize: 32, color: '#ffffff',
            stroke: '#000000', strokeThickness: 4,
            align: 'center'
        }).setOrigin(0.5).setDepth(100);
        
        // Create a button to return to the main menu
        this.menuButton = this.add.text(512, 500, 'Back to Main Menu', {
            fontFamily: 'Arial', fontSize: 32, color: '#ffffff',
            backgroundColor: '#000000',
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setDepth(100).setInteractive();
        
        // Add hover effect
        this.menuButton.on('pointerover', () => {
            this.menuButton.setStyle({ color: '#ffff00' });
        });
        
        this.menuButton.on('pointerout', () => {
            this.menuButton.setStyle({ color: '#ffffff' });
        });
        
        // Add click event to return to main menu
        this.menuButton.on('pointerdown', () => {
            this.changeScene();
        });
        
        EventBus.emit('current-scene-ready', this);
    }

    changeScene ()
    {
        this.scene.start('MainMenu');
    }
}
