import { Boot } from './scenes/Boot';
import { GameOver } from './scenes/GameOver';
import { Game as MainGame } from './scenes/Game';
import { MainMenu } from './scenes/MainMenu';
import { AUTO, Game, Scale } from 'phaser';
import { Preloader } from './scenes/Preloader';
import { PauseMenu } from './scenes/PauseMenu';
import { LevelUpSelection } from './scenes/LevelUpSelection';
import { ScreenManager } from './utils/ScreenManager';

//  Find out more information about the Game Config at:
//  https://newdocs.phaser.io/docs/3.70.0/Phaser.Types.Core.GameConfig
const config: Phaser.Types.Core.GameConfig = {
    type: AUTO,
    width: 1024,
    height: 768,
    parent: 'game-container',
    backgroundColor: '#028af8',
    scene: [
        Boot,
        Preloader,
        MainMenu,
        MainGame,
        GameOver,
        PauseMenu,
        LevelUpSelection
    ],
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { x: 0, y: 0 },
            debug: false
        }
    },
    audio: {
        disableWebAudio: false,
        noAudio: false
    },
    scale: {
        mode: Scale.RESIZE,
        parent: 'game-container',
        fullscreenTarget: 'game-container',
        autoCenter: Scale.CENTER_BOTH,
        expandParent: true,
        min: {
            width: 320,
            height: 240
        },
        max: {
            width: 1920,
            height: 1080
        }
    }
};

const StartGame = (parent: string) => {
    const game = new Game({ ...config, parent });
    
    // Attempt automatic fullscreen on mobile devices
    if (/Mobi|Android/i.test(navigator.userAgent) && game.scale.fullscreen.available) {
        game.scale.startFullscreen();
    }

    // Ensure the canvas always matches viewport size
    window.addEventListener('resize', () => {
        game.scale.resize(window.innerWidth, window.innerHeight);
    });

    // Initialize the screen manager after game creation
    const screenManager = ScreenManager.getInstance();
    screenManager.initialize(game.scale);
    
    return game;
}

export default StartGame;
