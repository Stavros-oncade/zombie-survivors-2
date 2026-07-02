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

export enum CharacterId {
    SOLDIER = 'soldier',
    SCOUT = 'scout',
    DEMOLITIONIST = 'demolitionist'
}

export enum DefensiveSkillId {
    DASH = 'dash',
    BARRIER = 'barrier',
    REPULSE = 'repulse'
}

export enum KillstreakPerkId {
    DAMAGE = 'damage',
    XP = 'xp',
    SPEED = 'speed'
}

export enum EnemyType {
    BASIC = 'basic',
    FAST = 'fast',
    TANK = 'tank',
    RANGED = 'ranged',
    CARRIER = 'carrier',
    TOXIC = 'toxic',
    SHRIEKER = 'shrieker'
}

export enum PickupType {
    HEALTH = 'health',
    SPEED = 'speed',
    DAMAGE = 'damage',
    EXPERIENCE = 'experience',
    BOMB = 'bomb',
    AIRSTRIKE = 'airstrike',
    FLARE = 'flare',
    FIRE_RING = 'fire_ring'
}

export enum RelicRarity {
    COMMON = 'common',
    RARE = 'rare',
    EPIC = 'epic',
    LEGENDARY = 'legendary'
}

export enum EliteState {
    CHASE = 'chase',
    TELEGRAPH = 'telegraph',
    CHARGE = 'charge'
}

export enum EliteAffix {
    MOLTEN = 'molten',
    SHIELDED = 'shielded',
    FROST = 'frost'
}

export enum RangedVariant {
    SINGLE = 'single',
    BURST = 'burst',
    ARC = 'arc'
}

// Tag data attached to toxic gas cloud graphics for cleanup and interactions
export interface GasCloudTag {
    __gasX: number;
    __gasY: number;
    __gasRadius: number;
    __gasTick?: Phaser.Time.TimerEvent;
}

// Spawn system enums
export enum SpawnState {
    NORMAL = 'normal',
    PEAK = 'peak',
    COOLDOWN = 'cooldown',
    RANGED_PACK = 'ranged_pack',
    CARRIER_PACK = 'carrier_pack',
    TOXIC_PACK = 'toxic_pack'
}

export enum ClusterType {
    RANDOM = 'random',
    SAME_SIDE = 'sameSide',
    PINCER = 'pincer',
    AROUND = 'around'
}

// Upgrade identifiers
export enum UpgradeId {
    HEALTH_BOOST = 'health_boost',
    SPEED_BOOST = 'speed_boost',
    WEAPON_DAMAGE = 'weapon_damage',
    WEAPON_SPEED = 'weapon_speed',
    HEALTH_REGEN = 'health_regen',
    PIERCING_SHOT = 'piercing_shot',
    EXPLOSIVE_BURST = 'explosive_burst',
    ORBITAL_SHIELD = 'orbital_shield',
    PROJECTILE_SPEED = 'projectile_speed',
    SKILL_MASTERY = 'skill_mastery',
    LIFESTEAL = 'lifesteal'
}
