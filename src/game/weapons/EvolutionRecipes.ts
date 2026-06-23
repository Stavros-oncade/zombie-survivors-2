import { Scene } from 'phaser';
import { IWeapon } from './IWeapon';
import { GameConstants } from '../config/GameConstants';
import { PiercingWeapon } from './PiercingWeapon';
import { ExplosiveWeapon } from './ExplosiveWeapon';
import { EvolvedInfernoLance } from './EvolvedInfernoLance';
import { OrbitalWeapon } from './OrbitalWeapon';
import { GravityWellWeapon } from './GravityWellWeapon';
import { StormVortexWeapon } from './StormVortexWeapon';
import { VoidOrbWeapon } from './VoidOrbWeapon';

// A constructor-ish identity for a weapon class, used for instanceof checks
// without importing every class into WeaponSystem.
export type WeaponClass = new (...args: any[]) => IWeapon;

export interface EvolutionRequirement {
  /** The weapon class that must be owned. */
  weapon: WeaponClass;
  /** Minimum getLevel() the owned instance must have reached. */
  minLevel: number;
}

export interface EvolutionRecipe {
  /** Stable id for logging / analytics / de-dup. */
  id: string;
  /** Human name of the resulting weapon (also used for toast text). */
  resultName: string;
  /** All of these weapons must be owned at >= minLevel. */
  requires: EvolutionRequirement[];
  /** Optional: a relic id that must be acquired (RelicSystem.hasRelic). */
  requiresRelicId?: string;
  /** The evolved class to detect "already evolved" and skip re-firing. */
  resultClass: WeaponClass;
  /**
   * Build the evolved weapon. Receives the matched source instances (in the
   * same order as `requires`) so a recipe MAY scale the result off the
   * sources' current stats if desired. Most recipes just use GameConstants.
   */
  build: (scene: Scene, sources: IWeapon[]) => IWeapon;
}

const B = GameConstants.WEAPONS;

export const EVOLUTION_RECIPES: EvolutionRecipe[] = [
  // --- Existing, preserved exactly (backward compatible) ---
  {
    id: 'inferno_lance',
    resultName: 'Inferno Lance',
    requires: [
      { weapon: PiercingWeapon, minLevel: 2 },
      { weapon: ExplosiveWeapon, minLevel: 2 },
    ],
    resultClass: EvolvedInfernoLance,
    build: (scene) => new EvolvedInfernoLance(scene, {
      damage: Math.round(B.BASIC_DAMAGE * 1.5),        // 30
      attackSpeed: B.BASIC_ATTACK_SPEED * 1.1,         // 3.3
      projectileSpeed: B.BASIC_PROJECTILE_SPEED * 1.1, // 550
      pierceCount: 2,
    }),
  },

  // --- New: Part B recipes ---
  {
    id: 'gravity_well',
    resultName: 'Gravity Well',
    requires: [
      { weapon: ExplosiveWeapon, minLevel: 3 },
      { weapon: OrbitalWeapon, minLevel: 2 },
    ],
    requiresRelicId: 'singularity_core', // LEGENDARY gate
    resultClass: GravityWellWeapon,
    build: (scene) => new GravityWellWeapon(scene, {
      damage: Math.round(B.BASIC_DAMAGE * 1.2),        // 24 / tick
      attackSpeed: B.BASIC_ATTACK_SPEED * 0.5,         // 1.5 (re-cast cadence)
      range: 140,
    }),
  },
  {
    // Void Orb satisfies the orbit/summon parent slot for Gravity Well (the
    // spec's "either Orbital OR Void Orb" — authored as a second zero-risk row
    // producing the same result). Same legendary gate as the Orbital recipe.
    id: 'gravity_well_void',
    resultName: 'Gravity Well',
    requires: [
      { weapon: ExplosiveWeapon, minLevel: 3 },
      { weapon: VoidOrbWeapon, minLevel: 2 },
    ],
    requiresRelicId: 'singularity_core',
    resultClass: GravityWellWeapon,
    build: (scene) => new GravityWellWeapon(scene, {
      damage: Math.round(B.BASIC_DAMAGE * 1.2),
      attackSpeed: B.BASIC_ATTACK_SPEED * 0.5,
      range: 140,
    }),
  },
  {
    id: 'storm_vortex',
    resultName: 'Storm Vortex',
    requires: [
      { weapon: PiercingWeapon, minLevel: 2 },
      { weapon: OrbitalWeapon, minLevel: 2 },
    ],
    resultClass: StormVortexWeapon,
    build: (scene) => new StormVortexWeapon(scene, {
      damage: Math.round(B.BASIC_DAMAGE * 0.9),        // 18 / hit
      attackSpeed: B.BASIC_ATTACK_SPEED * 1.2,         // 3.6 (orbit tick rate)
      projectileSpeed: B.BASIC_PROJECTILE_SPEED,       // 500
      orbCount: 3,
      pierceCount: 2,
    }),
  },
];
