import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { LevelScene } from '../scenes/LevelScene';

/**
 * Internal render resolution. 480x270 is exactly 16:9 and exactly 4x at
 * 1920x1080, so fullscreen at 1080p gets perfect integer pixel scaling.
 * 512x288 is also 16:9 but is 3.75x at 1080p — non-integer, which makes some
 * pixels 4 screen-px wide and others 3.
 */
export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 270;

/** All level geometry and all art is authored on this grid. */
export const TILE_SIZE = 32;

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',

  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#101a2b',

  // `pixelArt: true` is a shorthand Phaser expands into THREE settings:
  //     antialias   = false  -> nearest-neighbour texture filtering
  //     antialiasGL = false  -> the WebGL context has no AA
  //     roundPixels = true   -> IMPORTANT: this defaults to FALSE in v4,
  //                             unlike v3 where it defaulted to true. Setting
  //                             `pixelArt` is what turns it back on.
  // Do not set `antialias: false` by hand and assume you're done — you would
  // get nearest-neighbour filtering but leave roundPixels off.
  pixelArt: true,

  // Deliberately NOT `smoothPixelArt: true`, which is the opposite mode
  // (antialias on, pixelArt off). A 16-bit target wants hard pixels.
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // Floors the canvas' display size to whole pixels. Without it FIT can
    // compute a fractional CSS size, putting the canvas on a half-pixel
    // boundary and reintroducing the blur we just turned off.
    autoRound: true,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },

  physics: {
    default: 'arcade',
    arcade: {
      // World gravity is ZERO on purpose. All gravity is applied per-body in
      // Player.ts. Phaser combines them as (world.gravity + body.gravity), so
      // zero here makes `body.setGravityY()` the single readable source of
      // truth for the asymmetric rise/fall gravity the feel depends on.
      gravity: { x: 0, y: 0 },
      debug: false, // also toggleable at runtime with F1
    },
  },

  scene: [BootScene, LevelScene],
};
