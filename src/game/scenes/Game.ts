import { Scene } from "phaser";
import { Player } from "../entities/Player";
import { Enemy } from "../entities/Enemy";
import { Pickup } from "../entities/Pickup";
import { EnemySpawnSystem } from "../systems/EnemySpawnSystem";
import { WeaponSystem } from "../systems/WeaponSystem";
import { WEAPON_CATALOG, WeaponUnlockTier, isWeaponUnlocked, getWeaponDef } from "../weapons/WeaponCatalog";
import { ExperienceSystem } from "../systems/ExperienceSystem";
import { GameUI } from "../ui/GameUI";
import { PauseMenu } from "./PauseMenu";
import { UIEffects } from "../effects/UIEffects";
import { UpgradeSystem } from "../systems/UpgradeSystem";
import { Upgrade, PickupType, CharacterId, GasCloudTag, UpgradeId } from "../types/GameTypes";
import { PickupAssetGenerator } from "../utils/GeneratePickupAssets";
import { GameConstants } from "../config/GameConstants";
import { ExplosionConfig } from "../config/ExplosionConfig";
import { GameConfig } from "../config/GameConfig";
import { BoostTimerUI } from "../ui/BoostTimerUI";
import { EliteEnemy } from "../entities/EliteEnemy";
import { RangedEnemy } from "../entities/RangedEnemy";
import { ShriekerEnemy } from "../entities/ShriekerEnemy";
import { RelicSystem } from "../systems/RelicSystem";
import { LoadoutManager } from "../systems/LoadoutManager";
import { BlueprintSystem } from "../systems/BlueprintSystem";
import { SkillSystem } from "../systems/SkillSystem";
import { KillstreakSystem } from "../systems/KillstreakSystem";
import { SpawningConfig } from "../systems/SpawningConfig";
import { BlueprintDrop } from "../entities/BlueprintDrop";
import { SceneKey } from "../config/SceneKeys";
import { fadeIn, FADE_NIGHT } from "../utils/transition";
import { BossEnemy } from "../entities/BossEnemy";
import { MissionSystem } from "../systems/MissionSystem";
import { ExtractionSystem } from "../systems/ExtractionSystem";
import { FogSystem } from "../systems/FogSystem";
import { LightSystem } from "../systems/LightSystem";
import { BurnSystem } from "../systems/BurnSystem";
import { DecalSystem } from "../systems/DecalSystem";
import { resolveMission } from "../config/Missions";
import { Mission, MissionConditionKind, WorldPoint } from "../types/MissionTypes";
import { JobBoardSystem } from "../systems/JobBoardSystem";
import { JobModifier, JobModifierKind } from "../types/JobBoardTypes";
import { ExpeditionManager } from "../systems/ExpeditionManager";
import { ExpeditionPlan, RunModifierSink, SupplyId, SurvivorOutcome, RiskModifierId } from "../types/ExpeditionTypes";
import { SUPPLIES, PERKS, RISK_MODIFIERS } from "../config/Expedition";
import { ReconSystem } from "../systems/ReconSystem";
import { ReconCarryState } from "../types/ReconTypes";

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
    // Relic-chest queue. Elite/boss deaths request a chest; we open them ONE AT A
    // TIME so two elites dying in the same frame (now common with simultaneous
    // elite spawns) don't stomp each other's LevelUpSelection and silently drop a
    // reward. chestOpen = a chest selection is currently displayed.
    private chestQueue: number = 0;
    private chestOpen: boolean = false;
    private missionSystem!: MissionSystem;
    // Optional extraction-end phase. Constructed lazily in beginExtraction() when a
    // mission with `extraction.enabled` completes its primary objective.
    private extractionSystem?: ExtractionSystem;
    // Optional Fog of War (docs/specs/fog-of-war.md). Constructed in create() ONLY
    // when the active mission opts in (Mission.fog) or a fog risk-modifier forces
    // it; otherwise undefined and the run is byte-for-byte unchanged.
    private fogSystem?: FogSystem;
    // Optional Light Sources (docs/specs/fog-of-war-light-sources.md). Constructed
    // in create() ONLY when the mission declares `lights` or fog is on; otherwise
    // undefined and the run is byte-for-byte unchanged. Owns the glow entities and
    // registers each as a FogSystem reveal contributor.
    private lightSystem?: LightSystem;
    // Fire / Burn status (GameConfig.BURN). Always constructed in create(); owns
    // the burning-zombie DoT, flame overlays, glows + fog contributors, contagion
    // and the trashcan-barrel ignition. Burning works with or without fog.
    private burnSystem?: BurnSystem;
    // Ground decals (GameConfig.DECAL). Always constructed in create(); owns the
    // charred blast scorches and toxic-death stains. Purely cosmetic — no fog,
    // physics or damage. Mirrors the BurnSystem lifecycle.
    private decalSystem?: DecalSystem;
    // Fog modifiers accumulated by the RunModifierSink before the mission/FogSystem
    // is resolved (SCANNER widens reveal, VEIL narrows it + forces fog on).
    private pendingRevealRadiusMult: number = 1;
    private forceFogEnabled: boolean = false;
    private activeMission!: Mission;
    // Mono-Weapon (Specialist) mode (docs/specs/mono-weapon-mission-mode.md). The
    // resolved locked-weapon id when the active mission opts in, else null. Non-null
    // arms the upgrade-pool filter (getCappedUpgradeIds), the HUD chip, and the banner
    // line. '' is a valid value: "basic-weapon-only" mono (all catalog weapons locked).
    private monoWeaponId: string | null = null;
    // Run modifiers carried in from the accepted Job Board offer (§6.3).
    private activeModifiers: JobModifier[] = [];
    // Single latch so a WIN and a death resolving in the same frame can't both
    // transition. Death takes precedence (Player.die has its own isDead guard).
    private runEnded: boolean = false;
    // Unique id per run, threaded into GameOver so CampSystem.advanceCycle is
    // idempotent (a single run advances the camp exactly once).
    private runId: string = '';
    // Toxic gas clouds registry for typed access by skills
    private __gasClouds?: Set<Phaser.GameObjects.Graphics & GasCloudTag>;

    // Frozen Expedition plan handed in via scene-start data (§7.2 / §8).
    private expeditionPlan!: ExpeditionPlan;
    // Long Recon (§5): the node currently being run, and the in-run base upgrades
    // chosen this node (tracked so they carry to the next node via carry-state).
    private activeReconNodeId: string = '';
    private reconChosenUpgradeIds: string[] = [];
    // In-run medkit (heal) charges granted by MEDKIT supplies (§8). Bound to Q.
    private medkitCharges: number = 0;
    private medkitKey?: Phaser.Input.Keyboard.Key;
    // True when entered via the Briefing scene (normal Loadout deploy). Suppresses
    // the duplicate in-level OBJECTIVE banner and swaps the fade-in for an impact
    // flash so the run "drops in". Other entries (dev/recon/restart) fade in plain.
    private briefed: boolean = false;

    constructor() {
        super({ key: SceneKey.Game });
    }

    init(data?: { expeditionPlan?: ExpeditionPlan; briefed?: boolean }) {
        this.briefed = !!data?.briefed;
        // Phaser reuses scene instances across scene.start()/restart(), so class-field
        // initializers only run once (on first construction). Per-run state that other
        // systems read (cumulative run time, the run-ended latch) MUST be reset here or
        // it leaks across runs — e.g. a stale playTime breaks the survival HUD/payload.
        this.playTime = 0;
        this.runEnded = false;
        this.chestQueue = 0;
        this.chestOpen = false;
        // Mono-Weapon mode: reset per-run so a reused scene instance can't leak a
        // previous Specialist lock into a normal mission (both seams are no-ops null).
        this.monoWeaponId = null;

        // Prefer the frozen plan passed by the Loadout scene; otherwise build one
        // from the persisted draft so dev entry (SpawnTuner) never crashes (§10.2).
        if (data?.expeditionPlan) {
            this.expeditionPlan = data.expeditionPlan;
        } else {
            try {
                this.expeditionPlan = ExpeditionManager.getInstance().buildPlan();
            } catch {
                this.expeditionPlan = ExpeditionManager.emptyPlan(
                    LoadoutManager.getInstance().getMissionId()
                );
            }
        }
    }

    create() {
        // Per-run cleanup. Phaser fires SHUTDOWN on the outgoing scene when it is
        // stopped/restarted; it does NOT call a method named destroy(). Without
        // this wiring, systems and event listeners leak and accumulate across runs.
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdownScene, this);

        // Defensive recovery: if a previous run's scene was ever stopped while paused,
        // Phaser's Arcade physics plugin may not have re-booted, leaving world === null.
        // The exit paths now always resume before stopping (see prepareSceneExit /
        // PauseMenu / Player.die), but re-create the world here so a stray path can
        // never hard-crash create(). ArcadePhysics.start() only builds world if missing.
        if (!this.physics.world) {
            (this.physics as unknown as { start: () => void }).start();
        }

        // Arrival transition. A deploy from the Briefing scene "drops in" with a
        // white impact flash (the Briefing already faded to night); every other
        // entry (dev SpawnTuner, recon node, restart) fades up from night instead.
        if (this.briefed) {
            this.cameras.main.flash(180, 255, 255, 255);
        } else {
            fadeIn(this, { color: FADE_NIGHT });
        }

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

        // Apply character loadout. In Long Recon, the character/skill/killstreak come
        // from the frozen expedition loadout (§6) so the build is stable mid-recon
        // even if the player edits the menu; otherwise from LoadoutManager.
        const recon = ReconSystem.getInstance();
        const reconActive = recon.isActive();
        const character = reconActive ? recon.getLoadout().characterId : LoadoutManager.getInstance().getCharacter();
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

        // Reset fog modifier accumulators each run (scene instances are reused).
        // These are written by the RunModifierSink during applyExpedition() /
        // applyRunModifiers() below and consumed when FogSystem is constructed.
        this.pendingRevealRadiusMult = 1;
        this.forceFogEnabled = false;

        // Apply the frozen Expedition plan: perks, risk modifiers, supplies, and
        // assigned-survivor perks (§8). Reuses the existing stat-mutation path via
        // makeRunModifierSink(); only enemy/vision/medkit hooks are new.
        this.applyExpedition();

        // Initialize skills and killstreak (frozen recon loadout when active, §6).
        const lmSkill = LoadoutManager.getInstance();
        const defensiveSkill = reconActive ? recon.getLoadout().defensiveSkillId : lmSkill.getDefensiveSkill();
        const killstreakPerk = reconActive ? recon.getLoadout().killstreakPerkId : lmSkill.getKillstreakPerk();
        this.skillSystem = new SkillSystem(this, defensiveSkill);
        this.killstreakSystem = new KillstreakSystem(this, killstreakPerk);

        // Initialize the per-run mission (win condition). In Long Recon the mission is
        // the tier-scaled node mission (§5.3/§8); otherwise prefer the accepted Job
        // Board offer's mission, falling back to the legacy LoadoutManager id (§6.2).
        if (reconActive) {
            this.activeMission = recon.getActiveNodeMission();
            this.activeReconNodeId = recon.getActiveNodeId();
            this.applyReconCarryState(recon);
            // Spawn-director tier scaling (§8.2).
            const scaling = recon.getSpawnScaling(recon.getActiveNodeTier());
            this.enemySpawnSystem.setEnemyDensityMult(scaling.densityMult);
            this.enemySpawnSystem.setEliteIntervalMult(scaling.eliteIntervalMult);
        } else {
            const acceptedOffer = JobBoardSystem.getAcceptedOffer();
            this.activeMission = acceptedOffer?.mission
                ?? resolveMission(LoadoutManager.getInstance().getMissionId());
            // Capture run modifiers + reward from the offer for application + payout.
            this.activeModifiers = acceptedOffer?.modifiers ?? [];
            this.applyRunModifiers();
        }
        // Mono-Weapon (Specialist) mode (docs/specs/mono-weapon-mission-mode.md §7.1).
        // Resolve + install the locked weapon AFTER the mission and any recon
        // carry-state are applied, so installMonoWeapon runs LAST and rebuilds
        // this.weapons — dominating the basic/Demolitionist/starting/carried grants.
        // No-op (monoWeaponId stays null) for missions without the opt-in flag.
        this.resolveMonoWeapon();
        this.runId = `run_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
        this.missionSystem = new MissionSystem(this, this.activeMission);
        this.events.on('mission_complete', this.handleMissionComplete, this);

        // Fog of War (docs/specs/fog-of-war.md). Fog is ON BY DEFAULT: every run
        // builds FogSystem UNLESS the mission opts out (fog.enabled === false) or is
        // an easy mission (difficulty <= EASY_OPTOUT_MAX_DIFFICULTY). An explicit
        // fog.enabled === true or the VEIL risk modifier always force it on. The
        // reveal radius folds in any SCANNER/VEIL multiplier from the RunModifierSink.
        const fogCfg = this.activeMission.fog;
        const isEasyMission =
            (this.activeMission.difficulty ?? 99) <= GameConfig.FOG.EASY_OPTOUT_MAX_DIFFICULTY;
        const fogOn =
            this.forceFogEnabled ||
            fogCfg?.enabled === true ||
            (fogCfg?.enabled !== false && !isEasyMission);
        if (fogOn) {
            const baseRadius = fogCfg?.revealRadius ?? GameConfig.FOG.REVEAL_RADIUS;
            this.fogSystem = new FogSystem(this, {
                revealRadius: baseRadius * this.pendingRevealRadiusMult,
                blackoutStates: fogCfg?.blackoutStates ?? [],
            });
        }
        // Light Sources (docs/specs/fog-of-war-light-sources.md). Lights are ALWAYS
        // generated as part of arena/map setup (a procedural layout — streetlights,
        // trashcan fires, one carryable), plus any mission-authored lights appended.
        // They register as fog reveal contributors when fog is on, and otherwise
        // render as cosmetic glows (registration is guarded inside LightSystem).
        const generatedLights = LightSystem.generateMapLayout(
            GameConfig.WORLD.WIDTH,
            GameConfig.WORLD.HEIGHT,
            this.player.x,
            this.player.y,
        );
        const missionLights = this.activeMission.lights ?? [];
        this.lightSystem = new LightSystem(this, [...generatedLights, ...missionLights], this.fogSystem);
        // Fire / Burn status (GameConfig.BURN). Always built — burning zombies take
        // DoT, wear a flame overlay, and (where fog is on) light themselves out of
        // the shroud. Takes the fog (for reveal contributors) and the light system
        // (to read the burning trashcan-barrel positions for ignition).
        this.burnSystem = new BurnSystem(this, this.fogSystem, this.lightSystem);
        // Ground decals (blast scorches + toxic-death stains). Cosmetic only.
        this.decalSystem = new DecalSystem(this);
        // SLAY_BOSS may request an early boss spawn for a "boss rush" variant.
        const cond = this.activeMission.condition;
        if (cond.kind === MissionConditionKind.SLAY_BOSS && cond.forceEarlySpawnAtSeconds !== undefined) {
            this.time.delayedCall(Math.max(0, cond.forceEarlySpawnAtSeconds * 1000), () => {
                this.enemySpawnSystem.triggerBoss();
            });
        }
        // KILL_ELITES: spawn the whole required group at once (mirrors the boss
        // forceEarlySpawn pattern). The combined `elites_group_spawned` event drives a
        // single group camera intro. The periodic elite timer stays gated on
        // eliteAliveCount === 0, so it won't slip extra elites in while the group lives.
        if (cond.kind === MissionConditionKind.KILL_ELITES) {
            this.time.delayedCall(2500, () => {
                this.enemySpawnSystem.spawnEliteGroup(cond.target);
            });
        }
        // KILL_TYPE / PURGE_TYPE: guarantee the target enemy type appears at least
        // once every 2 waves so the objective can't stall when the weighted spawn
        // table happens to skip it (see EnemySpawnSystem.setGuaranteedType).
        if (
            cond.kind === MissionConditionKind.KILL_TYPE ||
            cond.kind === MissionConditionKind.PURGE_TYPE
        ) {
            this.enemySpawnSystem.setGuaranteedType(cond.enemyType);
        }
        // Brief mission banner at run start — unless the Briefing scene already
        // front-loaded the objective (briefed deploy), in which case it's redundant.
        if (!this.briefed) this.showMissionBanner();

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

            // Medkit (Expedition supply) heal charge, bound to Q.
            this.medkitKey = this.input.keyboard.addKey(
                Phaser.Input.Keyboard.KeyCodes.Q
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
            const killstreakXpMult = this.killstreakSystem ? this.killstreakSystem.getXPMult() : 1;
            const gain = Math.round(xp * xpMult * killstreakXpMult);
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
        // Persistent Specialist HUD chip (docs/specs/mono-weapon-mission-mode.md §6.3):
        // a player who never sees a new-weapon card still understands the lock.
        if (this.monoWeaponId !== null) {
            this.gameUI.showSpecialistWeapon(this.monoWeaponName());
        }

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

            // Fog: punch a hole around the elite for the duration of the intro so
            // the cinematic frames the threat, not shroud (§6.3).
            this.fogSystem?.addTimedReveal({ x: elite.x, y: elite.y, radius: 480, durationMs: 6500 });

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

        // Combined elite GROUP intro (KILL_ELITES): all elites spawn at once, so run a
        // SINGLE intro — one pan/zoom, one prompt, one set of input listeners, one
        // isEliteIntro set/clear. Pans to the CENTROID of the group (they're clustered on
        // one shared side by spawnEliteGroup) and zooms out a touch for >1 elite. This is
        // a near-verbatim copy of the single-elite intro above; do not also emit per-elite
        // `elite_spawned` for the group or the two intros would fight over the camera.
        this.events.on('elites_group_spawned', (elites: EliteEnemy[]) => {
            if (!this.scene.isActive()) { return; }
            if (!elites || elites.length === 0) { return; }
            this.isEliteIntro = true;
            this.physics.world.pause();

            const cam = this.cameras.main;
            const prevZoom = cam.zoom;
            const cx = elites.reduce((s, e) => s + e.x, 0) / elites.length;
            const cy = elites.reduce((s, e) => s + e.y, 0) / elites.length;
            // Fog: light the whole group's centroid for the intro (§6.3).
            this.fogSystem?.addTimedReveal({ x: cx, y: cy, radius: 560, durationMs: 6500 });
            cam.stopFollow();
            cam.pan(cx, cy, 350, 'Sine.easeInOut');
            cam.zoomTo(elites.length > 1 ? 1.0 : 1.5, 350);

            const prompt = this.add.text(this.cameras.main.width / 2, this.cameras.main.height * 0.18,
                `${elites.length} ELITES — TAP TO CONTINUE`, {
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

            // Fog: clear a wide bubble around the boss for the reveal (§6.3).
            this.fogSystem?.addTimedReveal({ x: boss.x, y: boss.y, radius: 620, durationMs: 7500 });

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
            // If this kill also completed the mission (e.g. a KILL_ELITES job) or the
            // player died in the same frame, the run is already ending — do NOT
            // pause/launch a chest, or we'd stop the Game scene while paused and break
            // Arcade physics on the next run (world=null).
            if (this.runEnded || this.player?.getIsDead()) { return; }
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
            // Elite chest reward: queue it so simultaneous elite deaths each get a
            // chest in turn instead of stomping one another (see requestRelicChest).
            this.requestRelicChest();
        });

        // Boss death is the run's climax: a stronger victory beat plus a GUARANTEED
        // reward (relic chest + blueprint points), versus the elite's conditional drop.
        this.events.on('boss_died', (pos?: {x:number,y:number}) => {
            // If this kill also completed the mission (e.g. a SLAY_BOSS job) or the
            // player died this frame, the run is already ending — skip the chest pause
            // so we never stop the Game scene while paused (which leaves Arcade physics
            // unable to re-boot: world=null next run).
            if (this.runEnded || this.player?.getIsDead()) { return; }
            // Victory beat: bigger camera shake than an elite kill (200/0.01),
            // a celebratory banner, and a particle burst (reuses UIEffects).
            if (this.cameras && this.cameras.main) {
                this.cameras.main.shake(600, 0.025);
            }
            this.uiEffects.showStateText('VICTORY!', {
                color: '#ffd700',
                fontSize: '72px',
                duration: 2000,
                glowColor: 0xffd700,
                glowIntensity: 8,
                scale: { from: 0.5, to: 1.3 },
                particles: true,
            });

            // Delay XP gain briefly so a level-up doesn't interrupt the reward chest.
            this.eliteXPDelayUntil = this.time.now + 2000;

            // GUARANTEED blueprint points (upper end of the old 1-2 range).
            if (pos) {
                this.spawnBlueprintDrops(pos.x, pos.y, 2);
            }

            // GUARANTEED relic chest: reuse the exact elite chest flow
            // (pause -> offer 3 weighted relics -> LevelUpSelection resumes on pick),
            // queued so it can't be stomped by a same-frame elite chest.
            this.requestRelicChest();
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
        if (this.isEliteIntro) {
            // Keep the fog rendering through the cinematic so the panned-to elite/
            // boss (which seeded a timed reveal) is lit, not staring at shroud.
            this.fogSystem?.update(this.game.loop.delta);
            return;
        }

        // Expedition medkit charge: press Q to spend a charge and heal (§8).
        if (this.medkitKey && Phaser.Input.Keyboard.JustDown(this.medkitKey)) {
            this.useMedkit();
        }

        // Update play time (in seconds)
        this.playTime += this.game.loop.delta / 1000;

        // Advance the mission (polled conditions: survive/zone/flawless) and check win.
        // Runs after the pause / elite-intro early-returns above, so spatial/time
        // conditions correctly do not tick during a cinematic pause.
        if (this.missionSystem) {
            this.missionSystem.update(
                this.game.loop.delta / 1000,
                this.playTime,
                this.player.x,
                this.player.y
            );
            if (this.missionSystem.isComplete() && !this.runEnded) {
                this.handleMissionComplete(this.missionSystem.getMission());
            }
        }

        // Advance the optional Extraction phase (dwell timer + zone marker). The
        // dwell completing emits extraction_complete → finishWin (guarded by a done
        // latch + death check so a same-frame death loses, not wins).
        if (this.extractionSystem && !this.runEnded) {
            this.extractionSystem.update(
                this.game.loop.delta / 1000,
                this.player.x,
                this.player.y
            );
        }

        // Update player movement with both keyboard and touch input
        this.player.update(this.cursors, this.wasdKeys, this.initialTouchPoint, this.currentTouchPoint);

        // Advance light sources (cone facing, carried-light follow, flicker, input)
        // BEFORE the fog so the contributors they own are current this frame.
        this.lightSystem?.update(this.game.loop.delta);

        // Advance burning zombies (DoT ticks, flame/glow flicker, contagion +
        // barrel ignition, prune/expire) BEFORE the fog so any contributor a fire
        // adds or removes this frame resolves before the shroud is re-drawn.
        this.burnSystem?.update(this.game.loop.delta);

        // Fade/prune ground decals. Cosmetic-only; order vs fog is irrelevant.
        this.decalSystem?.update(this.game.loop.delta);

        // Advance the fog reveal (player + light + timed contributors, blackout)
        // right after the player moves so the lantern tracks with zero lag.
        this.fogSystem?.update(this.game.loop.delta);

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
            if (enemy instanceof BossEnemy) {
                // Boss drives its own phases/attacks; it is an Enemy but not an
                // EliteEnemy, so it must be dispatched explicitly or its AI never runs.
                enemy.update(this.player);
            } else if (enemy instanceof EliteEnemy) {
                enemy.update(this.player);
            } else if (enemy instanceof RangedEnemy) {
                enemy.updateBehavior(this.player);
            } else if (enemy instanceof ShriekerEnemy) {
                enemy.updateBehavior(this.player);
            } else {
                (enemy as Enemy).moveTowardsPlayer(this.player);
            }
        });

        // Update UI
        this.gameUI.update(this.player.getStats());

        // Objective HUD
        if (this.missionSystem) {
            this.gameUI.updateObjective(
                this.missionSystem.getProgress(),
                this.activeMission.name,
                this.missionSystem.getDetailLabel()
            );
        }

        // Fog objective beacon (§5.2): a screen-edge arrow toward the active
        // spatial objective, only while fog is on. Extraction zone (if armed)
        // takes precedence over the mission's HOLD_ZONE; null hides the beacon.
        if (this.fogSystem) {
            let zoneTarget: WorldPoint | null = null;
            if (this.extractionSystem?.isActive()) {
                zoneTarget = this.extractionSystem.getZone();
            } else {
                zoneTarget = this.missionSystem?.getZoneTarget() ?? null;
            }
            this.gameUI.updateObjectiveBeacon(
                zoneTarget,
                this.player.x,
                this.player.y,
                this.fogSystem.getEffectivePlayerRadius()
            );
        }
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

    // Expose defensive skill system for upgrade effects
    public getSkillSystem(): SkillSystem {
        return this.skillSystem;
    }

    // Upgrade ids that should no longer be offered (e.g. capped unlock-style upgrades)
    private getCappedUpgradeIds(): Set<string> {
        const excluded = new Set<string>();
        if (this.skillSystem?.isMaxLevel()) {
            excluded.add(UpgradeId.SKILL_MASTERY);
        }
        // Drop stat upgrades that have hit their hard cap so they're never offered
        // as a dead "X -> X" choice (the player gets a meaningful option instead).
        if (this.weaponSystem?.isWeaponSpeedMaxed()) {
            excluded.add(UpgradeId.WEAPON_SPEED);
        }
        if (this.player && this.player.getMovementSpeed() >= GameConstants.PLAYER.MAX_MOVEMENT_SPEED) {
            excluded.add(UpgradeId.SPEED_BOOST);
        }
        // Filter weapon offers by unlock state: STARTER is always owned (never
        // offered), and gate-locked weapons (Void Orb until its city special is
        // minted) never appear in the level-up pool.
        for (const def of WEAPON_CATALOG) {
            if (def.tier === WeaponUnlockTier.STARTER) { excluded.add(def.id); continue; }
            if (!isWeaponUnlocked(def)) excluded.add(def.id);
        }
        // Mono-Weapon (Specialist) mode (docs/specs/mono-weapon-mission-mode.md §7.1).
        // When the run is locked to one weapon, exclude every OTHER catalog weapon so
        // neither level-up draws (Game.ts level-up) nor relic-chest top-ups (both share
        // this set) can ever surface a new weapon. The specialist's own id is left in,
        // so its repeatable upgrade card still appears. monoWeaponId is null on normal
        // missions, so this whole block is a no-op there (zero behavior change).
        if (this.monoWeaponId !== null) {
            for (const def of WEAPON_CATALOG) {
                if (def.id !== this.monoWeaponId) excluded.add(def.id);
            }
        }
        return excluded;
    }

    /**
     * Mono-Weapon (Specialist) resolution + install (§4 resolution order). Reads the
     * active mission's `monoWeapon` opt-in: fixed `weaponId` first, else a random pick
     * from `weaponPool` (playerChoice is deferred). Sets this.monoWeaponId (which arms
     * the pool filter + HUD chip + banner) and rebuilds the loadout via
     * WeaponSystem.installMonoWeapon. No-op when the mission doesn't opt in.
     */
    private resolveMonoWeapon(): void {
        const cfg = this.activeMission?.monoWeapon;
        if (!cfg?.enabled) return;
        // weaponId fixed (themed), else random-from-pool. '' / undefined => basic mono.
        let resolved: string | undefined = cfg.weaponId;
        if (resolved === undefined && cfg.weaponPool && cfg.weaponPool.length > 0) {
            resolved = Phaser.Utils.Array.GetRandom(cfg.weaponPool);
        }
        const weaponId = resolved ?? '';        // '' = lock to the basic peashooter
        const replaceBasic = cfg.replaceBasic !== false; // default true
        this.monoWeaponId = weaponId;
        this.weaponSystem.installMonoWeapon(weaponId, replaceBasic);
    }

    /** Display name of the locked specialist weapon for the HUD chip / banner. A
     *  basic-weapon-only mono (monoWeaponId === '') reads as 'Basic'. */
    private monoWeaponName(): string {
        if (!this.monoWeaponId) return 'Basic';
        return getWeaponDef(this.monoWeaponId)?.name ?? 'Basic';
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

    // Whether fog of war is active on this run. Drives fog-gated content such as
    // the FLARE pickup (Enemy.dropPickup only offers flares when this is true).
    public isFogActive(): boolean {
        return this.fogSystem != null;
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

    /** Leave a small green decal where a toxic enemy died (ToxicTankEnemy.die). */
    public spawnToxicDecal(x: number, y: number): void {
        this.decalSystem?.addToxicStain(x, y);
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

    // ─────────────────────── Expedition Loadout (§8) ───────────────────────

    /** Apply the frozen Expedition plan to the run via a RunModifierSink. */
    private applyExpedition(): void {
        const plan = this.expeditionPlan;
        if (!plan) return;
        const sink = this.makeRunModifierSink();
        const ironman = plan.risks.includes(RiskModifierId.IRONMAN);

        // 1. Perks (SUPPLY_CAP/SURVIVAL/ON_WIN already baked into derived).
        for (const perkId of plan.perks) {
            const perk = PERKS.find(p => p.id === perkId);
            if (perk) ExpeditionManager.applyPerk(perk, sink);
        }

        // 2. Risk modifiers (mutate run config: density/damage/elite/vision).
        for (const id of plan.risks) {
            RISK_MODIFIERS.find(r => r.id === id)?.apply(sink);
        }

        // 3. Supplies — one-shot stat applies + in-run charges (skipped on Ironman).
        if (!ironman) {
            for (const s of plan.supplies) {
                const def = SUPPLIES.find(d => d.id === s.id);
                if (!def) continue;
                for (let i = 0; i < s.qty; i++) def.apply(sink);
            }
        }

        // 4. Assigned-survivor perks (no-op for the synthetic count roster today).
        for (const a of plan.survivors) {
            ExpeditionManager.applyPerk(a.perk, sink);
        }
    }

    /** A RunModifierSink whose stat methods delegate to existing Game accessors. */
    private makeRunModifierSink(): RunModifierSink {
        return {
            adjustMaxHealth: (m) => this.playerAdjustMaxHealth(m),
            applyAsymptoticSpeed: (m) => this.playerApplyAsymptoticSpeed(m),
            upgradeWeaponDamage: (m) => this.weaponSystem.upgradeWeaponDamage(m),
            upgradeWeaponSpeed: (m) => this.weaponSystem.upgradeWeaponSpeed(m),
            upgradeProjectileSpeed: (m) => this.weaponSystem.upgradeProjectileSpeed(m),
            setXPMultiplier: (m) => {
                // Compose with any existing multiplier rather than overwrite it.
                const rs = this.relicSystem;
                rs.setXPMultiplier(rs.getXPMultiplier() * m);
            },
            grantSupplyCharge: (id, qty) => {
                if (id === SupplyId.MEDKIT) this.medkitCharges += qty;
            },
            setEnemyDensityMult: (m) => this.enemySpawnSystem.setEnemyDensityMult(m),
            setEnemyDamageMult: (m) => this.enemySpawnSystem.setEnemyDamageMult(m),
            setEliteIntervalMult: (m) => this.enemySpawnSystem.setEliteIntervalMult(m),
            setVision: (m) => {
                // Zoom out (>1) = wider view; zoom in (<1) = fog/restricted view.
                this.cameras.main.setZoom(1 / Math.max(0.25, m));
            },
            // Fog of War hooks (§4.4). SCANNER/VEIL repoint here. Accumulated now
            // and consumed when FogSystem is constructed (it may not exist yet, and
            // applyExpedition runs before the mission is resolved). If fog never
            // ends up enabled these are inert — non-fog runs stay unchanged.
            setFog: (enabled) => {
                this.forceFogEnabled = this.forceFogEnabled || enabled;
            },
            setRevealRadius: (m) => {
                this.pendingRevealRadiusMult *= m;
                // If FogSystem already exists (mid-run adjustment), apply live.
                this.fogSystem?.setRevealRadius(
                    (this.activeMission?.fog?.revealRadius ?? GameConfig.FOG.REVEAL_RADIUS) * this.pendingRevealRadiusMult
                );
            },
        };
    }

    /** Spend one medkit charge to heal the player (§8). */
    private useMedkit(): void {
        if (this.medkitCharges <= 0) return;
        if (!this.player || this.player.getIsDead()) return;
        this.medkitCharges -= 1;
        const healAmount = Math.ceil(this.player.getStats().maxHealth * 0.5);
        this.player.heal(healAmount);
        this.showFloatingText(`Medkit (+${healAmount} HP)`, this.player.x, this.player.y - 30, 0x66ff66);
    }

    /** Resolve assigned-survivor injury/death for the run. Called once inside the
     *  runEnded latch by both terminus paths (§6.3). Returns outcomes for GameOver. */
    private resolveSurvivors(outcome: 'win' | 'lose'): SurvivorOutcome[] {
        if (!this.expeditionPlan) return [];
        try {
            return ExpeditionManager.getInstance().resolveSurvivors(outcome, this.expeditionPlan, this.runId);
        } catch {
            return [];
        }
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
            // The player may have died during the delay; never pop the level-up
            // menu after death or it would soft-lock on top of the GameOver screen.
            if (!this.player || this.player.getIsDead() || !this.scene.isActive() || this.runEnded) {
                this.isLevelUpPending = false;
                return;
            }

            // Remove the celebratory "LEVEL UP!" banner so it doesn't bleed
            // through the selection menu's overlay while it finishes fading.
            this.uiEffects?.clearLevelUpText();

            // Pause the game
            this.scene.pause();

            // Stop the LevelUpSelection scene if it's already running
            if (this.scene.isActive(SceneKey.LevelUpSelection)) {
                this.scene.stop(SceneKey.LevelUpSelection);
            }

            // 15% chance to offer relics instead of upgrades
            const upgrades = Math.random() < 0.15
                ? UpgradeSystem.getRandomRelicUpgrades(3)
                : UpgradeSystem.getRandomUpgrades(3, this.getCappedUpgradeIds());

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
        // Long Recon (§5.3): track chosen BASE upgrades so they carry to the next
        // node. Relic and weapon picks are carried by RelicSystem / WeaponSystem ids
        // captured directly in captureCarryState(), so only base stat upgrades that
        // UpgradeSystem can re-apply by id are recorded here.
        if (selectedUpgrade && ReconSystem.getInstance().isActive()) {
            if (UpgradeSystem.getById(selectedUpgrade.id)) {
                this.reconChosenUpgradeIds.push(selectedUpgrade.id);
            }
        }
        // The game scene is already resumed by the LevelUpSelection scene
        // We can add additional logic here if needed
        this.scene.resume();
        // Allow future level-ups to schedule their menu
        this.isLevelUpPending = false;
        // This selection (chest or level-up) is done; surface the next queued chest
        // if any. Covers chest->chest and level-up->chest hand-offs. Deferred one
        // tick because LevelUpSelection emits this event BEFORE it stops itself, so
        // scene.isActive(LevelUpSelection) is still true right now — opening the next
        // chest synchronously would trip tryOpenNextChest's active-menu guard.
        this.chestOpen = false;
        this.time.delayedCall(0, () => this.tryOpenNextChest());
    }

    // Enqueue a relic chest (elite/boss reward) and surface it if nothing is open.
    private requestRelicChest(): void {
        this.chestQueue++;
        this.tryOpenNextChest();
    }

    // Open the next queued relic chest, one at a time. No-op while a chest is
    // already displayed, the queue is empty, the run is ending, or a level-up
    // menu currently owns the screen (it will re-drive us via the resume handler).
    private tryOpenNextChest(): void {
        if (this.chestOpen || this.chestQueue <= 0) { return; }
        if (this.runEnded || this.player?.getIsDead()) { this.chestQueue = 0; return; }
        if (this.scene.isActive(SceneKey.LevelUpSelection)) { return; }
        this.chestQueue--;
        this.chestOpen = true;
        this.scene.pause();
        // Weighted relic offer; top up with regular upgrades when few relics remain
        // so the menu always has clickable options and can never soft-lock.
        let upgrades = UpgradeSystem.getRandomRelicUpgradesFiltered(3, this.relicSystem.getAcquiredIds(), {
            playTimeSec: this.getPlayTime(),
            level: this.player.getStats().level,
            fromChest: true
        });
        if (upgrades.length < 3) {
            upgrades = upgrades.concat(UpgradeSystem.getRandomUpgrades(3 - upgrades.length, this.getCappedUpgradeIds()));
        }
        this.scene.launch(SceneKey.LevelUpSelection, { player: this.player, upgrades });
    }

    // Expose the mission system so the death path can label the failed objective.
    public getMissionSystem(): MissionSystem | undefined {
        return this.missionSystem;
    }

    // Run identity / mission id for the GameOver -> CampSystem cycle hook.
    public getRunId(): string { return this.runId; }
    public getActiveMissionId(): string | undefined { return this.activeMission?.id; }

    /**
     * Death-path survivor resolution (§6.3). Player.die() transitions to GameOver
     * itself, so it calls this to settle assigned-survivor fates under the SAME
     * runEnded latch the win/timeout paths use — guaranteeing exactly-once
     * resolution even on a same-frame win+death race.
     */
    public resolveSurvivorsForDeath(): SurvivorOutcome[] {
        if (this.runEnded) return [];
        this.runEnded = true;
        return this.resolveSurvivors('lose');
    }

    // ─────────────────────── Long Recon carry-state (§5) ───────────────────────

    /**
     * Re-apply the carried character state at the start of a recon node (§5.3).
     * Runs AFTER the normal loadout/blueprint application so it overwrites with the
     * carried absolute values (max HP, level/XP) and re-instantiates weapons /
     * upgrades / relics by id. The first node carries 0 maxHealth (a sentinel that
     * means "keep the run's freshly-computed stats").
     */
    private applyReconCarryState(recon: ReconSystem): void {
        const carry = recon.getCarry();
        // First node: nothing to restore (maxHealth sentinel 0) — leave fresh stats.
        if (carry.maxHealth > 0) {
            this.player.setMaxHealth(carry.maxHealth);
            this.player.setHealthAbsolute(carry.currentHealth);
            this.experienceSystem.restore(carry.level, carry.totalXP);
        }
        carry.unlockedWeaponIds.forEach(id => this.weaponSystem.unlockById(id));
        carry.upgradeIds.forEach(id => UpgradeSystem.reapply(this.player, id));
        carry.relicIds.forEach(id => this.relicSystem.reapply(id));
        // Seed the per-node chosen-upgrade tracker with what's already carried so
        // the next capture is cumulative across the whole recon.
        this.reconChosenUpgradeIds = carry.upgradeIds.slice();
    }

    /** Snapshot the live player/systems into a value-only carry-state (§5.4). */
    private captureCarryState(): ReconCarryState {
        const s = this.player.getStats();
        return {
            maxHealth: s.maxHealth,
            currentHealth: this.player.getCurrentHealth(),
            level: this.experienceSystem.getCurrentLevel(),
            totalXP: this.experienceSystem.getTotalXP(),
            unlockedWeaponIds: this.weaponSystem.getUnlockedIds(),
            upgradeIds: this.reconChosenUpgradeIds.slice(),
            relicIds: Array.from(this.relicSystem.getAcquiredIds()),
        };
    }

    // WIN transition. Mirrors the overlay cleanup Player.die() does, then routes to
    /**
     * Dismiss overlay scenes (level-up / pause) AND un-pause the Game scene before
     * we stop it to transition to GameOver/RouteMap. Phaser leaves Arcade physics
     * unable to re-boot (`physics.world === null` on the next run's create()) if a
     * scene is stopped while paused — so every exit MUST resume first. resume() on a
     * non-paused scene is a harmless no-op.
     */
    private prepareSceneExit(): void {
        const sm = this.scene;
        if (sm.isActive(SceneKey.LevelUpSelection)) sm.stop(SceneKey.LevelUpSelection);
        if (sm.isActive(SceneKey.PauseMenu)) sm.stop(SceneKey.PauseMenu);
        sm.resume();
    }

    // Single choke point for the primary mission_complete signal. Either reroutes
    // into the optional Extraction phase or pays out the win via finishWin().
    private handleMissionComplete(mission: Mission): void {
        if (this.runEnded) return;
        if (this.player && this.player.getIsDead()) return;

        // Optional Extraction end (spec §1): when the primary objective completes
        // and extraction is enabled, flip the run into a survival Extraction phase
        // instead of ending. Guarded by isActive()/isDone() so the single
        // mission_complete signal reroutes here exactly once; the real win comes
        // later via extraction_complete → finishWin. Missions without the flag fall
        // straight through to finishWin (zero behavior change).
        if (
            mission.extraction?.enabled &&
            !this.extractionSystem?.isActive() &&
            !this.extractionSystem?.isDone()
        ) {
            this.beginExtraction(mission);
            return; // do NOT end the run yet
        }

        this.finishWin(mission);
    }

    /**
     * Construct + arm the ExtractionSystem, start uncapped rear-biased spawning,
     * and wire extraction_complete → finishWin. The run does not end until the
     * player survives the dwell.
     */
    private beginExtraction(mission: Mission): void {
        if (this.extractionSystem?.isActive() || this.extractionSystem?.isDone()) return;

        const px = this.player.x;
        const py = this.player.y;

        this.extractionSystem = new ExtractionSystem(this, mission, this.enemySpawnSystem);
        this.extractionSystem.begin(px, py);

        // Drive uncapped directional spawning, biased away from the exit zone.
        const zone = this.extractionSystem.getZone();
        this.enemySpawnSystem.beginExtractionSpawning(zone);

        // The real win: survive the dwell → pay out via the normal win path.
        this.events.once('extraction_complete', (m: Mission) => {
            this.finishWin(m);
        });

        this.showExtractionBanner();
    }

    private showExtractionBanner(): void {
        const cam = this.cameras.main;
        const banner = this.add.text(cam.width / 2, cam.height * 0.28,
            `EXTRACTION\nReach the marked zone and hold!`, {
                fontFamily: 'Arial Black', fontSize: '26px', color: '#44ff88',
                stroke: '#000000', strokeThickness: 6, align: 'center',
                wordWrap: { width: Math.min(640, cam.width * 0.85) }
            }).setOrigin(0.5).setScrollFactor(0).setDepth(2002);
        this.tweens.add({
            targets: banner,
            alpha: 0,
            delay: 2500,
            duration: 800,
            onComplete: () => banner.destroy(),
        });
    }

    // GameOver with outcome:'win'. Guarded by runEnded so it fires at most once and
    // never races a death (death wins via Player.die's own isDead latch). Reached
    // either directly (non-extraction missions) or via extraction_complete.
    private finishWin(mission: Mission): void {
        if (this.runEnded) return;
        if (this.player && this.player.getIsDead()) return;
        this.runEnded = true;

        // Extraction is over (if any) — stop uncapped spawning + drop the marker.
        this.extractionSystem?.destroy();

        // Long Recon (§5.2): a node WIN does NOT go to GameOver. Capture carry-state,
        // accrue the node reward into pending, then return to the RouteMap — UNLESS
        // this was the boss node, which banks all pending rewards and shows the win
        // screen. Branch before the standalone GameOver payout path below.
        const recon = ReconSystem.getInstance();
        if (recon.isActive()) {
            const carry = this.captureCarryState();
            const nodeId = this.activeReconNodeId || recon.getActiveNodeId();
            const wasBoss = recon.isBossNode(nodeId);
            recon.completeNode(nodeId, carry);

            this.prepareSceneExit();

            if (wasBoss) {
                const payout = recon.completeRecon();
                this.scene.start(SceneKey.GameOver, {
                    outcome: 'win',
                    missionName: mission.name,
                    missionId: mission.id,
                    reconPayout: payout,
                    enemiesKilled: this.player.getEnemiesKilled(),
                    xpGained: this.player.getXPGained(),
                    levelReached: this.player.getStats().level,
                    playTimeSeconds: this.gameUI ? this.gameUI.getGameTime() : Math.floor(this.playTime),
                });
            } else {
                this.scene.start(SceneKey.RouteMap);
            }
            return;
        }

        // Blueprint points (and all camp resources) are awarded by
        // CampSystem.advanceCycle in GameOver, which owns the won-mission reward.
        // We only surface the BP figure here for the GameOver stats line. Prefer
        // the accepted Job Board offer's reward (generated missions have no
        // Mission.reward of their own).
        // Reward scaling (§5): base BP from the offer/mission scaled by the plan's
        // risk-modifier multiplier, plus any flat ON_WIN perk bonus. GameOver pays
        // the camp once (idempotent by runId); we scale the figure it consumes.
        const offer = JobBoardSystem.getAcceptedOffer();
        const baseBP = offer?.reward.camp.blueprintPoints ?? mission.reward?.blueprintPoints ?? 0;
        const mult = this.expeditionPlan?.derived.rewardMultiplier ?? 1;
        const onWin = this.expeditionPlan?.derived.onWinBonusPoints ?? 0;
        const awardedPoints = Math.round(baseBP * mult) + onWin;

        // Resolve assigned survivors exactly once, inside the runEnded latch (§6.3).
        const survivorOutcomes = this.resolveSurvivors('win');

        // City Reclamation (§6.2): if this run carried an accepted zone job, hand its
        // ids + difficulty to GameOver so CityReclamationSystem.applyJobWin() can drop
        // the zone's infestation on the win edge (pure localStorage; zero in-run cost).
        const zoneJob = LoadoutManager.getInstance().getActiveZoneJob();

        const playTime = this.gameUI ? this.gameUI.getGameTime() : Math.floor(this.playTime);

        // Dismiss overlay scenes (and un-pause) so nothing lingers on GameOver and
        // physics can re-boot next run.
        this.prepareSceneExit();

        this.scene.start(SceneKey.GameOver, {
            outcome: 'win',
            missionName: mission.name,
            missionId: mission.id,
            runId: this.runId,
            blueprintPointsAwarded: awardedPoints,
            rewardMultiplier: mult,
            onWinBonusPoints: onWin,
            survivorOutcomes,
            zoneId: zoneJob?.zoneId,
            jobId: zoneJob?.jobId,
            zoneDifficulty: mission.difficulty ?? 1,
            enemiesKilled: this.player.getEnemiesKilled(),
            xpGained: this.player.getXPGained(),
            levelReached: this.player.getStats().level,
            playTimeSeconds: playTime,
        });
    }

    /**
     * Apply run modifiers carried in from the accepted Job Board offer (§6.3).
     * Modifiers backed by an existing knob are applied; the rest degrade
     * gracefully (no-op + console.warn) so the board ships before every knob.
     * TODO(phase: modifiers) Wire HAZARD_FIELD/ENEMY_BUFF/SCARCITY/
     * TYPE_INFESTATION setters on EnemySpawnSystem.
     */
    private applyRunModifiers(): void {
        for (const m of this.activeModifiers) {
            switch (m.kind) {
                case JobModifierKind.ENEMY_DENSITY:
                    // Scale spawn pressure (count/cap) for the whole run.
                    this.enemySpawnSystem.setEnemyDensityMult(m.multiplier);
                    break;
                case JobModifierKind.ELITE_CADENCE:
                    // Tighten/loosen the elite spawn timer. The base interval is
                    // 90000ms (see EnemySpawnSystem.setupEliteTimer), so convert
                    // the absolute intervalMs into the multiplier the setter wants.
                    this.enemySpawnSystem.setEliteIntervalMult(m.intervalMs / 90000);
                    break;
                case JobModifierKind.BOSS_TIMING:
                    // Schedule an early/late boss spawn (triggerBoss is public).
                    this.time.delayedCall(Math.max(0, m.spawnAtSeconds * 1000), () => {
                        this.enemySpawnSystem.triggerBoss();
                    });
                    break;
                case JobModifierKind.TIME_LIMIT:
                    // Hard run timer: if the win condition isn't met in time, force LOSE
                    // through the same GameOver path a death uses (runEnded latch guards
                    // against a double transition vs a win/death in the same frame).
                    this.time.delayedCall(Math.max(0, m.seconds * 1000), () => {
                        if (!this.runEnded) this.forceLoseRun();
                    });
                    break;
                default:
                    console.warn(`[Game] Run modifier '${m.kind}' has no backing setter yet; ignoring.`);
                    break;
            }
        }
    }

    // Non-death LOSE transition (used by TIME_LIMIT modifier). Mirrors the
    // outcome:'lose' GameOver payload Player.die produces.
    private forceLoseRun(): void {
        if (this.runEnded) return;
        if (this.player && this.player.getIsDead()) return;
        this.runEnded = true;
        const survivorOutcomes = this.resolveSurvivors('lose');
        const playTime = this.gameUI ? this.gameUI.getGameTime() : Math.floor(this.playTime);
        this.prepareSceneExit();
        this.scene.start(SceneKey.GameOver, {
            outcome: 'lose',
            missionName: this.activeMission.name,
            missionId: this.activeMission.id,
            runId: this.runId,
            survivorOutcomes,
            enemiesKilled: this.player.getEnemiesKilled(),
            xpGained: this.player.getXPGained(),
            levelReached: this.player.getStats().level,
            playTimeSeconds: playTime,
        });
    }

    private showMissionBanner(): void {
        const cam = this.cameras.main;
        // Mono-Weapon (Specialist) mode: append a WEAPON LOCKED line so the lock is
        // unmistakable from second one (docs/specs/mono-weapon-mission-mode.md §6.2).
        let bannerText = `OBJECTIVE\n${this.activeMission.name}\n${this.activeMission.description}`;
        if (this.monoWeaponId !== null) {
            bannerText += `\nWEAPON LOCKED: ${this.monoWeaponName()}`;
        }
        const banner = this.add.text(cam.width / 2, cam.height * 0.28,
            bannerText, {
                fontFamily: 'Arial Black', fontSize: '24px', color: '#00ffff',
                stroke: '#000000', strokeThickness: 6, align: 'center',
                wordWrap: { width: Math.min(640, cam.width * 0.85) }
            }).setOrigin(0.5).setScrollFactor(0).setDepth(2002);
        this.tweens.add({
            targets: banner,
            alpha: 0,
            delay: 2500,
            duration: 800,
            onComplete: () => banner.destroy(),
        });
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
                case PickupType.AIRSTRIKE:
                    this.triggerAirstrike(pickup.x, pickup.y);
                    break;
                case PickupType.FLARE: {
                    // Blow the fog far back for a few seconds (the actual reveal),
                    // then pair a warm cosmetic glow so the area reads as LIT.
                    // Both systems are guarded — a non-fog run won't even drop a
                    // flare, but the optional chaining keeps it crash-safe.
                    const flare = GameConfig.FLARE;
                    this.fogSystem?.addTimedReveal({
                        x: player.x,
                        y: player.y,
                        radius: flare.REVEAL_RADIUS,
                        durationMs: flare.REVEAL_DURATION_MS,
                        fadeMs: flare.REVEAL_FADE_MS,
                    });
                    this.lightSystem?.flashGlow(
                        player.x,
                        player.y,
                        flare.REVEAL_RADIUS,
                        flare.TINT,
                        flare.GLOW_DURATION_MS
                    );
                    this.showFloatingText(
                        "FLARE!",
                        player.x,
                        player.y - 20,
                        flare.TINT
                    );
                    break;
                }
            }

            // Notify the mission system (COLLECT_DROPS) that a pickup was collected.
            this.events.emit('pickupCollected', { type: pickup.getType() });

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
    private createExplosionEffect(x: number, y: number, radiusMultiplier: number = 1): void {
        // Get the player's current weapon damage
        const weaponSystem = this.weaponSystem;
        const weapons = weaponSystem.getWeapons();
        const currentWeapon = weapons[0];
        const baseDamage = currentWeapon ? currentWeapon.getDamage() : GameConstants.WEAPONS.BASIC_DAMAGE;
        
        // Calculate explosion damage
        const explosionDamage = baseDamage * ExplosionConfig.DAMAGE_MULTIPLIER;
        
        // Create explosion radius (BOMB uses full radius; airstrike blasts are "medium")
        const explosionRadius = ExplosionConfig.RADIUS * radiusMultiplier;

        // Leave a charred scorch on the ground. This single hook covers BOMB and
        // every AIRSTRIKE sub-blast (the airstrike funnels through this method).
        this.decalSystem?.addScorch(x, y, explosionRadius);

        // Create explosion visual effect.
        // Draw circles centered at the graphics object's local origin (0, 0) and
        // position the object itself at (x, y). This keeps scale tweens centered
        // on the blast instead of scaling away from the world origin (0, 0).
        const explosion = this.add.graphics();
        explosion.setDepth(ExplosionConfig.VISUAL.MAIN.DEPTH);
        explosion.setScrollFactor(1);
        explosion.setPosition(x, y);
        explosion.fillStyle(ExplosionConfig.VISUAL.MAIN.OUTER_COLOR, ExplosionConfig.VISUAL.MAIN.OUTER_ALPHA);
        explosion.fillCircle(0, 0, explosionRadius);

        // Add a white border
        explosion.lineStyle(
            ExplosionConfig.VISUAL.MAIN.BORDER_WIDTH,
            ExplosionConfig.VISUAL.MAIN.BORDER_COLOR,
            ExplosionConfig.VISUAL.MAIN.BORDER_ALPHA
        );
        explosion.strokeCircle(0, 0, explosionRadius);

        // Add a smaller inner circle
        explosion.fillStyle(ExplosionConfig.VISUAL.MAIN.INNER_COLOR, ExplosionConfig.VISUAL.MAIN.INNER_ALPHA);
        explosion.fillCircle(0, 0, explosionRadius * ExplosionConfig.VISUAL.MAIN.INNER_RADIUS_MULTIPLIER);
        
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
                    // Bombs / airstrikes have a chance to set fire to enemies they
                    // DAMAGE but do not kill. takeDamage()→die()→destroy() flips
                    // `active` to false on a lethal hit, so `enemy.active` here is
                    // exactly "damaged, survived". One hook covers BOMB + AIRSTRIKE
                    // (the airstrike funnels every blast through this method).
                    if (enemy.active && Math.random() < GameConfig.BURN.IGNITE_CHANCE) {
                        this.burnSystem?.ignite(enemy);
                    }
                }
            }
        });
    }

    /**
     * AIRSTRIKE pickup effect. Finds the densest cluster of active enemies,
     * marks it with a targeting reticle, and after a delay drops a staggered
     * sequence of medium explosions scattered around the marked location.
     */
    private triggerAirstrike(fallbackX: number, fallbackY: number): void {
        // Tuning constants for the airstrike sequence.
        const CLUSTER_RADIUS = 150;        // px, radius used to count clustered enemies
        const WARNING_DELAY = 4000;        // ms before the bombs drop (3-5s window)
        const EXPLOSION_COUNT = 6;         // number of medium explosions (5-8)
        const SEQUENCE_DURATION = 1500;    // ms over which the explosions are staggered
        const SCATTER_RADIUS = 200;        // px, how far blasts scatter from the marker
        const BLAST_RADIUS_MULTIPLIER = 0.6; // "medium" explosions vs full BOMB radius

        // Find the densest cluster center among active enemies.
        const enemies = (this.enemies.getChildren() as Enemy[]).filter(e => e.active);
        let targetX = fallbackX;
        let targetY = fallbackY;

        if (enemies.length > 0) {
            let bestCount = -1;
            for (const enemy of enemies) {
                let count = 0;
                for (const other of enemies) {
                    if (Phaser.Math.Distance.Between(enemy.x, enemy.y, other.x, other.y) <= CLUSTER_RADIUS) {
                        count++;
                    }
                }
                if (count > bestCount) {
                    bestCount = count;
                    targetX = enemy.x;
                    targetY = enemy.y;
                }
            }
        }

        // Floating warning text.
        this.showFloatingText("AIRSTRIKE INCOMING!", targetX, targetY - 40, 0x66ccff);

        // Build a pulsing targeting reticle (concentric circles + crosshair).
        const marker = this.add.graphics();
        marker.setDepth(ExplosionConfig.VISUAL.MAIN.DEPTH);
        marker.setScrollFactor(1);
        marker.setPosition(targetX, targetY);
        const reticleRadius = 60;
        marker.lineStyle(4, 0x66ccff, 0.9);
        marker.strokeCircle(0, 0, reticleRadius);
        marker.strokeCircle(0, 0, reticleRadius * 0.6);
        marker.lineStyle(2, 0xffffff, 0.9);
        marker.lineBetween(-reticleRadius - 10, 0, reticleRadius + 10, 0);
        marker.lineBetween(0, -reticleRadius - 10, 0, reticleRadius + 10);

        const markerTween = this.tweens.add({
            targets: marker,
            scale: 1.25,
            alpha: 0.4,
            duration: 500,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // After the warning delay, drop the staggered explosion sequence.
        this.time.delayedCall(WARNING_DELAY, () => {
            for (let i = 0; i < EXPLOSION_COUNT; i++) {
                const stagger = (i / EXPLOSION_COUNT) * SEQUENCE_DURATION;
                this.time.delayedCall(stagger, () => {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = Math.random() * SCATTER_RADIUS;
                    const bx = targetX + Math.cos(angle) * dist;
                    const by = targetY + Math.sin(angle) * dist;
                    this.createExplosionEffect(bx, by, BLAST_RADIUS_MULTIPLIER);

                    // Briefly light up the crater: peel the fog back around the
                    // blast and pair a warm cosmetic glow so it reads as a
                    // fire-lit crater, not merely "unfogged". Both systems are
                    // guarded — a non-fog mission behaves exactly as before.
                    const air = GameConfig.AIRSTRIKE;
                    this.fogSystem?.addTimedReveal({
                        x: bx,
                        y: by,
                        radius: air.IMPACT_LIGHT_RADIUS,
                        durationMs: air.IMPACT_LIGHT_DURATION_MS,
                        fadeMs: air.IMPACT_LIGHT_FADE_MS,
                    });
                    this.lightSystem?.flashGlow(
                        bx,
                        by,
                        air.IMPACT_LIGHT_RADIUS,
                        air.IMPACT_LIGHT_TINT,
                        air.IMPACT_LIGHT_DURATION_MS
                    );
                });
            }

            // Remove the marker once the full sequence has finished.
            this.time.delayedCall(SEQUENCE_DURATION + 200, () => {
                markerTween.stop();
                marker.destroy();
            });
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

    // Invoked on the Phaser SHUTDOWN event (wired in create()). Guarded throughout
    // so it is safe even if shutdown happens before every system is initialized.
    private shutdownScene() {
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
        // Tear extraction down FIRST: its destroy() calls endExtractionSpawning()
        // which re-arms the normal spawn timers, so it must run before
        // enemySpawnSystem.destroy() finally kills them (else they'd leak).
        this.extractionSystem?.destroy();
        this.lightSystem?.destroy();
        // Before fogSystem: BurnSystem.destroy() removes its reveal contributors,
        // which must happen while the fog still exists.
        this.burnSystem?.destroy();
        this.decalSystem?.destroy();
        this.fogSystem?.destroy();
        this.enemySpawnSystem?.destroy();
        this.weaponSystem?.destroy();
        this.missionSystem?.destroy();
        this.gameUI?.destroy();

        // Remove only this game's custom event listeners. We must NOT call
        // this.events.removeAllListeners() here: this.events is the scene's
        // *system* emitter, which also carries Phaser's internal plugin
        // listeners (CameraManager/ArcadePhysics/Input subscribe to START on it).
        // Wiping all of them means cameras.main and physics.world are never
        // rebuilt on the next scene.start(), crashing create() (e.g. the
        // startFollow() TypeError). Remove our events by name instead.
        for (const evt of Game.CUSTOM_EVENTS) {
            this.events.removeAllListeners(evt);
        }
    }

    // Custom game events this scene wires up in create(); removed individually
    // on shutdown so Phaser's own system listeners survive a restart.
    private static readonly CUSTOM_EVENTS = [
        'mission_complete',
        'extraction_started',
        'extraction_complete',
        'enemyKilled',
        'enemyKilledClassified',
        'player_level_up',
        'player_hit',
        'pickupCreated',
        'pickupCollected',
        'elite_spawned',
        'elites_group_spawned',
        'elite_died',
        'boss_spawned',
        'boss_died',
        'difficulty_increased',
        'spawn_state_changed',
        'weapon_evolved',
    ];
}
