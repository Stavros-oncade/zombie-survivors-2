import Phaser from 'phaser';
import { GameConstants } from '../config/GameConstants';
import { EnemyType, SpawnState, ClusterType } from '../types/GameTypes';
import { Enemy } from '../entities/Enemy';
import { EliteEnemy } from '../entities/EliteEnemy';
import { BossEnemy } from '../entities/BossEnemy';
import { RangedEnemy } from '../entities/RangedEnemy';
import { CarrierEnemy } from '../entities/CarrierEnemy';
import { ToxicTankEnemy } from '../entities/ToxicTankEnemy';
import { SpawningConfig } from './SpawningConfig';
import { Game } from '../scenes/Game';

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
            ranged?: number;
            carrier?: number;
            toxic?: number;
        };
        clusterType: ClusterType;
        duration: number;
        // Add display configuration
        display?: WaveStateDisplayConfig;
    }

export class EnemySpawnSystem {
    private scene: Phaser.Scene;
    private enemies: Phaser.Physics.Arcade.Group;
    private spawnTimer!: Phaser.Time.TimerEvent;
    private stateTimer!: Phaser.Time.TimerEvent;
    private spawnState!: SpawnState;
    private difficultyLevel: number = 0;
    private difficultyTimer!: Phaser.Time.TimerEvent;
    // timers are created and managed internally; references retained for lifecycle, may be unused in code paths
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private eliteTimer!: Phaser.Time.TimerEvent;
    private eliteAlive: boolean = false;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private bossTimer!: Phaser.Time.TimerEvent;
    private bossAlive: boolean = false;

    private readonly stateConfigs: Record<SpawnState, SpawnStateConfig>;
    private readonly stateNames: SpawnState[];
    private readonly baseStateConfigs: Record<SpawnState, SpawnStateConfig>;

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
        customConfigs?: Partial<Record<SpawnState, SpawnStateConfig>>
    ) {
        this.scene = scene;
        this.enemies = enemies;

        const defaultConfigs: Record<SpawnState, SpawnStateConfig> = {
            [SpawnState.NORMAL]: {
                spawnDelay: GameConstants.ENEMIES.INITIAL_SPAWN_DELAY,
                spawnCount: 1,
                enemyChances: { fast: 0.4, tank: 0.2, ranged: 0.25, carrier: 0.05 },
                clusterType: ClusterType.RANDOM,
                duration: 10000,
                display: this.defaultDisplayConfigs.normal
            },
            [SpawnState.PEAK]: {
                spawnDelay: GameConstants.ENEMIES.MIN_SPAWN_DELAY,
                spawnCount: 3,
                enemyChances: { fast: 0.7, tank: 0.5, ranged: 0.4, carrier: 0.08 },
                clusterType: ClusterType.PINCER,
                duration: 6000,
                display: this.defaultDisplayConfigs.peak
            },
            [SpawnState.COOLDOWN]: {
                spawnDelay: GameConstants.ENEMIES.INITIAL_SPAWN_DELAY * 2,
                spawnCount: 2,
                enemyChances: { fast: 0.5, tank: 0.4, ranged: 0.3, carrier: 0.06 },
                clusterType: ClusterType.SAME_SIDE,
                duration: 8000,
                display: this.defaultDisplayConfigs.cooldown
            },
            [SpawnState.RANGED_PACK]: {
                spawnDelay: Math.max(600, Math.floor(GameConstants.ENEMIES.INITIAL_SPAWN_DELAY * 0.8)),
                spawnCount: 6,
                enemyChances: { fast: 0.05, tank: 0.05, ranged: 0.9, carrier: 0.0 },
                clusterType: ClusterType.SAME_SIDE,
                duration: 7000,
                display: { text: 'Marksmen incoming', color: '#66ccff', fontSize: '34px', glowColor: 0x66ccff, glowIntensity: 5, scale: { from: 0.8, to: 1.1 }, particles: true }
            },
            [SpawnState.CARRIER_PACK]: {
                spawnDelay: Math.max(700, Math.floor(GameConstants.ENEMIES.INITIAL_SPAWN_DELAY * 0.9)),
                spawnCount: 5,
                enemyChances: { fast: 0.05, tank: 0.05, ranged: 0.0, carrier: 0.9 },
                clusterType: ClusterType.SAME_SIDE,
                duration: 7000,
                display: { text: 'Carriers inbound', color: '#99cc66', fontSize: '34px', glowColor: 0x99cc66, glowIntensity: 5, scale: { from: 0.8, to: 1.1 }, particles: true }
            },
            [SpawnState.TOXIC_PACK]: {
                spawnDelay: Math.max(700, Math.floor(GameConstants.ENEMIES.INITIAL_SPAWN_DELAY * 0.9)),
                spawnCount: 6,
                enemyChances: { fast: 0.0, tank: 0.05, ranged: 0.0, carrier: 0.0, toxic: 0.95 },
                clusterType: ClusterType.AROUND,
                duration: 7000,
                display: { text: 'Toxic squad converging', color: '#66ff66', fontSize: '34px', glowColor: 0x66ff66, glowIntensity: 5, scale: { from: 0.8, to: 1.1 }, particles: true }
            }
        };

        this.baseStateConfigs = customConfigs 
            ? { ...defaultConfigs, ...(customConfigs as Record<SpawnState, SpawnStateConfig>)} 
            : defaultConfigs;
        // copy into mutable stateConfigs
        this.stateConfigs = JSON.parse(JSON.stringify(this.baseStateConfigs));
        this.stateNames = Object.keys(defaultConfigs) as SpawnState[];

        this.initialize();
    }

    private initialize(): void {
        this.spawnState = SpawnState.NORMAL;
        this.applyStateConfig();
        // If tuner requested a start state, switch to it now
        const cfg = SpawningConfig.getInstance();
        if (cfg.startState && this.stateNames.includes(cfg.startState)) {
            this.spawnState = cfg.startState;
            // Emit spawn state change event for UI and reapply timers
            const displayConfig = this.getWaveStateDisplayConfig(this.spawnState);
            const formattedText = this.getFormattedWaveStateText(this.spawnState);
            this.scene.events.emit('spawn_state_changed', {
                state: this.spawnState,
                displayConfig,
                formattedText
            });
            this.applyStateConfig();
            cfg.startState = undefined; // one-shot
        }
        // Increase global difficulty every 20 seconds
        this.difficultyTimer = this.scene.time.addEvent({
            delay: 20000,
            loop: true,
            callback: () => {
                this.difficultyLevel++;
                this.scene.events.emit('difficulty_increased');
                // Re-apply current state config to reflect increased difficulty
                this.applyStateConfig();
            }
        });

        // Spawn an elite periodically
        this.eliteTimer = this.scene.time.addEvent({
            delay: 90000,
            loop: true,
            callback: () => {
                if (!this.eliteAlive) {
                    this.spawnElite();
                }
            }
        });

        // Track elite death
        this.scene.events.on('elite_died', () => {
            this.eliteAlive = false;
        });
        // Spawn boss once after 5 minutes
        this.bossTimer = this.scene.time.addEvent({ delay: 300000, loop: false, callback: () => {
            if (!this.bossAlive) this.spawnBoss();
        }});
        this.scene.events.on('boss_died', () => { this.bossAlive = false; });
    }

    private applyStateConfig(): void {
        // derive cfg from base and difficulty level
        const base = this.baseStateConfigs[this.spawnState];
        const scaled = this.getScaledConfig(base);
        this.stateConfigs[this.spawnState] = scaled;
        this.setupSpawnTimer(scaled.spawnDelay);
        this.setupStateTimer(scaled.duration);
    }

    // Helper to scale spawn config by difficulty (instance method)
    private getScaledConfig(base: SpawnStateConfig): SpawnStateConfig {
        const level = this.difficultyLevel as number;
        const delayFactor = clamp(1 - 0.07 * level, 0.4, 1);
        const extraCount = Math.floor(level / 2);
        const tankBias = clamp(base.enemyChances.tank + 0.03 * level, 0, 0.8);
        const fastBias = clamp(base.enemyChances.fast + 0.02 * level, 0, 0.9);
        const cfg = SpawningConfig.getInstance();
        const rate = Math.max(0.1, cfg.rateMultiplier || 1);
        return {
            ...base,
            spawnDelay: Math.max(250, Math.floor((base.spawnDelay * delayFactor) / rate)),
            spawnCount: base.spawnCount + extraCount,
            enemyChances: {
                fast: fastBias,
                tank: tankBias,
                ranged: Math.max(0, base.enemyChances.ranged || 0),
                carrier: Math.max(0, base.enemyChances.carrier || 0),
                toxic: Math.max(0, base.enemyChances.toxic || 0)
            },
            clusterType: base.clusterType,
            duration: base.duration,
            display: base.display
        } as SpawnStateConfig;
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
        if (this.spawnState === SpawnState.NORMAL) {
            const nextStates = this.stateNames.filter(s => s !== SpawnState.NORMAL);
            this.spawnState = nextStates[Math.floor(Math.random() * nextStates.length)];
        } else {
            this.spawnState = SpawnState.NORMAL;
        }
        // console.log(`[SpawnState] → ${this.spawnState}`);
        
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

    // Expose a way to force a given spawn state and emit the banner
    public forceState(stateKey: SpawnState): void {
        if (!this.stateNames.includes(stateKey)) return;
        this.spawnState = stateKey;
        const displayConfig = this.getWaveStateDisplayConfig(this.spawnState);
        const formattedText = this.getFormattedWaveStateText(this.spawnState);
        this.scene.events.emit('spawn_state_changed', {
            state: this.spawnState,
            displayConfig,
            formattedText
        });
        this.applyStateConfig();
    }

    private spawnEnemy(): void {
        const cfg = this.stateConfigs[this.spawnState];
        this.spawnBatch(cfg);
    }

    private spawnBatch(cfg: SpawnStateConfig): void {
        switch (cfg.clusterType) {
            case ClusterType.SAME_SIDE:
                this.spawnClusterSameSide(cfg);
                break;
            case ClusterType.PINCER:
                this.spawnClusterPincer(cfg);
                break;
            case ClusterType.AROUND:
                this.spawnClusterAround(cfg);
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

    private spawnClusterAround(cfg: SpawnStateConfig): void {
        // Spawn enemies in a ring around the player (or camera center if player missing)
        let centerX = this.scene.cameras.main.worldView.centerX;
        let centerY = this.scene.cameras.main.worldView.centerY;
        if (this.scene instanceof Game) {
            const p = this.scene.getPlayer();
            centerX = p.x;
            centerY = p.y;
        }
        const radius = 400;
        for (let i = 0; i < cfg.spawnCount; i++) {
            const ang = Math.random() * Math.PI * 2;
            const jitter = Phaser.Math.Between(-40, 40);
            const x = centerX + Math.cos(ang) * (radius + jitter);
            const y = centerY + Math.sin(ang) * (radius + jitter);
            this.createEnemy(x, y, cfg);
        }
    }

    private createEnemy(x: number, y: number, cfg: SpawnStateConfig): void {
        const type = this.getRandomEnemyType(cfg);
        let enemy: Enemy;
        if (type === EnemyType.RANGED) {
            enemy = new RangedEnemy(this.scene, x, y);
        } else if (type === EnemyType.CARRIER) {
            enemy = new CarrierEnemy(this.scene, x, y);
        } else if (type === EnemyType.TOXIC) {
            enemy = new ToxicTankEnemy(this.scene, x, y);
        } else {
            enemy = new Enemy(this.scene, x, y, type);
        }
        this.scene.add.existing(enemy);
        this.enemies.add(enemy);
        // console.log(
        //     `[${this.spawnState}] Spawned ${type} @ (${x},${y}) — total: ${this.enemies.getLength()}`
        // );
    }

    private spawnElite(): void {
        const pos = this.getRandomSpawnPositionOnSide(Phaser.Math.Between(0, 3));
        const elite = new EliteEnemy(this.scene, pos.x, pos.y);
        this.scene.add.existing(elite);
        this.enemies.add(elite);
        this.eliteAlive = true;
        // Announce elite spawn (Game can do camera zoom + micro pause)
        this.scene.events.emit('elite_spawned', elite);
    }

    private spawnBoss(): void {
        const pos = this.getRandomSpawnPositionOnSide(Phaser.Math.Between(0, 3));
        const boss = new BossEnemy(this.scene, pos.x, pos.y);
        this.scene.add.existing(boss);
        this.enemies.add(boss);
        this.bossAlive = true;
        this.scene.events.emit('boss_spawned', boss);
    }

    // Public triggers for external control
    public triggerElite(): void { if (!this.eliteAlive) this.spawnElite(); }
    public triggerBoss(): void { if (!this.bossAlive) this.spawnBoss(); }

    private getRandomEnemyType(cfg: SpawnStateConfig): EnemyType {
        // Treat enemyChances as weights (not normalized probabilities).
        const wTank = Math.max(0, cfg.enemyChances.tank || 0);
        const wFast = Math.max(0, cfg.enemyChances.fast || 0);
        const wRanged = Math.max(0, cfg.enemyChances.ranged || 0);
        const wCarrier = Math.max(0, cfg.enemyChances.carrier || 0);
        const wToxic = Math.max(0, cfg.enemyChances.toxic || 0);
        // Include a baseline BASIC weight for generic states only; exclude for "pack" waves
        const includeBaselineBasic = !(this.spawnState && this.spawnState.indexOf('pack') !== -1);
        const wBasic = includeBaselineBasic ? 1 : 0;
        const total = wTank + wFast + wRanged + wCarrier + wToxic + wBasic;
        const roll = Math.random() * (total > 0 ? total : 1);
        if (roll < wTank) return EnemyType.TANK;
        if (roll < wTank + wFast) return EnemyType.FAST;
        if (roll < wTank + wFast + wRanged) return EnemyType.RANGED;
        if (roll < wTank + wFast + wRanged + wCarrier) return EnemyType.CARRIER;
        if (roll < wTank + wFast + wRanged + wCarrier + wToxic) return EnemyType.TOXIC;
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
        this.difficultyTimer?.destroy();
    }

    // New method to get the formatted wave state text
    public getWaveStateDisplayConfig(state: SpawnState): WaveStateDisplayConfig {
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
    public getFormattedWaveStateText(state: SpawnState): string {
        const displayConfig = this.getWaveStateDisplayConfig(state);
        return `${displayConfig.emoji ? displayConfig.emoji : ""} ${displayConfig.text} ${displayConfig.emoji ? displayConfig.emoji : ""}`;
    }
}

// Helper to scale spawn config by difficulty
function clamp(num: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, num));
}
