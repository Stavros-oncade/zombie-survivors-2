// src/game/config/JobBoardConfig.ts
// All Job Board tuning constants in one loud, centralized place (§5.3).
// Mirrors how the mission/spawn systems keep magic numbers discoverable.

export const JobBoardConfig = {
  // ── board generation ──
  OFFERS_PER_BOARD: 3,
  FREE_REROLLS_PER_BOARD: 1,     // free rerolls each generation (§4.4)
  REROLL_BP_COST: 1,             // blueprint-point cost of a paid reroll (§4.4)
  EASY_CAP: 35,                  // difficulty below this counts as an "easy" option (§4.1)

  // ── difficulty → reward budget (§5.2) ──
  BASE_BUDGET: 2,
  BUDGET_PER_DIFF: 0.18,         // diff 50 ≈ 11 budget

  // ── exchange rates: 1 budget → N units of a currency (§5.2) ──
  // Blueprints are rare/high-value (1:1). Camp resources and horde relief are
  // softer currencies, so 1 budget buys several units. Provisional — co-tuned
  // with the camp economy (outer-loop-survivor-camp.md, §11 risk 1).
  EXCHANGE_RATES: {
    blueprints: 1,               // 1 budget = 1 blueprint point
    campaign: 1,                 // 1 budget = 1 campaign point
    hordeRelief: 5,              // 1 budget = 5 horde-pressure units relieved
    resources: 4,               // 1 budget = 4 units of food/water/medicine
  },

  // ── modifiers ──
  MAX_MODIFIERS: 3,              // 0..3 modifiers per offer
  DEFAULT_ELITE_INTERVAL_MS: 90000,
  DEFAULT_BOSS_SPAWN_SECONDS: 300,
} as const;

/** Difficulty tier labels for the UI badge (maps offer.difficulty). */
export function difficultyTier(difficulty: number): { label: string; color: string } {
  if (difficulty < 35) return { label: 'Easy', color: '#7CFC7C' };
  if (difficulty < 60) return { label: 'Medium', color: '#FFD54F' };
  if (difficulty < 85) return { label: 'Hard', color: '#FF8A65' };
  return { label: 'Brutal', color: '#FF5252' };
}
