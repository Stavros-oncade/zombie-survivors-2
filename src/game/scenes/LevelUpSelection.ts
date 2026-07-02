import { Scene, GameObjects } from "phaser";
import { Player } from "../entities/Player";
import { Upgrade, UpgradeStats, UpgradeId } from "../types/GameTypes";
import { GameConstants } from "../config/GameConstants";
import { Game } from "./Game";
import { SceneKey } from "../config/SceneKeys";
import { SkillSystem } from "../systems/SkillSystem";
import { getWeaponDef } from "../weapons/WeaponCatalog";

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
        const cx = this.cameras.main.width / 2;
        const isMobile = this.cameras.main.width < 768;

        // Dimmed backdrop — slightly stronger than before so any residual
        // celebration FX underneath can't bleed through the menu.
        this.background = this.add
            .rectangle(
                0,
                0,
                this.cameras.main.width,
                this.cameras.main.height,
                0x000000,
                0.9
            )
            .setOrigin(0, 0)
            .setDepth(1000)
            .setScrollFactor(0);

        // --- Header: one title, one subtitle, cleanly stacked (no overlap) ---
        const titleY = isMobile ? 40 : 64;
        this.title = this.add
            .text(cx, titleY, "LEVEL UP!", {
                fontFamily: "Arial Black",
                fontSize: isMobile ? "30px" : "40px",
                color: "#ffd34d",
                stroke: "#000000",
                strokeThickness: 6,
            })
            .setOrigin(0.5)
            .setDepth(1001)
            .setScrollFactor(0);
        if (this.title.preFX) {
            this.title.preFX.addGlow(0xffd34d, 4, 0, false, 0.1, 12);
        }

        this.add
            .text(cx, titleY + (isMobile ? 26 : 36), "Choose an upgrade", {
                fontFamily: "Arial",
                fontSize: isMobile ? "16px" : "20px",
                color: "#cfcfcf",
                stroke: "#000000",
                strokeThickness: 3,
            })
            .setOrigin(0.5)
            .setDepth(1001)
            .setScrollFactor(0);

        // --- Cards ---
        const optionWidth = isMobile
            ? Math.min(this.cameras.main.width - 32, 360)
            : 300;
        const optionHeight = isMobile ? 170 : 210;
        const spacing = isMobile ? 16 : 40;
        const pad = 16;
        const hw = optionWidth / 2;
        const hh = optionHeight / 2;

        // Card centres (origin-at-centre so hover/select can scale cleanly).
        const desktopRowX =
            (this.cameras.main.width - (optionWidth * 3 + spacing * 2)) / 2 + hw;
        const desktopRowY = this.cameras.main.height / 2 + 16;
        const mobileStackH =
            optionHeight * upgrades.length + spacing * (upgrades.length - 1);
        const mobileTop =
            Math.max(110, (this.cameras.main.height - mobileStackH) / 2) + hh;

        upgrades.forEach((upgrade, index) => {
            const cardCX = isMobile
                ? cx
                : desktopRowX + (optionWidth + spacing) * index;
            const cardCY = isMobile
                ? mobileTop + (optionHeight + spacing) * index
                : desktopRowY;
            const baseY = cardCY;

            const rarity = this.getRarity(upgrade);
            const displayName = upgrade.name
                .replace(/\s*\[(common|rare|epic|legendary)\]/i, "")
                .trim();

            const container = this.add
                .container(cardCX, cardCY)
                .setDepth(1001)
                .setScrollFactor(0);

            // Soft rarity glow behind the card
            const glow = this.add.graphics();
            glow.fillStyle(rarity.color, 0.1);
            glow.fillRoundedRect(-hw - 5, -hh - 5, optionWidth + 10, optionHeight + 10, 18);

            // Card body + framed icon chip + rarity divider
            const chip = 46;
            const chipCX = -hw + pad + chip / 2;
            const chipCY = -hh + pad + chip / 2;
            const dividerY = -hh + pad + chip + 14;
            const body = this.add.graphics();
            body.fillStyle(0x1c1c22, 0.98);
            body.fillRoundedRect(-hw, -hh, optionWidth, optionHeight, 14);
            body.fillStyle(rarity.color, 0.16);
            body.fillRoundedRect(chipCX - chip / 2, chipCY - chip / 2, chip, chip, 10);
            body.lineStyle(2, rarity.color, 0.9);
            body.strokeRoundedRect(chipCX - chip / 2, chipCY - chip / 2, chip, chip, 10);
            body.fillStyle(rarity.color, 0.5);
            body.fillRect(-hw + pad, dividerY, optionWidth - pad * 2, 2);

            // Redrawable border (rarity → white on hover → green on select)
            const border = this.add.graphics();
            const drawBorder = (color: number, thickness: number) => {
                border.clear();
                border.lineStyle(thickness, color, 1);
                border.strokeRoundedRect(-hw, -hh, optionWidth, optionHeight, 14);
            };
            drawBorder(rarity.color, 2);

            // Icon image seated inside the chip (never overlaps the name)
            const iconKey = this.getIconKeyForUpgrade(upgrade);
            let icon: GameObjects.Image | null = null;
            if (iconKey && this.textures.exists(iconKey)) {
                icon = this.add
                    .image(chipCX, chipCY, iconKey)
                    .setOrigin(0.5)
                    .setDisplaySize(30, 30);
            }

            // Name — left-aligned beside the chip, wraps to its own column
            const nameX = chipCX + chip / 2 + 12;
            const name = this.add
                .text(nameX, chipCY, displayName, {
                    fontFamily: "Arial Black",
                    fontSize: isMobile ? "18px" : "20px",
                    color: "#ffffff",
                    stroke: "#000000",
                    strokeThickness: 3,
                    wordWrap: { width: hw - pad - nameX },
                    lineSpacing: 2,
                })
                .setOrigin(0, 0.5);

            // Rarity caption under the divider
            const caption = this.add
                .text(-hw + pad, dividerY + 16, rarity.label, {
                    fontFamily: "Arial",
                    fontSize: "12px",
                    color: this.toHex(rarity.color),
                    fontStyle: "bold",
                })
                .setOrigin(0, 0.5);

            // Description — centre-anchored in the lower half so 1-line and
            // multi-line entries both read consistently (no cramped wrap).
            const descCenterY = (dividerY + 24 + (hh - pad)) / 2;
            const description = this.add
                .text(0, descCenterY, this.buildDescription(upgrade), {
                    fontFamily: "Arial",
                    fontSize: isMobile ? "15px" : "17px",
                    color: "#e6e6e6",
                    align: "center",
                    wordWrap: { width: optionWidth - pad * 2 - 4 },
                    lineSpacing: 4,
                })
                .setOrigin(0.5, 0.5);

            // Transparent hit zone on top captures all input for the card
            const hit = this.add
                .rectangle(0, 0, optionWidth, optionHeight, 0x000000, 0)
                .setInteractive({ useHandCursor: true })
                .on("pointerover", () => {
                    if (this.isSelectionMade) return;
                    drawBorder(0xffffff, 3);
                    this.tweens.add({
                        targets: container,
                        scaleX: 1.04,
                        scaleY: 1.04,
                        y: baseY - 6,
                        duration: 120,
                        ease: "Quad.easeOut",
                    });
                })
                .on("pointerout", () => {
                    if (this.isSelectionMade) return;
                    drawBorder(rarity.color, 2);
                    this.tweens.add({
                        targets: container,
                        scaleX: 1,
                        scaleY: 1,
                        y: baseY,
                        duration: 120,
                        ease: "Quad.easeOut",
                    });
                })
                .on("pointerdown", () => {
                    if (this.isSelectionMade) return;
                    this.selectUpgrade(upgrade, { container, drawBorder, baseY });
                });

            const toAdd = [glow, body, border, icon, name, caption, description, hit]
                .filter(Boolean) as GameObjects.GameObject[];
            container.add(toAdd);
            this.upgradeOptions.push(container);
        });
    }

    private getCurrentStats(): UpgradeStats {
        let weaponDamage = GameConstants.WEAPONS.BASIC_DAMAGE;
        let weaponSpeed = GameConstants.WEAPONS.BASIC_ATTACK_SPEED;
        let projectileSpeed = GameConstants.WEAPONS.BASIC_PROJECTILE_SPEED;

        // Try to get current weapon stats if available
        const gameScene = this.scene.manager.getScene(SceneKey.Game) as Game;
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
            case UpgradeId.HEALTH_BOOST:
                afterStats.health = Math.round(currentStats.health * 1.2);
                break;
            case UpgradeId.SPEED_BOOST:
                afterStats.speed = Math.round(currentStats.speed * 1.15);
                break;
            case UpgradeId.WEAPON_DAMAGE:
                afterStats.weaponDamage = Math.round(currentStats.weaponDamage * 1.25);
                break;
            case UpgradeId.WEAPON_SPEED:
                afterStats.weaponSpeed = Math.round(currentStats.weaponSpeed * 1.2);
                break;
            case UpgradeId.PROJECTILE_SPEED:
                afterStats.projectileSpeed = Math.round(currentStats.projectileSpeed * 1.3);
                break;
        }

        return afterStats;
    }

    /** Build the effect-summary string for a card. Base stats render a concrete
     *  before → after; weapons/relics fall back to their catalog wording. */
    private buildDescription(upgrade: Upgrade): string {
        const currentStats = this.getCurrentStats();
        const afterStats = this.getAfterStats(upgrade);

        switch (upgrade.id) {
            case UpgradeId.HEALTH_BOOST:
                return `Health  ${Math.round(currentStats.health)} → ${Math.round(afterStats.health)}`;
            case UpgradeId.SPEED_BOOST:
                return `Speed  ${Math.round(currentStats.speed)} → ${Math.round(afterStats.speed)}`;
            case UpgradeId.WEAPON_DAMAGE:
                return `Damage  ${Math.round(currentStats.weaponDamage)} → ${Math.round(afterStats.weaponDamage)}`;
            case UpgradeId.WEAPON_SPEED:
                return `Attack Speed  ${Math.round(currentStats.weaponSpeed)} → ${Math.round(afterStats.weaponSpeed)}`;
            case UpgradeId.PROJECTILE_SPEED:
                return `Projectile Speed  ${Math.round(currentStats.projectileSpeed)} → ${Math.round(afterStats.projectileSpeed)}`;
            case UpgradeId.HEALTH_REGEN:
                return "Regenerate 1% of max health every 5 seconds";
            case UpgradeId.SKILL_MASTERY:
                return this.getSkillMasteryDescription();
            default:
                return this.getWeaponDescription(upgrade) ?? upgrade.description;
        }
    }

    private getSkillMasteryDescription(): string {
        const gameScene = this.scene.manager.getScene(SceneKey.Game) as Game | undefined;
        const skillSystem = gameScene?.getSkillSystem?.();
        if (!skillSystem) {
            return "Reduce defensive skill cooldown";
        }
        const currentMs = skillSystem.getCooldownTotalMs();
        // Mirror SkillSystem.levelUp() to preview the next level's cooldown.
        const nextLevel = Math.min(SkillSystem.MAX_LEVEL, skillSystem.getLevel() + 1);
        const nextMs = Math.max(400, 1200 - (nextLevel - 1) * 150);
        const currentSecs = (currentMs / 1000).toFixed(1);
        const nextSecs = (nextMs / 1000).toFixed(1);
        return `Skill Cooldown: ${currentSecs}s → ${nextSecs}s`;
    }

    /** For catalog-weapon offers, append the level transition and concrete deltas
     *  this pick will apply. Owned weapons read their live level + per-weapon deltas
     *  ("Lv N → N+1" / "Dmg +15% · Chains +1"); a first-time pick reads "New weapon".
     *  Returns null for non-weapon upgrades (relics/base stats). */
    private getWeaponDescription(upgrade: Upgrade): string | null {
        const def = getWeaponDef(upgrade.id);
        if (!def) return null;
        const gameScene = this.scene.manager.getScene(SceneKey.Game) as Game | undefined;
        const info = gameScene?.getWeaponSystem?.()?.getWeaponUpgradeInfo(upgrade.id) ?? null;
        if (!info) return `${upgrade.description}\nNew weapon`;
        const deltas = info.preview ? `\n${info.preview}` : '';
        return `${upgrade.description}\nLv ${info.level} → ${info.level + 1}${deltas}`;
    }

    private getIconKeyForUpgrade(upgrade: Upgrade): string | null {
        // For relics: id starts with 'relic_'
        if (upgrade.id.startsWith('relic_')) {
            return upgrade.id; // expects keys like 'relic_greed'
        }
        // Catalog weapons resolve their icon from the registry (single source of
        // truth) — covers piercing/explosive/orbital plus all new weapons.
        const def = getWeaponDef(upgrade.id);
        if (def) return def.iconKey;
        switch (upgrade.id) {
            case 'projectile_speed': return 'upgrade_projectile';
            case 'weapon_damage': return 'upgrade_weapon_damage';
            case 'weapon_speed': return 'upgrade_weapon_speed';
            case 'speed_boost': return 'upgrade_speed';
            case 'health_boost': return 'upgrade_health';
            case 'lifesteal': return 'upgrade_lifesteal';
            default: return null;
        }
    }

    /** Resolve a display rarity (colour + label) for any offer. Relics embed
     *  "[rarity]" in their name; weapons read as RARE; base stats as COMMON.
     *  Drives the card border, glow, divider, chip frame, and caption. */
    private getRarity(upgrade: Upgrade): { color: number; label: string } {
        const m = upgrade.name.match(/\[(common|rare|epic|legendary)\]/i);
        const key = m
            ? m[1].toLowerCase()
            : getWeaponDef(upgrade.id)
              ? 'rare'
              : 'common';
        switch (key) {
            case 'legendary': return { color: 0xffc107, label: 'LEGENDARY' };
            case 'epic': return { color: 0xbf5af2, label: 'EPIC' };
            case 'rare': return { color: 0x4da6ff, label: 'RARE' };
            default: return { color: 0xcccccc, label: 'COMMON' };
        }
    }

    private toHex(color: number): string {
        return '#' + color.toString(16).padStart(6, '0');
    }

    private selectUpgrade(
        upgrade: Upgrade,
        card?: {
            container: GameObjects.Container;
            drawBorder: (color: number, thickness: number) => void;
            baseY: number;
        }
    ): void {
        this.isSelectionMade = true;
        this.selectedUpgrade = upgrade;

        if (card) {
            // Confirm the pick: green border, dim the others for focus, and a
            // quick pulse before applying the effect and resuming.
            card.drawBorder(0x00ff66, 4);
            this.upgradeOptions.forEach((c) => {
                if (c !== card.container) {
                    this.tweens.add({ targets: c, alpha: 0.35, duration: 140 });
                }
            });
            this.tweens.add({
                targets: card.container,
                scaleX: 1.1,
                scaleY: 1.1,
                y: card.baseY - 8,
                duration: 90,
                yoyo: true,
                ease: "Quad.easeOut",
                onComplete: () => this.applyAndResume(upgrade),
            });
        } else {
            this.applyAndResume(upgrade);
        }
    }

    private applyAndResume(upgrade: Upgrade): void {
        // Apply the upgrade (guard if player died or scene was torn down)
        try {
            if (this.player && this.player.scene && this.player.active) {
                upgrade.effect(this.player);
            } else {
                console.warn('[LevelUpSelection] Player not available; skipping upgrade effect.');
            }
        } catch (err) {
            console.warn('[LevelUpSelection] Error applying upgrade effect:', err);
        }

        this.resumeGame();
    }

    private resumeGame(): void {
        // Emit event to the game scene if present
        const gameScene = this.scene.manager.getScene(SceneKey.Game) as Game | undefined;
        if (gameScene && gameScene.events) {
            gameScene.events.emit("level_up_selection_complete", this.selectedUpgrade);
        }
        
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
