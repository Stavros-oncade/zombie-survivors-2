import { Player } from '../entities/Player';
import { GameConstants } from '../config/GameConstants';

export class ExperienceSystem {
    private player: Player;
    private currentLevel: number = 1;
    private currentExperience: number = 0;

    constructor(player: Player) {
        this.player = player;
    }

    public gainExperience(amount: number): void {
        this.currentExperience += amount;
        this.checkLevelUp();
    }

    private checkLevelUp(): void {
        const requiredXP = this.getRequiredExperience();
        if (this.currentExperience >= requiredXP) {
            this.levelUp();
        }
    }

    private getRequiredExperience(): number {
        return Math.floor(GameConstants.EXPERIENCE.BASE_XP_REQUIREMENT * 
            Math.pow(GameConstants.EXPERIENCE.XP_SCALING_FACTOR, this.currentLevel - 1));
    }

    private levelUp(): void {
        this.currentLevel++;
        this.currentExperience = 0;
        this.player.levelUp();
    }
} 