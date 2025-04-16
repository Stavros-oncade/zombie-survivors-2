import { Player } from '../entities/Player';
import { GameConstants } from '../config/GameConstants';

export class ExperienceSystem {
    private player: Player;
    private currentLevel: number = 1;
    private currentExperience: number = 0;
    private onLevelUpCallback: () => void;

    constructor(player: Player, onLevelUpCallback: () => void) {
        this.player = player;
        this.onLevelUpCallback = onLevelUpCallback;
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
        const requiredXP = this.getRequiredExperience();
        this.currentLevel++;
        this.currentExperience -= requiredXP;
        console.log(`Level Up! New Level: ${this.currentLevel}. Remaining XP: ${this.currentExperience}`);
        this.onLevelUpCallback();
    }

    public getCurrentLevel(): number {
        return this.currentLevel;
    }

    public getCurrentExperience(): number {
        return this.currentExperience;
    }
} 