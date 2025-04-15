export const GameConstants = {
    PLAYER: {
        INITIAL_HEALTH: 100,
        MOVEMENT_SPEED: 200,
        INITIAL_WEAPONS: ['basicWeapon']
    },
    ENEMIES: {
        SPAWN_RATE: 1000,
        INITIAL_SPEED: 100,
        BASE_HEALTH: 50,
        INITIAL_SPAWN_DELAY: 2000,
        MIN_SPAWN_DELAY: 500
    },
    WEAPONS: {
        BASIC_DAMAGE: 10,
        BASIC_ATTACK_SPEED: 3,
        BASIC_PROJECTILE_SPEED: 400
    },
    EXPERIENCE: {
        BASE_XP_REQUIREMENT: 100,
        XP_SCALING_FACTOR: 1.5
    }
}; 