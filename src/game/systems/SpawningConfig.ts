import { SpawnState } from '../types/GameTypes';

export class SpawningConfig {
  private static instance: SpawningConfig;
  public rateMultiplier = 1; // 1x by default; higher = faster spawns
  public spawnEliteOnStart = false;
  public spawnBossOnStart = false;
  public startState: SpawnState | undefined; // selected start spawn state

  private constructor() {}

  public static getInstance(): SpawningConfig {
    if (!SpawningConfig.instance) SpawningConfig.instance = new SpawningConfig();
    return SpawningConfig.instance;
  }

  public reset(): void {
    this.rateMultiplier = 1;
    this.spawnEliteOnStart = false;
    this.spawnBossOnStart = false;
    this.startState = undefined;
  }
}
