import { Scene } from 'phaser';
import { SceneKey } from '../config/SceneKeys';
import { CampSystem } from '../systems/CampSystem';
import { resolveMission } from '../config/Missions';
import { CycleReport, CampReward } from '../types/CampTypes';
import { JobBoardSystem } from '../systems/JobBoardSystem';
import { CampaignSystem } from '../systems/CampaignSystem';
import { SurvivorOutcome, SurvivorStatus } from '../types/ExpeditionTypes';
import { CityReclamationSystem, JobWinResult } from '../systems/CityReclamationSystem';
import { LoadoutManager } from '../systems/LoadoutManager';
import { ZoneState } from '../types/CityTypes';
import { ReconPayout } from '../types/ReconTypes';

export class GameOver extends Scene
{
    camera: Phaser.Cameras.Scene2D.Camera;
    background: Phaser.GameObjects.Image;
    gameOverText: Phaser.GameObjects.Text;
    statsText: Phaser.GameObjects.Text;
    menuButton: Phaser.GameObjects.Text;
    
    // Player stats
    enemiesKilled: number = 0;
    xpGained: number = 0;
    levelReached: number = 1;
    playTimeSeconds: number = 0;

    // Outcome presentation
    outcome: 'win' | 'lose' = 'lose';
    missionName: string | undefined = undefined;
    missionId: string | undefined = undefined;
    runId: string | undefined = undefined;
    blueprintPointsAwarded: number = 0;

    // Expedition (§5/§6): reward scaling + assigned-survivor outcomes.
    rewardMultiplier: number = 1;
    onWinBonusPoints: number = 0;
    survivorOutcomes: SurvivorOutcome[] = [];

    // City Reclamation (§6.2): the zone job this run was attributed to (if any).
    zoneId: string | undefined = undefined;
    jobId: string | undefined = undefined;
    zoneDifficulty: number = 1;
    private cameFromZoneJob: boolean = false;
    private zoneJobResult: JobWinResult | null = null;

    // Long Recon (§12.4): terminal payout summary (win or failed). When present, this
    // GameOver presents the recon result and routes back to the Job Board, and the
    // standalone camp-cycle / job-board resolution is skipped (recon banks its own
    // rewards in ReconSystem; no runId is passed for recon terminations).
    private reconPayout: ReconPayout | null = null;

    constructor ()
    {
        super(SceneKey.GameOver);
    }

    init(data: {
        enemiesKilled?: number,
        xpGained?: number,
        levelReached?: number,
        playTimeSeconds?: number,
        outcome?: 'win' | 'lose',
        missionName?: string,
        missionId?: string,
        runId?: string,
        blueprintPointsAwarded?: number,
        rewardMultiplier?: number,
        onWinBonusPoints?: number,
        survivorOutcomes?: SurvivorOutcome[],
        zoneId?: string,
        jobId?: string,
        zoneDifficulty?: number,
        reconPayout?: ReconPayout,
        reconFailed?: boolean
    })
    {
        // Reset transient state (scenes are reused across runs).
        this.outcome = 'lose';
        this.missionName = undefined;
        this.missionId = undefined;
        this.runId = undefined;
        this.blueprintPointsAwarded = 0;
        this.rewardMultiplier = 1;
        this.onWinBonusPoints = 0;
        this.survivorOutcomes = [];
        this.zoneId = undefined;
        this.jobId = undefined;
        this.zoneDifficulty = 1;
        this.cameFromZoneJob = false;
        this.zoneJobResult = null;
        this.reconPayout = null;

        // Get stats passed from the Game scene
        if (data.enemiesKilled !== undefined) this.enemiesKilled = data.enemiesKilled;
        if (data.xpGained !== undefined) this.xpGained = data.xpGained;
        if (data.levelReached !== undefined) this.levelReached = data.levelReached;
        if (data.playTimeSeconds !== undefined) this.playTimeSeconds = data.playTimeSeconds;
        if (data.outcome !== undefined) this.outcome = data.outcome;
        if (data.missionName !== undefined) this.missionName = data.missionName;
        if (data.missionId !== undefined) this.missionId = data.missionId;
        if (data.runId !== undefined) this.runId = data.runId;
        if (data.blueprintPointsAwarded !== undefined) this.blueprintPointsAwarded = data.blueprintPointsAwarded;
        if (data.rewardMultiplier !== undefined) this.rewardMultiplier = data.rewardMultiplier;
        if (data.onWinBonusPoints !== undefined) this.onWinBonusPoints = data.onWinBonusPoints;
        if (data.survivorOutcomes !== undefined) this.survivorOutcomes = data.survivorOutcomes;
        if (data.zoneId !== undefined) this.zoneId = data.zoneId;
        if (data.jobId !== undefined) this.jobId = data.jobId;
        if (data.zoneDifficulty !== undefined) this.zoneDifficulty = data.zoneDifficulty;
        if (data.reconPayout !== undefined) this.reconPayout = data.reconPayout;
        this.cameFromZoneJob = !!(this.zoneId && this.jobId);
    }

    create ()
    {
        const isWin = this.outcome === 'win';

        // Advance the Survivor Camp by one cycle (per run resolved). Idempotent
        // per runId so a scene restart can't double-resolve. On a win, the won
        // mission's CampReward is applied (BP, food/water/medicine, horde relief,
        // rescued survivors); on a loss, the camp drains with nothing coming in.
        //
        // Reward source of truth: the accepted Job Board offer (§6.5). Its
        // CampReward (blueprints + horde relief + food/water/medicine) is handed
        // to advanceCycle as `missionReward` and applied there EXACTLY ONCE — the
        // idempotency guard (runId) prevents a double-pay on scene restart. The
        // legacy `Mission.reward` path is the fallback only when no offer is
        // accepted (generated offers set Mission.reward = undefined to avoid any
        // double-pay through resolveMission).
        let cycleReport: CycleReport | null = null;
        // Captured before onRunResolved() clears the accepted offer, for the win panel.
        let rewardSummary: string | null = null;
        if (this.runId) {
            const camp = CampSystem.getInstance();
            // Was this exact run already resolved? (scene restart guard) — drives
            // idempotency for the campaign-point payout, which lives outside the
            // CampReward bundle and so isn't covered by advanceCycle's own guard.
            const alreadyResolved = camp.getState().lastResolvedRunId === this.runId;
            const offer = JobBoardSystem.getAcceptedOffer();
            if (isWin && offer) rewardSummary = JobBoardSystem.describeReward(offer.reward);
            let reward: CampReward | undefined;
            if (isWin) {
                const baseReward = offer
                    ? offer.reward.camp
                    : (this.missionId ? resolveMission(this.missionId).reward : undefined);
                // Apply Expedition risk-modifier reward scaling (§5): scale the
                // blueprintPoints by rewardMultiplier and add any ON_WIN perk bonus.
                // Other CampReward currencies are unaffected by risk scaling.
                if (baseReward && (this.rewardMultiplier !== 1 || this.onWinBonusPoints > 0)) {
                    const baseBP = baseReward.blueprintPoints ?? 0;
                    reward = {
                        ...baseReward,
                        blueprintPoints: Math.round(baseBP * this.rewardMultiplier) + this.onWinBonusPoints,
                    };
                } else {
                    reward = baseReward;
                }
                // Campaign progression (4th currency) lives in its own system, not
                // in CampReward — pay it here once, gated on win + first resolution.
                if (!alreadyResolved && offer?.reward.campaignPoints) {
                    CampaignSystem.addProgress(offer.reward.campaignPoints);
                }
            }
            cycleReport = camp.advanceCycle({
                outcome: this.outcome,
                runId: this.runId,
                missionReward: reward,
            });
            // Consume the board for BOTH win and lose: next open regenerates (§4.3).
            // Only on first resolution so a restart doesn't burn an extra board.
            if (!alreadyResolved) JobBoardSystem.onRunResolved();

            // City Reclamation (§6.2): on a WIN that carried a zone job, drop the zone's
            // infestation + bleed to neighbors + resolve unlocks — exactly once. The
            // applyJobWin's `cleared` latch + grantedRewardKeys ledger make it
            // re-entrancy-safe even if the alreadyResolved gate were bypassed.
            if (isWin && !alreadyResolved && this.cameFromZoneJob) {
                this.zoneJobResult = CityReclamationSystem.applyJobWin(
                    this.zoneId!, this.jobId!, this.zoneDifficulty
                );
            }
            // Clear the accepted zone job on ANY resolution (win or lose) so a later
            // free-play win can't mis-credit a finished zone job (§13.7).
            if (!alreadyResolved) LoadoutManager.getInstance().setActiveZoneJob(null);
        }

        this.camera = this.cameras.main
        // Distinct background tint for a win.
        this.camera.setBackgroundColor(isWin ? 0x2a2410 : 0x303030);

        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        this.background = this.add.image(width / 2, height / 2, 'enemy');
        this.background.setScale(4);
        this.background.setAlpha(0.7);

        const yOffset = 150;

        const titleText = this.reconPayout
            ? (isWin ? 'RECON COMPLETE' : 'RECON FAILED')
            : (isWin ? 'MISSION COMPLETE' : 'Game Over');
        this.gameOverText = this.add.text(width / 2, height / 3 - yOffset, titleText, {
            fontFamily: 'Arial Black', fontSize: isWin ? 56 : 64, color: isWin ? '#ffd54f' : '#ffffff',
            stroke: '#000000', strokeThickness: 8,
            align: 'center'
        }).setOrigin(0.5).setDepth(100);

        // Objective result line (win = cleared, lose = failed) when a mission was active.
        if (this.missionName) {
            const objLine = isWin
                ? `Objective: ${this.missionName} — CLEARED`
                : `Objective: ${this.missionName} — FAILED`;
            this.add.text(width / 2, height / 3 - yOffset + 60, objLine, {
                fontFamily: 'Arial', fontSize: 24, color: isWin ? '#ffe9a8' : '#bbbbbb',
                stroke: '#000000', strokeThickness: 4, align: 'center'
            }).setOrigin(0.5).setDepth(100);
        }

        // Format play time as minutes and seconds (same format as GameUI)
        const minutes = Math.floor(this.playTimeSeconds / 60);
        const seconds = this.playTimeSeconds % 60;
        const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        // Display player stats (shared between outcomes)
        let statsBody = `Enemies Killed: ${this.enemiesKilled}\nXP Gained: ${this.xpGained}\nLevel Reached: ${this.levelReached}\nPlay Time: ${formattedTime}`;
        if (isWin) {
            // Surface the full Job Board reward bundle on the win panel (§6.5).
            if (rewardSummary) {
                statsBody += `\nReward: ${rewardSummary}`;
            } else if (this.blueprintPointsAwarded > 0) {
                statsBody += `\n+${this.blueprintPointsAwarded} Blueprint Points`;
            }
        }
        this.statsText = this.add.text(width / 2, height / 2 + yOffset/2, statsBody, {
            fontFamily: 'Arial', fontSize: 32, color: '#ffffff',
            stroke: '#000000', strokeThickness: 4,
            align: 'center'
        }).setOrigin(0.5).setDepth(100);

        // Expedition survivor outcomes (§6/§8.1): "Survivor X — KIA / INJURED / returned".
        if (this.survivorOutcomes.length > 0) {
            const lines = this.survivorOutcomes.map((o) => {
                const label = o.status === SurvivorStatus.DEAD ? 'KIA'
                    : o.status === SurvivorStatus.INJURED ? 'INJURED'
                    : 'returned';
                return `${o.name} — ${label}`;
            });
            const anyLost = this.survivorOutcomes.some((o) => o.status !== SurvivorStatus.HEALTHY);
            this.add.text(width / 2, height / 2 + yOffset * 0.95, `Squad: ${lines.join('  ·  ')}`, {
                fontFamily: 'Arial', fontSize: 20, color: anyLost ? '#ff9b6b' : '#bfe9bf',
                stroke: '#000000', strokeThickness: 4, align: 'center',
                wordWrap: { width: Math.min(820, width * 0.9) },
            }).setOrigin(0.5).setDepth(100);
        }

        // Compact camp summary beneath the run stats (spec §10.4).
        if (cycleReport) {
            const r = cycleReport;
            const deaths = r.deaths.fromFood + r.deaths.fromWater + r.deaths.fromMedicine + r.deaths.fromBreach;
            const parts: string[] = [];
            const prod = (r.produced.food ?? 0) + (r.produced.water ?? 0) + (r.produced.medicine ?? 0);
            if (r.rewardApplied || prod > 0) parts.push(`Supplies in`);
            parts.push(`Horde ${r.hordeStrengthAfter}/${r.campDefense}${r.breached ? ' BREACH' : ''}`);
            if (deaths > 0) parts.push(`${deaths} survivor(s) lost`);
            else if (r.regrowth > 0) parts.push(`+${r.regrowth} survivor(s)`);
            parts.push(`Survivors ${r.survivorsAfter}`);
            this.add.text(width / 2, height / 2 + yOffset * 1.35, `Camp: ${parts.join(' · ')}`, {
                fontFamily: 'Arial', fontSize: 22, color: r.extinct ? '#ff6b6b' : '#9fe0ff',
                stroke: '#000000', strokeThickness: 4, align: 'center',
            }).setOrigin(0.5).setDepth(100);

            // Hard meta-loss: route to the EXTINCTION state in the Camp scene.
            if (r.extinct) {
                this.add.text(width / 2, height / 2 + yOffset * 2, 'View Camp (EXTINCTION)', {
                    fontFamily: 'Arial Black', fontSize: 30, color: '#ff4444',
                    backgroundColor: '#000000', stroke: '#000000', strokeThickness: 4,
                    padding: { x: 20, y: 10 },
                }).setOrigin(0.5).setDepth(100).setInteractive({ useHandCursor: true })
                  .on('pointerdown', () => this.scene.start(SceneKey.Camp));
                this.scene.get(SceneKey.Game).events.emit('current-scene-ready', this);
                return;
            }
        }

        // Long Recon terminal summary (§12.4): nodes cleared + banked/salvaged payout.
        if (this.reconPayout) {
            const p = this.reconPayout;
            const parts: string[] = [`Nodes cleared: ${p.nodesCleared}/${p.totalNodes}`];
            if (p.blueprintPoints > 0) parts.push(`+${p.blueprintPoints} BP`);
            if (p.campResources > 0) parts.push(`+${p.campResources} Resources`);
            if (p.specialBlueprintIds.length > 0) parts.push(`+${p.specialBlueprintIds.length} Special Blueprint(s)`);
            const label = isWin
                ? `${p.reconName} — ${parts.join('  ·  ')}`
                : `${p.reconName} — ${parts.join('  ·  ')} (salvage)`;
            this.add.text(width / 2, height / 2 + yOffset * 1.65, label, {
                fontFamily: 'Arial Black', fontSize: 22, color: isWin ? '#2ecc71' : '#e0a020',
                stroke: '#000000', strokeThickness: 4, align: 'center',
                wordWrap: { width: Math.min(880, width * 0.92) },
            }).setOrigin(0.5).setDepth(100);
        }

        // City Reclamation result line: "Infestation -N • Zone CONTESTED/CLEARED" (§6 / §11.6).
        if (this.zoneJobResult && this.zoneJobResult.applied) {
            const z = this.zoneJobResult;
            const dropped = Math.round(z.infestationBefore - z.infestationAfter);
            const stateLabel = z.zoneCleared ? 'ZONE CLEARED'
                : z.newState === ZoneState.CONTESTED ? 'Zone CONTESTED' : 'Zone still INFESTED';
            let line = `Infestation -${dropped}  ·  ${stateLabel}`;
            if (z.cityReclaimed) line += '  ·  CITY RECLAIMED';
            this.add.text(width / 2, height / 2 + yOffset * 1.65, line, {
                fontFamily: 'Arial Black', fontSize: 24, color: z.zoneCleared ? '#2ecc71' : '#e0a020',
                stroke: '#000000', strokeThickness: 4, align: 'center',
            }).setOrigin(0.5).setDepth(100);
        }

        // Create a button to return — to the Job Board after a recon, the City Map when
        // this run came from a zone job, else the Main Menu.
        const returnLabel = this.reconPayout ? 'Back to Job Board'
            : this.cameFromZoneJob ? 'Back to City Map' : 'Back to Main Menu';
        this.menuButton = this.add.text(width / 2, height / 2 + yOffset*2, returnLabel, {
            fontFamily: 'Arial', fontSize: 32, color: '#ffffff',
            backgroundColor: '#000000', stroke: '#000000', strokeThickness: 4,
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setDepth(100).setInteractive();
        
        // Add hover effect
        this.menuButton.on('pointerover', () => {
            this.menuButton.setStyle({ color: '#ffff00' });
        });
        
        this.menuButton.on('pointerout', () => {
            this.menuButton.setStyle({ color: '#ffffff' });
        });
        
        // Add click event to return to main menu
        this.menuButton.on('pointerdown', () => {
            this.changeScene();
        });
        
        // Emit scene ready event directly to the game
        this.scene.get(SceneKey.Game).events.emit('current-scene-ready', this);
    }

    changeScene ()
    {
        if (this.reconPayout) { this.scene.start(SceneKey.JobBoard); return; }
        this.scene.start(this.cameFromZoneJob ? SceneKey.CityReclamation : SceneKey.MainMenu);
    }
}
