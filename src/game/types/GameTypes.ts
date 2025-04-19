export interface PlayerStats {
    health: number;
    maxHealth: number;
    level: number;
    experience: number;
    experienceToNextLevel: number;
}

export interface UpgradeStats {
    health: number;
    speed: number;
    weaponDamage: number;
    weaponSpeed: number;
    projectileSpeed: number;
}

export interface WeaponConfig {
    damage: number;
    attackSpeed: number;
    projectileSpeed: number;
    level: number;
    evolutionLevel: number;
}

export interface Upgrade {
    id: string;
    name: string;
    description: string;
    effect: (player: any) => void;
}

export interface UpgradeOption {
    upgrade: Upgrade;
    container: Phaser.GameObjects.Container;
}

export enum EnemyType {
    BASIC = 'basic',
    FAST = 'fast',
    TANK = 'tank'
}

export enum PickupType {
    HEALTH = 'health',
    SPEED = 'speed',
    DAMAGE = 'damage',
    EXPERIENCE = 'experience',
    BOMB = 'bomb'
} 