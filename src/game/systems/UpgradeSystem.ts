import { Player } from '../entities/Player';
import { Upgrade } from '../types/GameTypes';
import { GameConstants } from '../config/GameConstants';

export class UpgradeSystem {
    private static availableUpgrades: Upgrade[] = [
        {
            id: 'health_boost',
            name: 'Health Boost',
            description: 'Increase your maximum health by 20%',
            effect: (player: Player) => {
                const currentMaxHealth = player.getStats().maxHealth;
                player.setMaxHealth(Math.floor(currentMaxHealth * 1.2));
                player.heal(Math.floor(currentMaxHealth * 0.2)); // Heal by the amount increased
            }
        },
        {
            id: 'speed_boost',
            name: 'Speed Boost',
            description: 'Increase your movement speed by 15%',
            effect: (player: Player) => {
                player.setMovementSpeed(player.getMovementSpeed() * 1.15);
            }
        },
        {
            id: 'weapon_damage',
            name: 'Weapon Damage',
            description: 'Increase your weapon damage by 25%',
            effect: (player: Player) => {
                player.upgradeWeaponDamage(1.25);
            }
        },
        {
            id: 'weapon_speed',
            name: 'Weapon Speed',
            description: 'Increase your weapon attack speed by 20%',
            effect: (player: Player) => {
                player.upgradeWeaponSpeed(1.2);
            }
        },
        {
            id: 'health_regen',
            name: 'Health Regeneration',
            description: 'Regenerate 1% of max health every 5 seconds',
            effect: (player: Player) => {
                player.enableHealthRegeneration(0.01, 5000);
            }
        },
        {
            id: 'projectile_speed',
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
} 