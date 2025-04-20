import { Scene } from "phaser";

export class BoostTimerUI {
    private scene: Scene;
    private speedBoostArc: Phaser.GameObjects.Graphics | null = null;
    private damageBoostArc: Phaser.GameObjects.Graphics | null = null;
    private speedBoostText: Phaser.GameObjects.Text | null = null;
    private damageBoostText: Phaser.GameObjects.Text | null = null;
    private speedBoostTimer: Phaser.Time.TimerEvent | null = null;
    private damageBoostTimer: Phaser.Time.TimerEvent | null = null;
    private speedBoostDuration: number = 0;
    private damageBoostDuration: number = 0;
    private speedBoostElapsed: number = 0;
    private damageBoostElapsed: number = 0;
    private updateEvent: Phaser.Time.TimerEvent | null = null;

    constructor(scene: Scene) {
        this.scene = scene;
        this.initialize();
    }

    private initialize(): void {
        // Create graphics objects for the arcs
        this.speedBoostArc = this.scene.add.graphics();
        this.damageBoostArc = this.scene.add.graphics();
        
        // Set scroll factor to 0 so they stay fixed on screen
        this.speedBoostArc.setScrollFactor(0);
        this.damageBoostArc.setScrollFactor(0);
        
        // Create text objects for the boost labels
        this.speedBoostText = this.scene.add.text(0, 0, "SPEED", {
            fontSize: "14px",
            color: "#00ff00",
            stroke: "#000000",
            strokeThickness: 3
        });
        this.damageBoostText = this.scene.add.text(0, 0, "DAMAGE", {
            fontSize: "14px",
            color: "#ff00ff",
            stroke: "#000000",
            strokeThickness: 3
        });
        
        // Set scroll factor to 0 so they stay fixed on screen
        this.speedBoostText.setScrollFactor(0);
        this.damageBoostText.setScrollFactor(0);
        
        // Hide the UI elements initially
        this.hideAll();
        
        // Create an update event to update the UI every frame
        this.updateEvent = this.scene.time.addEvent({
            delay: 16, // Update at roughly 60fps
            callback: this.update,
            callbackScope: this,
            loop: true
        });
    }

    public showSpeedBoost(duration: number): void {
        // Store the duration and reset elapsed time
        this.speedBoostDuration = duration;
        this.speedBoostElapsed = 0;
        
        // Show the speed boost UI
        this.showSpeedUI();
        
        // Create a timer to track the elapsed time
        if (this.speedBoostTimer) {
            this.speedBoostTimer.destroy();
        }
        
        this.speedBoostTimer = this.scene.time.addEvent({
            delay: 16, // Update at roughly 60fps
            callback: () => {
                this.speedBoostElapsed += 16;
                if (this.speedBoostElapsed >= this.speedBoostDuration) {
                    this.hideSpeedUI();
                    if (this.speedBoostTimer) {
                        this.speedBoostTimer.destroy();
                        this.speedBoostTimer = null;
                    }
                }
            },
            callbackScope: this,
            loop: true
        });
    }

    public showDamageBoost(duration: number): void {
        // Store the duration and reset elapsed time
        this.damageBoostDuration = duration;
        this.damageBoostElapsed = 0;
        
        // Show the damage boost UI
        this.showDamageUI();
        
        // Create a timer to track the elapsed time
        if (this.damageBoostTimer) {
            this.damageBoostTimer.destroy();
        }
        
        this.damageBoostTimer = this.scene.time.addEvent({
            delay: 16, // Update at roughly 60fps
            callback: () => {
                this.damageBoostElapsed += 16;
                if (this.damageBoostElapsed >= this.damageBoostDuration) {
                    this.hideDamageUI();
                    if (this.damageBoostTimer) {
                        this.damageBoostTimer.destroy();
                        this.damageBoostTimer = null;
                    }
                }
            },
            callbackScope: this,
            loop: true
        });
    }

    private update(): void {
        // Update the UI elements
        this.updateSpeedUI();
        this.updateDamageUI();
    }

    private updateSpeedUI(): void {
        if (!this.speedBoostArc || !this.speedBoostText || this.speedBoostElapsed >= this.speedBoostDuration) {
            return;
        }

        // Calculate the progress (0 to 1)
        const progress = 1 - (this.speedBoostElapsed / this.speedBoostDuration);
        
        // Calculate the angle based on progress (0 to 2π)
        const angle = progress * Math.PI * 2;
        
        // Position in the upper right corner
        const x = this.scene.cameras.main.width - 60;
        const y = 60;
        const radius = 25;
        
        // Clear the graphics
        this.speedBoostArc.clear();
        
        // Draw the background circle
        this.speedBoostArc.lineStyle(4, 0x00ff00, 0.3);
        this.speedBoostArc.strokeCircle(x, y, radius);
        
        // Draw the filled progress arc
        this.speedBoostArc.lineStyle(4, 0x00ff00, 1);
        this.speedBoostArc.fillStyle(0x00ff00, 0.3);
        this.speedBoostArc.beginPath();
        this.speedBoostArc.moveTo(x, y);
        this.speedBoostArc.arc(x, y, radius, 0, angle, false);
        this.speedBoostArc.closePath();
        this.speedBoostArc.fillPath();
        this.speedBoostArc.strokePath();
        
        // Update the text position
        this.speedBoostText.setOrigin(0.5, 0.5);
        this.speedBoostText.setPosition(x, y);
    }

    private updateDamageUI(): void {
        if (!this.damageBoostArc || !this.damageBoostText || this.damageBoostElapsed >= this.damageBoostDuration) {
            return;
        }

        // Calculate the progress (0 to 1)
        const progress = 1 - (this.damageBoostElapsed / this.damageBoostDuration);
        
        // Calculate the angle based on progress (0 to 2π)
        const angle = progress * Math.PI * 2;
        
        // Position in the upper right corner, below the speed boost
        const x = this.scene.cameras.main.width - 60;
        const y = 120;
        const radius = 25;
        
        // Clear the graphics
        this.damageBoostArc.clear();
        
        // Draw the background circle
        this.damageBoostArc.lineStyle(4, 0xff00ff, 0.3);
        this.damageBoostArc.strokeCircle(x, y, radius);
        
        // Draw the filled progress arc
        this.damageBoostArc.lineStyle(4, 0xff00ff, 1);
        this.damageBoostArc.fillStyle(0xff00ff, 0.3);
        this.damageBoostArc.beginPath();
        this.damageBoostArc.moveTo(x, y);
        this.damageBoostArc.arc(x, y, radius, 0, angle, false);
        this.damageBoostArc.closePath();
        this.damageBoostArc.fillPath();
        this.damageBoostArc.strokePath();
        
        // Update the text position
        this.damageBoostText.setOrigin(0.5, 0.5);
        this.damageBoostText.setPosition(x, y);
    }

    private showSpeedUI(): void {
        if (this.speedBoostArc) {
            this.speedBoostArc.setVisible(true);
        }
        if (this.speedBoostText) {
            this.speedBoostText.setVisible(true);
        }
    }

    private hideSpeedUI(): void {
        if (this.speedBoostArc) {
            this.speedBoostArc.setVisible(false);
        }
        if (this.speedBoostText) {
            this.speedBoostText.setVisible(false);
        }
    }

    private showDamageUI(): void {
        if (this.damageBoostArc) {
            this.damageBoostArc.setVisible(true);
        }
        if (this.damageBoostText) {
            this.damageBoostText.setVisible(true);
        }
    }

    private hideDamageUI(): void {
        if (this.damageBoostArc) {
            this.damageBoostArc.setVisible(false);
        }
        if (this.damageBoostText) {
            this.damageBoostText.setVisible(false);
        }
    }

    private hideAll(): void {
        this.hideSpeedUI();
        this.hideDamageUI();
    }

    public destroy(): void {
        // Clean up timers
        if (this.speedBoostTimer) {
            this.speedBoostTimer.destroy();
            this.speedBoostTimer = null;
        }
        
        if (this.damageBoostTimer) {
            this.damageBoostTimer.destroy();
            this.damageBoostTimer = null;
        }
        
        if (this.updateEvent) {
            this.updateEvent.destroy();
            this.updateEvent = null;
        }
        
        // Clean up graphics
        if (this.speedBoostArc) {
            this.speedBoostArc.destroy();
            this.speedBoostArc = null;
        }
        
        if (this.damageBoostArc) {
            this.damageBoostArc.destroy();
            this.damageBoostArc = null;
        }
        
        // Clean up text
        if (this.speedBoostText) {
            this.speedBoostText.destroy();
            this.speedBoostText = null;
        }
        
        if (this.damageBoostText) {
            this.damageBoostText.destroy();
            this.damageBoostText = null;
        }
    }
} 