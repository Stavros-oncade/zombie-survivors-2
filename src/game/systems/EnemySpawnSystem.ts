import { GameConstants } from '../config/GameConstants';
import { EnemyType } from '../types/GameTypes';
import { Enemy } from '../entities/Enemy';

export class EnemySpawnSystem {
    private scene: Phaser.Scene;
    private enemies: Phaser.Physics.Arcade.Group;
    private spawnTimer: Phaser.Time.TimerEvent;
    private spawnDelay: number;
    private difficulty: number;

    constructor(scene: Phaser.Scene, enemies: Phaser.Physics.Arcade.Group) {
        this.scene = scene;
        this.enemies = enemies;
        this.difficulty = 1;
        this.spawnDelay = GameConstants.ENEMIES.INITIAL_SPAWN_DELAY;
        this.initialize();
    }

    private initialize(): void {
        // Create spawn timer
        this.spawnTimer = this.scene.time.addEvent({
            delay: this.spawnDelay,
            callback: this.spawnEnemy,
            callbackScope: this,
            loop: true
        });
    }

    public spawnEnemy(): void {
        // Randomly select enemy type based on difficulty
        const type = this.getRandomEnemyType();
        
        // Get random position around the edges of the screen
        const position = this.getRandomSpawnPosition();
        
        // Create enemy
        const enemy = new Enemy(this.scene, position.x, position.y, type);
        this.scene.add.existing(enemy);
        this.enemies.add(enemy);
        
        console.log(`Spawned enemy at (${position.x}, ${position.y}), total enemies: ${this.enemies.getLength()}`);
    }

    private getRandomEnemyType(): EnemyType {
        const rand = Math.random();
        
        if (this.difficulty > 2 && rand < 0.2) {
            return EnemyType.TANK;
        } else if (this.difficulty > 1 && rand < 0.4) {
            return EnemyType.FAST;
        }
        
        return EnemyType.BASIC;
    }

    private getRandomSpawnPosition(): { x: number; y: number } {
        const cam = this.scene.cameras.main;
        const left = cam.worldView.left;
        const right = cam.worldView.right;
        const top = cam.worldView.top;
        const bottom = cam.worldView.bottom;
        
        // Randomly choose a side to spawn from
        const side = Math.floor(Math.random() * 4);
        
        switch (side) {
            case 0: // Top
                return { x: Phaser.Math.Between(left, right), y: top };
            case 1: // Right
                return { x: right, y: Phaser.Math.Between(top, bottom) };
            case 2: // Bottom
                return { x: Phaser.Math.Between(left, right), y: bottom };
            case 3: // Left
                return { x: left, y: Phaser.Math.Between(top, bottom) };
            default:
                return { x: left, y: top };
        }
    }

    public increaseDifficulty(): void {
        this.difficulty += 0.1;
        this.spawnDelay = Math.max(
            GameConstants.ENEMIES.MIN_SPAWN_DELAY,
            GameConstants.ENEMIES.INITIAL_SPAWN_DELAY - (this.difficulty * 100)
        );
        
        // Update timer delay
        this.spawnTimer.reset({
            delay: this.spawnDelay,
            callback: this.spawnEnemy,
            callbackScope: this,
            loop: true
        });
    }

    public destroy(): void {
        if (this.spawnTimer) {
            this.spawnTimer.destroy();
        }
    }
} 