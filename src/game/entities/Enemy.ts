import { GameConstants } from '../config/GameConstants';
import { GameConfig } from '../config/GameConfig';
import { EnemyType, PickupType } from '../types/GameTypes';
import { KillClass } from '../types/MissionTypes';
// Note: base methods accept Phaser sprites to avoid tight coupling
import { DeathEffect } from '../effects/DeathEffect';
import { Pickup } from './Pickup';
import { Game } from '../scenes/Game';
import { SceneKey } from '../config/SceneKeys';

export class Enemy extends Phaser.Physics.Arcade.Sprite {
    private health: number;
    private maxHealth: number;
    private speed: number;
    private damage: number;
    private experienceValue: number;
    protected enemyType: EnemyType;
    private isStunned: boolean = false;
    private stunTimer: Phaser.Time.TimerEvent | null = null;
    private baseSpeed: number | null = null;
    private slowTimer: Phaser.Time.TimerEvent | null = null;
    // Rally (Shrieker aura) snapshot. Kept separate from the slow snapshot so the
    // two buffs/debuffs don't clobber each other's baseline. Both speed and damage
    // are snapshotted on first application and restored when the refresh stops.
    private rallyBaseSpeed: number | null = null;
    private rallyBaseDamage: number | null = null;
    private rallyTimer: Phaser.Time.TimerEvent | null = null;
    private isDoubleSpeed = false;
    private doubleSpeedGlow: Phaser.GameObjects.Sprite | null = null;
    private doubleSpeedGlowEvent?: Phaser.Time.TimerEvent;
    // Rare "erratic" variant state (see makeErratic()/updateErraticMovement()).
    private isErratic = false;
    private erraticAngle: number | null = null;
    private erraticTickAccumMs = 0;
    private erraticStopTicksLeft = 0;
    private erraticGlow: Phaser.GameObjects.Sprite | null = null;
    private erraticGlowEvent?: Phaser.Time.TimerEvent;
    private readonly damageFlashMatrix = [
        1, 0, 0, 0, 0,   // Red channel unchanged
        0.3, 0.3, 0.3, 0, 0, // Green channel dimmed (30% of original)
        0.3, 0.3, 0.3, 0, 0, // Blue channel dimmed (30% of original)
        0, 0, 0, 1, 0    // Alpha unchanged
    ];

    constructor(scene: Phaser.Scene, x: number, y: number, type: EnemyType) {
        const spriteKey = Enemy.getSpriteKeyForType(type);
        super(scene, x, y, spriteKey);
        this.enemyType = type;
        this.initialize();
    }

    private static getSpriteKeyForType(type: EnemyType): string {
        switch (type) {
            case EnemyType.TANK:
                return 'enemy_tank';
            case EnemyType.FAST:
                return 'enemy_fast';
            case EnemyType.RANGED:
                return 'enemy_ranged';
            case EnemyType.CARRIER:
                return 'enemy_carrier';
            case EnemyType.TOXIC:
                return 'enemy_toxic';
            default:
                return 'enemy';
        }
    }

    private initialize(): void {
        // Enable physics
        this.scene.physics.add.existing(this);
        this.setScale(0.5); // Scale down enemy sprite
        
        // Adjust physics body size after scaling
        const scaleFactor = 0.5;
        // Important: setSize should ideally use the *original* texture dimensions
        // If the base texture dimensions are unknown, get them before scaling or use reasonable defaults.
        // Assuming base dimensions here, replace with actual if known.
        const baseWidth = this.width / this.scaleX; // Estimate base width before scale was applied
        const baseHeight = this.height / this.scaleY; // Estimate base height before scale was applied
        this.body?.setSize(baseWidth * scaleFactor, baseHeight * scaleFactor);
        // Optional: Center body if needed after resize
        // this.body?.setOffset(offsetX, offsetY);

        // Set properties based on enemy type
        switch (this.enemyType) {
            case EnemyType.FAST:
                this.health = GameConstants.ENEMIES.BASE_HEALTH * 0.5;
                this.speed = GameConstants.ENEMIES.INITIAL_SPEED * 1.5;
                this.damage = 3;
                this.experienceValue = 30;
                break;
            case EnemyType.TANK:
                this.health = GameConstants.ENEMIES.BASE_HEALTH * 2;
                this.speed = GameConstants.ENEMIES.INITIAL_SPEED * 0.7;
                this.damage = 9;
                this.experienceValue = 35;
                break;
            case EnemyType.CARRIER:
                this.health = GameConstants.ENEMIES.BASE_HEALTH;
                this.speed = GameConstants.ENEMIES.INITIAL_SPEED * 0.8; // 20% slower
                this.damage = 6;
                this.experienceValue = 25;
                break;
            case EnemyType.TOXIC:
                this.health = GameConstants.ENEMIES.BASE_HEALTH * 1.5;
                this.speed = GameConstants.ENEMIES.INITIAL_SPEED * 0.6;
                this.damage = 7;
                this.experienceValue = 35;
                break;
            case EnemyType.SHRIEKER:
                // Fragile, slow, but high-value: the design wants it to lurk at the
                // back of a pack so auto-fire kills it last. High XP rewards the
                // player for repositioning to prioritize it.
                this.health = GameConstants.ENEMIES.BASE_HEALTH * 0.5;
                this.speed = GameConstants.ENEMIES.INITIAL_SPEED * 0.6;
                this.damage = 4;
                this.experienceValue = 60;
                break;
            default: // BASIC
                this.health = GameConstants.ENEMIES.BASE_HEALTH;
                this.speed = GameConstants.ENEMIES.INITIAL_SPEED;
                this.damage = 6;
                this.experienceValue = 20;
        }

        this.maxHealth = this.health;
    }

    public moveTowardsPlayer(player: Phaser.Physics.Arcade.Sprite): void {
        // Skip movement if stunned
        if (this.isStunned) return;

        // Erratic variant drives its own state machine instead of beelining the
        // player. Checked AFTER the stun guard above so knockback/stun still
        // interrupts an erratic enemy exactly like any other.
        if (this.isErratic) {
            this.updateErraticMovement(player);
            return;
        }

        const angle = Phaser.Math.Angle.Between(
            this.x,
            this.y,
            player.x,
            player.y
        );

        this.setVelocityX(Math.cos(angle) * this.speed);
        this.setVelocityY(Math.sin(angle) * this.speed);
    }

    /**
     * Apply a temporary movement slow (e.g. Frost Mine). `factor` is the fraction
     * of base speed to keep (0.6 = 40% slow). Refreshing extends the duration off
     * the original base speed so repeated applications never compound permanently.
     */
    public applySlow(factor: number, durationMs: number): void {
        // Guard against a slow applied to an enemy that was just killed/destroyed
        // (Phaser nulls `scene` on destroy, so `this.scene.time` would throw).
        if (!this.active || !this.scene) return;
        if (this.baseSpeed === null) this.baseSpeed = this.speed;
        this.speed = this.baseSpeed * Phaser.Math.Clamp(factor, 0.05, 1);
        this.slowTimer?.remove(false);
        this.slowTimer = this.scene.time.delayedCall(durationMs, () => {
            if (this.baseSpeed !== null) this.speed = this.baseSpeed;
            this.baseSpeed = null;
            this.slowTimer = null;
        });
    }

    /**
     * Apply a temporary "rally" buff (Shrieker aura). `factor` (>1) is the speed
     * multiplier off the original base speed; damage is scaled up by a derived
     * factor. Mirrors applySlow() exactly: the first application snapshots the
     * baseline once, every subsequent call recomputes from that SAME snapshot (so
     * repeated per-frame calls never compound), and a single refresh timer reverts
     * to baseline when the Shrieker stops refreshing (death / enemy leaves aura).
     */
    public applyRally(factor: number, durationMs: number): void {
        // Guard against a rally applied to an enemy that was just killed/destroyed
        // (Phaser nulls `scene` on destroy, so `this.scene.time` would throw).
        if (!this.active || !this.scene) return;
        // Snapshot the un-buffed baselines exactly once. While the buff is live the
        // snapshot is non-null, so the values below are always derived from the
        // ORIGINAL baseline rather than the already-buffed current values.
        if (this.rallyBaseSpeed === null) this.rallyBaseSpeed = this.speed;
        if (this.rallyBaseDamage === null) this.rallyBaseDamage = this.damage;
        const speedFactor = Phaser.Math.Clamp(factor, 1, 3);
        // Damage scales more gently than speed (e.g. 1.4x speed -> ~1.3x damage).
        const dmgFactor = 1 + (speedFactor - 1) * 0.75;
        this.speed = this.rallyBaseSpeed * speedFactor;
        this.damage = this.rallyBaseDamage * dmgFactor;
        this.rallyTimer?.remove(false);
        this.rallyTimer = this.scene.time.delayedCall(durationMs, () => {
            if (this.rallyBaseSpeed !== null) this.speed = this.rallyBaseSpeed;
            if (this.rallyBaseDamage !== null) this.damage = this.rallyBaseDamage;
            this.rallyBaseSpeed = null;
            this.rallyBaseDamage = null;
            this.rallyTimer = null;
        });
    }

    /**
     * Rare "double speed" variant modifier. Orthogonal to base type: multiplies
     * this enemy's base speed and marks it with a red outline so it reads as a
     * threat without recoloring the sprite. Idempotent — repeated calls no-op.
     */
    public makeDoubleSpeed(): void {
        if (this.isDoubleSpeed) return;
        this.isDoubleSpeed = true;
        this.speed *= GameConstants.ENEMIES.DOUBLE_SPEED_MULTIPLIER;

        const color = GameConstants.ENEMIES.DOUBLE_SPEED_OUTLINE_COLOR;
        // Tight preFX glow tuned to read as a red outline rather than a soft halo.
        const hadGlow = this.tryAddGlow(color, 4, 0, false, 0.6, 12);
        if (!hadGlow) {
            // Fallback for environments without preFX (e.g., Canvas renderer):
            // an ADD-blended, tinted copy of the sprite behind the original.
            this.doubleSpeedGlow = this.scene.add.sprite(this.x, this.y, this.texture.key);
            this.doubleSpeedGlow.setScale(this.scaleX * 1.2, this.scaleY * 1.2);
            this.doubleSpeedGlow.setTint(color).setAlpha(0.5);
            this.doubleSpeedGlow.setBlendMode(Phaser.BlendModes.ADD);
            this.doubleSpeedGlow.setDepth(this.depth - 1);
            // Follow position periodically
            this.doubleSpeedGlowEvent = this.scene.time.addEvent({ delay: 16, loop: true, callback: () => {
                if (this.doubleSpeedGlow && this.active) this.doubleSpeedGlow.setPosition(this.x, this.y);
            }});
        }
    }

    /**
     * Rare "erratic" variant modifier. Orthogonal to base type (mirrors
     * makeDoubleSpeed() exactly, purple outline instead of red): the enemy
     * lurches in a direction instead of beelining the player — see
     * updateErraticMovement(). Idempotent — repeated calls no-op.
     */
    public makeErratic(): void {
        if (this.isErratic) return;
        this.isErratic = true;

        const color = GameConstants.ENEMIES.ERRATIC_OUTLINE_COLOR;
        const hadGlow = this.tryAddGlow(color, 4, 0, false, 0.6, 12);
        if (!hadGlow) {
            this.erraticGlow = this.scene.add.sprite(this.x, this.y, this.texture.key);
            this.erraticGlow.setScale(this.scaleX * 1.2, this.scaleY * 1.2);
            this.erraticGlow.setTint(color).setAlpha(0.5);
            this.erraticGlow.setBlendMode(Phaser.BlendModes.ADD);
            this.erraticGlow.setDepth(this.depth - 1);
            this.erraticGlowEvent = this.scene.time.addEvent({ delay: 16, loop: true, callback: () => {
                if (this.erraticGlow && this.active) this.erraticGlow.setPosition(this.x, this.y);
            }});
        }
    }

    /**
     * Erratic movement state machine, driven from moveTowardsPlayer() in place
     * of the normal chase logic. Runs on a discrete tick (ERRATIC_TICK_MS) via
     * an ms accumulator rather than every frame, so it reads as a lurch rather
     * than jitter and stays frame-rate independent. Each tick: 80% continue on
     * the current heading, 10% turn ~90 degrees, 10% stop for
     * ERRATIC_STOP_TICKS ticks.
     */
    private updateErraticMovement(player: Phaser.Physics.Arcade.Sprite): void {
        const E = GameConstants.ENEMIES;
        if (this.erraticAngle === null) {
            this.erraticAngle = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
        }

        this.erraticTickAccumMs += this.scene.game.loop.delta;
        while (this.erraticTickAccumMs >= E.ERRATIC_TICK_MS) {
            this.erraticTickAccumMs -= E.ERRATIC_TICK_MS;

            if (this.erraticStopTicksLeft > 0) {
                this.erraticStopTicksLeft--;
                continue;
            }

            const roll = Math.random();
            if (roll < E.ERRATIC_CONTINUE_CHANCE) {
                // Continue straight — heading unchanged.
            } else if (roll < E.ERRATIC_CONTINUE_CHANCE + E.ERRATIC_TURN_CHANCE) {
                this.erraticAngle += (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
            } else {
                this.erraticStopTicksLeft = E.ERRATIC_STOP_TICKS;
            }
        }

        if (this.erraticStopTicksLeft > 0) {
            this.setVelocity(0, 0);
            return;
        }
        this.setVelocityX(Math.cos(this.erraticAngle) * this.speed);
        this.setVelocityY(Math.sin(this.erraticAngle) * this.speed);
    }

    /**
     * Adjust current health directly. Clamped to [0, maxHealth].
     */
    public setHealth(value: number): void {
        this.health = Math.max(0, Math.min(value, this.maxHealth));
    }

    /**
     * Adjust maximum health. If current health exceeds new max, it will be clamped down.
     */
    public setMaxHealth(value: number): void {
        this.maxHealth = Math.max(0, value);
        if (this.health > this.maxHealth) {
            this.health = this.maxHealth;
        }
    }

    /**
     * Try to add a glow effect using Phaser's preFX if available.
     * Returns true if the effect was applied.
     */
    public tryAddGlow(color: number, distance: number, _quality: number, knockout: boolean, alpha: number, strength: number): boolean {
        // preFX is only present under the WebGL renderer. Call addGlow on the
        // component itself so `this` stays bound (Phaser's addGlow does `this.add(...)`).
        if (this.preFX && typeof this.preFX.addGlow === 'function') {
            this.preFX.addGlow(color, distance, 0, knockout, alpha, strength);
            return true;
        }
        return false;
    }

    public takeDamage(amount: number): void {
        const before = this.health;
        this.health = Math.max(0, this.health - amount);
        const dealt = before - this.health;
        if (dealt > 0) this.scene.events.emit('damageDealt', dealt);

        // Apply damage flash effect
        if (this.preFX) {
            const fx = this.preFX.addColorMatrix();
            fx.set(this.damageFlashMatrix);
            
            // Reset the effect after a short delay
            this.scene.time.delayedCall(100, () => {
                // Only reset if the enemy still exists
                if (this.active && this.preFX) {
                    fx.reset();
                }
            });
        }
        
        // Hit number (juice) - occasional to reduce clutter
        if (this.scene && Math.random() < 0.3) {
            const txt = this.scene.add.text(this.x, this.y - 20, `-${Math.round(amount)}`, {
                fontSize: '14px', color: '#ff4444', stroke: '#000000', strokeThickness: 2
            }).setDepth(1000);
            this.scene.tweens.add({ targets: txt, y: this.y - 40, alpha: 0, duration: 500, onComplete: () => txt.destroy() });
        }
        
        if (this.health <= 0) {
            this.die();
        }
    }

    public getHealth(): number {
        return this.health;
    }

    public getMaxHealth(): number {
        return this.maxHealth;
    }

    public heal(amount: number): void {
        this.health = Math.min(this.maxHealth, this.health + amount);
    }

    protected die(): void {
        // Create death effect before destroying the enemy
        new DeathEffect(this.scene, this.x, this.y, this.texture.key, this.enemyType);
        
        // Clear any existing effects before destroying
        if (this.preFX) {
            this.preFX.clear();
        }
        
        // Check for pickup drop using constant from GameConstants
        if (Math.random() < GameConstants.ENEMIES.PICKUP_DROP_RATE) {
            this.dropPickup();
        }
        
        // Emit event for experience gain (XP / killstreak / level-up logic; unchanged)
        this.scene.events.emit('enemyKilled', this.experienceValue);
        // Richer, classified death signal for the Mission System. Kept separate so
        // the existing enemyKilled event (and its consumers) stay untouched. Uses a
        // virtual getKillClass() so elites/bosses classify correctly despite being
        // constructed with a base EnemyType.
        const cls = this.getKillClass();
        this.scene.events.emit('enemyKilledClassified', {
            type: cls.type,
            isElite: cls.isElite,
            isBoss: cls.isBoss,
            xp: this.experienceValue,
            x: this.x,
            y: this.y,
        });
        this.destroy();
    }

    /**
     * Classification used by the Mission System. Base enemies report their own
     * type and are neither elite nor boss; EliteEnemy / BossEnemy override this.
     * Public so the mission board-clear scan can classify live enemies.
     */
    public getKillClass(): KillClass {
        return { type: this.enemyType, isElite: false, isBoss: false };
    }
    
    private dropPickup(): void {
        // Weighted random selection. AIRSTRIKE is very powerful, so it is rare.
        const weightedPickups: Array<{ type: PickupType; weight: number }> = [
            { type: PickupType.HEALTH, weight: 20 },
            { type: PickupType.SPEED, weight: 20 },
            { type: PickupType.DAMAGE, weight: 20 },
            { type: PickupType.EXPERIENCE, weight: 20 },
            { type: PickupType.BOMB, weight: 18 },
            { type: PickupType.FIRE_RING, weight: 12 },
            { type: PickupType.AIRSTRIKE, weight: 2 } // Rare, powerful pickup
        ];

        // The FLARE is a fog-busting consumable — useless on a fully-lit run, so
        // only offer it when fog is active on this mission (gate via the Game scene).
        if (this.scene.scene.key === SceneKey.Game && this.scene instanceof Game && this.scene.isFogActive()) {
            weightedPickups.push({ type: PickupType.FLARE, weight: GameConfig.FLARE.DROP_WEIGHT });
        }

        const totalWeight = weightedPickups.reduce((sum, p) => sum + p.weight, 0);
        let roll = Math.random() * totalWeight;
        let randomType = weightedPickups[0].type;
        for (const entry of weightedPickups) {
            roll -= entry.weight;
            if (roll < 0) {
                randomType = entry.type;
                break;
            }
        }
        
        // Create the pickup at the enemy's position
        const pickup = new Pickup(this.scene, this.x, this.y, randomType);
        
        // Add to the scene
        this.scene.add.existing(pickup);
        
        // Add to the pickups physics group if the scene is a Game scene
        if (this.scene.scene.key === SceneKey.Game && this.scene instanceof Game) {
            const pickupsGroup = this.scene.getPickupsGroup();
            if (pickupsGroup) {
                pickupsGroup.add(pickup);
            }
        }
        
        // Emit event for pickup creation
        this.scene.events.emit('pickupCreated', pickup);
    }

    public getDamage(): number {
        return this.damage;
    }

    /** Scale contact damage (Expedition FEROCITY risk modifier, §8). */
    public scaleDamage(mult: number): void {
        this.damage = Math.max(1, Math.round(this.damage * mult));
    }

    public applyKnockback(force: number, angle: number): void {
        // Cancel any existing stun timer
        if (this.stunTimer) {
            this.stunTimer.destroy();
            this.stunTimer = null;
        }
        
        // Apply knockback force
        const knockbackX = Math.cos(angle) * force;
        const knockbackY = Math.sin(angle) * force;
        
        if (this.body) {
            (this.body as Phaser.Physics.Arcade.Body).setVelocity(knockbackX, knockbackY);
        }
        
        // Set stunned state
        this.isStunned = true;
        
        // Visual indicator for stun (optional)
        if (this.preFX) {
            const originalTint = this.tint;
            this.setTint(0x888888); // Gray tint to indicate stun
            
            // Create stun timer
            this.stunTimer = this.scene.time.delayedCall(500, () => {
                this.isStunned = false;
                this.setTint(originalTint);
            });
        } else {
            // If no preFX, just create the timer
            this.stunTimer = this.scene.time.delayedCall(500, () => {
                this.isStunned = false;
            });
        }
    }

    public destroy(fromScene?: boolean): void {
        // Clean up stun timer if it exists
        if (this.stunTimer) {
            this.stunTimer.destroy();
            this.stunTimer = null;
        }

        // Clean up the slow / rally refresh timers (scene-owned delayedCalls).
        if (this.slowTimer) {
            this.slowTimer.remove(false);
            this.slowTimer = null;
        }
        if (this.rallyTimer) {
            this.rallyTimer.remove(false);
            this.rallyTimer = null;
        }

        // Tear down the double-speed fallback halo (scene-owned, not a child).
        if (this.doubleSpeedGlowEvent) {
            this.doubleSpeedGlowEvent.destroy();
            this.doubleSpeedGlowEvent = undefined;
        }
        if (this.doubleSpeedGlow) {
            // On a full scene shutdown (fromScene), Phaser's DisplayList tears
            // this scene-owned sprite down on its own pass — destroying it here
            // would double-remove it mid-iteration and crash that loop.
            if (!fromScene) this.doubleSpeedGlow.destroy();
            this.doubleSpeedGlow = null;
        }

        // Tear down the erratic fallback halo (same fromScene guard as above).
        if (this.erraticGlowEvent) {
            this.erraticGlowEvent.destroy();
            this.erraticGlowEvent = undefined;
        }
        if (this.erraticGlow) {
            if (!fromScene) this.erraticGlow.destroy();
            this.erraticGlow = null;
        }

        super.destroy(fromScene);
    }
} 
