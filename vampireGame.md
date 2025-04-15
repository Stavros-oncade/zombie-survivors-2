# Vampire Survivors Implementation Plan

## Overview
This document outlines the implementation plan for creating a Vampire Survivors-style game using the existing Phaser template with React and TypeScript.

## Scene Structure
The game will maintain the existing scene flow while adding new functionality:

```
Boot → Preloader → MainMenu → Game → GameOver
```

## 1. Core Game Classes

### Player Class
```typescript
// src/game/entities/Player.ts
export class Player extends Phaser.Physics.Arcade.Sprite {
    private health: number;
    private maxHealth: number;
    private level: number;
    private experience: number;
    private experienceToNextLevel: number;
    private weapons: Weapon[];
    private stats: PlayerStats;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, 'player');
        this.initialize();
    }

    private initialize(): void {
        // Initialize player properties
    }

    public move(direction: Phaser.Math.Vector2): void {
        // Handle player movement
    }

    public takeDamage(amount: number): void {
        // Handle damage and death
    }

    public gainExperience(amount: number): void {
        // Handle experience gain and leveling
    }
}
```

### Enemy Class
```typescript
// src/game/entities/Enemy.ts
export class Enemy extends Phaser.Physics.Arcade.Sprite {
    private health: number;
    private maxHealth: number;
    private speed: number;
    private damage: number;
    private experienceValue: number;

    constructor(scene: Phaser.Scene, x: number, y: number, type: EnemyType) {
        super(scene, x, y, 'enemy');
        this.initialize(type);
    }

    private initialize(type: EnemyType): void {
        // Initialize enemy properties based on type
    }

    public moveTowardsPlayer(player: Player): void {
        // Handle enemy movement
    }
}
```

### Weapon Class
```typescript
// src/game/weapons/Weapon.ts
export class Weapon {
    private damage: number;
    private attackSpeed: number;
    private projectileSpeed: number;
    private level: number;
    private evolutionLevel: number;

    constructor(config: WeaponConfig) {
        this.initialize(config);
    }

    public fire(player: Player, enemies: Enemy[]): void {
        // Handle weapon firing
    }

    public upgrade(): void {
        // Handle weapon upgrades
    }
}
```

## 2. Game Systems

### Experience System
```typescript
// src/game/systems/ExperienceSystem.ts
export class ExperienceSystem {
    private static calculateLevelThreshold(level: number): number {
        // Calculate experience needed for next level
    }

    public static gainExperience(player: Player, amount: number): void {
        // Handle experience gain and level up
    }
}
```

### Upgrade System
```typescript
// src/game/systems/UpgradeSystem.ts
export class UpgradeSystem {
    private static availableUpgrades: Upgrade[];

    public static getRandomUpgrades(count: number): Upgrade[] {
        // Return random upgrades for level up
    }

    public static applyUpgrade(player: Player, upgrade: Upgrade): void {
        // Apply the selected upgrade
    }
}
```

### Enemy Spawn System
```typescript
// src/game/systems/EnemySpawnSystem.ts
export class EnemySpawnSystem {
    private spawnTimer: Phaser.Time.TimerEvent;
    private difficulty: number;

    constructor(scene: Phaser.Scene) {
        this.initialize(scene);
    }

    private initialize(scene: Phaser.Scene): void {
        // Initialize spawn system
    }

    public update(player: Player): void {
        // Update spawn logic based on player position and game time
    }
}
```

## 3. UI Components

### Game UI
```typescript
// src/game/ui/GameUI.ts
export class GameUI {
    private healthBar: Phaser.GameObjects.Graphics;
    private experienceBar: Phaser.GameObjects.Graphics;
    private levelText: Phaser.GameObjects.Text;
    private timerText: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene) {
        this.initialize(scene);
    }

    public update(player: Player, gameTime: number): void {
        // Update UI elements
    }
}
```

### Upgrade UI
```typescript
// src/game/ui/UpgradeUI.ts
export class UpgradeUI {
    private upgradeContainer: Phaser.GameObjects.Container;
    private upgradeOptions: UpgradeOption[];

    constructor(scene: Phaser.Scene) {
        this.initialize(scene);
    }

    public showUpgrades(upgrades: Upgrade[]): void {
        // Display upgrade options
    }
}
```

## 4. Implementation Steps

### Phase 1: Core Mechanics
1. Implement Player class with basic movement
2. Create basic Enemy class with movement towards player
3. Implement simple Weapon class with basic firing
4. Set up collision detection between entities

### Phase 2: Game Systems
1. Implement Experience System
2. Create Enemy Spawn System
3. Develop Upgrade System
4. Add basic UI elements

### Phase 3: Content
1. Add different enemy types
2. Implement various weapons
3. Create upgrade options
4. Add power-ups and items

### Phase 4: Polish
1. Add visual effects
2. Implement sound effects
3. Add particle systems
4. Create animations

## 5. Game Configuration

### Game Constants
```typescript
// src/game/config/GameConstants.ts
export const GameConstants = {
    PLAYER: {
        INITIAL_HEALTH: 100,
        MOVEMENT_SPEED: 200,
        INITIAL_WEAPONS: ['basicWeapon']
    },
    ENEMIES: {
        SPAWN_RATE: 1000,
        INITIAL_SPEED: 100,
        BASE_HEALTH: 50
    },
    WEAPONS: {
        BASIC_DAMAGE: 10,
        BASIC_ATTACK_SPEED: 1,
        BASIC_PROJECTILE_SPEED: 300
    },
    EXPERIENCE: {
        BASE_XP_REQUIREMENT: 100,
        XP_SCALING_FACTOR: 1.5
    }
};
```

## 6. Scene Modifications

### Game Scene
```typescript
// src/game/scenes/Game.ts
export class Game extends Phaser.Scene {
    private player: Player;
    private enemies: Phaser.Physics.Arcade.Group;
    private weapons: Phaser.Physics.Arcade.Group;
    private gameUI: GameUI;
    private enemySpawnSystem: EnemySpawnSystem;
    private upgradeSystem: UpgradeSystem;

    create(): void {
        // Initialize game systems and entities
    }

    update(): void {
        // Update game state
    }
}
```

## 7. Asset Requirements

### Required Sprites
- Player character (multiple frames for animation)
- Enemy types (3-4 different designs)
- Weapon projectiles
- UI elements (health bar, experience bar)
- Power-up items
- Background elements

### Required Audio
- Background music
- Weapon sound effects
- Enemy death sounds
- Level up sound
- UI interaction sounds

## 8. Testing Plan

1. Unit Tests
   - Player movement and stats
   - Enemy behavior
   - Weapon mechanics
   - Experience calculation

2. Integration Tests
   - Scene transitions
   - Game state management
   - Save/load functionality

3. Performance Tests
   - Enemy spawn optimization
   - Collision detection
   - Particle effects

## 9. Future Enhancements

1. Additional Features
   - Boss enemies
   - Special abilities
   - Achievement system
   - High score system

2. Content Updates
   - New weapons
   - New enemy types
   - New power-ups
   - New maps/backgrounds

3. Quality of Life
   - Settings menu
   - Tutorial system
   - Help documentation
   - Controller support 