import { PlayerStats, KillstreakPerkId } from '../types/GameTypes';
import { MissionProgress } from '../types/MissionTypes';

export class GameUI {
    private healthBar: Phaser.GameObjects.Graphics;
    private experienceBar: Phaser.GameObjects.Graphics;
    private levelText: Phaser.GameObjects.Text;
    private timerText: Phaser.GameObjects.Text;
    private scene: Phaser.Scene;
    private gameTime: number;
    private skillCooldownArc: Phaser.GameObjects.Graphics | null = null;
    private skillCooldownLabel: Phaser.GameObjects.Text | null = null;
    private killstreakText: Phaser.GameObjects.Text | null = null;
    private objectiveTitle: Phaser.GameObjects.Text | null = null;
    private objectiveDetail: Phaser.GameObjects.Text | null = null;
    private objectiveBar: Phaser.GameObjects.Graphics | null = null;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.gameTime = 0;
        this.initialize();
    }

    private initialize(): void {
        const padding = 16;
        let y = padding;

        // Create health bar
        this.healthBar = this.scene.add.graphics();
        this.healthBar.setScrollFactor(0);
        // Position relative to camera view (defaults to 0,0 which is correct for scrollFactor 0)
        // this.healthBar.setPosition(this.scene.cameras.main.x, this.scene.cameras.main.y); // REMOVED

        // Create experience bar
        this.experienceBar = this.scene.add.graphics();
        this.experienceBar.setScrollFactor(0);
        // Position relative to camera view (defaults to 0,0 which is correct for scrollFactor 0)
        // this.experienceBar.setPosition(this.scene.cameras.main.x, this.scene.cameras.main.y); // REMOVED

        // Create level text - Position relative to camera view
        this.levelText = this.scene.add.text(padding, y, 'Level: 1', { // REMOVED camera coordinates
            fontSize: '16px',
            color: '#fff',
            stroke: '#000000',
            strokeThickness: 4
        });
        this.levelText.setScrollFactor(0);
        y += 20;

        // Create timer text - Position relative to camera view
        this.timerText = this.scene.add.text(padding, y, 'Time: 0:00', { // REMOVED camera coordinates
            fontSize: '16px',
            color: '#fff',
            stroke: '#000000',
            strokeThickness: 4
        });
        this.timerText.setScrollFactor(0);
        y += 20;

        // Start timer
        this.scene.time.addEvent({
            delay: 1000,
            callback: this.updateTimer,
            callbackScope: this,
            loop: true
        });

        // Create skill cooldown UI (top-left below bars)
        this.skillCooldownArc = this.scene.add.graphics();
        this.skillCooldownArc.setScrollFactor(0);
        this.skillCooldownArc.setVisible(false);
        this.skillCooldownLabel = this.scene.add.text(padding + 60, padding + 100, '', {
            fontSize: '14px', color: '#ffeb99', stroke: '#000000', strokeThickness: 3
        }).setScrollFactor(0).setVisible(false);

        // Killstreak indicator (top-left)
        this.killstreakText = this.scene.add.text(padding, padding + 140, '', {
            fontSize: '16px', color: '#ffffff', stroke: '#000000', strokeThickness: 4
        }).setScrollFactor(0).setVisible(false);

        // Objective tracker (top-left, below killstreak)
        this.objectiveTitle = this.scene.add.text(padding, padding + 170, '', {
            fontSize: '16px', color: '#00ffff', stroke: '#000000', strokeThickness: 4
        }).setScrollFactor(0).setVisible(false);
        this.objectiveDetail = this.scene.add.text(padding, padding + 190, '', {
            fontSize: '13px', color: '#ffffff', stroke: '#000000', strokeThickness: 3
        }).setScrollFactor(0).setVisible(false);
        this.objectiveBar = this.scene.add.graphics();
        this.objectiveBar.setScrollFactor(0).setVisible(false);
    }

    private updateTimer(): void {
        this.gameTime++;
        const minutes = Math.floor(this.gameTime / 60);
        const seconds = this.gameTime % 60;
        this.timerText.setText(`Time: ${minutes}:${seconds.toString().padStart(2, '0')}`);
    }

    public update(playerStats: PlayerStats): void {
        const padding = 16;
        // Start Y position below the text elements
        // Level Text Y: padding, Timer Text Y: padding + 40
        // Start bars below Timer Text
        let y = padding + 40 + 40; 

        // Update health bar - Draw relative to the Graphics object's origin (which is view's top-left)
        this.healthBar.clear();
        this.healthBar.fillStyle(0x000000, 1);
        // Use coordinates relative to the view: (padding, y)
        this.healthBar.fillRect(padding, y, 200, 20); // REMOVED camera y coordinate
        this.healthBar.fillStyle(0xff0000, 1);
        this.healthBar.fillRect(
            padding,
            y, // REMOVED camera y coordinate
            (playerStats.health / playerStats.maxHealth) * 200,
            20
        );
        y += 28; // Space between bars

        // Update experience bar - Draw relative to the Graphics object's origin (which is view's top-left)
        this.experienceBar.clear();
        this.experienceBar.fillStyle(0x000000, 1);
        // Use coordinates relative to the view: (padding, y)
        this.experienceBar.fillRect(padding, y, 200, 20); // REMOVED camera x and y coordinates
        this.experienceBar.fillStyle(0x00ff00, 1);
        const xpPercentage = playerStats.experienceToNextLevel > 0 ? 
                             (playerStats.experience / playerStats.experienceToNextLevel) : 0;
        this.experienceBar.fillRect(
            padding,
            y, // REMOVED camera x and y coordinates
            xpPercentage * 200,
            20
        );

        // Update level text position (it might drift slightly otherwise, ensure it stays put)
        this.levelText.setPosition(padding, padding); // Ensure position stays correct
        this.levelText.setText(`Level: ${playerStats.level}`);

        // Update timer text position
        this.timerText.setPosition(padding, padding + 40); // Ensure position stays correct
    }

    public updateObjective(progress: MissionProgress, title: string, detail: string): void {
        if (!this.objectiveTitle || !this.objectiveDetail || !this.objectiveBar) return;
        const padding = 16;
        const barY = padding + 210;
        const barW = 200;
        const barH = 12;

        this.objectiveTitle.setPosition(padding, padding + 170);
        this.objectiveTitle.setText(title);
        this.objectiveTitle.setVisible(true);

        this.objectiveDetail.setPosition(padding, padding + 190);
        this.objectiveDetail.setText(detail);
        this.objectiveDetail.setVisible(true);

        const frac = progress.goal > 0 ? Phaser.Math.Clamp(progress.current / progress.goal, 0, 1) : 0;
        this.objectiveBar.clear();
        this.objectiveBar.fillStyle(0x000000, 1);
        this.objectiveBar.fillRect(padding, barY, barW, barH);
        // Flash red when a soft-fail condition is transiently invalidated.
        const fillColor = progress.failed ? 0xff4444 : 0x00ffff;
        this.objectiveBar.fillStyle(fillColor, 1);
        this.objectiveBar.fillRect(padding, barY, frac * barW, barH);
        this.objectiveBar.setVisible(true);
    }

    public destroy(): void {
        this.healthBar.destroy();
        this.experienceBar.destroy();
        this.levelText.destroy();
        this.timerText.destroy();
        this.skillCooldownArc?.destroy();
        this.skillCooldownLabel?.destroy();
        this.killstreakText?.destroy();
        this.objectiveTitle?.destroy();
        this.objectiveDetail?.destroy();
        this.objectiveBar?.destroy();
    }

    // Getter for gameTime to make it accessible from outside
    public getGameTime(): number {
        return this.gameTime;
    }

    // Update or hide a small circular cooldown indicator
    public updateSkillCooldown(remainingMs: number, totalMs: number): void {
        if (!this.skillCooldownArc || !this.skillCooldownLabel) return;
        const padding = 16;
        const x = padding + 40;
        const y = padding + 100;
        if (remainingMs <= 0 || totalMs <= 0) {
            this.skillCooldownArc.setVisible(false);
            this.skillCooldownLabel.setVisible(false);
            return;
        }
        const frac = Phaser.Math.Clamp(remainingMs / totalMs, 0, 1);
        this.skillCooldownArc.clear();
        // background circle
        this.skillCooldownArc.fillStyle(0x222222, 0.6);
        this.skillCooldownArc.fillCircle(x, y, 18);
        // border
        this.skillCooldownArc.lineStyle(2, 0xffffff, 0.8);
        this.skillCooldownArc.strokeCircle(x, y, 18);
        // arc from -90 degrees clockwise
        this.skillCooldownArc.beginPath();
        this.skillCooldownArc.lineStyle(4, 0xffaa00, 1);
        const start = Phaser.Math.DegToRad(-90);
        const end = start + Math.PI * 2 * frac;
        this.skillCooldownArc.arc(x, y, 16, start, end, false);
        this.skillCooldownArc.strokePath();
        this.skillCooldownArc.setVisible(true);

        const secs = Math.ceil(remainingMs / 100) / 10; // 0.1s precision
        this.skillCooldownLabel.setPosition(x + 20, y - 8);
        this.skillCooldownLabel.setText(`${secs.toFixed(1)}s`);
        this.skillCooldownLabel.setVisible(true);
    }

    public updateKillstreak(multiplier: number, perk?: KillstreakPerkId): void {
        if (!this.killstreakText) return;
        if (multiplier <= 1) {
            this.killstreakText.setVisible(false);
            return;
        }
        const label = perk
            ? (perk === KillstreakPerkId.DAMAGE
                ? 'DAMAGE'
                : perk === KillstreakPerkId.XP
                    ? 'XP'
                    : 'SPEED')
            : 'COMBO';
        this.killstreakText.setText(`${label} x${multiplier}`);
        let color = '#ffffff';
        if (perk === KillstreakPerkId.DAMAGE) color = '#ff5555';
        if (perk === KillstreakPerkId.XP) color = '#ffd54f';
        if (perk === KillstreakPerkId.SPEED) color = '#66ccff';
        this.killstreakText.setColor(color);
        this.killstreakText.setVisible(true);
    }
}
