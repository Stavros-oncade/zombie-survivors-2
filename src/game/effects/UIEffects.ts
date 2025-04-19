import { Scene } from "phaser";

export class UIEffects {
    private scene: Scene;
    private levelUpText: Phaser.GameObjects.Text | null = null;
    private difficultyChangeText: Phaser.GameObjects.Text | null = null;
    private spawnStateChangeText: Phaser.GameObjects.Text | null = null;
    private levelUpParticles: Phaser.GameObjects.Particles.ParticleEmitter | null =
        null;
    private difficultyChangeParticles: Phaser.GameObjects.Particles.ParticleEmitter | null =
        null;
    private spawnStateChangeParticles: Phaser.GameObjects.Particles.ParticleEmitter | null =
        null;
    private isDestroyed: boolean = false;
    private currentTween: Phaser.Tweens.Tween | null = null;

    constructor(scene: Scene) {
        this.scene = scene;
    }

    public create(): void {
        // Listen for level up events directly from the scene
        this.scene.events.on(
            "player_level_up",
            this.showLevelUpEffect.bind(this)
        );

        // Listen for difficulty change events directly from the scene
        this.scene.events.on(
            "difficulty_increased",
            this.showDifficultyChangeEffect.bind(this)
        );

        // Listen for spawn state change events directly from the scene
        this.scene.events.on(
            "spawn_state_changed",
            this.showSpawnStateChangeEffect.bind(this)
        );
    }

    private isSceneValid(): boolean {
        return (
            !this.isDestroyed &&
            this.scene !== null &&
            this.scene.add !== undefined &&
            this.scene.add !== null &&
            this.scene.game !== undefined &&
            this.scene.game !== null
        );
    }

    public showLevelUpEffect(data: {
        level: number;
        previousLevel: number;
    }): void {
        // Check if scene is valid
        if (!this.isSceneValid()) {
            console.error(
                "UIEffects: Scene is not valid when trying to show level up effect"
            );
            return;
        }

        // Double check scene validity before proceeding
        if (
            !this.scene?.add?.text ||
            !this.scene?.game?.config?.width ||
            !this.scene?.game?.config?.height
        ) {
            console.error(
                "UIEffects: Required scene properties are not available"
            );
            return;
        }

        // Clean up any existing level up text and tweens
        if (this.levelUpText) {
            // Stop any existing tweens targeting this text
            if (this.scene.tweens) {
                this.scene.tweens.killTweensOf(this.levelUpText);
            }
            this.levelUpText.destroy();
            this.levelUpText = null;
        }

        // Clean up any existing tween
        if (this.currentTween) {
            this.currentTween.stop();
            this.currentTween = null;
        }

        const width = this.scene.cameras.main.width;
        const height = this.scene.cameras.main.height;

        // Create level up text
        this.levelUpText = this.scene.add
            .text(width / 2, height / 4, `LEVEL UP!\nLevel ${data.level}`, {
                fontSize: "48px",
                color: "#ffff00",
                stroke: "#000000",
                strokeThickness: 6,
                align: "center",
            })
            .setOrigin(0.5)
            .setDepth(1000)
            .setScrollFactor(0);

        // Add glow effect
        if (this.levelUpText?.preFX) {
            this.levelUpText.preFX.addGlow(0xffff00, 4, 0, false, 0.1, 16);

            // Animate the text
            if (this.scene?.tweens) {
                const initialTween = this.scene.tweens.add({
                    targets: this.levelUpText,
                    scale: { from: 0.5, to: 1.2 },
                    alpha: { from: 0, to: 1 },
                    duration: 500,
                    ease: "Back.easeOut",
                    onComplete: () => {
                        // Only proceed if the text still exists
                        if (this.levelUpText && this.scene?.tweens) {
                            // Hold for a moment
                            this.scene.time.delayedCall(500, () => {
                                // Only proceed if the text still exists
                                if (this.levelUpText && this.scene?.tweens) {
                                    // Fade out
                                    this.scene.tweens.add({
                                        targets: this.levelUpText,
                                        alpha: 0,
                                        scale: 1.5,
                                        duration: 500,
                                        onComplete: () => {
                                            if (this.levelUpText) {
                                                this.levelUpText.destroy();
                                                this.levelUpText = null;
                                            }
                                        },
                                    });
                                }
                            });
                        }
                    },
                });

                // Store the tween reference for cleanup
                this.currentTween = initialTween;
            }
        }

        // Create particle effect
        this.createLevelUpParticles();
    }

    private createLevelUpParticles(): void {
        // Check if scene is valid
        if (!this.isSceneValid()) {
            console.error(
                "UIEffects: Scene is not valid when trying to create level up particles"
            );
            return;
        }

        const width = this.scene.game.config.width as number;
        const height = this.scene.game.config.height as number;

        // Create particle emitter
        this.levelUpParticles = this.scene.add.particles(0, 0, "particle", {
            speed: { min: 50, max: 150 },
            scale: { start: 0.5, end: 0 },
            lifespan: 1000,
            quantity: 50,
            emitting: false,
            frequency: 50,
            blendMode: "ADD",
            active: false,
            visible: false,
        });

        // Position at center of screen
        if (this.levelUpParticles && this.scene?.add) {
            this.levelUpParticles.setPosition(width / 2, height / 2);
            this.levelUpParticles.setScrollFactor(0);
            this.levelUpParticles.setDepth(999);

            // Emit particles
            this.levelUpParticles.explode(50, 0, 0);

            // Destroy after animation completes
            if (this.levelUpParticles) {
                this.levelUpParticles.destroy();
                this.levelUpParticles = null;
            }
        }
    }

    public showDifficultyChangeEffect(): void {
        // Check if scene is valid
        if (!this.isSceneValid()) {
            console.error(
                "UIEffects: Scene is not valid when trying to show difficulty change effect"
            );
            return;
        }

        // Create difficulty change text
        this.difficultyChangeText = this.scene.add
            .text(
                (this.scene.game.config.width as number) / 2,
                (this.scene.game.config.height as number) / 2 + 100, // Below level up text if both are showing
                `Difficulty Increased!\nEnemies are spawning faster!`,
                {
                    fontSize: "32px",
                    color: "#ff6600",
                    stroke: "#000000",
                    strokeThickness: 4,
                    align: "center",
                }
            )
            .setOrigin(0.5)
            .setDepth(1000)
            .setScrollFactor(0);

        // Add shake effect to the camera
        if (this.scene.cameras.main) {
            this.scene.cameras.main.shake(200, 0.005);
        }

        // Animate the text
        this.scene.tweens.add({
            targets: this.difficultyChangeText,
            scale: { from: 0.8, to: 1 },
            alpha: { from: 0, to: 1 },
            duration: 300,
            ease: "Power2",
            onComplete: () => {
                // Hold for a moment
                this.scene.time.delayedCall(1500, () => {
                    // Fade out
                    this.scene.tweens.add({
                        targets: this.difficultyChangeText,
                        alpha: 0,
                        duration: 500,
                        onComplete: () => {
                            if (this.difficultyChangeText) {
                                this.difficultyChangeText.destroy();
                                this.difficultyChangeText = null;
                            }
                        },
                    });
                });
            },
        });

        // Create particle effect
        this.createDifficultyChangeParticles();
    }

    private createDifficultyChangeParticles(): void {
        // Check if scene is valid
        if (!this.isSceneValid()) {
            console.error(
                "UIEffects: Scene is not valid when trying to create difficulty change particles"
            );
            return;
        }

        // Create particle emitter
        this.difficultyChangeParticles = this.scene.add.particles(
            0,
            0,
            "particle",
            {
                speed: { min: 30, max: 100 },
                scale: { start: 0.4, end: 0 },
                lifespan: 800,
                quantity: 30,
                emitting: false,
                frequency: 50,
                blendMode: "ADD",
                active: false,
                visible: false,
                tint: 0xff6600,
            }
        );

        // Position at center of screen
        if (this.difficultyChangeParticles) {
            this.difficultyChangeParticles.setPosition(
                (this.scene.game.config.width as number) / 2,
                (this.scene.game.config.height as number) / 2 + 100
            );
            this.difficultyChangeParticles.setScrollFactor(0);
            this.difficultyChangeParticles.setDepth(999);

            // Emit particles
            this.difficultyChangeParticles.explode(30, 0, 0);

            // Destroy after animation completes
            this.scene.time.delayedCall(800, () => {
                if (this.difficultyChangeParticles) {
                    this.difficultyChangeParticles.destroy();
                    this.difficultyChangeParticles = null;
                }
            });
        }
    }

    public showSpawnStateChangeEffect(data: {
        state: string;
        displayConfig: {
            text: string;
            color: string;
            fontSize: string;
            emoji: string;
            glowColor: number;
            glowIntensity: number;
            scale: { from: number; to: number };
            particles: boolean;
        };
        formattedText: string;
    }): void {
        // Check if scene is valid
        if (!this.isSceneValid()) {
            console.error(
                "UIEffects: Scene is not valid when trying to show spawn state change effect"
            );
            return;
        }

        // Create spawn state change text
        this.spawnStateChangeText = this.scene.add
            .text(
                (this.scene.game.config.width as number) / 2,
                (this.scene.game.config.height as number) / 2 + 150, // Below other effects if they're showing
                data.formattedText,
                {
                    fontSize: data.displayConfig.fontSize,
                    color: data.displayConfig.color,
                    stroke: "#000000",
                    strokeThickness: 4,
                    align: "center",
                    fontStyle: "bold",
                }
            )
            .setOrigin(0.5)
            .setDepth(1000)
            .setScrollFactor(0);

        // Add glow effect
        if (this.spawnStateChangeText.preFX) {
            this.spawnStateChangeText.preFX.addGlow(
                data.displayConfig.glowColor,
                data.displayConfig.glowIntensity,
                0,
                false,
                0.1,
                16
            );
        }

        // Animate the text
        this.scene.tweens.add({
            targets: this.spawnStateChangeText,
            scale: { from: data.displayConfig.scale.from, to: data.displayConfig.scale.to },
            alpha: { from: 0, to: 1 },
            duration: 400,
            ease: "Power2",
            onComplete: () => {
                // Hold for a moment
                this.scene.time.delayedCall(1200, () => {
                    // Fade out
                    this.scene.tweens.add({
                        targets: this.spawnStateChangeText,
                        alpha: 0,
                        duration: 500,
                        onComplete: () => {
                            if (this.spawnStateChangeText) {
                                this.spawnStateChangeText.destroy();
                                this.spawnStateChangeText = null;
                            }
                        },
                    });
                });
            },
        });

        // Create particle effect if enabled
        if (data.displayConfig.particles) {
            this.createSpawnStateChangeParticles(data.displayConfig.color);
        }
    }

    private createSpawnStateChangeParticles(color: string): void {
        // Check if scene is valid
        if (!this.isSceneValid()) {
            console.error(
                "UIEffects: Scene is not valid when trying to create spawn state change particles"
            );
            return;
        }

        // Create particle emitter
        this.spawnStateChangeParticles = this.scene.add.particles(
            0,
            0,
            "particle",
            {
                speed: { min: 40, max: 120 },
                scale: { start: 0.3, end: 0 },
                lifespan: 900,
                quantity: 25,
                emitting: false,
                frequency: 50,
                blendMode: "ADD",
                active: false,
                visible: false,
                tint: parseInt(color.replace("#", "0x")),
            }
        );

        // Position at center of screen
        if (this.spawnStateChangeParticles) {
            this.spawnStateChangeParticles.setPosition(
                (this.scene.game.config.width as number) / 2,
                (this.scene.game.config.height as number) / 2 + 150
            );
            this.spawnStateChangeParticles.setScrollFactor(0);
            this.spawnStateChangeParticles.setDepth(999);

            // Emit particles
            this.spawnStateChangeParticles.explode(25, 0, 0);

            // Destroy after animation completes
            this.scene.time.delayedCall(900, () => {
                if (this.spawnStateChangeParticles) {
                    this.spawnStateChangeParticles.destroy();
                    this.spawnStateChangeParticles = null;
                }
            });
        }
    }

    public showStateText(state: string, options: {
        color?: string;
        fontSize?: string;
        duration?: number;
        position?: { x: number; y: number };
        glowColor?: number;
        glowIntensity?: number;
        scale?: { from: number; to: number };
        particles?: boolean;
    } = {}): void {
        // Check if scene is valid
        if (!this.isSceneValid()) {
            console.error(
                "UIEffects: Scene is not valid when trying to show state text"
            );
            return;
        }

        // Default options
        const {
            color = "#ffffff",
            fontSize = "32px",
            duration = 2000,
            position = {
                x: (this.scene.game.config.width as number) / 2,
                y: (this.scene.game.config.height as number) / 2
            },
            glowColor = 0xffffff,
            glowIntensity = 4,
            scale = { from: 0.8, to: 1.2 },
            particles = true
        } = options;

        // Create state text
        const stateText = this.scene.add
            .text(position.x, position.y, state, {
                fontSize: fontSize,
                color: color,
                stroke: "#000000",
                strokeThickness: 4,
                align: "center",
            })
            .setOrigin(0.5)
            .setDepth(1000)
            .setScrollFactor(0);

        // Add glow effect
        if (stateText?.preFX) {
            stateText.preFX.addGlow(glowColor, glowIntensity, 0, false, 0.1, 16);
        }

        // Animate the text
        this.scene.tweens.add({
            targets: stateText,
            scale: { from: scale.from, to: scale.to },
            alpha: { from: 0, to: 1 },
            duration: duration / 2,
            ease: "Back.easeOut",
            onComplete: () => {
                // Hold for a moment
                this.scene.time.delayedCall(duration / 2, () => {
                    // Fade out
                    this.scene.tweens.add({
                        targets: stateText,
                        alpha: 0,
                        scale: scale.to * 1.2,
                        duration: duration / 2,
                        onComplete: () => {
                            stateText.destroy();
                        },
                    });
                });
            },
        });

        // Add camera shake effect
        if (this.scene.cameras.main) {
            this.scene.cameras.main.shake(200, 0.005);
        }

        // Create particle effect if enabled
        if (particles) {
            this.createStateParticles(position.x, position.y, color);
        }
    }

    private createStateParticles(x: number, y: number, color: string): void {
        // Check if scene is valid
        if (!this.isSceneValid()) {
            console.error(
                "UIEffects: Scene is not valid when trying to create state particles"
            );
            return;
        }

        // Create particle emitter
        const particles = this.scene.add.particles(0, 0, "particle", {
            speed: { min: 30, max: 100 },
            scale: { start: 0.4, end: 0 },
            lifespan: 800,
            quantity: 30,
            emitting: false,
            frequency: 50,
            blendMode: "ADD",
            active: false,
            visible: false,
            tint: parseInt(color.replace("#", "0x")),
        });

        // Position at specified coordinates
        if (particles && this.scene?.add) {
            particles.setPosition(x, y);
            particles.setScrollFactor(0);
            particles.setDepth(999);

            // Emit particles
            particles.explode(30, 0, 0);

            // Destroy after animation completes
            this.scene.time.delayedCall(800, () => {
                particles.destroy();
            });
        }
    }

    public destroy(): void {
        this.isDestroyed = true;

        // Clean up current tween if it exists
        if (this.currentTween) {
            this.currentTween.stop();
            this.currentTween = null;
        }

        // Clean up text objects
        if (this.levelUpText) {
            this.levelUpText.destroy();
            this.levelUpText = null;
        }

        if (this.difficultyChangeText) {
            this.difficultyChangeText.destroy();
            this.difficultyChangeText = null;
        }

        if (this.spawnStateChangeText) {
            this.spawnStateChangeText.destroy();
            this.spawnStateChangeText = null;
        }

        // Clean up particle emitters
        if (this.levelUpParticles) {
            this.levelUpParticles.stop();
            this.levelUpParticles = null;
        }

        if (this.difficultyChangeParticles) {
            this.difficultyChangeParticles.stop();
            this.difficultyChangeParticles = null;
        }

        if (this.spawnStateChangeParticles) {
            this.spawnStateChangeParticles.stop();
            this.spawnStateChangeParticles = null;
        }

        // Remove event listeners
        this.scene.events.off("player_level_up", this.showLevelUpEffect);
        this.scene.events.off(
            "difficulty_increased",
            this.showDifficultyChangeEffect
        );
        this.scene.events.off(
            "spawn_state_changed",
            this.showSpawnStateChangeEffect
        );
    }
}
