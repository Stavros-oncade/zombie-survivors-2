import { Player } from '../entities/Player';
import { Upgrade, UpgradeId } from '../types/GameTypes';
import { SceneKey } from '../config/SceneKeys';
import { RELICS, Relic } from './RelicSystem';
import { Game } from '../scenes/Game';

export class UpgradeSystem {
    private static availableUpgrades: Upgrade[] = [
        {
            id: UpgradeId.HEALTH_BOOST,
            name: 'Health Boost',
            description: 'Increase your maximum health by 20%',
            effect: (player: Player) => {
                const currentMaxHealth = player.getStats().maxHealth;
                player.setMaxHealth(Math.floor(currentMaxHealth * 1.2));
                player.heal(Math.floor(currentMaxHealth * 0.2)); // Heal by the amount increased
            }
        },
        {
            id: UpgradeId.SPEED_BOOST,
            name: 'Speed Boost',
            description: 'Increase your movement speed by 15%',
            effect: (player: Player) => {
                // Asymptotically approach max movement speed
                player.applyAsymptoticSpeedIncrease(1.15);
            }
        },
        {
            id: UpgradeId.WEAPON_DAMAGE,
            name: 'Weapon Damage',
            description: 'Increase your weapon damage by 25%',
            effect: (player: Player) => {
                player.upgradeWeaponDamage(1.25);
            }
        },
        {
            id: UpgradeId.WEAPON_SPEED,
            name: 'Weapon Speed',
            description: 'Increase your weapon attack speed by 20%',
            effect: (player: Player) => {
                player.upgradeWeaponSpeed(1.2);
            }
        },
        {
            id: UpgradeId.HEALTH_REGEN,
            name: 'Health Regeneration',
            description: 'Regenerate 1% of max health every 5 seconds',
            effect: (player: Player) => {
                player.enableHealthRegeneration(0.01, 5000);
            }
        },
        {
            id: UpgradeId.PIERCING_SHOT,
            name: 'Piercing Shot',
            description: 'Unlocks or upgrades a piercing projectile weapon',
            effect: (player: Player) => {
                const sc = player.scene?.scene?.get(SceneKey.Game);
                if (sc && sc instanceof Game) {
                    sc.getWeaponSystem().unlockPiercing();
                }
            }
        },
        {
            id: UpgradeId.EXPLOSIVE_BURST,
            name: 'Explosive Burst',
            description: 'Unlocks or upgrades a short-range explosive burst',
            effect: (player: Player) => {
                const sc = player.scene?.scene?.get(SceneKey.Game);
                if (sc && sc instanceof Game) {
                    sc.getWeaponSystem().unlockExplosive();
                }
            }
        },
        {
            id: UpgradeId.PROJECTILE_SPEED,
            name: 'Projectile Speed',
            description: 'Increase projectile speed by 30%',
            effect: (player: Player) => {
                player.upgradeProjectileSpeed(1.3);
            }
        }
    ];

    public static getRandomUpgrades(count: number): Upgrade[] {
        // Create a copy of the available upgrades
        const available = [...this.availableUpgrades];
        const selected: Upgrade[] = [];
        
        // Select random upgrades
        for (let i = 0; i < count && available.length > 0; i++) {
            const randomIndex = Math.floor(Math.random() * available.length);
            selected.push(available[randomIndex]);
            available.splice(randomIndex, 1);
        }
        
        return selected;
    }

    // Convert relics into Upgrade-like choices that grant relics
    public static getRandomRelicUpgrades(count: number): Upgrade[] {
        return this.getRandomRelicUpgradesFiltered(count);
    }

    public static getRandomRelicUpgradesFiltered(count: number, acquired?: Set<string>): Upgrade[] {
        // Weighted selection from RELICS, skipping acquired
        const working = RELICS.filter(r => !acquired || !acquired.has(r.id));
        const selected: Relic[] = [];
        while (selected.length < count && working.length > 0) {
            const totalWeight = working.reduce((sum, r) => sum + r.weight, 0);
            let roll = Math.random() * totalWeight;
            let pickIndex = 0;
            for (let i = 0; i < working.length; i++) {
                roll -= working[i].weight;
                if (roll <= 0) { pickIndex = i; break; }
            }
            const pick = working.splice(pickIndex, 1)[0];
            selected.push(pick);
        }
        return selected.map(r => ({
            id: `relic_${r.id}`,
            name: `${r.name} [${r.rarity}]`,
            description: r.description,
            effect: (player: Player) => {
                const sc = player.scene?.scene?.get(SceneKey.Game);
                if (sc && sc instanceof Game) {
                    sc.getRelicSystem().acquireRelic(r.id);
                }
            }
        }));
    }
} 
