import Phaser from 'phaser';
import { gameConfig } from './config/game';

export const game = new Phaser.Game(gameConfig);

// Handy for poking at state from the devtools console.
declare global {
  interface Window {
    game: Phaser.Game;
  }
}
window.game = game;
