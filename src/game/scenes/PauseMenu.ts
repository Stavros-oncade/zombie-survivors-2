import { GameObjects, Scene } from 'phaser';

export class PauseMenu extends Scene {
    private background: GameObjects.Rectangle;
    private title: GameObjects.Text;
    private resumeButton: GameObjects.Text;
    private mainMenuButton: GameObjects.Text;
    private closeButton: GameObjects.Text;
    public isVisible: boolean = false;
    private escapeKey!: Phaser.Input.Keyboard.Key;

    constructor() {
        super('PauseMenu');
    }

    create() {
        // Add escape key
        if (this.input.keyboard) {
            this.escapeKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
        }
        
        // Create semi-transparent background
        this.background = this.add.rectangle(0, 0, this.cameras.main.width, this.cameras.main.height, 0x000000, 0.7)
            .setOrigin(0, 0)
            .setDepth(1000)
            .setScrollFactor(0);

        // Create title
        this.title = this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2 - 100, 'PAUSED', {
            fontFamily: 'Arial Black',
            fontSize: '48px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 6
        })
        .setOrigin(0.5)
        .setDepth(1001)
        .setScrollFactor(0);

        // Create resume button
        this.resumeButton = this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2, 'Resume', {
            fontFamily: 'Arial',
            fontSize: '32px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 4,
            backgroundColor: '#333333',
            padding: { x: 20, y: 10 }
        })
        .setOrigin(0.5)
        .setDepth(1001)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => this.resumeButton.setStyle({ color: '#ffff00' }))
        .on('pointerout', () => this.resumeButton.setStyle({ color: '#ffffff' }))
        .on('pointerdown', () => this.resumeGame());

        // Create main menu button
        this.mainMenuButton = this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2 + 60, 'Main Menu', {
            fontFamily: 'Arial',
            fontSize: '32px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 4,
            backgroundColor: '#333333',
            padding: { x: 20, y: 10 }
        })
        .setOrigin(0.5)
        .setDepth(1001)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => this.mainMenuButton.setStyle({ color: '#ffff00' }))
        .on('pointerout', () => this.mainMenuButton.setStyle({ color: '#ffffff' }))
        .on('pointerdown', () => this.goToMainMenu());

        // Create close button (X) in the top-right corner
        this.closeButton = this.add.text(this.cameras.main.width - 20, 20, '✕', {
            fontFamily: 'Arial',
            fontSize: '32px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 4
        })
        .setOrigin(1, 0)
        .setDepth(1001)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => this.closeButton.setStyle({ color: '#ffff00' }))
        .on('pointerout', () => this.closeButton.setStyle({ color: '#ffffff' }))
        .on('pointerdown', () => this.resumeGame());

        // Hide the menu initially
        this.hide();
    }

    update() {
        // Check for escape key press
        if (this.escapeKey && Phaser.Input.Keyboard.JustDown(this.escapeKey) && this.isVisible) {
            this.resumeGame();
        }
    }

    show() {
        this.background.setVisible(true);
        this.title.setVisible(true);
        this.resumeButton.setVisible(true);
        this.mainMenuButton.setVisible(true);
        this.closeButton.setVisible(true);
        this.isVisible = true;
    }

    hide() {
        this.background.setVisible(false);
        this.title.setVisible(false);
        this.resumeButton.setVisible(false);
        this.mainMenuButton.setVisible(false);
        this.closeButton.setVisible(false);
        this.isVisible = false;
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    private resumeGame() {
        this.hide();
        this.scene.resume('Game');
    }

    private goToMainMenu() {
        this.scene.stop('Game');
        this.scene.start('MainMenu');
    }
} 