// src/game/systems/CampaignSystem.ts
// THIN STUB for the campaign-progression meta-currency (the 4th Job Board reward
// currency, §2 / §5.2). The full campaign track (story beats / unlock gates) is
// owned by a later outer-loop doc; until then this mirrors BlueprintSystem's
// static, localStorage-backed, crash-proof API so the board can award all four
// currencies today.
//
// TODO(phase: campaign) Replace with the real campaign track + unlock gates.

const STORAGE_KEY = 'zs2_campaign_progress';

export class CampaignSystem {
  static getProgress(): number {
    const n = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
    return Number.isFinite(n) ? n : 0;
  }
  static setProgress(v: number): void {
    localStorage.setItem(STORAGE_KEY, String(Math.max(0, Math.floor(v))));
  }
  static addProgress(delta: number): void {
    this.setProgress(this.getProgress() + Math.floor(delta));
  }
}
