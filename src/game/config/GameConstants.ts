export const GameConstants = {
    PLAYER: {
        INITIAL_HEALTH: 100,
        MOVEMENT_SPEED: 200,
        MAX_MOVEMENT_SPEED: 400,
        INITIAL_WEAPONS: ['basicWeapon']
    },
    ENEMIES: {
        SPAWN_RATE: 1000,
        INITIAL_SPEED: 90,
        BASE_HEALTH: 40,
        INITIAL_SPAWN_DELAY: 2000,
        MIN_SPAWN_DELAY: 500,
        PICKUP_DROP_RATE: 0.15,
        DOUBLE_SPEED_CHANCE: 0.02,        // 2% rare spawn
        DOUBLE_SPEED_MULTIPLIER: 2,       // 2x base type speed
        DOUBLE_SPEED_OUTLINE_COLOR: 0xff0000
    },
    WEAPONS: {
        BASIC_DAMAGE: 20,
        BASIC_ATTACK_SPEED: 3,
        // Hard cap for the Weapon Speed stat upgrade. Base 3 grows x1.2 per pick
        // (3 -> 3.6 -> 4.32 -> 5.18 -> 6+), so this allows a handful of meaningful
        // upgrades before the stat is maxed and dropped from the level-up pool.
        MAX_ATTACK_SPEED: 6,
        BASIC_PROJECTILE_SPEED: 500
    },
    EXPERIENCE: {
        BASE_XP_REQUIREMENT: 200,
        XP_SCALING_FACTOR: 1.5
    }
};
