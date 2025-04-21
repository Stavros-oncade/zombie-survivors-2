import { Scene, GameObjects } from "phaser";
import { Player } from "../entities/Player";
import { Upgrade, UpgradeStats } from "../types/GameTypes";
import { GameConstants } from "../config/GameConstants";
import { Game } from "./Game";

export class LevelUpSelection extends Scene {
    private background: GameObjects.Rectangle;
    private title: GameObjects.Text;
    private upgradeOptions: GameObjects.Container[] = [];
    private player: Player;
    private selectedUpgrade: Upgrade | null = null;
    private isSelectionMade: boolean = false;

    constructor() {
        super("LevelUpSelection");
    }

    create() {
    }

    init(data: { player: Player; upgrades: Upgrade[] }) {
        this.player = data.player;
        
        // Reset the selection flag when the scene is initialized
        this.isSelectionMade = false;
        this.selectedUpgrade = null;
        
        // Ensure input is enabled for this scene
        this.input.enabled = true;
        
        this.createUI(data.upgrades);
    }

    private createUI(upgrades: Upgrade[]): void {
        // Create semi-transparent background
        this.background = this.add
            .rectangle(
                0,
                0,
                this.cameras.main.width,
                this.cameras.main.height,
                0x000000,
                0.8
            )
            .setOrigin(0, 0)
            .setDepth(1000)
            .setScrollFactor(0);

        // Create title
        const isMobile = this.cameras.main.width < 768;
        const titleY = isMobile ? 50 : 100;
        this.title = this.add
            .text(this.cameras.main.width / 2, titleY, "LEVEL UP!", {
                fontFamily: "Arial Black",
                fontSize: "36px",
                color: "#ffff00",
                stroke: "#000000",
                strokeThickness: 6,
            })
            .setOrigin(0.5)
            .setDepth(1001)
            .setScrollFactor(0);

        // Create subtitle
        this.add
            .text(this.cameras.main.width / 2, 100, "Choose an upgrade:", {
                fontFamily: "Arial",
                fontSize: "24px",
                color: "#ffffff",
                stroke: "#000000",
                strokeThickness: 4,
            })
            .setOrigin(0.5)
            .setDepth(1001)
            .setScrollFactor(0);

        // Create upgrade options
        const optionWidth = isMobile ? this.cameras.main.width : 300;
        const optionHeight = isMobile ? 180 : 200;
        const spacing = isMobile ? 20 : 50;
        const startX = isMobile
            ? 0
            : (this.cameras.main.width - (optionWidth * 3 + spacing * 2)) / 2;
        const startY = isMobile ? 150 : 250;

        upgrades.forEach((upgrade, index) => {
            const x = isMobile
                ? startX
                : startX + (optionWidth + spacing) * index;
            const y = isMobile
                ? startY + (optionHeight + spacing) * index
                : startY;

            // Create container for the upgrade option
            const container = this.add.container(x, y);
            container.setDepth(1001);
            container.setScrollFactor(0);

            // Create background for the option
            const optionBg = this.add
                .rectangle(
                    optionWidth / 2,
                    optionHeight / 2,
                    optionWidth,
                    optionHeight,
                    0x333333
                )
                .setStrokeStyle(2, 0xffff00)
                .setInteractive({ useHandCursor: true })
                .setSize(optionWidth, optionHeight)
                .on("pointerover", () => {
                    if (!this.isSelectionMade) {
                        optionBg.setStrokeStyle(3, 0xffffff);
                    }
                })
                .on("pointerout", () => {
                    if (!this.isSelectionMade) {
                        optionBg.setStrokeStyle(2, 0xffff00);
                    }
                })
                .on("pointerdown", () => {
                    if (!this.isSelectionMade) {
                        this.selectUpgrade(upgrade);
                    } else {
                        console.log("Selection already made, ignoring click");
                    }
                });

            // Create title for the option
            const title = this.add
                .text(optionWidth / 2, 30, upgrade.name, {
                    fontFamily: "Arial",
                    fontSize: isMobile ? "20px" : "24px",
                    color: "#ffffff",
                    stroke: "#000000",
                    strokeThickness: 4,
                    align: "center",
                })
                .setOrigin(0.5);

            // Get current stats for before/after comparison
            const currentStats = this.getCurrentStats();
            const afterStats = this.getAfterStats(upgrade);

            // Create description with before/after values
            const description = this.createUpgradeDescription(
                upgrade,
                currentStats,
                afterStats,
                isMobile,
                optionWidth
            );

            // Add all elements to the container
            container.add([optionBg, title, description]);
            this.upgradeOptions.push(container);
        });
    }

    private getCurrentStats(): UpgradeStats {
        let weaponDamage = GameConstants.WEAPONS.BASIC_DAMAGE;
        let weaponSpeed = GameConstants.WEAPONS.BASIC_ATTACK_SPEED;
        let projectileSpeed = GameConstants.WEAPONS.BASIC_PROJECTILE_SPEED;

        // Try to get current weapon stats if available
        const gameScene = this.scene.manager.getScene('Game') as Game;
        if (gameScene && gameScene.getWeaponSystem) {
            const weaponSystem = gameScene.getWeaponSystem();
            const weapons = weaponSystem.getWeapons();
            const currentWeapon = weapons[0];
            
            if (currentWeapon) {
                weaponDamage = currentWeapon.getDamage();
                weaponSpeed = currentWeapon.getAttackSpeed();
                projectileSpeed = currentWeapon.getProjectileSpeed();
            }
        }
        
        return {
            health: this.player.getStats().maxHealth,
            speed: this.player.getMovementSpeed(),
            weaponDamage,
            weaponSpeed,
            projectileSpeed,
        };
    }

    private getAfterStats(upgrade: Upgrade): UpgradeStats {
        const currentStats = this.getCurrentStats();

        // Calculate the after stats based on the upgrade type
        const afterStats: UpgradeStats = { ...currentStats };

        switch (upgrade.id) {
            case "health_boost":
                afterStats.health = Math.round(currentStats.health * 1.2);
                break;
            case "speed_boost":
                afterStats.speed = Math.round(currentStats.speed * 1.15);
                break;
            case "weapon_damage":
                afterStats.weaponDamage = Math.round(currentStats.weaponDamage * 1.25);
                break;
            case "weapon_speed":
                afterStats.weaponSpeed = Math.round(currentStats.weaponSpeed * 1.2);
                break;
            case "projectile_speed":
                afterStats.projectileSpeed = Math.round(currentStats.projectileSpeed * 1.3);
                break;
        }

        return afterStats;
    }

    private createUpgradeDescription(
        upgrade: Upgrade,
        currentStats: UpgradeStats,
        afterStats: UpgradeStats,
        isMobile: boolean,
        optionWidth: number
    ): GameObjects.Text {
        let description = "";

        switch (upgrade.id) {
            case "health_boost":
                description = `Health: ${Math.round(currentStats.health)} → ${Math.round(afterStats.health)}`;
                break;
            case "speed_boost":
                description = `Speed: ${Math.round(currentStats.speed)} → ${Math.round(afterStats.speed)}`;
                break;
            case "weapon_damage":
                description = `Damage: ${Math.round(currentStats.weaponDamage)} → ${Math.round(afterStats.weaponDamage)}`;
                break;
            case "weapon_speed":
                description = `Attack Speed: ${Math.round(currentStats.weaponSpeed)} → ${Math.round(afterStats.weaponSpeed)}`;
                break;
            case "projectile_speed":
                description = `Projectile Speed: ${Math.round(currentStats.projectileSpeed)} → ${Math.round(afterStats.projectileSpeed)}`;
                break;
            case "health_regen":
                description = "Regenerate 1% of max health every 5 seconds";
                break;
            default:
                description = upgrade.description;
        }

        // Create the text object with the description
        return this.add
            .text(optionWidth / 2, 80, description, {
                fontFamily: "Arial",
                fontSize: isMobile ? "16px" : "18px",
                color: "#ffffff",
                stroke: "#000000",
                strokeThickness: 3,
                align: "center",
                wordWrap: { width: optionWidth - 20 },
            })
            .setOrigin(0.5);
    }

    private selectUpgrade(upgrade: Upgrade): void {
        this.isSelectionMade = true;
        this.selectedUpgrade = upgrade;

        // Highlight the selected option
        const selectedIndex = this.upgradeOptions.findIndex((container) => {
            const bg = container.getAt(0) as GameObjects.Rectangle;
            return (
                bg && bg.input && bg.input.hitAreaCallback(bg.input.hitArea, 0, 0, bg)
            );
        });


        if (selectedIndex !== -1) {
            const selectedContainer = this.upgradeOptions[selectedIndex];
            const selectedBg = selectedContainer.getAt(
                0
            ) as GameObjects.Rectangle;
            selectedBg.setStrokeStyle(4, 0x00ff00);
        }

        // Apply the upgrade
        upgrade.effect(this.player);

        this.resumeGame();
    }

    private resumeGame(): void {
        // Emit event directly to the game scene
        this.scene.get('Game').events.emit("level_up_selection_complete", this.selectedUpgrade);
        
        // Clean up the scene before stopping it
        this.destroy();
        
        // Stop this scene and resume the game scene
        this.scene.stop();
    }

    destroy(): void {
        
        // Remove event listeners
        this.events.off("pause");
        this.events.off("resume");
        
        // Clean up all game objects
        if (this.background) this.background.destroy();
        if (this.title) this.title.destroy();
        
        // Clean up all upgrade options
        this.upgradeOptions.forEach((container) => {
            container.destroy();
        });
        this.upgradeOptions = [];
        
        // Reset state
        this.selectedUpgrade = null;
        this.isSelectionMade = false;
        
        // Disable input
        this.input.enabled = false;
    }
}
