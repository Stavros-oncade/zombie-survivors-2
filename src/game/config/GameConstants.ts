export const GameConstants = {
    PLAYER: {
        INITIAL_HEALTH: 100,
        MOVEMENT_SPEED: 200,
        INITIAL_WEAPONS: ['basicWeapon']
    },
    ENEMIES: {
        SPAWN_RATE: 1000,
        INITIAL_SPEED: 90,
        BASE_HEALTH: 40,
        INITIAL_SPAWN_DELAY: 2000,
        MIN_SPAWN_DELAY: 500,
        PICKUP_DROP_RATE: 0.40
    },
    WEAPONS: {
        BASIC_DAMAGE: 20,
        BASIC_ATTACK_SPEED: 3,
        BASIC_PROJECTILE_SPEED: 500
    },
    EXPERIENCE: {
        BASE_XP_REQUIREMENT: 100,
        XP_SCALING_FACTOR: 1.5
    }
}; 