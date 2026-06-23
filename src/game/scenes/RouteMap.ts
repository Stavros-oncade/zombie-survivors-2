import { Scene } from 'phaser';
import { SceneKey } from '../config/SceneKeys';
import { ReconSystem } from '../systems/ReconSystem';
import { SpawningConfig } from '../systems/SpawningConfig';
import { ReconConfig } from '../config/ReconConfig';
import {
  ReconMap,
  ReconNode,
  ReconNodeKind,
  NODE_LAUNCHES_RUN,
} from '../types/ReconTypes';

// The Long Recon route map (§12). Renders the layered DAG left->right (StS column
// structure), shows cleared/current/available/locked node states, the carried
// run-state (HP / level) and accumulated pending reward tally, and launches the
// selected node's Game run (or resolves SHOP/EVENT on the map with no scene change).
//
// Mirrors the City Reclamation launch/return contract: selecting a run node sets
// the active node in ReconSystem then starts SceneKey.Game; Game reads ReconSystem
// in create() and on WIN returns here (or to GameOver on the boss / on death).

const KIND_COLOR: Record<ReconNodeKind, number> = {
  [ReconNodeKind.START]:  0x6a5d3a,
  [ReconNodeKind.COMBAT]: 0x8b1a1a,
  [ReconNodeKind.ELITE]:  0xb04a8a,
  [ReconNodeKind.CACHE]:  0xe0a020,
  [ReconNodeKind.SHOP]:   0x2a8a8a,
  [ReconNodeKind.EVENT]:  0x3a7a3a,
  [ReconNodeKind.BOSS]:   0xb085ff,
};

const KIND_ICON: Record<ReconNodeKind, string> = {
  [ReconNodeKind.START]:  '⌂',
  [ReconNodeKind.COMBAT]: '⚔',
  [ReconNodeKind.ELITE]:  '☠',
  [ReconNodeKind.CACHE]:  '✦',
  [ReconNodeKind.SHOP]:   '$',
  [ReconNodeKind.EVENT]:  '+',
  [ReconNodeKind.BOSS]:   '♛',
};

export class RouteMap extends Scene {
  constructor() { super(SceneKey.RouteMap); }

  create() {
    const recon = ReconSystem.getInstance();
    if (!recon.isActive()) {
      // Defensive: nothing to show — bail back to the Job Board.
      this.scene.start(SceneKey.JobBoard);
      return;
    }
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    this.cameras.main.setBackgroundColor(0x100d18);

    const map = recon.getMap();

    this.add.text(w / 2, 28, `Long Recon — ${map.name}`, {
      fontFamily: 'Arial Black', fontSize: '32px', color: '#c9aaff', stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5);

    // Run-state readout (carried HP/level) + pending reward tally (§12.1 header).
    this.add.text(w / 2, 62, this.headerLine(recon), {
      fontFamily: 'Arial', fontSize: '16px', color: '#9fe0ff', stroke: '#000000', strokeThickness: 3,
      align: 'center',
    }).setOrigin(0.5);

    this.drawGraph(map, recon, w, h);

    // Abandon button (forfeit per §9 salvage floor).
    const abandonBtn = this.add.text(w / 2 - 120, h - 30, 'Abandon Recon', {
      fontFamily: 'Arial', fontSize: '18px', color: '#ff8888',
      backgroundColor: '#2a1414', stroke: '#000000', strokeThickness: 3, padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', () => abandonBtn.setStyle({ color: '#ffbbbb' }))
      .on('pointerout', () => abandonBtn.setStyle({ color: '#ff8888' }))
      .on('pointerdown', () => {
        const payout = recon.abandonRecon();
        this.scene.start(SceneKey.GameOver, { outcome: 'lose', reconPayout: payout });
      });

    // Back to Job Board (leaves the recon resumable — state stays persisted).
    const backBtn = this.add.text(w / 2 + 120, h - 30, 'Suspend (Resume Later)', {
      fontFamily: 'Arial', fontSize: '18px', color: '#ffffff',
      backgroundColor: '#333333', stroke: '#000000', strokeThickness: 3, padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', () => backBtn.setStyle({ color: '#ffff00' }))
      .on('pointerout', () => backBtn.setStyle({ color: '#ffffff' }))
      .on('pointerdown', () => this.scene.start(SceneKey.JobBoard));
  }

  private headerLine(recon: ReconSystem): string {
    const c = recon.getCarry();
    const p = recon.getRunState()!.pending;
    const hp = c.maxHealth > 0 ? `HP ${c.currentHealth}/${c.maxHealth}` : 'HP full (fresh)';
    const lvl = `Lv ${c.level}`;
    const reward = `Pending: ${p.blueprintPoints} BP · ${p.campResources} Res` +
      (p.specialBlueprintIds.length ? ` · ${p.specialBlueprintIds.length} Special` : '');
    return `${hp}  ·  ${lvl}  ·  ${reward}`;
  }

  private drawGraph(map: ReconMap, recon: ReconSystem, w: number, h: number): void {
    const layers = map.layers;
    const areaX = 70, areaY = 110, areaW = w - 140, areaH = h - 200;
    const colSpacing = areaW / Math.max(1, layers - 1);
    const cleared = new Set(recon.getClearedNodeIds());
    const available = new Set(recon.getAvailableNextNodes().map(n => n.id));
    const currentId = recon.getCurrentNodeId();
    const nodeR = Math.max(20, Math.min(34, colSpacing * 0.16));

    const pos = (n: ReconNode) => {
      const layerNodes = map.nodes.filter(x => x.layer === n.layer);
      const count = layerNodes.length;
      const slotGap = areaH / (count + 1);
      return {
        x: areaX + n.layer * colSpacing,
        y: areaY + slotGap * (n.slot + 1),
      };
    };

    // 1. Edges first (under nodes).
    const edges = this.add.graphics();
    for (const n of map.nodes) {
      const p = pos(n);
      for (const nextId of n.next) {
        const target = map.nodes.find(x => x.id === nextId);
        if (!target) continue;
        const tp = pos(target);
        const onPath = cleared.has(n.id) && (cleared.has(nextId) || available.has(nextId));
        edges.lineStyle(onPath ? 3 : 1.5, onPath ? 0xb085ff : 0x453a5a, onPath ? 0.9 : 0.5);
        edges.beginPath();
        edges.moveTo(p.x, p.y);
        edges.lineTo(tp.x, tp.y);
        edges.strokePath();
      }
    }

    // 2. Nodes.
    for (const n of map.nodes) {
      const p = pos(n);
      const isCleared = cleared.has(n.id);
      const isCurrent = n.id === currentId;
      const isAvailable = available.has(n.id);
      this.drawNode(n, p.x, p.y, nodeR, { isCleared, isCurrent, isAvailable }, recon);
    }
  }

  private drawNode(
    n: ReconNode,
    x: number,
    y: number,
    r: number,
    state: { isCleared: boolean; isCurrent: boolean; isAvailable: boolean },
    recon: ReconSystem
  ): void {
    const baseColor = KIND_COLOR[n.kind];
    const g = this.add.graphics();
    const alpha = state.isCleared ? 0.45 : state.isAvailable || state.isCurrent ? 1 : 0.35;
    g.fillStyle(baseColor, alpha).fillCircle(x, y, r);
    const borderColor = state.isCurrent ? 0x00ff88 : state.isAvailable ? 0xffff00 : 0x000000;
    g.lineStyle(state.isCurrent || state.isAvailable ? 4 : 2, borderColor, 1).strokeCircle(x, y, r);

    this.add.text(x, y, KIND_ICON[n.kind], {
      fontFamily: 'Arial', fontSize: `${Math.round(r * 0.9)}px`, color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);

    // Tier badge below.
    this.add.text(x, y + r + 10, `T${n.difficultyTier}`, {
      fontFamily: 'Arial', fontSize: '12px', color: state.isAvailable ? '#ffe9a8' : '#888888',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 0);

    if (state.isAvailable) {
      const hit = this.add.circle(x, y, r + 4).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => g.lineStyle(5, 0xffffff, 1).strokeCircle(x, y, r));
      hit.on('pointerout', () => g.lineStyle(4, 0xffff00, 1).strokeCircle(x, y, r));
      hit.on('pointerdown', () => this.selectNode(n, recon));
    }
  }

  private selectNode(node: ReconNode, recon: ReconSystem): void {
    if (!recon.selectNextNode(node.id)) return;
    if (NODE_LAUNCHES_RUN[node.kind]) {
      // Launch the Game run; it reads ReconSystem in create() (§5.3). Reset stale
      // dev SpawnTuner state, same as the City/Job Board launch path.
      SpawningConfig.getInstance().reset();
      this.scene.start(SceneKey.Game);
    } else {
      this.resolveMapNode(node, recon);
    }
  }

  /** SHOP / EVENT resolved on the map as a modal (§7 / §12.2). */
  private resolveMapNode(node: ReconNode, recon: ReconSystem): void {
    if (node.kind === ReconNodeKind.EVENT) {
      // Field medic: restore a fraction of max HP toward full.
      recon.resolveMapNode(node.id, { healFraction: ReconConfig.eventHealFraction });
      this.scene.restart();
      return;
    }
    if (node.kind === ReconNodeKind.SHOP) {
      // Supply cache: spend pending BP to heal (a hedge against forfeit-on-death).
      const pending = recon.getRunState()!.pending.blueprintPoints;
      if (pending >= ReconConfig.shopHealCostBP) {
        recon.resolveMapNode(node.id, {
          spendBlueprintPoints: ReconConfig.shopHealCostBP,
          healFraction: ReconConfig.shopHealFraction,
        });
      } else {
        // Can't afford — resolve as a free pass-through (accrues the node reward).
        recon.resolveMapNode(node.id, {});
      }
      this.scene.restart();
      return;
    }
    // START or any other non-run kind: just advance.
    recon.resolveMapNode(node.id, {});
    this.scene.restart();
  }
}
