import { Player } from '../entities/Player';
import { GameConstants } from '../config/GameConstants';

export class ExperienceSystem {
    // Currently unused but kept for potential mechanics; suppress unused warning
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private player: Player;
    private currentLevel: number = 1;
    private currentExperience: number = 0;
    private onLevelUpCallback: () => void;
    private scene: Phaser.Scene;

    constructor(player: Player, onLevelUpCallback: () => void, scene: Phaser.Scene) {
        this.player = player;
        this.onLevelUpCallback = onLevelUpCallback;
        this.scene = scene;
    }

    public gainExperience(amount: number): void {
        this.currentExperience += amount;
        this.checkLevelUp();
    }

    private checkLevelUp(): void {
        const requiredXP = this.getRequiredExperience();
        if (this.currentExperience >= requiredXP) {
            while (this.currentExperience >= this.getRequiredExperience()) {
                this.levelUp();
            }
        }
    }

    public getRequiredExperience(): number {
        return Math.floor(GameConstants.EXPERIENCE.BASE_XP_REQUIREMENT * 
            Math.pow(GameConstants.EXPERIENCE.XP_SCALING_FACTOR, this.currentLevel - 1));
    }

    private levelUp(): void {
        const previousLevel = this.currentLevel;
        const requiredXP = this.getRequiredExperience();
        this.currentLevel++;
        this.currentExperience -= requiredXP;
        console.log(`Level Up! New Level: ${this.currentLevel}. Remaining XP: ${this.currentExperience}`);
        
        // Emit the level up event directly to the scene
        this.scene.events.emit('player_level_up', { 
            level: this.currentLevel, 
            previousLevel: previousLevel 
        });
        
        // Defer the callback to avoid physics callback issues
        if (this.scene && this.scene.time) {
            this.scene.time.delayedCall(0, () => {
                this.onLevelUpCallback();
            });
        } else {
            // Fallback if scene is not available
            this.onLevelUpCallback();
        }
    }

    public getCurrentLevel(): number {
        return this.currentLevel;
    }

    public getCurrentExperience(): number {
        return this.currentExperience;
    }

    /**
     * Total XP accumulated across all levels (banked XP for the Long Recon carry-
     * state, §5). Re-derives the requirement for each completed level so it round-
     * trips with restore(level, totalXP).
     */
    public getTotalXP(): number {
        let total = this.currentExperience;
        const saved = this.currentLevel;
        for (let lvl = 1; lvl < saved; lvl++) {
            total += Math.floor(GameConstants.EXPERIENCE.BASE_XP_REQUIREMENT *
                Math.pow(GameConstants.EXPERIENCE.XP_SCALING_FACTOR, lvl - 1));
        }
        return total;
    }

    /**
     * Restore a saved level + total-XP snapshot WITHOUT re-firing level-up events
     * (used by the Long Recon when re-applying carry-state at a node start, §5.3).
     * Sets currentLevel/currentExperience directly so no new level-up UI pops.
     */
    public restore(level: number, totalXP: number): void {
        this.currentLevel = Math.max(1, Math.floor(level));
        let remaining = Math.max(0, Math.floor(totalXP));
        for (let lvl = 1; lvl < this.currentLevel; lvl++) {
            remaining -= Math.floor(GameConstants.EXPERIENCE.BASE_XP_REQUIREMENT *
                Math.pow(GameConstants.EXPERIENCE.XP_SCALING_FACTOR, lvl - 1));
        }
        this.currentExperience = Math.max(0, remaining);
    }
} 