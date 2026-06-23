import { Scene } from 'phaser';
import { SceneKey } from '../config/SceneKeys';
import { CityReclamationSystem } from '../systems/CityReclamationSystem';
import { LoadoutManager } from '../systems/LoadoutManager';
import { JobBoardSystem } from '../systems/JobBoardSystem';
import { JobLaunchKind } from '../types/JobBoardTypes';
import { SpawningConfig } from '../systems/SpawningConfig';
import { registerMission } from '../config/Missions';
import { Mission } from '../types/MissionTypes';
import { BiomeId, CityDef, ZoneDef, ZoneJobDef, ZoneState } from '../types/CityTypes';

// The City Reclamation meta-map (§9). Renders the current city's zone graph by
// ZoneDef.grid, edges from adjacency, per-zone visual state (color/fog/fill bar),
// and lets the player accept a zone job: sets LoadoutManager.setMissionId +
// setActiveZoneJob, then routes to Loadout -> Game. On win the zone's infestation
// drops (resolved in GameOver via CityReclamationSystem.applyJobWin), and control
// returns here re-rendered.
//
// Also the destination for JobBoard's CITY_RECLAMATION launch kind.

const STATE_COLOR: Record<ZoneState, number> = {
  [ZoneState.INFESTED]: 0x8b1a1a,
  [ZoneState.CONTESTED]: 0xe0a020,
  [ZoneState.CLEARED]: 0x2ecc71,
};

const BIOME_BG: Record<BiomeId, number> = {
  [BiomeId.URBAN_RUINS]: 0x14110c,
  [BiomeId.FLOODED_DELTA]: 0x0c1418,
  [BiomeId.ASH_WASTES]: 0x1a1410,
  [BiomeId.FROZEN_SPRAWL]: 0x10141a,
  [BiomeId.TOXIC_JUNGLE]: 0x0e1a0c,
};

export class CityReclamation extends Scene {
  constructor() { super(SceneKey.CityReclamation); }

  create() {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const city = CityReclamationSystem.getCurrentCity();
    this.cameras.main.setBackgroundColor(BIOME_BG[city.biome] ?? 0x14110c);

    const progress = CityReclamationSystem.getCityProgress(city.id);
    const sheltered = CityReclamationSystem.getClearedZoneCount();

    // Fully-reclaimed city (e.g. the terminal city, or arriving here via an accepted
    // CITY_RECLAMATION job after the last zone fell): there is nothing actionable on
    // the map. Clear any stale accepted city offer so the Job Board isn't left stuck
    // pointing at an un-runnable mission, and show a notice instead of a dead map.
    if (progress.total > 0 && progress.cleared >= progress.total) {
      const accepted = JobBoardSystem.getAcceptedOffer();
      if (accepted && accepted.launch?.kind === JobLaunchKind.CITY_RECLAMATION) {
        JobBoardSystem.clearAcceptedOffer();
        LoadoutManager.getInstance().setActiveZoneJob(null);
      }
      this.add.text(w / 2, 34, `${city.name}`, {
        fontFamily: 'Arial Black', fontSize: '36px', color: '#ffd54f', stroke: '#000000', strokeThickness: 6,
      }).setOrigin(0.5);
      this.add.text(w / 2, h / 2, 'City reclaimed.\nNo districts remain to clear here.', {
        fontFamily: 'Arial', fontSize: '22px', color: '#9fe0ff', align: 'center',
        stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0.5);
      const backBtn = this.add.text(w / 2, h - 36, 'Back to Main Menu', {
        fontFamily: 'Arial', fontSize: '22px', color: '#ffffff',
        backgroundColor: '#333333', stroke: '#000000', strokeThickness: 4, padding: { x: 14, y: 8 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true })
        .on('pointerover', () => backBtn.setStyle({ color: '#ffff00' }))
        .on('pointerout', () => backBtn.setStyle({ color: '#ffffff' }))
        .on('pointerdown', () => this.scene.start(SceneKey.MainMenu));
      return;
    }

    this.add.text(w / 2, 34, `${city.name}`, {
      fontFamily: 'Arial Black', fontSize: '36px', color: '#ffd54f', stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5);

    this.add.text(w / 2, 70, `Reclaimed ${progress.cleared}/${progress.total}  ·  Survivors sheltered: ${sheltered}`, {
      fontFamily: 'Arial', fontSize: '16px', color: '#9fe0ff', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);

    this.drawGraph(city, w, h);

    // Back button.
    const backBtn = this.add.text(w / 2, h - 36, 'Back to Main Menu', {
      fontFamily: 'Arial', fontSize: '22px', color: '#ffffff',
      backgroundColor: '#333333', stroke: '#000000', strokeThickness: 4, padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', () => backBtn.setStyle({ color: '#ffff00' }))
      .on('pointerout', () => backBtn.setStyle({ color: '#ffffff' }))
      .on('pointerdown', () => this.scene.start(SceneKey.MainMenu));
  }

  private drawGraph(city: CityDef, w: number, h: number): void {
    // Layout: a fully-packed BLOCK GRID (§13.11). Each ZoneDef.grid {col,row} is one
    // contiguous tile; adjacency is implicit in the grid, so no edges are drawn. A block
    // is takeable iff it touches CLEARED territory (CityReclamationSystem.isZoneOpen).
    const cols = Math.max(...city.zones.map((z) => z.grid.col)) + 1;
    const rows = Math.max(...city.zones.map((z) => z.grid.row)) + 1;
    const areaX = 60, areaY = 110, areaW = w - 120, areaH = h - 200;
    const cellW = areaW / cols, cellH = areaH / rows;
    const gap = 6;

    for (const z of city.zones) {
      const x = areaX + z.grid.col * cellW + gap / 2;
      const y = areaY + z.grid.row * cellH + gap / 2;
      this.drawBlock(z, x, y, cellW - gap, cellH - gap);
    }
  }

  private drawBlock(z: ZoneDef, x: number, y: number, bw: number, bh: number): void {
    const live = CityReclamationSystem.getZoneLive(z.id);
    const state = live?.state ?? ZoneState.INFESTED;
    const color = STATE_COLOR[state];
    const open = CityReclamationSystem.isZoneOpen(z.id);
    const cx = x + bw / 2;

    const g = this.add.graphics();
    // Block body, dimmed when this block isn't yet on the frontier (fog of war feel).
    const bodyA = state === ZoneState.CLEARED ? 1 : open ? 0.92 : 0.4;
    g.fillStyle(color, bodyA).fillRect(x, y, bw, bh);

    // Infestation darkening overlay — heavier when more infested.
    const inf = live?.infestation ?? z.baseInfestation;
    const fogA = (inf / 100) * 0.5;
    if (fogA > 0.02) g.fillStyle(0x000000, fogA).fillRect(x, y, bw, bh);

    const drawBorder = (lw: number, c: number) => g.lineStyle(lw, c, 1).strokeRect(x, y, bw, bh);
    const baseBorder = state === ZoneState.CLEARED ? 0x2ecc71 : open ? 0xffd54f : 0x000000;
    drawBorder(open ? 3 : 2, baseBorder);

    const icon = state === ZoneState.CLEARED ? '⚑' : state === ZoneState.CONTESTED ? '⚔' : '☣';
    this.add.text(cx, y + bh * 0.34, icon, {
      fontFamily: 'Arial', fontSize: `${Math.round(Math.min(bw, bh) * 0.34)}px`,
      color: '#ffffff', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);

    this.add.text(cx, y + bh * 0.62, z.name, {
      fontFamily: 'Arial', fontSize: '13px',
      color: state === ZoneState.CLEARED ? '#bfeccb' : open ? '#ffe9a8' : '#8a8a8a',
      stroke: '#000000', strokeThickness: 3, align: 'center',
      wordWrap: { width: bw - 8 },
    }).setOrigin(0.5);

    // Infestation bar near the block's foot.
    if (state !== ZoneState.CLEARED) {
      const barW = bw - 16, barH = 6, barX = x + 8, barY = y + bh - 14;
      g.fillStyle(0x000000, 0.7).fillRect(barX, barY, barW, barH);
      g.fillStyle(color, 1).fillRect(barX, barY, barW * (inf / 100), barH);
    }

    if (open) {
      const hit = this.add.rectangle(cx, y + bh / 2, bw, bh).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => drawBorder(4, 0xffff00));
      hit.on('pointerout', () => drawBorder(3, baseBorder));
      hit.on('pointerdown', () => this.openZoneJobs(z));
    }
  }

  /** Tap an open zone -> pick a job -> accept (sets missionId + activeZoneJob) -> Loadout. */
  private openZoneJobs(zone: ZoneDef): void {
    const job = zone.jobs[0];
    if (!job) return;
    // Single-job zones accept directly; multi-job (Long Recon) seam below.
    // TODO(phase: route-map) zones with isLongRecon surface a branching route picker.
    this.acceptJob(zone, job);
  }

  private acceptJob(zone: ZoneDef, job: ZoneJobDef): void {
    const lm = LoadoutManager.getInstance();
    // Build a one-off Mission from the zone job's condition and register it so the Game
    // scene's resolveMission(getMissionId()) returns the right win condition. A modest
    // per-run CampReward flows through the normal camp cycle; the big zone-clear rewards
    // (vendors, city blueprints, bulk BP) are paid separately by applyJobWin (§5.2/§6.2).
    const missionId = `zone::${zone.id}::${job.id}`;
    const mission: Mission = {
      id: missionId,
      name: `${zone.name}: ${job.name}`,
      description: job.name,
      condition: job.condition,
      reward: { blueprintPoints: 1 },
      difficulty: 3,
    };
    registerMission(mission);
    // Clear any stale Job Board offer so Game uses THIS mission, not the board's.
    JobBoardSystem.clearAcceptedOffer();
    lm.setMissionId(missionId);
    lm.setActiveZoneJob({ zoneId: zone.id, jobId: job.id });
    SpawningConfig.getInstance().reset();
    this.scene.start(SceneKey.Loadout);
  }
}
