import { GameConstants } from '../config/GameConstants';
import { PlayerStats } from '../types/GameTypes';
import { ExperienceSystem } from '../systems/ExperienceSystem';
import { trackEvent } from '../../oncade/OncadeIntegration';
import { Game } from '../scenes/Game';
import { SceneKey } from '../config/SceneKeys';
import { Enemy } from './Enemy';
import { ReconSystem } from '../systems/ReconSystem';
import { readMovementDirection } from '../utils/MovementInput';

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
    // deprecated: interval stored in timer; no separate field needed
    private lastDamageSource: Enemy | null = null;
    private immunityTimer: Phaser.Time.TimerEvent | null = null;
    private readonly IMMUNITY_DURATION: number = 100; // 100ms immunity
    private isDead: boolean = false;
    // Lifesteal (Vampiric Rounds upgrade): fraction of damage dealt to enemies
    // that heals the player. Additive per pick, capped so it can't trivialize
    // damage. Subscribes to the 'damageDealt' event Enemy.takeDamage() emits —
    // covers weapon hits, explosion damage, AND burn DoT ticks (all player-caused).
    private lifestealPct: number = 0;
    // Last NON-ZERO movement heading (normalized). Held when the player stops so
    // the flashlight cone (LightSystem) keeps its heading instead of snapping to
    // zero (light-sources doc §3.3 / §6.4). Defaults to "facing right".
    private lastFacing: Phaser.Math.Vector2 = new Phaser.Math.Vector2(1, 0);

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

        this.scene.events.on('damageDealt', this.onDamageDealt, this);
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

        // Cache the last non-zero heading (already normalized) so consumers like
        // the flashlight cone hold a stable facing while the player is idle.
        if (direction.lengthSq() > 0.0001) {
            this.lastFacing.copy(direction);
        }
    }

    /** Last non-zero movement heading (normalized). Used by the flashlight cone. */
    public getFacing(): Phaser.Math.Vector2 {
        return this.lastFacing;
    }

    public takeDamage(amount: number, source: Enemy): void {
        // Check if the player is immune to this damage source (while timer has remaining time)
        if (this.lastDamageSource === source && this.immunityTimer && this.immunityTimer.getRemaining() > 0) {
            return; // Player is still immune to this source
        }

        this.health = Math.max(0, this.health - amount);
        // Emit player hit event for systems that react (killstreak reset, etc.)
        this.scene.events.emit('player_hit', { amount });
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
        // Use asymptotic increase toward max speed
        this.applyAsymptoticSpeedIncrease(1.05);
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

    public getIsDead(): boolean {
        return this.isDead;
    }

    public getEnemiesKilled(): number {
        return this.enemiesKilled;
    }

    public getXPGained(): number {
        return this.xpGained;
    }

    private die(): void {
        // Guard against re-entry (e.g. multiple damage sources resolving in the
        // same frame) so we only ever transition to GameOver once.
        if (this.isDead) {
            return;
        }
        this.isDead = true;

        console.log("Player Died. Stats:", this.getStats());

        // Mark the player inactive so any in-flight upgrade effects / level-up
        // triggers that check `active` no-op instead of mutating a dead player.
        this.setActive(false);

        // Get play time from the GameUI instead of the Game scene
        const gameScene = this.scene.scene.get(SceneKey.Game) as Game;
        const gameUI = gameScene ? gameScene.getGameUI() : null;
        const playTime = gameUI ? gameUI.getGameTime() : 0;

        // Track player death event
        trackEvent('player_died', {
            enemiesKilled: this.enemiesKilled,
            xpGained: this.xpGained,
            levelReached: this.experienceSystem.getCurrentLevel(),
            playTimeSeconds: playTime
        });

        // Dismiss any overlay scenes that are running on top of the Game scene.
        // If the player dies at (or just before) the moment a level-up upgrade
        // selection is shown, that overlay is a separate, independently-running
        // scene and would otherwise linger on top of GameOver, soft-locking the
        // game. Stop it (and the pause overlay) before transitioning.
        const sceneManager = this.scene.scene;
        if (sceneManager.isActive(SceneKey.LevelUpSelection)) {
            sceneManager.stop(SceneKey.LevelUpSelection);
        }
        if (sceneManager.isActive(SceneKey.PauseMenu)) {
            sceneManager.stop(SceneKey.PauseMenu);
        }
        // Un-pause before stopping the Game scene: a scene stopped while paused
        // leaves Arcade physics unable to re-boot (physics.world === null) on the
        // next run's create(). resume() on a non-paused scene is a no-op.
        sceneManager.resume();

        // Surface the failed objective on the lose screen.
        const missionName = gameScene?.getMissionSystem?.()?.getMission().name;
        const missionId = gameScene?.getActiveMissionId?.();
        const runId = gameScene?.getRunId?.();

        // Resolve assigned-survivor injury/death under the Game's runEnded latch so
        // it settles exactly once (mirrors the win/timeout terminus paths).
        const survivorOutcomes = gameScene?.resolveSurvivorsForDeath?.() ?? [];

        // Long Recon (§5.5): death anywhere FAILS the whole expedition. Forfeit the
        // staked pending rewards to a salvage floor, clear run-state, and route to the
        // recon-failed GameOver presentation instead of the standalone lose payload.
        const recon = ReconSystem.getInstance();
        if (recon.isActive()) {
            const payout = recon.failRecon();
            sceneManager.start(SceneKey.GameOver, {
                outcome: 'lose',
                missionName,
                missionId,
                runId,
                survivorOutcomes,
                reconFailed: true,
                reconPayout: payout,
                enemiesKilled: this.enemiesKilled,
                xpGained: this.xpGained,
                levelReached: this.experienceSystem.getCurrentLevel(),
                playTimeSeconds: playTime
            });
            return;
        }

        sceneManager.start(SceneKey.GameOver, {
            outcome: 'lose',
            missionName,
            missionId,
            runId,
            survivorOutcomes,
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
        // Movement intent is read by the shared MovementInput helper so the combat
        // Player and the camp CampPlayer stay in lockstep (no control drift).
        const direction = readMovementDirection(cursors, wasdKeys, initialTouchPoint, currentTouchPoint);
        this.move(direction);
    }

    public setMaxHealth(newMaxHealth: number): void {
        this.maxHealth = newMaxHealth;
        this.stats.maxHealth = newMaxHealth;
    }

    /** Current HP (Long Recon carry-state snapshot, §5.4). */
    public getCurrentHealth(): number {
        return this.health;
    }

    /**
     * Overwrite current HP to an absolute value (clamped to [1, maxHealth]). Used by
     * the Long Recon to carry damage between nodes (§5.3); never sets 0 (that would
     * trigger death on a fresh node), and never exceeds maxHealth.
     */
    public setHealthAbsolute(value: number): void {
        this.health = Math.max(1, Math.min(this.maxHealth, Math.floor(value)));
        this.stats.health = this.health;
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
        // Clamp to [0, MAX]
        const max = GameConstants.PLAYER.MAX_MOVEMENT_SPEED ?? this.movementSpeed;
        this.movementSpeed = Math.max(0, Math.min(newSpeed, max));
    }

    public upgradeWeaponDamage(multiplier: number): void {
        // Get the weapon system from the game scene
        const gameScene = this.scene.scene.get(SceneKey.Game) as Game;
        if (gameScene && gameScene.getWeaponSystem()) {
            gameScene.getWeaponSystem().upgradeWeaponDamage(multiplier);
        }
    }

    public upgradeWeaponSpeed(multiplier: number): void {
        // Get the weapon system from the game scene
        const gameScene = this.scene.scene.get(SceneKey.Game) as Game;
        if (gameScene && gameScene.getWeaponSystem()) {
            gameScene.getWeaponSystem().upgradeWeaponSpeed(multiplier);
        }
    }

    public upgradeProjectileSpeed(multiplier: number): void {
        // Get the weapon system from the game scene
        const gameScene = this.scene.scene.get(SceneKey.Game) as Game;
        if (gameScene && gameScene.getWeaponSystem()) {
            gameScene.getWeaponSystem().upgradeProjectileSpeed(multiplier);
        }
    }

    /**
     * Grants temporary immunity to repeated damage from the same source for a specified duration.
     * Resets the last damage source immediately and starts/restarts the internal immunity timer.
     */
    public grantImmunity(durationMs: number): void {
        if (this.immunityTimer) {
            this.immunityTimer.destroy();
        }
        this.lastDamageSource = null;
        this.immunityTimer = this.scene.time.addEvent({
            delay: Math.max(0, durationMs),
            callback: () => {
                this.lastDamageSource = null;
            }
        });
    }

    /** Additive per pick, capped at 40% so a stacked lifesteal build can't trivialize damage. */
    public enableLifesteal(pct: number): void {
        this.lifestealPct = Math.min(0.4, this.lifestealPct + pct);
    }

    public getLifestealPct(): number {
        return this.lifestealPct;
    }

    private onDamageDealt = (dealt: number): void => {
        if (!this.active || this.lifestealPct <= 0) return;
        this.heal(dealt * this.lifestealPct);
    };

    public enableHealthRegeneration(percentPerTick: number, intervalMs: number): void {
        // Clear any existing regeneration timer
        if (this.healthRegenTimer) {
            this.healthRegenTimer.destroy();
        }

        this.healthRegenAmount = percentPerTick;

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

        // Guard: on a full scene shutdown, Phaser may have already nulled
        // `this.scene` by the time this cascades down from UpdateList.shutdown.
        if (this.scene) this.scene.events.off('damageDealt', this.onDamageDealt, this);

        super.destroy(fromScene);
    }

    // Asymptotic speed growth toward a cap for permanent upgrades
    public applyAsymptoticSpeedIncrease(multiplier: number): void {
        const max = GameConstants.PLAYER.MAX_MOVEMENT_SPEED ?? this.movementSpeed;
        const current = this.movementSpeed;
        const factor = Math.max(1, multiplier);
        const increment = (max - current) * (factor - 1);
        this.setMovementSpeed(current + increment);
    }
}
