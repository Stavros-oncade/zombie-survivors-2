import { GameObjects, Scene } from 'phaser';

import { EventBus } from '../EventBus';
import { initializeOncade, getStoreCatalog, openTipUrl, getAllConfig, getConfig } from '../../oncade/OncadeIntegration';
import { ScreenManager } from '../utils/ScreenManager';

export class MainMenu extends Scene
{
    background: GameObjects.Image;
    logo: GameObjects.Image;
    title: GameObjects.Text;
    playButton: GameObjects.Text;
    logoTween: Phaser.Tweens.Tween | null;
    zombies: GameObjects.Sprite[] = [];
    zombieTimer: Phaser.Time.TimerEvent | null = null;
    maxZombies: number = 10;
    currentZombieCount: number = 0;
    updateCallbacks: (() => void)[] = [];
    versionText: GameObjects.Text | null = null;
    motdText: GameObjects.Text | null = null;
    screenManager: ScreenManager;

    constructor ()
    {
        super('MainMenu');
        this.screenManager = ScreenManager.getInstance();
    }

    async create ()
    {
        // Initialize Oncade SDK first
        await initializeOncade().then(() => {
            console.log('Oncade initialized from MainMenu');
            // You could potentially enable Oncade buttons only after successful init
        }).catch((err: Error) => {
            console.error('Oncade failed to initialize from MainMenu:', err);
            // Handle error - maybe disable buttons or show a message
        });

        // Create and stretch background to fill the screen
        this.background = this.add.image(0, 0, 'background');
        this.background.setOrigin(0, 0);
        this.background.setDisplaySize(this.cameras.main.width, this.cameras.main.height);

        // Add version text in lower right corner
        try {
            const config = await getAllConfig();
            const version = config.version as string || '0.0.0';
            this.versionText = this.add.text(this.cameras.main.width - 10, this.cameras.main.height - 10, `v${version}`, {
                fontFamily: 'Arial',
                fontSize: '16px',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 4
            }).setOrigin(1, 1).setDepth(102);
            
            // Fetch and display Message of the Day if available
            const motd = await getConfig<string>('motd');
            if (motd) {
                this.motdText = this.add.text(this.cameras.main.width / 2, 100, motd, {
                    fontFamily: 'Arial',
                    fontSize: '20px',
                    color: '#ffffff',
                    stroke: '#000000',
                    strokeThickness: 4,
                    align: 'center',
                    wordWrap: { width: this.cameras.main.width * 0.8 }
                }).setOrigin(0.5, 0).setDepth(102);
            }
        } catch (error) {
            console.error('Failed to get config:', error);
            // Fallback version if config fetch fails
            this.versionText = this.add.text(this.cameras.main.width - 10, this.cameras.main.height - 10, 'v0.0.0', {
                fontFamily: 'Arial',
                fontSize: '16px',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 4
            }).setOrigin(1, 1).setDepth(102);
        }

        // Position and scale the logo at the top center of the screen
        this.logo = this.add.image(this.cameras.main.width / 2, 0, 'logo').setDepth(100);
        
        // Get the original dimensions of the logo
        const originalHeight = this.textures.get('logo').getSourceImage().height;
        const originalWidth = this.textures.get('logo').getSourceImage().width;
        
        // Calculate the maximum height for the logo (20% of screen height)
        const maxLogoHeight = this.cameras.main.height * .66;
        const maxLogoWidth = this.cameras.main.width;
        
        // Calculate the scale factor to fit the logo within the max height
        const scaleFactorHeight = Math.min(1, maxLogoHeight / originalHeight);
        const scaleFactorWidth = Math.min(1, maxLogoWidth / originalWidth);

        const scaleFactor = Math.min(scaleFactorHeight, scaleFactorWidth);
        
        // Apply the scale to the logo
        this.logo.setScale(scaleFactor);
        console.log('Logo scale factor:', scaleFactor);
        
        // Set the origin to the top center of the logo
        this.logo.setOrigin(0.5, 0);
        
        // Position the logo at the top center with some padding
        const topPadding = 10; // Increased padding to ensure logo is visible
        const buttonYOffset = 60; // Vertical space between buttons
        this.logo.setPosition(this.cameras.main.width / 2, topPadding);
        
        // Calculate button positions from bottom up
        const bottomPadding = 40; // Padding from bottom of screen
        const tipButtonY = this.cameras.main.height - bottomPadding;
        const storeButtonY = tipButtonY - buttonYOffset;
        const playButtonY = storeButtonY - buttonYOffset;
        
        // Create play button
        this.playButton = this.add.text(this.cameras.main.width / 2, playButtonY, 'Play', {
            fontFamily: 'Arial Black', fontSize: 32, color: '#ffffff',
            stroke: '#000000', strokeThickness: 6,
            align: 'center',
            padding: { x: 20, y: 10 }
        })
        .setOrigin(0.5)
        .setDepth(102)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => this.playButton.setStyle({ color: '#ffff00' }))
        .on('pointerout', () => this.playButton.setStyle({ color: '#ffffff' }))
        .on('pointerdown', () => this.changeScene());
        
        // --- Add Oncade Buttons --- 
        // Store Button (Now emits event to show React UI)
        const storeButton = this.createButton('Store', async () => {
            console.log('Store button clicked. Fetching catalog...');
            try {
                const catalog = await getStoreCatalog();
                if (catalog && catalog.length > 0) {
                    console.log('Catalog received, emitting show-store event:', catalog);
                    EventBus.emit('show-store', catalog);
                } else {
                    console.log('No items found in catalog or failed to fetch.');
                    // Optionally emit an event to show an empty store or error message
                    EventBus.emit('show-store', []); // Show empty store
                    // alert('Store catalog is empty or unavailable.'); 
                }
            } catch (error) {
                console.error('Error fetching store catalog:', error);
                // Optionally emit an event to show an error message in the UI
                EventBus.emit('show-store', []); // Show empty store on error
                // alert('Failed to load store catalog.');
            }
        });
        storeButton.setPosition(this.cameras.main.width / 2, storeButtonY);
        storeButton.setDepth(102);

        // Tip Button
        const tipButton = this.createButton('Tip Developer', () => {
            console.log('Tip button clicked.');
            openTipUrl();
        });
        tipButton.setPosition(this.cameras.main.width / 2, tipButtonY);
        tipButton.setDepth(102);
        // --- End Oncade Buttons ---

        // Initialize zombies
        this.initializeZombies();

        EventBus.emit('current-scene-ready', this);
    }
    
    changeScene ()
    {
        if (this.logoTween)
        {
            this.logoTween.stop();
            this.logoTween = null;
        }
        
        // Clear zombie timer when changing scene
        if (this.zombieTimer) {
            this.zombieTimer.remove();
            this.zombieTimer = null;
        }

        // Clean up all zombies and their update callbacks
        this.cleanupZombies();

        this.scene.start('Game');
    }

    cleanupZombies(): void {
        // Remove all update callbacks
        this.updateCallbacks.forEach(callback => {
            this.events.off('update', callback);
        });
        this.updateCallbacks = [];
        
        // Destroy all zombies
        this.zombies.forEach(zombie => {
            if (zombie && zombie.active) {
                zombie.destroy();
            }
        });
        this.zombies = [];
        this.currentZombieCount = 0;
    }

    moveLogo (callback?: ({ x, y }: { x: number, y: number }) => void)
    {
        if (this.logoTween)
        {
            if (this.logoTween.isPlaying())
            {
                this.logoTween.pause();
            }
            else
            {
                this.logoTween.play();
            }
        } 
        else
        {
            // Get screen dimensions
            const screenWidth = this.cameras.main.width;
            const screenHeight = this.cameras.main.height;
            
            // Calculate animation positions based on screen size
            const endX = screenWidth * 0.8; // 80% of screen width
            const endY = screenHeight * 0.15; // 15% of screen height
            
            this.logoTween = this.tweens.add({
                targets: this.logo,
                x: { value: endX, duration: 3000, ease: 'Back.easeInOut' },
                y: { value: endY, duration: 1500, ease: 'Sine.easeOut' },
                yoyo: true,
                repeat: -1,
                onUpdate: () => {
                    if (callback)
                    {
                        callback({
                            x: Math.floor(this.logo.x),
                            y: Math.floor(this.logo.y)
                        });
                    }
                }
            });
        }
    }

    private initializeZombies(): void {
        // Start with 3 zombies
        for (let i = 0; i < 3; i++) {
            this.addNewSprite();
        }
        
        // Set up timer to add a new zombie every 5 seconds until reaching maxZombies
        this.zombieTimer = this.time.addEvent({
            delay: 5000,
            callback: () => {
                if (this.currentZombieCount < this.maxZombies) {
                    this.addNewSprite();
                } else {
                    // Stop the timer when we reach max zombies
                    this.zombieTimer?.remove();
                    this.zombieTimer = null;
                }
            },
            loop: true
        });
    }

    private createButton(text: string, callback: () => void): GameObjects.Text {
        const button = this.add.text(0, 0, text, {
            fontFamily: 'Arial', fontSize: 24, color: '#ffffff',
            stroke: '#000000', strokeThickness: 4,
            align: 'center',
            backgroundColor: '#333333',
            padding: { x: 15, y: 8 }
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => button.setStyle({ color: '#ffff00' }))
        .on('pointerout', () => button.setStyle({ color: '#ffffff' }))
        .on('pointerdown', callback);

        return button;
    }

    private addNewSprite(): void {
        // Add more zombies
        const x = Phaser.Math.Between(64, this.scale.width - 64);
        const y = Phaser.Math.Between(64, this.scale.height - 64);

        // Create a zombie sprite with higher depth than the logo
        const zombie = this.add.sprite(x, y, 'enemy');
        zombie.setDepth(101); // Higher than logo's depth (100)
        
        // Add to zombies array
        this.zombies.push(zombie);
        this.currentZombieCount++;

        // Create a wandering behavior
        this.createWanderingBehavior(zombie);
    }

    private createWanderingBehavior(zombie: GameObjects.Sprite): void {
        // Set initial random velocity
        const speed = 50 + Math.random() * 50;
        const angle = Math.random() * Math.PI * 2;
        
        zombie.setData('velocity', {
            x: Math.cos(angle) * speed,
            y: Math.sin(angle) * speed
        });
        
        // Create update callback for this zombie
        const updateCallback = () => {
            // Skip if zombie is no longer valid
            if (!zombie || !zombie.active) return;
            
            const velocity = zombie.getData('velocity');
            if (!velocity) return;
            
            // Update position
            zombie.x += velocity.x * this.game.loop.delta / 1000;
            zombie.y += velocity.y * this.game.loop.delta / 1000;
            
            // Bounce off the edges
            if (zombie.x < 64 || zombie.x > this.scale.width - 64) {
                velocity.x *= -1;
            }
            if (zombie.y < 64 || zombie.y > this.scale.height - 64) {
                velocity.y *= -1;
            }
            
            // Occasionally change direction
            if (Math.random() < 0.01) {
                const newAngle = Math.random() * Math.PI * 2;
                const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
                velocity.x = Math.cos(newAngle) * speed;
                velocity.y = Math.sin(newAngle) * speed;
            }
            
            // Update the velocity data
            zombie.setData('velocity', velocity);
        };
        
        // Add update callback to the list
        this.updateCallbacks.push(updateCallback);
        
        // Register the update callback
        this.events.on('update', updateCallback);
    }
}
