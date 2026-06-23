import { Game } from '../scenes/Game';
import { KillstreakPerkId } from '../types/GameTypes';

export class KillstreakSystem {
  private game: Game;
  private perk: KillstreakPerkId;
  private kills = 0;
  private lastKillTime = 0;
  private multiplier = 1;
  private maxMult = 3;
  private decayMs = 4000;

  constructor(game: Game, perk: KillstreakPerkId) {
    this.game = game;
    this.perk = perk;
    this.game.events.on('enemyKilled', this.onKill, this);
    this.game.events.on('player_hit', this.reset, this);
  }

  public levelUp() { this.maxMult = Math.min(5, this.maxMult + 1); }

  private onKill() {
    this.kills++;
    this.lastKillTime = this.game.time.now;
    this.multiplier = Math.min(this.maxMult, 1 + Math.floor(this.kills / 10));
    this.applyBuffs();
    // decay check
    this.game.time.delayedCall(this.decayMs, () => {
      if (this.game.time.now - this.lastKillTime >= this.decayMs) this.reset();
    });
  }

  private applyBuffs() {
    const ws = this.game.getWeaponSystem();
    // Use temp multiplier so we don't permanently scale base damage
    const m = this.multiplier;
    if (this.perk === KillstreakPerkId.DAMAGE) ws.setTempDamageMultiplier(1 + 0.15 * (m - 1));
    if (this.perk === KillstreakPerkId.SPEED) ws.upgradeWeaponSpeed(1 + 0.10 * (m - 1));
    // xp perk handled in Game's enemyKilled XP calc, which calls getXPMult()
  }

  public getXPMult(): number {
    return this.perk === KillstreakPerkId.XP ? 1 + 0.15 * (this.multiplier - 1) : 1;
  }

  public getMultiplier(): number { return this.multiplier; }
  public getPerk(): KillstreakPerkId { return this.perk; }

  public reset() {
    this.kills = 0;
    this.multiplier = 1;
    // Revert temp damage overlay to neutral
    const ws = this.game.getWeaponSystem();
    ws.setTempDamageMultiplier(1);
  }
}
