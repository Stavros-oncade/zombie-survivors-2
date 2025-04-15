import { GameConstants } from '../config/GameConstants';
import { PlayerStats } from '../types/GameTypes';

export class Player extends Phaser.Physics.Arcade.Sprite {
    private health: number;
    private maxHealth: number;
    private level: number;
    private experience: number;
    private experienceToNextLevel: number;
    private stats: PlayerStats;
    private movementSpeed: number;
    private enemiesKilled: number = 0;
    private xpGained: number = 0;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, 'player');
        this.initialize();
    }

    private initialize(): void {
        this.health = GameConstants.PLAYER.INITIAL_HEALTH;
        this.maxHealth = GameConstants.PLAYER.INITIAL_HEALTH;
        this.level = 1;
        this.experience = 0;
        this.experienceToNextLevel = GameConstants.EXPERIENCE.BASE_XP_REQUIREMENT;
        this.movementSpeed = GameConstants.PLAYER.MOVEMENT_SPEED;
        
        this.stats = {
            health: this.health,
            maxHealth: this.maxHealth,
            level: this.level,
            experience: this.experience,
            experienceToNextLevel: this.experienceToNextLevel
        };

        // Enable physics - moved to after the sprite is added to the scene
        // The physics will be enabled in the Game scene's create method
    }

    public enablePhysics(): void {
        if (this.scene && this.scene.physics) {
            this.scene.physics.add.existing(this);
            this.setCollideWorldBounds(true);
        }
    }

    public move(direction: Phaser.Math.Vector2): void {
        const speed = GameConstants.PLAYER.MOVEMENT_SPEED;
        this.setVelocity(direction.x * speed, direction.y * speed);

        // Flip sprite based on horizontal movement direction
        if (direction.x !== 0) {
            this.setFlipX(direction.x < 0);
        }
    }

    public takeDamage(amount: number): void {
        this.health = Math.max(0, this.health - amount);
        this.stats.health = this.health;
        
        if (this.health <= 0) {
            this.die();
        }
    }

    public gainExperience(amount: number): void {
        this.experience += amount;
        this.xpGained += amount;
        this.stats.experience = this.experience;

        if (this.experience >= this.experienceToNextLevel) {
            this.levelUp();
        }
    }

    public levelUp(): void {
        this.level++;
        this.maxHealth *= 1.1;
        this.health = this.maxHealth;
        this.movementSpeed *= 1.05;
        this.stats.level = this.level;
        this.experience -= this.experienceToNextLevel;
        this.experienceToNextLevel = Math.floor(
            GameConstants.EXPERIENCE.BASE_XP_REQUIREMENT * 
            Math.pow(GameConstants.EXPERIENCE.XP_SCALING_FACTOR, this.level - 1)
        );
        this.stats.experienceToNextLevel = this.experienceToNextLevel;
    }

    public incrementEnemiesKilled(): void {
        this.enemiesKilled++;
    }

    private die(): void {
        this.scene.scene.start('GameOver', { 
            enemiesKilled: this.enemiesKilled, 
            xpGained: this.xpGained 
        });
    }

    public getStats(): PlayerStats {
        return this.stats;
    }

    public update(
        cursors: Phaser.Types.Input.Keyboard.CursorKeys,
        wasdKeys?: { [key: string]: Phaser.Input.Keyboard.Key }
    ): void {
        const direction = new Phaser.Math.Vector2(0, 0);

        // Arrow keys
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

        // WASD keys
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