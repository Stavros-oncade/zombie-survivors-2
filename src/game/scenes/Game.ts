import { Scene } from "phaser";
import { Player } from "../entities/Player";
import { Enemy } from "../entities/Enemy";
import { Pickup } from "../entities/Pickup";
import { EnemySpawnSystem } from "../systems/EnemySpawnSystem";
import { WeaponSystem } from "../systems/WeaponSystem";
import { ExperienceSystem } from "../systems/ExperienceSystem";
import { GameUI } from "../ui/GameUI";
import { PauseMenu } from "./PauseMenu";
import { UIEffects } from "../effects/UIEffects";
import { UpgradeSystem } from "../systems/UpgradeSystem";
import { Upgrade, PickupType, CharacterId, GasCloudTag } from "../types/GameTypes";
import { PickupAssetGenerator } from "../utils/GeneratePickupAssets";
import { GameConstants } from "../config/GameConstants";
import { ExplosionConfig } from "../config/ExplosionConfig";
import { GameConfig } from "../config/GameConfig";
import { BoostTimerUI } from "../ui/BoostTimerUI";
import { EliteEnemy } from "../entities/EliteEnemy";
import { RangedEnemy } from "../entities/RangedEnemy";
import { RelicSystem } from "../systems/RelicSystem";
import { LoadoutManager } from "../systems/LoadoutManager";
import { BlueprintSystem } from "../systems/BlueprintSystem";
import { SkillSystem } from "../systems/SkillSystem";
import { KillstreakSystem } from "../systems/KillstreakSystem";
import { SpawningConfig } from "../systems/SpawningConfig";
import { BlueprintDrop } from "../entities/BlueprintDrop";
import { SceneKey } from "../config/SceneKeys";
import { BossEnemy } from "../entities/BossEnemy";

export class Game extends Scene {
    private player!: Player;
    private enemies!: Phaser.Physics.Arcade.Group;
    private pickups!: Phaser.Physics.Arcade.Group;
    private enemySpawnSystem!: EnemySpawnSystem;
    private weaponSystem!: WeaponSystem;
    private experienceSystem!: ExperienceSystem;
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private wasdKeys!: { [key: string]: Phaser.Input.Keyboard.Key };
    private gameUI!: GameUI;
    private uiEffects!: UIEffects;
    private boostTimerUI!: BoostTimerUI;
    private playTime: number = 0; // Track play time in seconds
    private pauseButton!: Phaser.GameObjects.Text;
    private escapeKey!: Phaser.Input.Keyboard.Key;
    private speedBoostTimer: Phaser.Time.TimerEvent | null = null;
    private damageBoostTimer: Phaser.Time.TimerEvent | null = null;
    private originalSpeed: number | null = null; // Track original speed
    private isEliteIntro: boolean = false;
    private collectedPickups: Set<Pickup> = new Set(); // Track pickups that have been collected
    private initialTouchPoint: Phaser.Math.Vector2 | null = null;
    private currentTouchPoint: Phaser.Math.Vector2 | null = null;
    private touchIndicator: Phaser.GameObjects.Sprite | null = null;
    private centerDot: Phaser.GameObjects.Graphics | null = null;
    private relicSystem!: RelicSystem;
    private skillSystem!: SkillSystem;
    private killstreakSystem!: KillstreakSystem;
    private skillButtonCircle: Phaser.GameObjects.Graphics | null = null;
    private skillButtonIcon: Phaser.GameObjects.Text | null = null;
    private isLevelUpPending: boolean = false;
    private eliteXPDelayUntil: number = 0;
    // Toxic gas clouds registry for typed access by skills
    private __gasClouds?: Set<Phaser.GameObjects.Graphics & GasCloudTag>;

    constructor() {
        super({ key: SceneKey.Game });
    }

    create() {
        // Set the physics world bounds to be larger than the viewport
        const worldWidth = GameConfig.WORLD.WIDTH;
        const worldHeight = GameConfig.WORLD.HEIGHT;
        this.physics.world.setBounds(0, 0, worldWidth, worldHeight);

        // Create and stretch background to fill the world bounds
        const background = this.add.image(0, 0, "background");
        background.setOrigin(0, 0);
        background.setDisplaySize(worldWidth, worldHeight);
        background.setDepth(GameConfig.BACKGROUND.DEPTH);

        // --- Player and Experience System Initialization ---
        // 1. Create Player (without full initialization yet)
        this.player = new Player(this, worldWidth / 2, worldHeight / 2);
        this.add.existing(this.player);

        // 2. Create ExperienceSystem, passing the player's level-up callback
        this.experienceSystem = new ExperienceSystem(
            this.player,
            this.player.applyLevelUpEffects.bind(this.player),
            this
        );

        // 3. Initialize Player with the ExperienceSystem
        this.player.initialize(this.experienceSystem);

        // 4. Enable Player physics after initialization
        this.player.enablePhysics();
        // --- End Initialization ---

        // Set up camera to follow player
        // this.cameras.main.setZoom(0.5); // Keep zoom disabled
        this.cameras.main.startFollow(this.player);
        this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);

        // Create enemy group
        this.enemies = this.physics.add.group();
        this.enemies.setName("enemies");

        // Create pickups group
        this.pickups = this.physics.add.group({
            classType: Pickup,
            runChildUpdate: true,
        });

        // Initialize other systems (pass ExperienceSystem if needed, though not currently used by them)
        this.enemySpawnSystem = new EnemySpawnSystem(this, this.enemies);
        this.weaponSystem = new WeaponSystem(this, this.player, this.enemies);
        // ExperienceSystem is already initialized

        // Initialize UI Effects
        this.uiEffects = new UIEffects(this);
        this.uiEffects.create();

        // Initialize Boost Timer UI
        this.boostTimerUI = new BoostTimerUI(this);

        // After UI is ready, apply requested start wave (ensures banner shows)
        {
            const sc = SpawningConfig.getInstance();
            if (sc.startState) {
                this.enemySpawnSystem.forceState(sc.startState);
                sc.startState = undefined;
            }
        }

        // Initialize relic system (per-run)
        this.relicSystem = new RelicSystem(this);

        // Apply character loadout
        const lm = LoadoutManager.getInstance();
        const character = lm.getCharacter();
        if (character === CharacterId.SOLDIER) {
            this.player.setMaxHealth(Math.floor(this.player.getStats().maxHealth * 1.2));
            this.player.heal(0);
        } else if (character === CharacterId.SCOUT) {
            this.player.applyAsymptoticSpeedIncrease(1.10);
        } else if (character === CharacterId.DEMOLITIONIST) {
            this.weaponSystem.unlockExplosive();
        }

        // Apply permanent blueprints
        BlueprintSystem.applyToGame(this);

        // Initialize skills and killstreak
        const lmSkill = LoadoutManager.getInstance();
        this.skillSystem = new SkillSystem(this, lmSkill.getDefensiveSkill());
        this.killstreakSystem = new KillstreakSystem(this, lmSkill.getKillstreakPerk());

        // Apply spawning tuner options at start — schedule after a short delay
        const sc = SpawningConfig.getInstance();
        if (sc.spawnEliteOnStart) {
            this.time.delayedCall(2500, () => {
                this.enemySpawnSystem.triggerElite();
                sc.spawnEliteOnStart = false; // one-shot
            });
        }
        if (sc.spawnBossOnStart) {
            this.time.delayedCall(3500, () => {
                this.enemySpawnSystem.triggerBoss();
                sc.spawnBossOnStart = false; // one-shot
            });
        }

        // Setup input
        if (this.input.keyboard) {
            this.cursors = this.input.keyboard.createCursorKeys();
            this.wasdKeys = this.input.keyboard.addKeys({
                up: Phaser.Input.Keyboard.KeyCodes.W,
                down: Phaser.Input.Keyboard.KeyCodes.S,
                left: Phaser.Input.Keyboard.KeyCodes.A,
                right: Phaser.Input.Keyboard.KeyCodes.D,
                dash: Phaser.Input.Keyboard.KeyCodes.SHIFT,
            }) as { [key: string]: Phaser.Input.Keyboard.Key };

            // Add escape key
            this.escapeKey = this.input.keyboard.addKey(
                Phaser.Input.Keyboard.KeyCodes.ESC
            );
        }

        // Setup touch input
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            this.initialTouchPoint = new Phaser.Math.Vector2(pointer.x, pointer.y);
            this.currentTouchPoint = new Phaser.Math.Vector2(pointer.x, pointer.y);
            
            // Create touch indicator if it doesn't exist
            if (!this.touchIndicator) {
                // Create a circle texture for the indicator
                const graphics = this.add.graphics();
                graphics.fillStyle(0x4a4a4a, 1);
                graphics.fillCircle(32, 32, 32);
                graphics.lineStyle(3, 0x272727, 1);
                graphics.strokeCircle(32, 32, 32);
                
                graphics.generateTexture('touchIndicator', 64, 64);
                graphics.destroy();

                // Create the sprite
                this.touchIndicator = this.add.sprite(0, 0, 'touchIndicator');
                this.touchIndicator.setDepth(9999);
                this.touchIndicator.setScrollFactor(0);

                // Create the center dot
                this.centerDot = this.add.graphics();
                this.centerDot.setDepth(10000); // Above the indicator
                this.centerDot.setScrollFactor(0);
            }
            
            // Update the touch indicator position
            this.updateTouchIndicator();
        });

        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (pointer.isDown) {
                this.currentTouchPoint = new Phaser.Math.Vector2(pointer.x, pointer.y);
                this.updateCenterDot();
            }
        });

        this.input.on('pointerup', () => {
            this.initialTouchPoint = null;
            this.currentTouchPoint = null;
            
            // Hide the touch indicator and center dot
            if (this.touchIndicator) {
                this.touchIndicator.setVisible(false);
            }
            if (this.centerDot) {
                this.centerDot.clear();
            }
        });

        // Create pause button in the top-right corner
        this.pauseButton = this.add
            .text(this.cameras.main.width - 20, 20, "⏸", {
                fontFamily: "Arial",
                fontSize: "32px",
                color: "#ffffff",
                stroke: "#000000",
                strokeThickness: 4,
            })
            .setOrigin(1, 0)
            .setDepth(1000)
            .setScrollFactor(0)
            .setInteractive({ useHandCursor: true })
            .on("pointerover", () =>
                this.pauseButton.setStyle({ color: "#ffff00" })
            )
            .on("pointerout", () =>
                this.pauseButton.setStyle({ color: "#ffffff" })
            )
            .on("pointerdown", () => this.togglePause());

        // Setup collisions
        this.physics.add.collider(
            this.player,
            this.enemies,
            (player, enemy) => {
                this.handlePlayerEnemyCollision(
                    player as Player,
                    enemy as Enemy
                );
            },
            undefined,
            this
        );

        // Setup experience gain - Listener now updates ExperienceSystem and Player's total XP gained
        this.events.on("enemyKilled", (xp: number) => {
            const xpMult = this.relicSystem ? this.relicSystem.getXPMultiplier() : 1;
            const gain = Math.round(xp * xpMult);
            const now = this.time.now;
            if (now < this.eliteXPDelayUntil) {
                const delay = this.eliteXPDelayUntil - now;
                this.time.delayedCall(delay, () => this.experienceSystem.gainExperience(gain));
            } else {
                this.experienceSystem.gainExperience(gain);
            }
            this.player.addXPGained(xp); // Track total XP for game over
            this.player.incrementEnemiesKilled(); // Track killed enemies
        });

        // Listen for level up events to show the selection screen
        this.events.on("player_level_up", this.handleLevelUp.bind(this));

        // Listen for level up selection complete events
        this.events.on(
            "level_up_selection_complete",
            this.handleLevelUpSelectionComplete.bind(this)
        );

        // Create UI
        this.gameUI = new GameUI(this);

        // Launch the PauseMenu scene
        this.scene.launch(SceneKey.PauseMenu);

        // Set up collisions between player and pickups
        this.physics.add.overlap(
            this.player,
            this.pickups,
            (player, pickup) =>
                this.handlePlayerPickupCollision(
                    player as Player,
                    pickup as Pickup
                ),
            undefined,
            this
        );

        // Generate pickup assets
        const pickupAssetGenerator = new PickupAssetGenerator(this);
        pickupAssetGenerator.generatePickupAssets();

        // Listen for pickup creation events
        this.events.on("pickupCreated", (pickup: Pickup) => {
            // Add the pickup to the physics group
            this.pickups.add(pickup);
        });

        // Initialize relic system (per-run)
        this.relicSystem = new RelicSystem(this);

        // Elite spawn intro and juice: pause physics, pan to elite, then resume on player input (enabled after 3s)
        this.events.on('elite_spawned', (elite: EliteEnemy) => {
            if (!this.scene.isActive()) { return; }
            this.isEliteIntro = true;
            this.physics.world.pause();

            const cam = this.cameras.main;
            const prevZoom = cam.zoom;
            cam.stopFollow();
            cam.pan(elite.x, elite.y, 300, 'Sine.easeInOut');
            cam.zoomTo(1.5, 300);

            const eliteNm = elite.getNameText()?.text || 'ELITE';
            const prompt = this.add.text(this.cameras.main.width / 2, this.cameras.main.height * 0.18,
                `${eliteNm} — TAP TO CONTINUE`, {
                    fontFamily: 'Arial Black', fontSize: '20px', color: '#ffff99', stroke: '#000000', strokeThickness: 6
                }).setOrigin(0.5).setScrollFactor(0).setDepth(2002);

            let resumed = false;
            let allowInput = false;
            const tryResume = () => {
                if (!allowInput || resumed) return;
                resumed = true;
                prompt.destroy();
                cam.pan(this.player.x, this.player.y, 320, 'Sine.easeInOut');
                cam.zoomTo(prevZoom, 320);
                this.time.delayedCall(330, () => {
                    cam.startFollow(this.player);
                    this.physics.world.resume();
                    this.isEliteIntro = false;
                });
                this.input.off('pointerdown', tryResume);
                this.input.keyboard?.off('keydown', tryResume);
            };

            // Register input immediately but gate it until allowed
            this.input.on('pointerdown', tryResume);
            this.input.keyboard?.on('keydown', tryResume);

            // Enable input after 3 seconds
            this.time.delayedCall(3000, () => { allowInput = true; });

            // Safety auto-resume after 6 seconds
            this.time.delayedCall(6000, tryResume);
        });

        // Boss spawn intro: pause physics, pan to boss, show label, resume on input
        this.events.on('boss_spawned', (boss: BossEnemy) => {
            if (!this.scene.isActive()) { return; }
            this.isEliteIntro = true; // reuse intro flag to pause updates
            this.physics.world.pause();

            const cam = this.cameras.main;
            const prevZoom = cam.zoom;
            cam.stopFollow();
            cam.pan(boss.x, boss.y, 400, 'Sine.easeInOut');
            cam.zoomTo(1.6, 400);

            // World-space label centered on the boss, much larger
            // Large boss name during intro (UI overlay)
            const bossNm = boss.getNameText()?.text || 'BOSS';
            const bossLabel = this.add.text(this.cameras.main.width / 2, this.cameras.main.height * 0.2, bossNm, {
                fontFamily: 'Arial Black', fontSize: '96px', color: '#ff4444', stroke: '#000000', strokeThickness: 12
            }).setOrigin(0.5).setScrollFactor(0).setDepth(2002);

            let resumed = false;
            let allowInput = false;
            const tryResume = () => {
                if (!allowInput || resumed) return;
                resumed = true;
                // Fade label quickly
                this.tweens.add({ targets: bossLabel, alpha: 0, duration: 200, onComplete: () => bossLabel.destroy() });
                // Pan back to player and restore
                cam.pan(this.player.x, this.player.y, 350, 'Sine.easeInOut');
                cam.zoomTo(prevZoom, 350);
                this.time.delayedCall(360, () => {
                    cam.startFollow(this.player);
                    this.physics.world.resume();
                    this.isEliteIntro = false;
                });
                this.input.off('pointerdown', tryResume);
                this.input.keyboard?.off('keydown', tryResume);
            };

            // Register listeners; gate input for 3s to avoid instant skip
            this.input.on('pointerdown', tryResume);
            this.input.keyboard?.on('keydown', tryResume);
            this.time.delayedCall(3000, () => { allowInput = true; });
            // Safety auto-resume
            this.time.delayedCall(7000, tryResume);
        });

        this.events.on('elite_died', (pos?: {x:number,y:number}) => {
            // Scene may be shutting down; guard camera access
            if (this.cameras && this.cameras.main) {
                this.cameras.main.shake(200, 0.01);
            }
            // Delay XP gain for a short period so level-up UI doesn't interrupt the intro/outro
            this.eliteXPDelayUntil = this.time.now + 2000;
            // 50% chance to drop a blueprint point
            if (pos && Math.random() < 0.5) {
                this.spawnBlueprintDrops(pos.x, pos.y, 1);
            }
            // Elite chest reward: pause and offer relics
            this.scene.pause();
            const upgrades = UpgradeSystem.getRandomRelicUpgradesFiltered(3, this.relicSystem.getAcquiredIds());
            if (this.scene.isActive(SceneKey.LevelUpSelection)) {
                this.scene.stop(SceneKey.LevelUpSelection);
            }
            this.scene.launch(SceneKey.LevelUpSelection, { player: this.player, upgrades });
        });

        // Boss drop: 1-2 blueprint points
        this.events.on('boss_died', (pos?: {x:number,y:number}) => {
            if (pos) {
                const count = Phaser.Math.Between(1, 2);
                this.spawnBlueprintDrops(pos.x, pos.y, count);
            }
        });

        // Mobile skill button (bottom-right)
        if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            const cam = this.cameras.main;
            const cx = cam.width - 70;
            const cy = cam.height - 70;
            const g = this.add.graphics();
            g.setScrollFactor(0).setDepth(2000);
            g.fillStyle(0x333333, 0.6);
            g.fillCircle(cx, cy, 42);
            g.lineStyle(3, 0xffffff, 0.9);
            g.strokeCircle(cx, cy, 42);
            g.setInteractive(new Phaser.Geom.Circle(cx, cy, 42), Phaser.Geom.Circle.Contains);
            g.on('pointerdown', () => this.skillSystem?.tryActivate());
            const t = this.add.text(cx, cy, 'Skill', { fontSize: '14px', color: '#ffeb99', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
            this.skillButtonCircle = g;
            this.skillButtonIcon = t;
        }
    }

    update() {
        if (!this.cursors || !this.wasdKeys) return;

        // Check for escape key press
        if (this.escapeKey && Phaser.Input.Keyboard.JustDown(this.escapeKey)) {
            this.togglePause();
        }

        // Skip the rest of the update if the game is paused or during elite intro
        if (this.scene.isPaused()) return;
        if (this.isEliteIntro) return;

        // Update play time (in seconds)
        this.playTime += this.game.loop.delta / 1000;

        // Update player movement with both keyboard and touch input
        this.player.update(this.cursors, this.wasdKeys, this.initialTouchPoint, this.currentTouchPoint);

        // Update weapons (automatic firing)
        this.weaponSystem.update();

        // Defensive skill activation (Shift)
        if (this.wasdKeys && Phaser.Input.Keyboard.JustDown(this.wasdKeys['dash'])) {
            this.skillSystem?.tryActivate();
        }

        // enemies spawn on a timer they set internally

        // Update enemies
        const enemyChildren = this.enemies.getChildren() as Enemy[];
        enemyChildren.forEach((enemy) => {
            if (!enemy.active) return;
            if (enemy instanceof EliteEnemy) {
                enemy.update(this.player);
            } else if (enemy instanceof RangedEnemy) {
                enemy.updateBehavior(this.player);
            } else {
                (enemy as Enemy).moveTowardsPlayer(this.player);
            }
        });

        // Update UI
        this.gameUI.update(this.player.getStats());
        // Skill cooldown HUD + mobile button feedback
        if (this.skillSystem) {
            const total = this.skillSystem.getCooldownTotalMs();
            const remaining = this.skillSystem.getCooldownRemainingMs(this.time.now);
            this.gameUI.updateSkillCooldown(remaining, total);
            if (this.skillButtonCircle && this.skillButtonIcon) {
                const onCd = remaining > 0;
                this.skillButtonCircle.setAlpha(onCd ? 0.4 : 1);
                this.skillButtonIcon.setAlpha(onCd ? 0.6 : 1);
            }
        }

        // Killstreak HUD
        if (this.killstreakSystem) {
            const mult = this.killstreakSystem.getMultiplier();
            const perk = this.killstreakSystem.getPerk();
            this.gameUI.updateKillstreak(mult, perk);
        }
    }

    private handlePlayerEnemyCollision(player: Player, enemy: Enemy) {
        // Check if enemy is still active before dealing damage
        if (enemy.active) {
            player.takeDamage(enemy.getDamage(), enemy);
        }
    }

    private togglePause() {
        const pauseMenu = this.scene.get(SceneKey.PauseMenu) as PauseMenu;
        if (pauseMenu) {
            pauseMenu.toggle();
            if (pauseMenu.isVisible) {
                this.scene.pause();
                this.pauseButton.setText("▶");
            } else {
                this.scene.resume();
                this.pauseButton.setText("⏸");
            }
        }
    }

    // Method to get play time in seconds
    public getPlayTime(): number {
        return this.playTime;
    }

    // Method to get the GameUI instance
    public getGameUI(): GameUI {
        return this.gameUI;
    }

    public getWeaponSystem(): WeaponSystem {
        return this.weaponSystem;
    }

    public getCursors(): Phaser.Types.Input.Keyboard.CursorKeys {
        return this.cursors;
    }

    public getWasdKeys(): { [key: string]: Phaser.Input.Keyboard.Key } {
        return this.wasdKeys;
    }

    // Expose enemies group to spawners/carrier on-death
    public getEnemiesGroup(): Phaser.Physics.Arcade.Group {
        return this.enemies;
    }

    // Expose player for typed access from entities
    public getPlayer(): Player {
        return this.player;
    }

    // Expose relic system for upgrade/relic effects
    public getRelicSystem(): RelicSystem {
        return this.relicSystem;
    }

    // Registry accessors for toxic gas clouds
    public registerGasCloud(g: Phaser.GameObjects.Graphics & GasCloudTag): void {
        if (!this.__gasClouds) this.__gasClouds = new Set();
        this.__gasClouds.add(g);
    }

    public unregisterGasCloud(g: Phaser.GameObjects.Graphics & GasCloudTag): void {
        this.__gasClouds?.delete(g);
    }

    public getGasClouds(): ReadonlySet<(Phaser.GameObjects.Graphics & GasCloudTag)> | undefined {
        return this.__gasClouds;
    }

    // Internal hook for relics to adjust XP multiplier
    public getRelicSystemInternal(): RelicSystem {
        return this.relicSystem;
    }

    // Helper for relics to apply asymptotic speed increase on player
    public playerApplyAsymptoticSpeed(multiplier: number): void {
        this.player.applyAsymptoticSpeedIncrease(multiplier);
    }

    // Helper for relics/blueprints to adjust max HP
    public playerAdjustMaxHealth(multiplier: number): void {
        this.player.setMaxHealth(Math.floor(this.player.getStats().maxHealth * multiplier));
        this.player.heal(0);
    }

    private spawnBlueprintDrops(x: number, y: number, count: number): void {
        for (let i = 0; i < count; i++) {
            const ox = Phaser.Math.Between(-24, 24);
            const oy = Phaser.Math.Between(-24, 24);
            const drop = new BlueprintDrop(this, x + ox, y + oy, 1);
            // Overlap with player to collect
            this.physics.add.overlap(this.player, drop, () => {
                drop.collect();
            });
            // If spawned on top of player, collect immediately
            const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, drop.x, drop.y);
            if (d < 48) {
                drop.collect();
            }
        }
    }

    private handleLevelUp(data: {
        level: number;
        previousLevel: number;
    }): void {
        // Avoid stacking multiple pending level-ups
        if (this.isLevelUpPending) {
            return;
        }
        this.isLevelUpPending = true;
        console.log(`Level up from ${data.previousLevel} to ${data.level}`);

        // Allow the built-in level up effect (UIEffects listener) to play for 1s, then pause and show menu
        this.time.delayedCall(1000, () => {
            // Pause the game
            this.scene.pause();

            // Stop the LevelUpSelection scene if it's already running
            if (this.scene.isActive(SceneKey.LevelUpSelection)) {
                this.scene.stop(SceneKey.LevelUpSelection);
            }

            // 15% chance to offer relics instead of upgrades
            const upgrades = Math.random() < 0.15
                ? UpgradeSystem.getRandomRelicUpgrades(3)
                : UpgradeSystem.getRandomUpgrades(3);

            // Launch the level up selection scene
            this.scene.launch(SceneKey.LevelUpSelection, {
                player: this.player,
                upgrades: upgrades,
            });
        });
    }

    private handleLevelUpSelectionComplete(
        selectedUpgrade: Upgrade | null
    ): void {
        console.log("Level up selection complete:", selectedUpgrade);
        // The game scene is already resumed by the LevelUpSelection scene
        // We can add additional logic here if needed
        this.scene.resume();
        // Allow future level-ups to schedule their menu
        this.isLevelUpPending = false;
    }

    private handlePlayerPickupCollision(player: Player, pickup: Pickup): void {
        // Skip if this pickup has already been collected
        if (this.collectedPickups.has(pickup)) {
            return;
        }
        
        // Mark this pickup as collected
        this.collectedPickups.add(pickup);
        
        // Defer the pickup collection to the next frame to avoid physics callback issues
        this.time.delayedCall(0, () => {
            // Apply pickup effect based on type
            switch (pickup.getType()) {
                case PickupType.HEALTH:
                    player.heal(pickup.getValue());
                    this.showFloatingText(
                        "+" + pickup.getValue() + " HP",
                        player.x,
                        player.y - 20,
                        0xff0000
                    );
                    break;
                case PickupType.SPEED:
                    this.applySpeedBoost(pickup.getValue());
                    this.showFloatingText(
                        "Speed Boost!",
                        player.x,
                        player.y - 20,
                        0x00ff00
                    );
                    break;
                case PickupType.DAMAGE:
                    this.applyDamageBoost(pickup.getValue());
                    this.showFloatingText(
                        "Damage Boost!",
                        player.x,
                        player.y - 20,
                        0xff00ff
                    );
                    break;
                case PickupType.EXPERIENCE:
                    this.experienceSystem.gainExperience(pickup.getValue());
                    player.addXPGained(pickup.getValue());
                    this.showFloatingText(
                        "+" + pickup.getValue() + " XP",
                        player.x,
                        player.y - 20,
                        0xffff00
                    );
                    break;
                case PickupType.BOMB:
                    // Only create explosion if one isn't already active
                      this.createExplosionEffect(pickup.x, pickup.y);
                      this.showFloatingText(
                        "BOOM!",
                        pickup.x,
                        pickup.y - 20,
                        0xff0000
                    );
                    break;
            }

            // Play collection animation and destroy the pickup
            pickup.collect();
        });
    }

    private showFloatingText(
        text: string,
        x: number,
        y: number,
        color: number
    ): void {
        const floatingText = this.add.text(x, y, text, {
            fontSize: "16px",
            color: "#" + color.toString(16),
            stroke: "#000000",
            strokeThickness: 2,
        });

        this.tweens.add({
            targets: floatingText,
            y: y - 50,
            alpha: 0,
            duration: 1000,
            onComplete: () => {
                floatingText.destroy();
            },
        });
    }

    private applySpeedBoost(multiplier: number): void {
        // Store original speed if not already stored
        if (this.originalSpeed === null) {
            this.originalSpeed = this.player.getMovementSpeed();
        }

        // Cancel existing speed boost timer if it exists
        if (this.speedBoostTimer) {
            this.speedBoostTimer.destroy();
        }

        // Apply speed boost based on original speed, not current speed
        if (this.originalSpeed !== null) {
            this.player.setMovementSpeed(this.originalSpeed * multiplier);
        }

        // Show the boost timer UI
        this.boostTimerUI.showSpeedBoost(5000);

        // Create timer to revert speed boost after 5 seconds
        this.speedBoostTimer = this.time.delayedCall(5000, () => {
            if (this.originalSpeed !== null) {
                this.player.setMovementSpeed(this.originalSpeed);
            }
            this.originalSpeed = null; // Reset original speed tracking
            this.showFloatingText("Speed Boost Ended", this.player.x, this.player.y - 20, 0x00ff00);
        });
    }

    private applyDamageBoost(multiplier: number): void {
        // Cancel existing damage boost timer if it exists
        if (this.damageBoostTimer) {
            this.damageBoostTimer.destroy();
        }

        // Apply temporary damage multiplier overlay (non-compounding)
        this.weaponSystem.setTempDamageMultiplier(multiplier);

        // Show the boost timer UI
        this.boostTimerUI.showDamageBoost(5000);

        // Revert after 5 seconds
        this.damageBoostTimer = this.time.delayedCall(5000, () => {
            this.weaponSystem.setTempDamageMultiplier(1);
            this.showFloatingText(
                "Damage Boost Ended",
                this.player.x,
                this.player.y - 20,
                0xff00ff
            );
        });
    }

    // Method to get the pickups group
    public getPickupsGroup(): Phaser.Physics.Arcade.Group {
        return this.pickups;
    }

    // Add a new method to create the explosion effect
    private createExplosionEffect(x: number, y: number): void {
        // Get the player's current weapon damage
        const weaponSystem = this.weaponSystem;
        const weapons = weaponSystem.getWeapons();
        const currentWeapon = weapons[0];
        const baseDamage = currentWeapon ? currentWeapon.getDamage() : GameConstants.WEAPONS.BASIC_DAMAGE;
        
        // Calculate explosion damage
        const explosionDamage = baseDamage * ExplosionConfig.DAMAGE_MULTIPLIER;
        
        // Create explosion radius
        const explosionRadius = ExplosionConfig.RADIUS;
        
        // Create explosion visual effect
        const explosion = this.add.graphics();
        explosion.setDepth(ExplosionConfig.VISUAL.MAIN.DEPTH);
        explosion.setScrollFactor(1);
        explosion.fillStyle(ExplosionConfig.VISUAL.MAIN.OUTER_COLOR, ExplosionConfig.VISUAL.MAIN.OUTER_ALPHA);
        explosion.fillCircle(x, y, explosionRadius);
        
        // Add a white border
        explosion.lineStyle(
            ExplosionConfig.VISUAL.MAIN.BORDER_WIDTH,
            ExplosionConfig.VISUAL.MAIN.BORDER_COLOR,
            ExplosionConfig.VISUAL.MAIN.BORDER_ALPHA
        );
        explosion.strokeCircle(x, y, explosionRadius);
        
        // Add a smaller inner circle
        explosion.fillStyle(ExplosionConfig.VISUAL.MAIN.INNER_COLOR, ExplosionConfig.VISUAL.MAIN.INNER_ALPHA);
        explosion.fillCircle(x, y, explosionRadius * ExplosionConfig.VISUAL.MAIN.INNER_RADIUS_MULTIPLIER);
        
        // Add explosion particles
        for (let i = 0; i < ExplosionConfig.VISUAL.PARTICLES.COUNT; i++) {
            const angle = (i / ExplosionConfig.VISUAL.PARTICLES.COUNT) * Math.PI * 2;
            const distance = explosionRadius * (0.5 + Math.random() * 0.5);
            const particleX = x + Math.cos(angle) * distance;
            const particleY = y + Math.sin(angle) * distance;
            
            const particle = this.add.graphics();
            particle.setDepth(ExplosionConfig.VISUAL.PARTICLES.DEPTH);
            particle.setScrollFactor(1);
            particle.fillStyle(ExplosionConfig.VISUAL.PARTICLES.COLOR, ExplosionConfig.VISUAL.PARTICLES.ALPHA);
            particle.fillCircle(0, 0, ExplosionConfig.VISUAL.PARTICLES.SIZE);
            
            // Position the particle graphics at the calculated position
            particle.x = particleX;
            particle.y = particleY;
            
            // Animate particle
            this.tweens.add({
                targets: particle,
                alpha: 0,
                scale: ExplosionConfig.VISUAL.PARTICLES.ANIMATION.SCALE,
                duration: ExplosionConfig.VISUAL.PARTICLES.ANIMATION.DURATION,
                onComplete: () => {
                    particle.destroy();
                }
            });
        }
        
        // Animate the explosion
        this.tweens.add({
            targets: explosion,
            from: {
                alpha: 1,
                scale: 1
            },
            to: {
                alpha: 0,
                scale: ExplosionConfig.VISUAL.ANIMATION.SCALE
            },
            duration: ExplosionConfig.VISUAL.ANIMATION.DURATION,
            onComplete: () => {
                explosion.destroy();
            }
        });
        
        // Calculate knockback radius
        const knockbackRadius = explosionRadius * ExplosionConfig.KNOCKBACK_RADIUS_MULTIPLIER;
        
        // Damage and apply knockback to all enemies
        const enemies = this.enemies.getChildren() as Enemy[];
        enemies.forEach(enemy => {
            if (!enemy.active) return;
            
            const distance = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
            
            // Apply knockback to enemies within the extended radius
            if (distance <= knockbackRadius) {
                // Calculate knockback force (stronger for enemies closer to the explosion)
                const knockbackForce = ExplosionConfig.KNOCKBACK_FORCE * (1 - (distance / knockbackRadius));
                const angle = Phaser.Math.Angle.Between(x, y, enemy.x, enemy.y);
                
                // Use the new applyKnockback method
                enemy.applyKnockback(knockbackForce, angle);
                
                // Apply damage only to enemies within the original explosion radius
                if (distance <= explosionRadius) {
                    enemy.takeDamage(explosionDamage);
                }
            }
        });
    }

    // Add a method to clean up the collected pickups set when a pickup is destroyed
    public removeFromCollectedPickups(pickup: Pickup): void {
        this.collectedPickups.delete(pickup);
    }

    private updateTouchIndicator(): void {
        if (!this.touchIndicator || !this.initialTouchPoint) return;

        // Update position and make visible
        this.touchIndicator.setPosition(this.initialTouchPoint.x, this.initialTouchPoint.y);
        this.touchIndicator.setVisible(true);
        
        // Update center dot position
        this.updateCenterDot();
    }

    private updateCenterDot(): void {
        if (!this.centerDot || !this.initialTouchPoint || !this.currentTouchPoint) return;

        // Calculate the vector from initial to current touch
        const vector = new Phaser.Math.Vector2(
            this.currentTouchPoint.x - this.initialTouchPoint.x,
            this.currentTouchPoint.y - this.initialTouchPoint.y
        );

        // Normalize the vector and scale it to move the dot
        vector.normalize();
        vector.scale(20); // Move the dot 20 pixels in the direction of movement

        // Clear and redraw the center dot
        this.centerDot.clear();
        this.centerDot.fillStyle(0x272727, 1);
        this.centerDot.fillCircle(
            this.initialTouchPoint.x + vector.x,
            this.initialTouchPoint.y + vector.y,
            5
        );
    }

    destroy() {
        // Clean up UI Effects
        if (this.uiEffects) {
            this.uiEffects.destroy();
        }

        // Clean up Boost Timer UI
        if (this.boostTimerUI) {
            this.boostTimerUI.destroy();
        }

        // Stop all sounds
        this.sound.stopAll();

        // Clean up systems
        this.enemySpawnSystem.destroy();
        this.weaponSystem.destroy();
        this.gameUI.destroy();

        // Removed debug cleanup

        // Remove all event listeners
        this.events.removeAllListeners();
    }
}
