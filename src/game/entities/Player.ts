import { GameConstants } from '../config/GameConstants';
import { PlayerStats } from '../types/GameTypes';
import { ExperienceSystem } from '../systems/ExperienceSystem';

export class Player extends Phaser.Physics.Arcade.Sprite {
    private health: number;
    private maxHealth: number;
    private stats: PlayerStats;
    private movementSpeed: number;
    private enemiesKilled: number = 0;
    private xpGained: number = 0;
    private experienceSystem!: ExperienceSystem;

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

    public takeDamage(amount: number): void {
        this.health = Math.max(0, this.health - amount);
        
        if (this.health <= 0) {
            this.die();
        }
    }

    public applyLevelUpEffects(): void {
        this.maxHealth = Math.floor(this.maxHealth * 1.1);
        this.health = this.maxHealth;
        this.movementSpeed = this.movementSpeed * 1.05;
        console.log(`Player Level Up Effects Applied! New Max HP: ${this.maxHealth}, New Speed: ${this.movementSpeed.toFixed(2)}`);
    }

    public incrementEnemiesKilled(): void {
        this.enemiesKilled++;
    }

    public addXPGained(amount: number): void {
        this.xpGained += amount;
    }

    private die(): void {
        console.log("Player Died. Stats:", this.getStats());
        this.scene.scene.start('GameOver', { 
            enemiesKilled: this.enemiesKilled, 
            xpGained: this.xpGained,
            levelReached: this.experienceSystem.getCurrentLevel()
        });
    }

    public getStats(): PlayerStats {
        this.stats.health = this.health;
        this.stats.maxHealth = this.maxHealth;
        this.stats.level = this.experienceSystem.getCurrentLevel();
        this.stats.experience = this.experienceSystem.getCurrentExperience();
        this.stats.experienceToNextLevel = this.experienceSystem.getRequiredExperience();
        console.log("getStats called:", this.stats);
        return this.stats;
    }

    public update(
        cursors: Phaser.Types.Input.Keyboard.CursorKeys,
        wasdKeys?: { [key: string]: Phaser.Input.Keyboard.Key }
    ): void {
        const direction = new Phaser.Math.Vector2(0, 0);

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

        direction.normalize();
        this.move(direction);
    }
} 