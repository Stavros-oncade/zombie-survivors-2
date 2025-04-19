export const ExplosionConfig = {
    // Damage multiplier for explosion (10x weapon damage)
    DAMAGE_MULTIPLIER: 10,
    
    // Explosion radius in pixels
    RADIUS: 250,
    
    // Knockback radius multiplier (1.5x explosion radius)
    KNOCKBACK_RADIUS_MULTIPLIER: 1.5,
    
    // Knockback force
    KNOCKBACK_FORCE: 900,
    
    // Visual effects
    VISUAL: {
        // Main explosion
        MAIN: {
            OUTER_COLOR: 0xff0000,
            OUTER_ALPHA: 0.7,
            BORDER_COLOR: 0xffffff,
            BORDER_ALPHA: 0.8,
            BORDER_WIDTH: 4,
            INNER_COLOR: 0xffff00,
            INNER_ALPHA: 0.9,
            INNER_RADIUS_MULTIPLIER: 0.5,
            DEPTH: -1
        },
        // Particles
        PARTICLES: {
            COUNT: 20,
            COLOR: 0xff5500,
            ALPHA: 0.8,
            SIZE: 5,
            DEPTH: 0,
            ANIMATION: {
                DURATION: 500,
                SCALE: 2
            }
        },
        // Explosion animation
        ANIMATION: {
            DURATION: 300,
            SCALE: 1.5
        }
    }
}; 