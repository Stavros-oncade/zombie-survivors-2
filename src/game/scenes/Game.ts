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
        // Create player
        this.player = new Player(this, 400, 300);
        this.add.existing(this.player);
        // Enable physics after the player is added to the scene
        this.player.enablePhysics();

        this.cameras.main.setZoom(0.5);

        // Create enemy group
        this.enemies = this.physics.add.group();
        this.enemies.setName('enemies');

        // Initialize systems
        this.enemySpawnSystem = new EnemySpawnSystem(this, this.enemies);
        this.weaponSystem = new WeaponSystem(this, this.player, this.enemies);
        this.experienceSystem = new ExperienceSystem(this.player);

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

        // Setup experience gain
        this.events.on('enemyKilled', (xp: number) => {
            this.experienceSystem.gainExperience(xp);
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

        // Update enemy spawning
        // enemies spawn on a timer they set internally

        // Update enemies
        const enemyChildren = this.enemies.getChildren() as Enemy[];
        enemyChildren.forEach(enemy => {
            enemy.moveTowardsPlayer(this.player);
        });

        // Update UI
        this.gameUI.update(this.player.getStats());
    }

    private handlePlayerEnemyCollision(player: Player, enemy: Enemy)
    {
        player.takeDamage(enemy.getDamage());
    }

    destroy()
    {
        // Stop all sounds
        this.sound.stopAll();
        
        // Clean up systems
        this.enemySpawnSystem.destroy();
        this.weaponSystem.destroy();
        this.gameUI.destroy();
        
        // Remove all event listeners
        this.events.removeAllListeners();
    }
}
