import Phaser from 'phaser';
import { GameConstants } from '../config/GameConstants';
import { EnemyType } from '../types/GameTypes';
import { Enemy } from '../entities/Enemy';

// New interface for wave state display configuration
interface WaveStateDisplayConfig {
    text: string;
    color: string;
    fontSize: string;
    emoji?: string;
    glowColor: number;
    glowIntensity: number;
    scale: { from: number; to: number };
    particles: boolean;
}

interface SpawnStateConfig {
    spawnDelay: number;
    spawnCount: number;
    enemyChances: {
        fast: number;
        tank: number;
    };
    clusterType: 'random' | 'sameSide' | 'pincer';
    duration: number;
    // Add display configuration
    display?: WaveStateDisplayConfig;
}

export class EnemySpawnSystem {
    private scene: Phaser.Scene;
    private enemies: Phaser.Physics.Arcade.Group;
    private spawnTimer!: Phaser.Time.TimerEvent;
    private stateTimer!: Phaser.Time.TimerEvent;
    private spawnState!: string;

    private readonly stateConfigs: Record<string, SpawnStateConfig>;
    private readonly stateNames: string[];

    // Default display configurations for each state
    private readonly defaultDisplayConfigs: Record<string, WaveStateDisplayConfig> = {
        normal: {
            text: "zombies incoming",
            color: "#00ffff",
            fontSize: "32px",
            glowColor: 0x00ffff,
            glowIntensity: 4,
            scale: { from: 0.7, to: 1 },
            particles: true
        },
        peak: {
            text: "HORDE SPOTTED!!",
            color: "#ff6600",
            fontSize: "36px",
            emoji: "💀",
            glowColor: 0xff6600,
            glowIntensity: 5,
            scale: { from: 0.8, to: 1.2 },
            particles: true
        },
        cooldown: {
            text: "Its quiet...",
            color: "#00ff00",
            fontSize: "30px",
            glowColor: 0x00ff00,
            glowIntensity: 4,
            scale: { from: 0.7, to: 1 },
            particles: true
        }
    };

    constructor(
        scene: Phaser.Scene,
        enemies: Phaser.Physics.Arcade.Group,
        customConfigs?: Partial<Record<string, SpawnStateConfig>>
    ) {
        this.scene = scene;
        this.enemies = enemies;

        const defaultConfigs: Record<string, SpawnStateConfig> = {
            normal: {
                spawnDelay: GameConstants.ENEMIES.INITIAL_SPAWN_DELAY,
                spawnCount: 1,
                enemyChances: { fast: 0.4, tank: 0.2 },
                clusterType: 'random',
                duration: 10000,
                display: this.defaultDisplayConfigs.normal
            },
            peak: {
                spawnDelay: GameConstants.ENEMIES.MIN_SPAWN_DELAY,
                spawnCount: 3,
                enemyChances: { fast: 0.7, tank: 0.5 },
                clusterType: 'pincer',
                duration: 6000,
                display: this.defaultDisplayConfigs.peak
            },
            cooldown: {
                spawnDelay: GameConstants.ENEMIES.INITIAL_SPAWN_DELAY * 2,
                spawnCount: 2,
                enemyChances: { fast: 0.5, tank: 0.4 },
                clusterType: 'sameSide',
                duration: 8000,
                display: this.defaultDisplayConfigs.cooldown
            }
        };

        this.stateConfigs = customConfigs 
            ? { ...defaultConfigs, ...(customConfigs as Record<string, SpawnStateConfig>)} 
            : defaultConfigs;
        this.stateNames = Object.keys(defaultConfigs);

        this.initialize();
    }

    private initialize(): void {
        this.spawnState = 'normal';
        this.applyStateConfig();
    }

    private applyStateConfig(): void {
        const cfg = this.stateConfigs[this.spawnState];
        this.setupSpawnTimer(cfg.spawnDelay);
        this.setupStateTimer(cfg.duration);
    }

    private setupSpawnTimer(delay: number): void {
        this.spawnTimer?.destroy();
        this.spawnTimer = this.scene.time.addEvent({
            delay,
            callback: this.spawnEnemy,
            callbackScope: this,
            loop: true
        });
    }

    private setupStateTimer(duration: number): void {
        this.stateTimer?.destroy();
        this.stateTimer = this.scene.time.addEvent({
            delay: duration,
            callback: this.switchState,
            callbackScope: this
        });
    }

    private switchState(): void {
        if (this.spawnState === 'normal') {
            const nextStates = this.stateNames.filter(s => s !== 'normal');
            this.spawnState = nextStates[Math.floor(Math.random() * nextStates.length)];
        } else {
            this.spawnState = 'normal';
        }
        console.log(`[SpawnState] → ${this.spawnState}`);
        
        // Get the display configuration for the new state
        const displayConfig = this.getWaveStateDisplayConfig(this.spawnState);
        const formattedText = this.getFormattedWaveStateText(this.spawnState);
        
        // Emit event with both the state name and its display configuration
        this.scene.events.emit('spawn_state_changed', {
            state: this.spawnState,
            displayConfig: displayConfig,
            formattedText: formattedText
        });
        
        this.applyStateConfig();
    }

    private spawnEnemy(): void {
        const cfg = this.stateConfigs[this.spawnState];
        this.spawnBatch(cfg);
    }

    private spawnBatch(cfg: SpawnStateConfig): void {
        switch (cfg.clusterType) {
            case 'sameSide':
                this.spawnClusterSameSide(cfg);
                break;
            case 'pincer':
                this.spawnClusterPincer(cfg);
                break;
            default:
                this.spawnClusterRandom(cfg);
        }
    }

    private spawnClusterRandom(cfg: SpawnStateConfig): void {
        for (let i = 0; i < cfg.spawnCount; i++) {
            const { x, y } = this.getRandomSpawnPosition();
            this.createEnemy(x, y, cfg);
        }
    }

    private spawnClusterSameSide(cfg: SpawnStateConfig): void {
        const side = Phaser.Math.Between(0, 3);
        for (let i = 0; i < cfg.spawnCount; i++) {
            const pos = this.getRandomSpawnPositionOnSide(side);
            const offsetX = Phaser.Math.Between(-50, 50);
            const offsetY = Phaser.Math.Between(-50, 50);
            this.createEnemy(pos.x + offsetX, pos.y + offsetY, cfg);
        }
    }

    private spawnClusterPincer(cfg: SpawnStateConfig): void {
        const side1 = Phaser.Math.Between(0, 3);
        const side2 = (side1 + 2) % 4;
        const half = Math.floor(cfg.spawnCount / 2);

        for (let i = 0; i < half; i++) {
            const pos = this.getRandomSpawnPositionOnSide(side1);
            this.createEnemy(pos.x, pos.y, cfg);
        }
        for (let i = 0; i < cfg.spawnCount - half; i++) {
            const pos = this.getRandomSpawnPositionOnSide(side2);
            this.createEnemy(pos.x, pos.y, cfg);
        }
    }

    private createEnemy(x: number, y: number, cfg: SpawnStateConfig): void {
        const type = this.getRandomEnemyType(cfg);
        const enemy = new Enemy(this.scene, x, y, type);
        this.scene.add.existing(enemy);
        this.enemies.add(enemy);
        console.log(
            `[${this.spawnState}] Spawned ${type} @ (${x},${y}) — total: ${this.enemies.getLength()}`
        );
    }

    private getRandomEnemyType(cfg: SpawnStateConfig): EnemyType {
        const r = Math.random();
        if (r < cfg.enemyChances.tank) {
            return EnemyType.TANK;
        } else if (r < cfg.enemyChances.tank + cfg.enemyChances.fast) {
            return EnemyType.FAST;
        }
        return EnemyType.BASIC;
    }

    private getRandomSpawnPosition(): { x: number; y: number } {
        return this.getRandomSpawnPositionOnSide(Phaser.Math.Between(0, 3));
    }

    private getRandomSpawnPositionOnSide(side: number) {
        const cam = this.scene.cameras.main;
        const { left, right, top, bottom } = cam.worldView;
        switch (side) {
            case 0:
                return { x: Phaser.Math.Between(left, right), y: top };
            case 1:
                return { x: right, y: Phaser.Math.Between(top, bottom) };
            case 2:
                return { x: Phaser.Math.Between(left, right), y: bottom };
            default:
                return { x: left, y: Phaser.Math.Between(top, bottom) };
        }
    }

    public destroy(): void {
        this.spawnTimer?.destroy();
        this.stateTimer?.destroy();
    }

    // New method to get the formatted wave state text
    public getWaveStateDisplayConfig(state: string): WaveStateDisplayConfig {
        const stateConfig = this.stateConfigs[state];
        if (stateConfig?.display) {
            return stateConfig.display;
        }
        
        // Return default display config for the state or a fallback
        return this.defaultDisplayConfigs[state] || {
            text: state.toUpperCase(),
            color: "#ffffff",
            fontSize: "32px",
            emoji: "⚔️",
            glowColor: 0xffffff,
            glowIntensity: 4,
            scale: { from: 0.7, to: 1 },
            particles: true
        };
    }

    // New method to get the formatted wave state text
    public getFormattedWaveStateText(state: string): string {
        const displayConfig = this.getWaveStateDisplayConfig(state);
        return `${displayConfig.emoji ? displayConfig.emoji : ""} ${displayConfig.text} ${displayConfig.emoji ? displayConfig.emoji : ""}`;
    }
}