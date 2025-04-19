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
    levelReached: number = 1;
    playTimeSeconds: number = 0;

    constructor ()
    {
        super('GameOver');
    }

    init(data: { 
        enemiesKilled?: number, 
        xpGained?: number, 
        levelReached?: number,
        playTimeSeconds?: number 
    })
    {
        // Get stats passed from the Game scene
        if (data.enemiesKilled !== undefined) this.enemiesKilled = data.enemiesKilled;
        if (data.xpGained !== undefined) this.xpGained = data.xpGained;
        if (data.levelReached !== undefined) this.levelReached = data.levelReached;
        if (data.playTimeSeconds !== undefined) this.playTimeSeconds = data.playTimeSeconds;
    }

    create ()
    {
        this.camera = this.cameras.main
        this.camera.setBackgroundColor(0x303030);

        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        this.background = this.add.image(width / 2, height / 2, 'enemy');
        this.background.setScale(4);
        this.background.setAlpha(0.7);

        const yOffset = 150;

        this.gameOverText = this.add.text(width / 2, height / 3 - yOffset, 'Game Over', {
            fontFamily: 'Arial Black', fontSize: 64, color: '#ffffff',
            stroke: '#000000', strokeThickness: 8,
            align: 'center'
        }).setOrigin(0.5).setDepth(100);
        
        // Format play time as minutes and seconds (same format as GameUI)
        const minutes = Math.floor(this.playTimeSeconds / 60);
        const seconds = this.playTimeSeconds % 60;
        const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        
        // Display player stats
        this.statsText = this.add.text(width / 2, height / 2 + yOffset/2, 
            `Enemies Killed: ${this.enemiesKilled}\nXP Gained: ${this.xpGained}\nLevel Reached: ${this.levelReached}\nPlay Time: ${formattedTime}`, {
            fontFamily: 'Arial', fontSize: 32, color: '#ffffff',
            stroke: '#000000', strokeThickness: 4,
            align: 'center'
        }).setOrigin(0.5).setDepth(100);
        
        // Create a button to return to the main menu
        this.menuButton = this.add.text(width / 2, height / 2 + yOffset*2, 'Back to Main Menu', {
            fontFamily: 'Arial', fontSize: 32, color: '#ffffff',
            backgroundColor: '#000000', stroke: '#000000', strokeThickness: 4,
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
        
        // Emit scene ready event directly to the game
        this.scene.get('Game').events.emit('current-scene-ready', this);
    }

    changeScene ()
    {
        this.scene.start('MainMenu');
    }
}
