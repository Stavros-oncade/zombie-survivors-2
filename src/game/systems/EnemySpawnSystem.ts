import Phaser from 'phaser';
import { GameConstants } from '../config/GameConstants';
import { EnemyType, SpawnState, ClusterType } from '../types/GameTypes';
import { Enemy } from '../entities/Enemy';
import { EliteEnemy } from '../entities/EliteEnemy';
import { BossEnemy } from '../entities/BossEnemy';
import { RangedEnemy } from '../entities/RangedEnemy';
import { CarrierEnemy } from '../entities/CarrierEnemy';
import { ToxicTankEnemy } from '../entities/ToxicTankEnemy';
import { ShriekerEnemy } from '../entities/ShriekerEnemy';
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
    // Shrieker spawn gating: only mix in once difficulty has ramped, and never let
    // more than a couple exist at once (their aura compounds across a pack quickly).
    private static readonly SHRIEKER_MIN_DIFFICULTY = 2;
    private static readonly SHRIEKER_MAX_ALIVE = 2;

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
    // Number of elites currently alive. Replaces the old single `eliteAlive` boolean
    // so a simultaneously-spawned KILL_ELITES group (spawnEliteGroup) doesn't let the
    // periodic timer slip extra elites in while the group is still alive: the timer
    // only fires when this is 0, and each `elite_died` decrements it (down to 0).
    private eliteAliveCount: number = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private bossTimer!: Phaser.Time.TimerEvent;
    private bossAlive: boolean = false;

    // Expedition / Job Board run-modifier multipliers (default 1 = unchanged).
    private densityMult: number = 1;
    private enemyDamageMult: number = 1;
    private eliteIntervalMult: number = 1;

    // Mission "guaranteed type" (KILL_TYPE / PURGE_TYPE). When set, this enemy type
    // is force-spawned at any wave boundary where the previous wave produced none of
    // it, so it appears at least once every 2 waves regardless of the weighted table.
    private guaranteedType: EnemyType | null = null;
    private guaranteedSpawnedThisWave: boolean = false;
    private guaranteedSpawnedPrevWave: boolean = false;

    // ── Extraction phase (uncapped directional spawning) ──
    // When active, spawning bypasses getScaledConfig ceilings and a fast fixed
    // loop replaces the normal spawn timer, biased to come mostly from AWAY from
    // the extraction zone. The state machine is frozen while active.
    private extractionActive: boolean = false;
    private extractionTarget?: { x: number; y: number };
    private extractionSpawnTimer?: Phaser.Time.TimerEvent;
    private savedSpawnState?: SpawnState;
    // Rear-bias tuning (see spec §3).
    private static readonly EXTRACT_BASE_FLOOR = 0.08;
    private static readonly EXTRACT_BIAS_K = 2;
    private static readonly EXTRACT_SPAWN_DELAY = 250;
    private static readonly EXTRACT_BATCH = 8;

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
        this.setupEliteTimer();

        // Track elite death. Each elite (single or part of a group) emits its own
        // `elite_died`, so decrement per death and clamp at 0 — the periodic timer
        // re-opens only once every elite is gone.
        this.scene.events.on('elite_died', () => {
            this.eliteAliveCount = Math.max(0, this.eliteAliveCount - 1);
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
            spawnCount: Math.max(1, Math.round((base.spawnCount + extraCount) * this.densityMult)),
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
        this.enforceGuaranteedType();
    }

    /**
     * Wave-boundary hook for the mission guaranteed type. Called once per wave
     * (spawn-state) transition. If the wave that just ended produced none of the
     * guaranteed type, force-spawn one into the new wave — so two consecutive waves
     * can never pass without the mission's target type appearing.
     */
    private enforceGuaranteedType(): void {
        if (!this.guaranteedType) return;
        this.guaranteedSpawnedPrevWave = this.guaranteedSpawnedThisWave;
        this.guaranteedSpawnedThisWave = false;
        if (this.guaranteedSpawnedPrevWave) return;
        // Respect the Shrieker concurrency cap: if it's already at the ceiling the
        // type is plainly on the board, so the guarantee is met without adding another
        // (whose rally aura would compound). Mark satisfied and skip the force-spawn.
        if (
            this.guaranteedType === EnemyType.SHRIEKER &&
            this.countAliveShriekers() >= EnemySpawnSystem.SHRIEKER_MAX_ALIVE
        ) {
            this.guaranteedSpawnedThisWave = true;
            return;
        }
        const { x, y } = this.getRandomSpawnPosition();
        this.addEnemyOfType(this.guaranteedType, x, y);
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
        this.addEnemyOfType(this.getRandomEnemyType(cfg), x, y);
    }

    /**
     * Instantiate + register one enemy of an EXPLICIT type. Shared by the normal
     * weighted-random path (createEnemy) and the mission guaranteed-type path
     * (enforceGuaranteedType) so both apply the double-speed roll, damage scaling,
     * and group registration — and so any spawn of the guaranteed type marks it
     * present for the current wave.
     */
    private addEnemyOfType(type: EnemyType, x: number, y: number): void {
        let enemy: Enemy;
        if (type === EnemyType.RANGED) {
            enemy = new RangedEnemy(this.scene, x, y);
        } else if (type === EnemyType.CARRIER) {
            enemy = new CarrierEnemy(this.scene, x, y);
        } else if (type === EnemyType.TOXIC) {
            enemy = new ToxicTankEnemy(this.scene, x, y);
        } else if (type === EnemyType.SHRIEKER) {
            enemy = new ShriekerEnemy(this.scene, x, y);
        } else {
            enemy = new Enemy(this.scene, x, y, type);
        }
        // Rare "double speed" variant — orthogonal to base type, rides on any of
        // them. Apply at spawn, before any slow, so applySlow's snapshot is correct.
        if (Math.random() < GameConstants.ENEMIES.DOUBLE_SPEED_CHANCE) {
            enemy.makeDoubleSpeed();
        }
        if (this.enemyDamageMult !== 1) enemy.scaleDamage(this.enemyDamageMult);
        this.scene.add.existing(enemy);
        this.enemies.add(enemy);
        if (type === this.guaranteedType) this.guaranteedSpawnedThisWave = true;
        // console.log(
        //     `[${this.spawnState}] Spawned ${type} @ (${x},${y}) — total: ${this.enemies.getLength()}`
        // );
    }

    private spawnElite(): void {
        const pos = this.getRandomSpawnPositionOnSide(Phaser.Math.Between(0, 3));
        const elite = new EliteEnemy(this.scene, pos.x, pos.y);
        if (this.enemyDamageMult !== 1) elite.scaleDamage(this.enemyDamageMult);
        this.scene.add.existing(elite);
        this.enemies.add(elite);
        this.eliteAliveCount++;
        // Announce elite spawn (Game can do camera zoom + micro pause)
        this.scene.events.emit('elite_spawned', elite);
    }

    /**
     * Spawn `count` elites SIMULTANEOUSLY for a KILL_ELITES mission. Unlike the
     * periodic single-elite path, every elite appears at once, CLUSTERED ON ONE
     * SHARED SIDE (one side is picked once, positions jittered around it) so a
     * single centroid camera pan can frame the whole group without the centroid
     * landing on empty space. Emits ONE combined `elites_group_spawned` event with
     * the array of elites — it does NOT emit per-elite `elite_spawned`, which would
     * fire competing camera intros (one event → one intro → one set of tweens).
     */
    public spawnEliteGroup(count: number): void {
        const n = Math.max(1, Math.floor(count));
        const side = Phaser.Math.Between(0, 3);
        const elites: EliteEnemy[] = [];
        for (let i = 0; i < n; i++) {
            const pos = this.getRandomSpawnPositionOnSide(side);
            const offsetX = Phaser.Math.Between(-60, 60);
            const offsetY = Phaser.Math.Between(-60, 60);
            const elite = new EliteEnemy(this.scene, pos.x + offsetX, pos.y + offsetY);
            if (this.enemyDamageMult !== 1) elite.scaleDamage(this.enemyDamageMult);
            this.scene.add.existing(elite);
            this.enemies.add(elite);
            this.eliteAliveCount++;
            elites.push(elite);
        }
        // One combined announcement → Game runs a single group camera intro.
        this.scene.events.emit('elites_group_spawned', elites);
    }

    private spawnBoss(): void {
        const pos = this.getRandomSpawnPositionOnSide(Phaser.Math.Between(0, 3));
        const boss = new BossEnemy(this.scene, pos.x, pos.y);
        if (this.enemyDamageMult !== 1) boss.scaleDamage(this.enemyDamageMult);
        this.scene.add.existing(boss);
        this.enemies.add(boss);
        this.bossAlive = true;
        this.scene.events.emit('boss_spawned', boss);
    }

    // Public triggers for external control
    public triggerElite(): void { if (this.eliteAliveCount === 0) this.spawnElite(); }
    public triggerBoss(): void { if (!this.bossAlive) this.spawnBoss(); }

    private setupEliteTimer(): void {
        this.eliteTimer?.destroy();
        const delay = Math.max(5000, Math.round(90000 * this.eliteIntervalMult));
        this.eliteTimer = this.scene.time.addEvent({
            delay,
            loop: true,
            callback: () => {
                if (this.eliteAliveCount === 0) this.spawnElite();
            }
        });
    }

    // ── Expedition / Job Board run-modifier setters (§8) ──
    public setEnemyDensityMult(mult: number): void {
        this.densityMult = Math.max(0.25, mult);
        this.applyStateConfig(); // re-derive spawnCount immediately
    }
    public setEnemyDamageMult(mult: number): void {
        this.enemyDamageMult = Math.max(0.25, mult);
    }
    public setEliteIntervalMult(mult: number): void {
        this.eliteIntervalMult = Math.max(0.1, mult);
        this.setupEliteTimer();
    }

    /**
     * Force a specific enemy type to appear at least once every 2 waves (used for
     * KILL_TYPE / PURGE_TYPE missions so the objective can't stall when the weighted
     * spawn table happens to skip the target). Pass null to clear. Enforced at each
     * wave transition by enforceGuaranteedType().
     */
    public setGuaranteedType(type: EnemyType | null): void {
        this.guaranteedType = type;
        this.guaranteedSpawnedThisWave = false;
        this.guaranteedSpawnedPrevWave = false;
    }

    /** Count currently-alive Shriekers in the group (enforces the spawn cap). */
    private countAliveShriekers(): number {
        let count = 0;
        const children = this.enemies.getChildren() as Enemy[];
        for (const e of children) {
            if (e.active && e instanceof ShriekerEnemy) count++;
        }
        return count;
    }

    private getRandomEnemyType(cfg: SpawnStateConfig): EnemyType {
        // Treat enemyChances as weights (not normalized probabilities).
        const wTank = Math.max(0, cfg.enemyChances.tank || 0);
        const wFast = Math.max(0, cfg.enemyChances.fast || 0);
        const wRanged = Math.max(0, cfg.enemyChances.ranged || 0);
        const wCarrier = Math.max(0, cfg.enemyChances.carrier || 0);
        const wToxic = Math.max(0, cfg.enemyChances.toxic || 0);
        // Shrieker (pack-rally aura). Small weight so 1 mixes into NORMAL/PEAK waves.
        // Gated on difficulty >= 2, capped at MAX_ALIVE concurrent, and excluded from
        // the focused "pack" states so it stays an opportunistic horde sweetener.
        const isPackWave = !!(this.spawnState && this.spawnState.indexOf('pack') !== -1);
        const shriekerEligible =
            this.difficultyLevel >= EnemySpawnSystem.SHRIEKER_MIN_DIFFICULTY &&
            !isPackWave &&
            this.countAliveShriekers() < EnemySpawnSystem.SHRIEKER_MAX_ALIVE;
        const wShrieker = shriekerEligible ? 0.06 : 0;
        // Include a baseline BASIC weight for generic states only; exclude for "pack" waves
        const includeBaselineBasic = !isPackWave;
        const wBasic = includeBaselineBasic ? 1 : 0;
        const total = wTank + wFast + wRanged + wCarrier + wToxic + wShrieker + wBasic;
        const roll = Math.random() * (total > 0 ? total : 1);
        if (roll < wTank) return EnemyType.TANK;
        if (roll < wTank + wFast) return EnemyType.FAST;
        if (roll < wTank + wFast + wRanged) return EnemyType.RANGED;
        if (roll < wTank + wFast + wRanged + wCarrier) return EnemyType.CARRIER;
        if (roll < wTank + wFast + wRanged + wCarrier + wToxic) return EnemyType.TOXIC;
        if (roll < wTank + wFast + wRanged + wCarrier + wToxic + wShrieker) return EnemyType.SHRIEKER;
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

    // ── Extraction phase: uncapped, rear-biased directional spawning (spec §3/§4) ──

    /** Set (or clear) the world point spawns should be biased AWAY from. */
    public setExtractionTarget(p?: { x: number; y: number }): void {
        this.extractionTarget = p;
    }

    /**
     * Begin uncapped extraction spawning. Freezes the normal state machine
     * (so switchState can't reset the override), saves the current state, and
     * replaces the spawn timer with a fast fixed loop that bypasses the
     * getScaledConfig difficulty ceilings and spawns a fixed rear-biased batch.
     */
    public beginExtractionSpawning(target: { x: number; y: number }): void {
        if (this.extractionActive) return;
        this.extractionActive = true;
        this.extractionTarget = target;
        this.savedSpawnState = this.spawnState;

        // Freeze the normal cadence: kill the periodic spawn + the state machine
        // timer so neither competes with / resets the extraction override.
        this.spawnTimer?.destroy();
        this.stateTimer?.destroy();

        this.extractionSpawnTimer = this.scene.time.addEvent({
            delay: EnemySpawnSystem.EXTRACT_SPAWN_DELAY,
            loop: true,
            callback: this.spawnExtractionBatch,
            callbackScope: this,
        });
    }

    /** Restore the saved spawn state and normal timers when the phase ends. */
    public endExtractionSpawning(): void {
        if (!this.extractionActive) return;
        this.extractionActive = false;
        this.extractionTarget = undefined;
        this.extractionSpawnTimer?.destroy();
        this.extractionSpawnTimer = undefined;
        if (this.savedSpawnState) {
            this.spawnState = this.savedSpawnState;
            this.savedSpawnState = undefined;
        }
        // Re-arm the normal spawn + state timers from the (unfrozen) state.
        this.applyStateConfig();
    }

    /**
     * Spawn a fixed batch each tick, bypassing getScaledConfig ceilings. Each
     * enemy is placed via getBiasedSpawnPosition so the horde comes mostly from
     * away from the exit. Uses the current state's enemy mix for variety.
     */
    private spawnExtractionBatch(): void {
        const cfg = this.stateConfigs[this.spawnState];
        for (let i = 0; i < EnemySpawnSystem.EXTRACT_BATCH; i++) {
            const { x, y } = this.getBiasedSpawnPosition();
            this.createEnemy(x, y, cfg);
        }
    }

    /**
     * Pick a just-off-screen spawn point biased AWAY from the extraction exit via
     * rejection sampling. weight(δ) = baseFloor + (1-baseFloor)*((1-cos δ)/2)^k
     * where δ is the angular distance from the player→exit direction (0 = toward
     * exit, π = away). Up to ~8 tries, then accept the last roll.
     */
    public getBiasedSpawnPosition(): { x: number; y: number } {
        let centerX = this.scene.cameras.main.worldView.centerX;
        let centerY = this.scene.cameras.main.worldView.centerY;
        if (this.scene instanceof Game) {
            const p = this.scene.getPlayer();
            centerX = p.x;
            centerY = p.y;
        }

        // No target → fall back to a plain off-screen edge spawn.
        if (!this.extractionTarget) {
            return this.getRandomSpawnPosition();
        }

        const exitAngle = Math.atan2(
            this.extractionTarget.y - centerY,
            this.extractionTarget.x - centerX
        );

        let theta = Math.random() * Math.PI * 2;
        for (let attempt = 0; attempt < 8; attempt++) {
            theta = Math.random() * Math.PI * 2;
            const delta = Math.abs(Phaser.Math.Angle.Wrap(theta - exitAngle)); // [0, π]
            const away = (1 - Math.cos(delta)) / 2; // 0 toward exit, 1 away
            const weight =
                EnemySpawnSystem.EXTRACT_BASE_FLOOR +
                (1 - EnemySpawnSystem.EXTRACT_BASE_FLOOR) *
                    Math.pow(away, EnemySpawnSystem.EXTRACT_BIAS_K);
            if (Math.random() < weight) break;
        }
        return this.projectToViewportEdge(centerX, centerY, theta);
    }

    /**
     * Ray-cast from (cx, cy) along angle theta to the nearest camera worldView
     * edge, so the spawn lands just off-screen in the chosen direction.
     */
    public projectToViewportEdge(cx: number, cy: number, theta: number): { x: number; y: number } {
        const { left, right, top, bottom } = this.scene.cameras.main.worldView;
        const dx = Math.cos(theta);
        const dy = Math.sin(theta);

        let t = Infinity;
        if (dx > 1e-6) t = Math.min(t, (right - cx) / dx);
        else if (dx < -1e-6) t = Math.min(t, (left - cx) / dx);
        if (dy > 1e-6) t = Math.min(t, (bottom - cy) / dy);
        else if (dy < -1e-6) t = Math.min(t, (top - cy) / dy);
        if (!isFinite(t) || t < 0) t = 0;

        return { x: cx + dx * t, y: cy + dy * t };
    }

    public destroy(): void {
        this.spawnTimer?.destroy();
        this.stateTimer?.destroy();
        this.difficultyTimer?.destroy();
        this.extractionSpawnTimer?.destroy();
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
