// src/game/config/ReconConfig.ts
// Tuning surface for the Long Recon route map (§3,§8,§9). Single source of truth
// for sizing, node-kind weights, difficulty curve, and payout policy.
import { ReconNodeKind } from '../types/ReconTypes';

export const ReconConfig = {
  // ── Sizing (§3) ──
  layers: 6,            // start(0) + 4 inner + boss(last) -> requiredClears = 6
  minWidth: 2,
  maxWidth: 3,

  // ── Node-kind weights for inner layers (§4.3) ──
  kindWeights: {
    [ReconNodeKind.COMBAT]: 0.50,
    [ReconNodeKind.ELITE]:  0.18,
    [ReconNodeKind.CACHE]:  0.14,
    [ReconNodeKind.EVENT]:  0.12,
    [ReconNodeKind.SHOP]:   0.06,
  } as Record<string, number>,

  // ── Reward base values (§4.7), scaled by tier + kind ──
  reward: {
    combatBPPerTier: 2,
    combatResourcesPerTier: 4,
    elitePremium: 1.6,      // multiplier on a same-tier combat payout
    cachePremium: 2.0,
    bossBaseBP: 6,          // baseReward.blueprintPoints paid on boss clear
    bossBaseResources: 20,
  },

  // ── Failure / salvage policy (§9) ──
  salvageFraction: 0.25,    // fraction of pending BP paid out on death; 0 = hardcore

  // ── EVENT / SHOP economy (§7) ──
  eventHealFraction: 0.5,   // "Field medic": restore 50% max HP
  shopHealCostBP: 4,        // SHOP: spend pending BP to heal
  shopHealFraction: 0.5,
} as const;

// ── Difficulty curve (§8). node.difficultyTier = 1 + layer. ──
export const RECON_DIFFICULTY = {
  killCountPerTier: 0.35,   // +35% kill/collect/elite target per tier above 1
  surviveSecPerTier: 20,    // +20s survive/hold per tier
  spawnRatePerTier: 0.15,   // +15% spawn-count multiplier per tier
  eliteCadencePerTier: 0.10,// -10% elite interval per tier (tighter cadence)
} as const;

/** Themed recon names for flavor (picked by seed). */
export const RECON_NAMES = [
  'Downtown Sweep', 'The Long Road', 'Deep Patrol', 'Far Recon',
  'Ashfall Run', 'Delta Push', 'Sprawl Crawl', 'The Far Line',
];
