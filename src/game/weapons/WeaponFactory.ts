// Weapon class + level-1 factory registry. This is the ONLY catalog-side module
// that imports concrete weapon classes (which import Enemy). It must therefore
// only be imported from inside the Game scene's module graph — WeaponSystem is
// the sole consumer. Keep metadata (ids/tiers/costs/predicates) in WeaponCatalog.ts.
import { Scene } from 'phaser';
import { IWeapon } from './IWeapon';
import { GameConstants } from '../config/GameConstants';

import { PiercingWeapon } from './PiercingWeapon';
import { ExplosiveWeapon } from './ExplosiveWeapon';
import { OrbitalWeapon } from './OrbitalWeapon';
import { TeslaArcWeapon } from './TeslaArcWeapon';
import { SentryDroneWeapon } from './SentryDroneWeapon';
import { FrostMineWeapon } from './FrostMineWeapon';
import { RicochetDiscWeapon } from './RicochetDiscWeapon';
import { PrismBeamWeapon } from './PrismBeamWeapon';
import { VoidOrbWeapon } from './VoidOrbWeapon';

const B = GameConstants.WEAPONS;

export interface WeaponFactoryEntry {
  /** The class, for instanceof checks in WeaponSystem (owned/upgrade detection). */
  weaponClass: new (...args: any[]) => IWeapon;
  /** Factory for a fresh level-1 instance. */
  create: (scene: Scene) => IWeapon;
}

/** id -> { weaponClass, create }. Ids match WEAPON_CATALOG in WeaponCatalog.ts. */
export const WEAPON_FACTORY: Record<string, WeaponFactoryEntry> = {
  piercing_shot: {
    weaponClass: PiercingWeapon,
    create: (s) => new PiercingWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 0.8), attackSpeed: B.BASIC_ATTACK_SPEED * 1.1,
      projectileSpeed: B.BASIC_PROJECTILE_SPEED * 1.1, level: 1, pierceCount: 3,
    }),
  },
  explosive_burst: {
    weaponClass: ExplosiveWeapon,
    create: (s) => new ExplosiveWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 1.1), attackSpeed: B.BASIC_ATTACK_SPEED * 0.5,
      range: 80, level: 1,
    }),
  },
  orbital_shield: {
    weaponClass: OrbitalWeapon,
    create: (s) => new OrbitalWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 0.6), attackSpeed: B.BASIC_ATTACK_SPEED * 0.83,
      level: 1, orbCount: 2, radius: 70, angularSpeed: 2.5, hitCooldownMs: 400,
    }),
  },
  ricochet_disc: {
    weaponClass: RicochetDiscWeapon,
    create: (s) => new RicochetDiscWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 0.75), attackSpeed: B.BASIC_ATTACK_SPEED * 0.73,
      projectileSpeed: B.BASIC_PROJECTILE_SPEED * 1.04, bounceCount: 4, level: 1,
    }),
  },
  tesla_arc: {
    weaponClass: TeslaArcWeapon,
    create: (s) => new TeslaArcWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 0.7), attackSpeed: B.BASIC_ATTACK_SPEED * 0.8,
      chainCount: 3, chainRange: 180, level: 1,
    }),
  },
  sentry_drone: {
    weaponClass: SentryDroneWeapon,
    create: (s) => new SentryDroneWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 0.5), attackSpeed: B.BASIC_ATTACK_SPEED * 0.67,
      projectileSpeed: B.BASIC_PROJECTILE_SPEED * 0.96, droneCount: 1, level: 1,
    }),
  },
  frost_mine: {
    weaponClass: FrostMineWeapon,
    create: (s) => new FrostMineWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 0.8), attackSpeed: 0.8, range: 120, mineCap: 4, level: 1,
    }),
  },
  prism_beam: {
    weaponClass: PrismBeamWeapon,
    create: (s) => new PrismBeamWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 0.4), attackSpeed: 8, beamRange: 260, level: 1,
    }),
  },
  void_orb: {
    weaponClass: VoidOrbWeapon,
    create: (s) => new VoidOrbWeapon(s, {
      damage: Math.round(B.BASIC_DAMAGE * 1.0), attackSpeed: 0.4, range: 150, ticks: 5, level: 1,
    }),
  },
};

export function getWeaponFactory(id: string): WeaponFactoryEntry | undefined {
  return WEAPON_FACTORY[id];
}
