import { Game } from '../scenes/Game';
import { RelicRarity } from '../types/GameTypes';

export type Relic = {
  id: string;
  name: string;
  description: string;
  rarity: RelicRarity;
  weight: number; // for weighted selection
  minPlayTimeSec?: number; // gate by run time (e.g. legendaries only late)
  chestOnly?: boolean;     // exclude from the level-up pool (chests only)
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
  public setXPMultiplier(multiplier: number): void { this.xpMultiplier = multiplier; }

  public acquireRelic(id: string): void {
    if (this.acquired.has(id)) return;
    const relic = RELICS.find(r => r.id === id);
    if (!relic) return;
    this.acquired.add(id);
    relic.apply(this.game);
  }

  // Expose for UI / selection
  public getAcquiredIds(): Set<string> { return new Set(this.acquired); }

  /** Re-apply a relic by id at a Long Recon node start (§5.3). acquireRelic is
   *  idempotent (guards on the acquired set) and re-runs the relic's apply(). */
  public reapply(id: string): void { this.acquireRelic(id); }
}

// Assets needed:
// - Optional relic icons for UI (e.g., 'relic_chain_lightning.png', 'relic_greed.png')

// Icons (suggested):
// - relic_greed.png (gold coin or laurel)
// - relic_celerity.png (wing or boot)
// - relic_arsenal.png (crossed blades)
// - relic_singularity_core.png (purple/void collapsing star)
// - relic_chrono_engine.png (cyan/electric clockwork)
// Place under public/assets/ and load in Preloader if showing icons in UI.

export const RELICS: Relic[] = [
  {
    id: 'greed',
    name: 'Greed',
    description: '+25% experience gain from all sources',
    rarity: RelicRarity.COMMON,
    weight: 50,
    apply: (game: Game) => {
      game.getRelicSystemInternal().setXPMultiplier(1.25);
    }
  },
  {
    id: 'celerity',
    name: 'Celerity',
    description: 'Increase movement speed toward cap (+5% asymptotically)',
    rarity: RelicRarity.RARE,
    weight: 30,
    apply: (game: Game) => {
      game.playerApplyAsymptoticSpeed(1.05);
    }
  },
  {
    id: 'arsenal',
    name: 'Arsenal',
    description: '+10% attack speed for all weapons',
    rarity: RelicRarity.EPIC,
    weight: 15,
    apply: (game: Game) => {
      game.getWeaponSystem().upgradeWeaponSpeed(1.1);
    }
  },
  {
    id: 'warp_coils',
    name: 'Warp Coils',
    description: '+20% projectile speed',
    rarity: RelicRarity.COMMON,
    weight: 40,
    apply: (game: Game) => {
      game.getWeaponSystem().upgradeProjectileSpeed(1.2);
    }
  },
  {
    id: 'vitality',
    name: 'Vitality',
    description: '+10% max health',
    rarity: RelicRarity.COMMON,
    weight: 35,
    apply: (game: Game) => {
      game.playerAdjustMaxHealth(1.1);
    }
  },
  {
    id: 'sharpshooter',
    name: 'Sharpshooter',
    description: '+15% weapon damage',
    rarity: RelicRarity.RARE,
    weight: 30,
    apply: (game: Game) => {
      game.getWeaponSystem().upgradeWeaponDamage(1.15);
    }
  },
  {
    id: 'overclock',
    name: 'Overclock',
    description: '+15% attack speed',
    rarity: RelicRarity.EPIC,
    weight: 20,
    apply: (game: Game) => {
      game.getWeaponSystem().upgradeWeaponSpeed(1.15);
    }
  },
  {
    id: 'singularity_core',
    name: 'Singularity Core',
    description: 'Your explosive bursts collapse inward. Unlocks the Gravity Well evolution and pulls enemies toward blast centers.',
    rarity: RelicRarity.LEGENDARY,
    weight: 3,
    minPlayTimeSec: 300, // 5 min, chest-only
    chestOnly: true,
    apply: (game: Game) => {
      // Primary effect is the evolution UNLOCK: the GravityWell recipe requires
      // hasRelic('singularity_core'). Re-check immediately so a qualifying
      // player evolves the moment they pick this up.
      game.getWeaponSystem().checkEvolutionPublic();
    }
  },
  {
    id: 'chrono_engine',
    name: 'Chrono Engine',
    description: 'Time dilates around you. +60% attack speed for ALL weapons.',
    rarity: RelicRarity.LEGENDARY,
    weight: 3,
    minPlayTimeSec: 300,
    chestOnly: true,
    apply: (game: Game) => {
      // Big global attack-speed step that reshapes pacing (vs Arsenal +10% /
      // Overclock +15%). Reuses the existing hook.
      game.getWeaponSystem().upgradeWeaponSpeed(1.6);
    }
  }
];
