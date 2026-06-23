import { Player } from '../entities/Player';
import { Upgrade, UpgradeId } from '../types/GameTypes';
import { SceneKey } from '../config/SceneKeys';
import { RELICS, Relic } from './RelicSystem';
import { Game } from '../scenes/Game';
import { WEAPON_CATALOG, WeaponUnlockTier } from '../weapons/WeaponCatalog';

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
            id: UpgradeId.PROJECTILE_SPEED,
            name: 'Projectile Speed',
            description: 'Increase projectile speed by 30%',
            effect: (player: Player) => {
                player.upgradeProjectileSpeed(1.3);
            }
        },
        {
            id: UpgradeId.SKILL_MASTERY,
            name: 'Tactical Training',
            description: 'Reduce your defensive skill cooldown and amplify its effect',
            effect: (player: Player) => {
                const sc = player.scene?.scene?.get(SceneKey.Game);
                if (sc && sc instanceof Game) {
                    sc.getSkillSystem().levelUp();
                }
            }
        }
    ];

    // Weapon-unlock offers generated from the catalog (replaces the old
    // hand-written PIERCING_SHOT / EXPLOSIVE_BURST / ORBITAL_SHIELD entries).
    // STARTER is excluded (always owned); per-tier eligibility is enforced by the
    // caller's excludeIds (Game.getCappedUpgradeIds via isWeaponUnlocked).
    private static weaponUpgrades(): Upgrade[] {
        return WEAPON_CATALOG
            .filter(w => w.tier !== WeaponUnlockTier.STARTER)
            .map(w => ({
                id: w.id,
                name: w.name,
                description: w.description,
                effect: (player: Player) => {
                    const sc = player.scene?.scene?.get(SceneKey.Game);
                    if (sc && sc instanceof Game) sc.getWeaponSystem().unlockWeapon(w.id);
                },
            }));
    }

    /** Look up a base (non-relic, non-weapon) upgrade by id. Used by the Long Recon
     *  carry-state re-apply (§5.3): relic/weapon picks are carried by their own
     *  systems, so only these stat upgrades need id-addressable replay here. */
    public static getById(id: string): Upgrade | undefined {
        return this.availableUpgrades.find(u => u.id === id);
    }

    /** Re-apply a carried base upgrade to the player at a node start (§5.3). No-op
     *  for ids that aren't base upgrades (relics/weapons re-apply elsewhere). */
    public static reapply(player: Player, id: string): void {
        this.getById(id)?.effect(player);
    }

    public static getRandomUpgrades(count: number, excludeIds?: Set<string>): Upgrade[] {
        // Create a copy of the available upgrades, skipping any excluded ids
        // (e.g. unlock-style upgrades that have already hit their cap, or
        // weapons not yet unlocked for the player).
        const pool = [...this.availableUpgrades, ...this.weaponUpgrades()];
        const available = pool.filter(u => !excludeIds || !excludeIds.has(u.id));
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
        // Level-up path: not from a chest, so legendaries are excluded.
        return this.getRandomRelicUpgradesFiltered(count, undefined, { fromChest: false });
    }

    public static getRandomRelicUpgradesFiltered(
        count: number,
        acquired?: Set<string>,
        ctx?: { playTimeSec?: number; level?: number; fromChest?: boolean }
    ): Upgrade[] {
        const fromChest = ctx?.fromChest ?? false;
        const playTimeSec = ctx?.playTimeSec ?? 0;
        // Weighted selection from RELICS, skipping acquired and applying gates.
        const working = RELICS.filter(r => {
            if (acquired && acquired.has(r.id)) return false;
            // chest-only relics never appear from a normal level-up.
            if (r.chestOnly && !fromChest) return false;
            // time-gated relics only appear after their threshold.
            if (r.minPlayTimeSec !== undefined && playTimeSec < r.minPlayTimeSec) return false;
            return true;
        });
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
