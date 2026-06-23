import { Scene } from 'phaser';
import { Player } from '../entities/Player';
import { Weapon } from '../weapons/Weapon';
import { GameConstants } from '../config/GameConstants';
import { Enemy } from '../entities/Enemy';
import { IWeapon } from '../weapons/IWeapon';
import { EVOLUTION_RECIPES, EvolutionRecipe } from '../weapons/EvolutionRecipes';
import { getWeaponDef, WEAPON_CATALOG } from '../weapons/WeaponCatalog';
import { getWeaponFactory } from '../weapons/WeaponFactory';
import type { Game } from '../scenes/Game';

export class WeaponSystem {
    private scene: Scene;
    private player: Player;
    private weapons: IWeapon[];
    private enemies: Phaser.Physics.Arcade.Group;

    constructor(scene: Scene, player: Player, enemies: Phaser.Physics.Arcade.Group) {
        this.scene = scene;
        this.player = player;
        this.enemies = enemies;
        this.weapons = [
            new Weapon(scene, {
                damage: GameConstants.WEAPONS.BASIC_DAMAGE,
                attackSpeed: GameConstants.WEAPONS.BASIC_ATTACK_SPEED,
                projectileSpeed: GameConstants.WEAPONS.BASIC_PROJECTILE_SPEED,
                level: 1
            })
        ];
    }

    public update(): void {
        // Per-frame movement/update hook runs regardless of the enemy gate so
        // companion weapons (e.g. Sentry Drone) keep moving when no enemies exist.
        const dt = this.scene.game.loop.delta;
        this.weapons.forEach(weapon => weapon.update?.(this.scene, this.player, dt));

        // Get enemies that are actually in the scene
        const activeEnemies = this.enemies.getChildren().filter(enemy => enemy.active) as Enemy[];

        if (activeEnemies.length > 0) {
            this.weapons.forEach(weapon => {
                weapon.fire(this.scene, this.player, activeEnemies);
            });
        }
    }

    public destroy(): void {
        // Let summon weapons (drones, mines, orbs) tear down their cached sprites
        // so a run teardown doesn't leak them. The hook is optional on IWeapon.
        this.weapons.forEach(w => (w as { dispose?: () => void }).dispose?.());
        this.weapons = [];
    }

    public upgradeWeaponDamage(multiplier: number): void {
        this.weapons.forEach(weapon => weapon.upgradeDamage(multiplier));
    }

    public upgradeWeaponSpeed(multiplier: number): void {
        this.weapons.forEach(weapon => weapon.upgradeSpeed(multiplier));
    }

    /** True once the basic weapon's attack speed has hit its hard cap, so the
     *  Weapon Speed level-up choice can be dropped from the pool (no more 4 -> 4).
     *  weapons[0] is the always-present basic Weapon (mirrors LevelUpSelection's
     *  stat preview, which reads weapons[0]). */
    public isWeaponSpeedMaxed(): boolean {
        const basic = this.weapons[0];
        return basic instanceof Weapon && basic.isAttackSpeedMaxed();
    }

    public upgradeProjectileSpeed(multiplier: number): void {
        this.weapons.forEach(weapon => weapon.upgradeProjectileSpeed(multiplier));
    }

    // Temporary damage overlay control for timed buffs (non-compounding)
    public setTempDamageMultiplier(multiplier: number): void {
        this.weapons.forEach(weapon => weapon.setTempDamageMultiplier(multiplier));
    }

    public getWeapons(): IWeapon[] { return this.weapons; }

    /**
     * Data-driven unlock: find an existing instance of the catalog weapon's class
     * and upgrade it, else create a fresh level-1 instance from the catalog
     * factory. Replaces the old bespoke unlock* methods (now thin shims below).
     */
    public unlockWeapon(id: string): void {
        const def = getWeaponDef(id);
        const factory = getWeaponFactory(id);
        if (!def || !factory) return;
        const existing = this.weapons.find(w => w instanceof factory.weaponClass);
        if (existing) existing.upgrade();
        else this.weapons.push(factory.create(this.scene));
        this.checkEvolution();
    }

    public ownsWeapon(id: string): boolean {
        const factory = getWeaponFactory(id);
        return !!factory && this.weapons.some(w => w instanceof factory.weaponClass);
    }

    /** Live upgrade info for an owned catalog weapon (level-up card preview), or
     *  null if the weapon isn't owned yet. `preview` is the per-weapon delta string
     *  (null for weapons that don't implement getUpgradePreview). */
    public getWeaponUpgradeInfo(id: string): { level: number; preview: string | null } | null {
        const factory = getWeaponFactory(id);
        if (!factory) return null;
        const existing = this.weapons.find(w => w instanceof factory.weaponClass);
        if (!existing) return null;
        return { level: existing.getLevel(), preview: existing.getUpgradePreview?.() ?? null };
    }

    /** Catalog ids of all currently-owned weapons (Long Recon carry-state, §5). The
     *  basic/starter weapon has no catalog def and is always present, so it is
     *  intentionally omitted — only unlocked weapons need re-applying at node start. */
    public getUnlockedIds(): string[] {
        const ids: string[] = [];
        for (const def of WEAPON_CATALOG) {
            const factory = getWeaponFactory(def.id);
            if (factory && this.weapons.some(w => w instanceof factory.weaponClass)) ids.push(def.id);
        }
        return ids;
    }

    /** Re-unlock a weapon by catalog id (carry-state re-apply at node start, §5.3). */
    public unlockById(id: string): void {
        this.unlockWeapon(id);
    }

    // Backward-compatible shims so existing callers (BlueprintSystem, character
    // loadout) keep working through the single source of truth.
    public unlockPiercing(): void { this.unlockWeapon('piercing_shot'); }
    public unlockExplosive(): void { this.unlockWeapon('explosive_burst'); }
    public unlockOrbital(): void { this.unlockWeapon('orbital_shield'); }

    // Public wrapper so relic effects (e.g. Singularity Core) can trigger an
    // immediate re-evaluation when a relic that gates an evolution is acquired.
    public checkEvolutionPublic(): void {
        this.checkEvolution();
    }

    private checkEvolution(): void {
        for (const recipe of EVOLUTION_RECIPES) {
            if (this.tryEvolve(recipe)) {
                // Re-scan from the top: removing bases can satisfy/invalidate
                // others. Cheap (table is tiny) and keeps behavior deterministic.
                return this.checkEvolution();
            }
        }
    }

    private tryEvolve(recipe: EvolutionRecipe): boolean {
        // Already have the result? skip.
        if (this.weapons.some(w => w instanceof recipe.resultClass)) return false;

        // Relic gate (optional). Game owns RelicSystem.
        if (recipe.requiresRelicId) {
            const relics = (this.scene as Game).getRelicSystem?.();
            if (!relics || !relics.hasRelic(recipe.requiresRelicId)) return false;
        }

        // Match every required weapon at >= minLevel, capturing the instances.
        const sources: IWeapon[] = [];
        for (const req of recipe.requires) {
            const inst = this.weapons.find(w => w instanceof req.weapon) as IWeapon | undefined;
            if (!inst || inst.getLevel() < req.minLevel) return false;
            sources.push(inst);
        }

        // Consume the source weapons and add the evolved one.
        const consume = recipe.requires.map(r => r.weapon);
        this.weapons = this.weapons.filter(w => !consume.some(c => w instanceof c));
        this.weapons.push(recipe.build(this.scene, sources));
        this.scene.events.emit('weapon_evolved', recipe.resultName);
        return true;
    }
}
