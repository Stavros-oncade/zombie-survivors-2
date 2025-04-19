import { Player } from '../entities/Player';
import { GameConstants } from '../config/GameConstants';

export class ExperienceSystem {
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
} 