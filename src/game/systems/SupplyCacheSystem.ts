import { Game } from '../scenes/Game';
import { Mission, WorldPoint } from '../types/MissionTypes';
import { GameConfig } from '../config/GameConfig';
import { SupplyCache } from '../entities/SupplyCache';

/**
 * Search & Retrieve supply caches (docs/specs/search-and-retrieve-supply-caches.md).
 * Owned by Game, constructed only when mission.supplyCache?.enabled. Mirrors
 * ExtractionSystem's shape: places 1-3 world-space caches, drives a per-cache
 * channel timer (pause-not-reset), and exposes whether the player is currently
 * channeling (used to suppress weapon fire) and the nearest unretrieved cache
 * (used to drive the HUD beacon). Reward payout is read by Game.finishWin() via
 * getRetrievedCount()/getTotalCount() — this system never touches CampReward
 * itself; GameOver scales the reward by the retrieval ratio.
 */
export class SupplyCacheSystem {
  private static readonly MIN_COUNT = 1;
  private static readonly MAX_COUNT = 3;
  private static readonly DEFAULT_COUNT = 2;
  private static readonly DEFAULT_RADIUS = 48;
  private static readonly DEFAULT_SEARCH_SECONDS = 3;
  private static readonly HIT_PENALTY = 0.25;

  // Placement tunables (generalizes ExtractionSystem.placeZone for N mutually
  // spaced points instead of one).
  private static readonly MIN_DIST_FROM_PLAYER = 280;
  private static readonly MAX_DIST_FROM_PLAYER = 850;
  private static readonly MIN_MUTUAL_SPACING = 360; // > 2*radius: rings never overlap
  private static readonly PLACEMENT_ATTEMPTS = 20;

  private scene: Game;
  private radius: number;
  private searchSeconds: number;
  private caches: SupplyCache[] = [];
  private retrievedCount = 0;
  private playerIsSearching = false;
  private onPlayerHit?: () => void;

  constructor(scene: Game, mission: Mission, playerX: number, playerY: number) {
    this.scene = scene;
    this.radius = mission.supplyCache?.radius ?? SupplyCacheSystem.DEFAULT_RADIUS;
    this.searchSeconds = mission.supplyCache?.searchSeconds ?? SupplyCacheSystem.DEFAULT_SEARCH_SECONDS;
    const count = Phaser.Math.Clamp(
      mission.supplyCache?.count ?? SupplyCacheSystem.DEFAULT_COUNT,
      SupplyCacheSystem.MIN_COUNT,
      SupplyCacheSystem.MAX_COUNT
    );
    this.placeCaches(count, playerX, playerY);

    this.onPlayerHit = () => this.handlePlayerHit();
    this.scene.events.on('player_hit', this.onPlayerHit);
  }

  /**
   * Place `count` caches at a random angle/distance band from the player's start
   * position, clamped to world bounds, rejecting spots too close to the player or
   * to an already-placed cache. Tracks a best-scoring fallback per cache (mirrors
   * ExtractionSystem.placeZone's bestDist pattern) so placement always terminates.
   */
  private placeCaches(count: number, playerX: number, playerY: number): void {
    const W = GameConfig.WORLD.WIDTH;
    const H = GameConfig.WORLD.HEIGHT;
    const margin = this.radius + 64;
    const minFromPlayer = this.radius + 96;
    const placed: WorldPoint[] = [];

    for (let i = 0; i < count; i++) {
      let best: WorldPoint = { x: playerX, y: playerY };
      let bestScore = -1;

      for (let attempt = 0; attempt < SupplyCacheSystem.PLACEMENT_ATTEMPTS; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Phaser.Math.Linear(
          SupplyCacheSystem.MIN_DIST_FROM_PLAYER,
          SupplyCacheSystem.MAX_DIST_FROM_PLAYER,
          Math.random()
        );
        const x = Phaser.Math.Clamp(playerX + Math.cos(angle) * dist, margin, W - margin);
        const y = Phaser.Math.Clamp(playerY + Math.sin(angle) * dist, margin, H - margin);

        const distFromPlayer = Phaser.Math.Distance.Between(playerX, playerY, x, y);
        const distFromNearestCache = placed.length === 0
          ? Number.POSITIVE_INFINITY
          : Math.min(...placed.map((p) => Phaser.Math.Distance.Between(p.x, p.y, x, y)));

        const valid = distFromPlayer >= minFromPlayer
          && distFromNearestCache >= SupplyCacheSystem.MIN_MUTUAL_SPACING;
        if (valid) {
          best = { x, y };
          bestScore = Number.POSITIVE_INFINITY;
          break;
        }

        // Track the best-scoring reject in case every attempt fails (small map /
        // player pinned in a corner) — score is the tighter of the two constraints.
        const score = Math.min(distFromPlayer, distFromNearestCache);
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }

      placed.push(best);
      this.caches.push(new SupplyCache(this.scene, best.x, best.y, this.radius));
    }
  }

  /** dt in seconds. Advances each unretrieved cache's channel timer and visuals. */
  public update(dt: number, playerX: number, playerY: number): void {
    let searching = false;

    for (const cache of this.caches) {
      if (cache.getRetrieved()) continue;

      const p = cache.getWorldPos();
      const inside = Phaser.Math.Distance.Between(playerX, playerY, p.x, p.y) <= cache.getRadius();
      cache.update(dt, inside);

      if (inside) {
        searching = true;
        const next = Math.min(1, cache.getProgress() + dt / this.searchSeconds);
        cache.setProgress(next);
        if (next >= 1) {
          cache.markRetrieved();
          cache.playRetrievedFx();
          this.retrievedCount++;
          this.scene.events.emit('supply_cache_retrieved', {
            retrieved: this.retrievedCount,
            total: this.caches.length,
          });
        }
      }
      // else: paused, not reset — progress holds while the player is outside the radius.
    }

    this.playerIsSearching = searching;
  }

  /** Hit-while-channeling penalty: knock back the cache the player is currently inside. */
  private handlePlayerHit(): void {
    const player = this.scene.getPlayer();
    if (!player) return;

    for (const cache of this.caches) {
      if (cache.getRetrieved()) continue;
      const p = cache.getWorldPos();
      if (Phaser.Math.Distance.Between(player.x, player.y, p.x, p.y) <= cache.getRadius()) {
        cache.setProgress(Math.max(0, cache.getProgress() - SupplyCacheSystem.HIT_PENALTY));
        cache.flashHit();
        break; // mutual spacing guarantees at most one match; break defensively
      }
    }
  }

  /** True if the player is currently inside any unretrieved cache's radius (gates weapon fire). */
  public isSearching(): boolean {
    return this.playerIsSearching;
  }

  /** Nearest unretrieved cache to (x,y), or null if all caches are retrieved. */
  public getNearestUnretrieved(x: number, y: number): WorldPoint | null {
    let nearest: WorldPoint | null = null;
    let nearestDist = Number.POSITIVE_INFINITY;
    for (const cache of this.caches) {
      if (cache.getRetrieved()) continue;
      const p = cache.getWorldPos();
      const d = Phaser.Math.Distance.Between(x, y, p.x, p.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = p;
      }
    }
    return nearest;
  }

  public getRetrievedCount(): number {
    return this.retrievedCount;
  }

  public getTotalCount(): number {
    return this.caches.length;
  }

  public destroy(): void {
    if (this.onPlayerHit) {
      this.scene.events.off('player_hit', this.onPlayerHit);
      this.onPlayerHit = undefined;
    }
    this.caches.forEach((c) => c.destroy());
  }
}
