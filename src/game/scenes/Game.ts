import { Scene } from 'phaser';
import { Player } from '../entities/Player';
import { EnemySpawnSystem } from '../systems/EnemySpawnSystem';
import { WeaponSystem } from '../systems/WeaponSystem';
import { ExperienceSystem } from '../systems/ExperienceSystem';
import { Enemy } from '../entities/Enemy';
import { GameUI } from '../ui/GameUI';

export class Game extends Scene
{
    private player!: Player;
    private enemies!: Phaser.Physics.Arcade.Group;
    private enemySpawnSystem!: EnemySpawnSystem;
    private weaponSystem!: WeaponSystem;
    private experienceSystem!: ExperienceSystem;
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private wasdKeys!: { [key: string]: Phaser.Input.Keyboard.Key };
    private gameUI!: GameUI;

    constructor()
    {
        super({ key: 'Game' });
    }

    create()
    {
        // Set the physics world bounds to be larger than the viewport
        const worldWidth = 2048; // 4x the default width
        const worldHeight = 1536; // 4x the default height
        this.physics.world.setBounds(0, 0, worldWidth, worldHeight);

        // Create and stretch background to fill the world bounds
        const background = this.add.image(0, 0, 'background');
        background.setOrigin(0, 0);
        background.setDisplaySize(worldWidth, worldHeight);
        background.setDepth(-1); // Ensure background is behind everything

        // --- Player and Experience System Initialization --- 
        // 1. Create Player (without full initialization yet)
        this.player = new Player(this, worldWidth / 2, worldHeight / 2);
        this.add.existing(this.player);

        // 2. Create ExperienceSystem, passing the player's level-up callback
        this.experienceSystem = new ExperienceSystem(this.player, this.player.applyLevelUpEffects.bind(this.player));

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
        this.enemies.setName('enemies');

        // Initialize other systems (pass ExperienceSystem if needed, though not currently used by them)
        this.enemySpawnSystem = new EnemySpawnSystem(this, this.enemies);
        this.weaponSystem = new WeaponSystem(this, this.player, this.enemies);
        // ExperienceSystem is already initialized

        // Setup input
        if (this.input.keyboard) {
            this.cursors = this.input.keyboard.createCursorKeys();
            this.wasdKeys = this.input.keyboard.addKeys({
                up: Phaser.Input.Keyboard.KeyCodes.W,
                down: Phaser.Input.Keyboard.KeyCodes.S,
                left: Phaser.Input.Keyboard.KeyCodes.A,
                right: Phaser.Input.Keyboard.KeyCodes.D
            }) as { [key: string]: Phaser.Input.Keyboard.Key };
        }

        // Setup collisions
        this.physics.add.collider(this.player, this.enemies, (player, enemy) => {
            this.handlePlayerEnemyCollision(player as Player, enemy as Enemy);
        }, undefined, this);

        // Setup experience gain - Listener now updates ExperienceSystem and Player's total XP gained
        this.events.on('enemyKilled', (xp: number) => { // Remove unused killedEnemy parameter
            console.log(`Game Scene: enemyKilled event received with ${xp} XP`); // DEBUG
            this.experienceSystem.gainExperience(xp);
            this.player.addXPGained(xp); // Track total XP for game over
            this.player.incrementEnemiesKilled(); // Track killed enemies
        });

        // Create UI
        this.gameUI = new GameUI(this);
    }

    update()
    {
        if (!this.cursors || !this.wasdKeys) return;

        // Update player movement
        this.player.update(this.cursors, this.wasdKeys);

        // Update weapons (automatic firing)
        this.weaponSystem.update();

        // enemies spawn on a timer they set internally

        // Update enemies
        const enemyChildren = this.enemies.getChildren() as Enemy[];
        enemyChildren.forEach(enemy => {
            // Check if enemy is still active before moving
            if (enemy.active) { 
                enemy.moveTowardsPlayer(this.player);
            }
        });

        // Update UI
        this.gameUI.update(this.player.getStats());
    }

    private handlePlayerEnemyCollision(player: Player, enemy: Enemy)
    {
        // Check if enemy is still active before dealing damage
        if(enemy.active) {
             player.takeDamage(enemy.getDamage());
        }
       
    }

    destroy()
    {
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
