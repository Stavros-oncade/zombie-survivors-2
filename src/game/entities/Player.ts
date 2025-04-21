import { GameConstants } from '../config/GameConstants';
import { PlayerStats } from '../types/GameTypes';
import { ExperienceSystem } from '../systems/ExperienceSystem';
import { trackEvent } from '../../oncade/OncadeIntegration';
import { Game } from '../scenes/Game';
import { Enemy } from './Enemy';

export class Player extends Phaser.Physics.Arcade.Sprite {
    private health: number;
    private maxHealth: number;
    private stats: PlayerStats;
    private movementSpeed: number;
    private enemiesKilled: number = 0;
    private xpGained: number = 0;
    private experienceSystem!: ExperienceSystem;
    private lastLevel: number = 1;
    private healthRegenTimer: Phaser.Time.TimerEvent | null = null;
    private healthRegenAmount: number = 0;
    private healthRegenInterval: number = 0;
    private lastDamageSource: Enemy | null = null;
    private immunityTimer: Phaser.Time.TimerEvent | null = null;
    private readonly IMMUNITY_DURATION: number = 100; // 100ms immunity

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, 'player');
    }

    public initialize(experienceSystem: ExperienceSystem): void {
        this.experienceSystem = experienceSystem;

        this.health = GameConstants.PLAYER.INITIAL_HEALTH;
        this.maxHealth = GameConstants.PLAYER.INITIAL_HEALTH;
        this.movementSpeed = GameConstants.PLAYER.MOVEMENT_SPEED;
        
        this.setScale(0.5);

        this.stats = {
            health: this.health,
            maxHealth: this.maxHealth,
            level: this.experienceSystem.getCurrentLevel(),
            experience: this.experienceSystem.getCurrentExperience(),
            experienceToNextLevel: this.experienceSystem.getRequiredExperience()
        };
        
        this.lastLevel = this.experienceSystem.getCurrentLevel();

        // Enable health regeneration by default
        //this.enableHealthRegeneration(0.01, 1000); // 1% health per second
    }

    public enablePhysics(): void {
        if (this.scene && this.scene.physics) {
            this.scene.physics.add.existing(this);
            this.setCollideWorldBounds(true);
            const scaleFactor = 0.5;
            if (this.body instanceof Phaser.Physics.Arcade.Body) {
                 this.body.setSize(this.texture.source[0].width * scaleFactor, this.texture.source[0].height * scaleFactor);
            }
        }
    }

    public move(direction: Phaser.Math.Vector2): void {
        const speed = this.movementSpeed;
        this.setVelocity(direction.x * speed, direction.y * speed);

        if (direction.x !== 0) {
            this.setFlipX(direction.x < 0);
        }
    }

    public takeDamage(amount: number, source: Enemy): void {
        // Check if the player is immune to this damage source
        if (this.lastDamageSource === source && this.immunityTimer && !this.immunityTimer.getRemaining()) {
            return; // Player is still immune to this source
        }

        this.health = Math.max(0, this.health - amount);
        this.lastDamageSource = source;
        
        // Clear any existing immunity timer
        if (this.immunityTimer) {
            this.immunityTimer.destroy();
        }

        // Create new immunity timer
        this.immunityTimer = this.scene.time.addEvent({
            delay: this.IMMUNITY_DURATION,
            callback: () => {
                this.lastDamageSource = null;
            }
        });
        
        if (this.health <= 0) {
            this.die();
        }
    }

    public applyLevelUpEffects(): void {
        this.maxHealth = Math.floor(this.maxHealth * 1.1);
        this.health = this.maxHealth;
        this.movementSpeed = this.movementSpeed * 1.05;
        console.log(`Player Level Up Effects Applied! New Max HP: ${this.maxHealth}, New Speed: ${this.movementSpeed.toFixed(2)}`);
        
        // Track level up event
        const currentLevel = this.experienceSystem.getCurrentLevel();
        if (currentLevel > this.lastLevel) {
            trackEvent('player_level_up', {
                level: currentLevel,
                previousLevel: this.lastLevel,
                maxHealth: this.maxHealth,
                movementSpeed: this.movementSpeed
            });
            this.lastLevel = currentLevel;
        }
    }

    public incrementEnemiesKilled(): void {
        this.enemiesKilled++;
    }

    public addXPGained(amount: number): void {
        this.xpGained += amount;
    }

    private die(): void {
        console.log("Player Died. Stats:", this.getStats());
        
        // Get play time from the GameUI instead of the Game scene
        const gameScene = this.scene.scene.get('Game') as Game;
        const gameUI = gameScene ? gameScene.getGameUI() : null;
        const playTime = gameUI ? gameUI.getGameTime() : 0;
        
        // Track player death event
        trackEvent('player_died', {
            enemiesKilled: this.enemiesKilled,
            xpGained: this.xpGained,
            levelReached: this.experienceSystem.getCurrentLevel(),
            playTimeSeconds: playTime
        });
        
        this.scene.scene.start('GameOver', { 
            enemiesKilled: this.enemiesKilled, 
            xpGained: this.xpGained,
            levelReached: this.experienceSystem.getCurrentLevel(),
            playTimeSeconds: playTime
        });
    }

    public getStats(): PlayerStats {
        this.stats.health = this.health;
        this.stats.maxHealth = this.maxHealth;
        this.stats.level = this.experienceSystem.getCurrentLevel();
        this.stats.experience = this.experienceSystem.getCurrentExperience();
        this.stats.experienceToNextLevel = this.experienceSystem.getRequiredExperience();
        return this.stats;
    }

    public update(
        cursors: Phaser.Types.Input.Keyboard.CursorKeys,
        wasdKeys?: { [key: string]: Phaser.Input.Keyboard.Key },
        initialTouchPoint?: Phaser.Math.Vector2 | null,
        currentTouchPoint?: Phaser.Math.Vector2 | null
    ): void {
        const direction = new Phaser.Math.Vector2(0, 0);

        // Handle keyboard input
        if (cursors.left && cursors.left.isDown) {
            direction.x = -1;
        } else if (cursors.right && cursors.right.isDown) {
            direction.x = 1;
        }
        if (cursors.up && cursors.up.isDown) {
            direction.y = -1;
        } else if (cursors.down && cursors.down.isDown) {
            direction.y = 1;
        }

        if (wasdKeys) {
            if (wasdKeys.left && wasdKeys.left.isDown) {
                direction.x = -1;
            } else if (wasdKeys.right && wasdKeys.right.isDown) {
                direction.x = 1;
            }
            if (wasdKeys.up && wasdKeys.up.isDown) {
                direction.y = -1;
            } else if (wasdKeys.down && wasdKeys.down.isDown) {
                direction.y = 1;
            }
        }

        // Handle touch input (virtual joystick)
        if (initialTouchPoint && currentTouchPoint) {
            // Calculate the vector from initial touch to current touch
            const touchDirection = new Phaser.Math.Vector2(
                currentTouchPoint.x - initialTouchPoint.x,
                currentTouchPoint.y - initialTouchPoint.y
            );

            // Normalize the vector to get direction
            touchDirection.normalize();

            // Add the touch direction to the movement direction
            direction.add(touchDirection);
        }

        direction.normalize();
        this.move(direction);
    }

    public setMaxHealth(newMaxHealth: number): void {
        this.maxHealth = newMaxHealth;
        this.stats.maxHealth = newMaxHealth;
    }

    public heal(amount: number): void {
      const previousHealth = this.health;
        this.health = Math.min(this.maxHealth, this.health + amount);
        if (this.health !== previousHealth) {
          //console.log(`Player healed ${amount} HP. New health: ${this.health}`);
        }
        this.stats.health = this.health;
    }

    public getMovementSpeed(): number {
        return this.movementSpeed;
    }

    public setMovementSpeed(newSpeed: number): void {
        this.movementSpeed = newSpeed;
    }

    public upgradeWeaponDamage(multiplier: number): void {
        // Get the weapon system from the game scene
        const gameScene = this.scene.scene.get('Game') as Game;
        if (gameScene && gameScene.getWeaponSystem()) {
            gameScene.getWeaponSystem().upgradeWeaponDamage(multiplier);
        }
    }

    public upgradeWeaponSpeed(multiplier: number): void {
        // Get the weapon system from the game scene
        const gameScene = this.scene.scene.get('Game') as Game;
        if (gameScene && gameScene.getWeaponSystem()) {
            gameScene.getWeaponSystem().upgradeWeaponSpeed(multiplier);
        }
    }

    public upgradeProjectileSpeed(multiplier: number): void {
        // Get the weapon system from the game scene
        const gameScene = this.scene.scene.get('Game') as Game;
        if (gameScene && gameScene.getWeaponSystem()) {
            gameScene.getWeaponSystem().upgradeProjectileSpeed(multiplier);
        }
    }

    public enableHealthRegeneration(percentPerTick: number, intervalMs: number): void {
        // Clear any existing regeneration timer
        if (this.healthRegenTimer) {
            this.healthRegenTimer.destroy();
        }

        this.healthRegenAmount = percentPerTick;
        this.healthRegenInterval = intervalMs;

        // Create a new regeneration timer
        this.healthRegenTimer = this.scene.time.addEvent({
            delay: intervalMs,
            callback: this.regenerateHealth,
            callbackScope: this,
            loop: true
        });
    }

    private regenerateHealth(): void {
        if (this.health < this.maxHealth) {
            const healAmount = Math.floor(this.maxHealth * this.healthRegenAmount);
            this.heal(healAmount);
        }
    }

    public destroy(fromScene?: boolean): void {
        // Clean up health regeneration timer
        if (this.healthRegenTimer) {
            this.healthRegenTimer.destroy();
            this.healthRegenTimer = null;
        }

        // Clean up immunity timer
        if (this.immunityTimer) {
            this.immunityTimer.destroy();
            this.immunityTimer = null;
        }
        
        super.destroy(fromScene);
    }
} 