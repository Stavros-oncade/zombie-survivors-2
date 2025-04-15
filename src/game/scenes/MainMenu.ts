import { GameObjects, Scene } from 'phaser';

import { EventBus } from '../EventBus';

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

    constructor ()
    {
        super('MainMenu');
    }

    create ()
    {
        // Create and stretch background to fill the screen
        this.background = this.add.image(0, 0, 'background');
        this.background.setOrigin(0, 0);
        this.background.setDisplaySize(this.cameras.main.width, this.cameras.main.height);

        this.logo = this.add.image(512, 250, 'logo').setDepth(100);

        // Create play button
        this.playButton = this.add.text(512, 460, 'Play', {
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
            this.logoTween = this.tweens.add({
                targets: this.logo,
                x: { value: 750, duration: 3000, ease: 'Back.easeInOut' },
                y: { value: 80, duration: 1500, ease: 'Sine.easeOut' },
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
