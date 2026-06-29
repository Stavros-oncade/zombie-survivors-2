import { GameObjects, Scene } from 'phaser';
import { SceneKey } from '../config/SceneKeys';
import { JobBoardSystem } from '../systems/JobBoardSystem';
import { JobOffer, JobLaunchKind } from '../types/JobBoardTypes';
import { BlueprintSystem } from '../systems/BlueprintSystem';
import { CampaignSystem } from '../systems/CampaignSystem';
import { CampSystem } from '../systems/CampSystem';
import { JobBoardConfig } from '../config/JobBoardConfig';
import { SpawningConfig } from '../systems/SpawningConfig';
import { transitionTo, fadeIn } from '../utils/transition';

// The Job Board: 3 mission offers the player chooses between (§7). Text-driven,
// matching Loadout/Blueprints style. Picking an offer commits it via
// JobBoardSystem, then routes per launch.kind: normal → Loadout → Game; special
// → sub-loop scenes (stubbed until those phases land).

/** A single reward/threat pill descriptor. */
interface Chip { label: string; color: number; }

/** Layout result carried from the measure pass into the finalize pass so all
 *  cards can share a uniform height and vertical centering. */
interface CardLayout {
  container: GameObjects.Container;
  bgG: GameObjects.Graphics;       // card fill + border (bottom layer)
  cw: number;
  isSpecial: boolean;
  borderColor: number;
  bgColor: number;
  contentBottom: number;           // local Y just below the last content section
}

export class JobBoard extends Scene {
  constructor() { super(SceneKey.JobBoard); }

  // ── palette ──────────────────────────────────────────────────────────────
  private static readonly CARD_BG_NORMAL = 0x17140e;
  private static readonly CARD_BG_SPECIAL = 0x241b38;
  private static readonly BORDER_SPECIAL = 0xb085ff;
  private static readonly DIVIDER = 0x4a4534;
  private static readonly PILL_NEUTRAL = 0x7a7468;
  private static readonly LABEL_COLOR = '#8a7f63';

  create() {
    fadeIn(this);
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    this.cameras.main.setBackgroundColor(0x14110c);

    this.add.text(w / 2, 36, 'Job Board', {
      fontFamily: 'Arial Black', fontSize: '40px', color: '#ffd54f', stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5);

    // Currencies strip.
    this.add.text(w / 2, 78, this.currenciesLine(), {
      fontFamily: 'Arial', fontSize: '18px', color: '#9fe0ff', stroke: '#000000', strokeThickness: 3,
      align: 'center',
    }).setOrigin(0.5);

    const offers = JobBoardSystem.getOffers();
    const cardW = Math.min(360, (w - 80) / 3);
    const gap = 20;
    const totalW = offers.length * cardW + (offers.length - 1) * gap;
    const startX = (w - totalW) / 2;

    // Pass 1 — build each card's content and measure its height (y=0 for now).
    const layouts = offers.map((offer, i) => {
      const x = startX + i * (cardW + gap);
      return this.buildCardContent(offer, x, cardW);
    });

    // Uniform card height: dock the Accept button below the tallest content.
    const contentBottom = Math.max(...layouts.map((l) => l.contentBottom));
    const acceptTop = contentBottom + 18;
    const cardH = acceptTop + 56;   // room for the Accept button + padding

    // Vertically centre the card block in the space between header and footer.
    const areaTop = 110;
    const areaBottom = h - 100;
    const top = Math.max(areaTop, areaTop + (areaBottom - areaTop - cardH) / 2);

    // Pass 2 — draw the backgrounds at the shared height and wire interactivity.
    layouts.forEach((l, i) => this.finalizeCard(l, offers[i], top, cardH, acceptTop));

    // Reroll button.
    const state = JobBoardSystem.getState();
    const free = state.rerollsRemaining;
    const rerollLabel = free > 0
      ? `Reroll (${free} free)`
      : `Reroll (${JobBoardConfig.REROLL_BP_COST} BP)`;
    const canReroll = JobBoardSystem.canReroll();
    const rerollBtn = this.add.text(w / 2 - 120, h - 60, rerollLabel, {
      fontFamily: 'Arial', fontSize: '24px', color: canReroll ? '#ffffff' : '#777777',
      backgroundColor: '#333333', stroke: '#000000', strokeThickness: 4, padding: { x: 14, y: 8 },
    }).setOrigin(0.5);
    if (canReroll) {
      rerollBtn.setInteractive({ useHandCursor: true })
        .on('pointerover', () => rerollBtn.setStyle({ color: '#ffff00' }))
        .on('pointerout', () => rerollBtn.setStyle({ color: '#ffffff' }))
        .on('pointerdown', () => {
          if (JobBoardSystem.reroll()) { this.scene.restart(); }
        });
    }

    // Back button.
    const backBtn = this.add.text(w / 2 + 120, h - 60, 'Back', {
      fontFamily: 'Arial', fontSize: '24px', color: '#ffffff',
      backgroundColor: '#333333', stroke: '#000000', strokeThickness: 4, padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', () => backBtn.setStyle({ color: '#ffff00' }))
      .on('pointerout', () => backBtn.setStyle({ color: '#ffffff' }))
      .on('pointerdown', () => transitionTo(this, SceneKey.MainMenu));
  }

  private currenciesLine(): string {
    const bp = BlueprintSystem.getPoints();
    const camp = CampSystem.getInstance().getState();
    const campaign = CampaignSystem.getProgress();
    return `BP ${bp}  ·  Campaign ${campaign}  ·  Horde ${camp.hordeStrength}  ·  ` +
      `Food ${camp.needs.food.stock}  Water ${camp.needs.water.stock}  Med ${camp.needs.medicine.stock}`;
  }

  /** #6-hex helper for Phaser text color strings. */
  private hex(n: number): string {
    return '#' + n.toString(16).padStart(6, '0');
  }

  // ── Pass 1: content + measurement ──────────────────────────────────────────
  private buildCardContent(offer: JobOffer, x: number, cw: number): CardLayout {
    const isSpecial = offer.launch.kind !== JobLaunchKind.GAME_RUN;
    const tier = JobBoardSystem.tierBadge(offer.difficulty);
    const tierColor = parseInt(tier.color.slice(1), 16);
    const borderColor = isSpecial ? JobBoard.BORDER_SPECIAL : tierColor;
    const bgColor = isSpecial ? JobBoard.CARD_BG_SPECIAL : JobBoard.CARD_BG_NORMAL;

    const pad = 14;
    const innerW = cw - pad * 2;

    const container = this.add.container(x, 0);
    const bgG = this.add.graphics();   // bottom layer — filled in pass 2
    const decoG = this.add.graphics(); // bands, dividers, pips, pill backgrounds
    container.add([bgG, decoG]);

    // ── header band: optional EXPEDITION pill, title, risk meter ──
    let by = 10;

    if (isSpecial) {
      const label = offer.launch.kind === JobLaunchKind.LONG_RECON ? 'EXPEDITION' : 'RECLAIM';
      const pillT = this.add.text(0, 0, label, {
        fontFamily: 'Arial Black', fontSize: '11px', color: '#1a1330',
      }).setOrigin(0.5);
      const pw = Math.ceil(pillT.width) + 18;
      const ph = Math.ceil(pillT.height) + 7;
      decoG.fillStyle(JobBoard.BORDER_SPECIAL, 1).fillRoundedRect(cw / 2 - pw / 2, by, pw, ph, ph / 2);
      pillT.setPosition(cw / 2, by + ph / 2);
      container.add(pillT);
      by += ph + 8;
    }

    const titleT = this.add.text(cw / 2, by, offer.title, {
      fontFamily: 'Arial Black', fontSize: '19px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
      align: 'center', wordWrap: { width: innerW },
    }).setOrigin(0.5, 0);
    container.add(titleT);
    by += Math.ceil(titleT.height) + 8;

    // Risk meter: tier label + 5 colour-coded pips (replaces the raw score).
    const labelT = this.add.text(0, 0, tier.label.toUpperCase(), {
      fontFamily: 'Arial Black', fontSize: '13px', color: tier.color, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0, 0.5);
    const pipR = 5;
    const pipStep = 15;
    const pipsW = 5 * pipStep - (pipStep - pipR * 2);
    const groupW = Math.ceil(labelT.width) + 12 + pipsW;
    const meterCY = by + pipR + 1;
    const groupX = cw / 2 - groupW / 2;
    labelT.setPosition(groupX, meterCY);
    container.add(labelT);
    const pipsX = groupX + Math.ceil(labelT.width) + 12;
    const filled = Phaser.Math.Clamp(Math.ceil(offer.difficulty / 20), 1, 5);
    by = meterCY + pipR + 10;
    const bandH = by;

    // Header band fill (tinted by difficulty). Painted into decoG BEFORE the pips
    // so the pips render crisply on top; decoG as a whole sits under the text layer.
    decoG.fillStyle(tierColor, 0.10).fillRoundedRect(0, 0, cw, bandH, { tl: 10, tr: 10, bl: 0, br: 0 });
    decoG.lineStyle(1, tierColor, 0.45).lineBetween(2, bandH, cw - 2, bandH);
    for (let p = 0; p < 5; p++) {
      const pcx = pipsX + p * pipStep + pipR;
      decoG.fillStyle(p < filled ? tierColor : 0x3a352a, 1).fillCircle(pcx, meterCY, pipR);
      decoG.lineStyle(1, p < filled ? tierColor : 0x55503f, 0.9).strokeCircle(pcx, meterCY, pipR);
    }

    // ── body ──
    let ty = bandH + 12;

    // Flavor.
    const flavorT = this.add.text(cw / 2, ty, offer.flavor, {
      fontFamily: 'Arial', fontSize: '13px', color: '#b9b3a3', align: 'center',
      wordWrap: { width: innerW }, fontStyle: 'italic',
    }).setOrigin(0.5, 0);
    container.add(flavorT);
    ty += Math.ceil(flavorT.height) + 12;

    // Objective section.
    ty = this.drawDivider(decoG, ty, cw, pad);
    ty = this.drawSectionLabel(container, 'OBJECTIVE', pad, ty);
    const objT = this.add.text(pad, ty, offer.mission.description, {
      fontFamily: 'Arial', fontSize: '14px', color: '#ffe9a8', align: 'left',
      wordWrap: { width: innerW },
    }).setOrigin(0, 0);
    container.add(objT);
    ty += Math.ceil(objT.height) + 12;

    // Threats (modifiers) section.
    ty = this.drawDivider(decoG, ty, cw, pad);
    ty = this.drawSectionLabel(container, 'THREATS', pad, ty);
    const modChips: Chip[] = offer.modifiers.length
      ? offer.modifiers.map((m) => ({ label: JobBoardSystem.describeModifier(m), color: 0xff8a65 }))
      : [{ label: 'No threats', color: JobBoard.PILL_NEUTRAL }];
    ty = this.flowPills(container, decoG, modChips, pad, ty, innerW) + 12;

    // Reward section.
    ty = this.drawDivider(decoG, ty, cw, pad);
    ty = this.drawSectionLabel(container, 'REWARD', pad, ty);
    ty = this.flowPills(container, decoG, this.rewardChips(offer), pad, ty, innerW) + 4;

    return { container, bgG, cw, isSpecial, borderColor, bgColor, contentBottom: ty };
  }

  private drawDivider(decoG: GameObjects.Graphics, y: number, cw: number, pad: number): number {
    decoG.lineStyle(1, JobBoard.DIVIDER, 0.6).lineBetween(pad, y, cw - pad, y);
    return y + 10;
  }

  private drawSectionLabel(container: GameObjects.Container, label: string, x: number, y: number): number {
    const t = this.add.text(x, y, label, {
      fontFamily: 'Arial Black', fontSize: '11px', color: JobBoard.LABEL_COLOR,
    }).setOrigin(0, 0);
    container.add(t);
    return y + Math.ceil(t.height) + 5;
  }

  /** Flow a row of pills left→right, wrapping within maxW. Returns the bottom Y. */
  private flowPills(
    container: GameObjects.Container,
    decoG: GameObjects.Graphics,
    chips: Chip[],
    x0: number,
    y0: number,
    maxW: number,
  ): number {
    const padX = 8, padY = 4, gapX = 6, gapY = 6;
    let cx = x0, cy = y0, rowH = 0;
    for (const chip of chips) {
      const t = this.add.text(0, 0, chip.label, {
        fontFamily: 'Arial', fontSize: '12px', color: this.hex(chip.color),
      });
      const pw = Math.ceil(t.width) + padX * 2;
      const ph = Math.ceil(t.height) + padY * 2;
      if (cx + pw > x0 + maxW && cx > x0) { cx = x0; cy += rowH + gapY; rowH = 0; }
      decoG.fillStyle(chip.color, 0.16).fillRoundedRect(cx, cy, pw, ph, 6);
      decoG.lineStyle(1, chip.color, 0.6).strokeRoundedRect(cx, cy, pw, ph, 6);
      t.setPosition(cx + padX, cy + padY);
      container.add(t);
      cx += pw + gapX;
      rowH = Math.max(rowH, ph);
    }
    return cy + rowH;
  }

  private rewardChips(offer: JobOffer): Chip[] {
    const chips: Chip[] = [];
    const c = offer.reward.camp;
    if (c.blueprintPoints) chips.push({ label: `${c.blueprintPoints} BP`, color: 0xffd54f });
    if (offer.reward.campaignPoints) chips.push({ label: `${offer.reward.campaignPoints} Campaign`, color: 0xb085ff });
    if (c.hordePressureReduction) chips.push({ label: `-${c.hordePressureReduction} Horde`, color: 0x9fe0ff });
    if (c.food) chips.push({ label: `${c.food} Food`, color: 0x9ccc65 });
    if (c.water) chips.push({ label: `${c.water} Water`, color: 0x4fc3f7 });
    if (c.medicine) chips.push({ label: `${c.medicine} Med`, color: 0xff8a80 });
    if (c.survivorsRescued) chips.push({ label: `${c.survivorsRescued} Survivors`, color: 0xffffff });
    if (!chips.length) chips.push({ label: 'No reward', color: JobBoard.PILL_NEUTRAL });
    return chips;
  }

  // ── Pass 2: backgrounds, accept button, whole-card interactivity ───────────
  private finalizeCard(l: CardLayout, offer: JobOffer, top: number, cardH: number, acceptTop: number): void {
    const { container, bgG, cw } = l;
    container.setY(top);

    // Card fill + border (bottom layer, drawn now that the height is known).
    bgG.fillStyle(l.bgColor, 1).fillRoundedRect(0, 0, cw, cardH, 10);
    bgG.lineStyle(2, l.borderColor, 0.85).strokeRoundedRect(0, 0, cw, cardH, 10);

    // Hover glow border — hidden until the card is hovered.
    const hoverG = this.add.graphics();
    hoverG.lineStyle(3, l.isSpecial ? JobBoard.BORDER_SPECIAL : 0xffffff, 0.95)
      .strokeRoundedRect(0, 0, cw, cardH, 10);
    hoverG.setVisible(false);
    container.add(hoverG);

    // Accept button.
    const acceptBtn = this.add.text(cw / 2, acceptTop + 18, 'Accept', {
      fontFamily: 'Arial Black', fontSize: '20px', color: '#ffffff',
      backgroundColor: '#2a5d2a', stroke: '#000000', strokeThickness: 4, padding: { x: 18, y: 8 },
    }).setOrigin(0.5);
    container.add(acceptBtn);

    // Whole-card interactive zone (transparent) sits under the Accept button so
    // hovering the button still keeps its own highlight, but the rest of the card
    // is a click target too (#5).
    const zone = this.add.rectangle(cw / 2, cardH / 2, cw, cardH, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    container.add(zone);
    container.bringToTop(acceptBtn); // ensure the button stays clickable on top

    const onOver = () => { hoverG.setVisible(true); container.setY(top - 4); };
    const onOut = () => { hoverG.setVisible(false); container.setY(top); };

    zone.on('pointerover', onOver)
      .on('pointerout', onOut)
      .on('pointerdown', () => this.accept(offer));

    acceptBtn.setInteractive({ useHandCursor: true })
      .on('pointerover', () => { acceptBtn.setStyle({ color: '#ffff00' }); onOver(); })
      .on('pointerout', () => { acceptBtn.setStyle({ color: '#ffffff' }); onOut(); })
      .on('pointerdown', () => this.accept(offer));
  }

  private accept(offer: JobOffer): void {
    JobBoardSystem.setAcceptedOffer(offer);
    switch (offer.launch.kind) {
      case JobLaunchKind.GAME_RUN:
        // Normal run flow bypasses the dev SpawnTuner; reset stale tuner state.
        SpawningConfig.getInstance().reset();
        transitionTo(this, SceneKey.Loadout);
        break;
      case JobLaunchKind.LONG_RECON:
        // Expedition: outfit ONCE (Loadout in recon mode), which on Start generates
        // the DAG, calls ReconSystem.startRecon, and routes to the RouteMap (§6/§12).
        SpawningConfig.getInstance().reset();
        transitionTo(this, SceneKey.Loadout, { reconMode: true });
        break;
      case JobLaunchKind.CITY_RECLAMATION:
        // Route to the City Reclamation meta-map: the player picks a zone there, which
        // sets its own mission + active zone job (the board offer's nominal mission is
        // discarded — clearAcceptedOffer is called when a zone is accepted).
        transitionTo(this, SceneKey.CityReclamation);
        break;
    }
  }
}
