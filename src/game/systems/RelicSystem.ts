import { Game } from '../scenes/Game';

export type RelicRarity = 'common' | 'rare' | 'epic' | 'legendary';

export type Relic = {
  id: string;
  name: string;
  description: string;
  rarity: RelicRarity;
  weight: number; // for weighted selection
  apply: (game: Game) => void;
};

export class RelicSystem {
  private game: Game;
  private acquired: Set<string> = new Set();
  private xpMultiplier = 1.0;

  constructor(game: Game) {
    this.game = game;
  }

  public getXPMultiplier(): number { return this.xpMultiplier; }
  public hasRelic(id: string): boolean { return this.acquired.has(id); }

  public acquireRelic(id: string): void {
    if (this.acquired.has(id)) return;
    const relic = RELICS.find(r => r.id === id);
    if (!relic) return;
    this.acquired.add(id);
    relic.apply(this.game);
  }

  // Expose for UI / selection
  public getAcquiredIds(): Set<string> { return new Set(this.acquired); }
}

// Assets needed:
// - Optional relic icons for UI (e.g., 'relic_chain_lightning.png', 'relic_greed.png')

// Icons (suggested):
// - relic_greed.png (gold coin or laurel)
// - relic_celerity.png (wing or boot)
// - relic_arsenal.png (crossed blades)
// Place under public/assets/ and load in Preloader if showing icons in UI.

export const RELICS: Relic[] = [
  {
    id: 'greed',
    name: 'Greed',
    description: '+25% experience gain from all sources',
    rarity: 'common',
    weight: 50,
    apply: (game: Game) => {
      game.getRelicSystemInternal().xpMultiplier = 1.25;
    }
  },
  {
    id: 'celerity',
    name: 'Celerity',
    description: 'Increase movement speed toward cap (+5% asymptotically)',
    rarity: 'rare',
    weight: 30,
    apply: (game: Game) => {
      game.playerApplyAsymptoticSpeed(1.05);
    }
  },
  {
    id: 'arsenal',
    name: 'Arsenal',
    description: '+10% attack speed for all weapons',
    rarity: 'epic',
    weight: 15,
    apply: (game: Game) => {
      game.getWeaponSystem().upgradeWeaponSpeed(1.1);
    }
  },
  {
    id: 'warp_coils',
    name: 'Warp Coils',
    description: '+20% projectile speed',
    rarity: 'common',
    weight: 40,
    apply: (game: Game) => {
      game.getWeaponSystem().upgradeProjectileSpeed(1.2);
    }
  },
  {
    id: 'vitality',
    name: 'Vitality',
    description: '+10% max health',
    rarity: 'common',
    weight: 35,
    apply: (game: Game) => {
      game.playerAdjustMaxHealth(1.1);
    }
  },
  {
    id: 'sharpshooter',
    name: 'Sharpshooter',
    description: '+15% weapon damage',
    rarity: 'rare',
    weight: 30,
    apply: (game: Game) => {
      game.getWeaponSystem().upgradeWeaponDamage(1.15);
    }
  },
  {
    id: 'overclock',
    name: 'Overclock',
    description: '+15% attack speed',
    rarity: 'epic',
    weight: 20,
    apply: (game: Game) => {
      game.getWeaponSystem().upgradeWeaponSpeed(1.15);
    }
  }
];
