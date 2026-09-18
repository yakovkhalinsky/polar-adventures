import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { LevelScene } from '../scenes/LevelScene';

/**
 * Internal render resolution. 960x540 is exactly 16:9 and exactly 2x at
 * 1920x1080, so fullscreen at 1080p gets perfect integer pixel scaling.
 *
 * Upscaling is what makes pixel art read as pixel art, which is why this is
 * not set to 1920x1080 even though the art could fill it: at 540 the frame is
 * doubled to 1080p, so each art pixel covers 2x2 screen pixels. At native 1080p
 * the hero would be a 124px character on a 1080p monitor — small, and no
 * chunkier than any other game.
 */
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

/**
 * The collision grid, in game pixels. All level geometry is authored on it.
 *
 * These are NOT the same as the art's tile: one drawn brick is 35x22, which is
 * neither square nor a useful collision unit. A collision tile is a 2x3 GROUP of
 * bricks — 70x66, near square — which is what makes the hero come out a sane
 * 1.9 tiles tall instead of 5.6.
 *
 * The grouping is baked into the tileset by scripts/slice-art.mjs: each cell of
 * public/art/tiles.png is already a composed 2x3 block of bricks, so the tilemap
 * can go on addressing one index per cell.
 *
 * Width and height differ, and that is fine: `buildLevel` and Phaser's tilemap
 * both take them separately, and the level is authored as rows and columns
 * either way. Only physics maths has to care.
 *
 * Both are exact multiples of the brick, and that is the point — a brick is 35
 * wide and 22 tall, so 70x66 is 2x3 of them with nothing left over. An earlier
 * 70x67 split the difference at 22.33px per brick row, which resamples the art.
 * TILE_H is mirrored as `tileHeight` in src/level/levels.ts, which is what
 * buildLevel actually reads; change both or the tileset and the tile grid
 * disagree about how tall a tile is.
 */
export const TILE_W = 70;
export const TILE_H = 66;

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

      // THE most important number in this file, and the one that is invisible
      // until it breaks. Phaser discards a tile collision outright when the
      // overlap exceeds this value: `TileCheckY` does `oy = body.bottom -
      // tileTop; if (oy > tileBias) oy = 0`. The default of 16 is fine while a
      // body moves less than 16px per frame, and silently tunnels through the
      // floor the moment it does not.
      //
      // A falling hero here moves MAX_FALL_SPEED/60 + one frame of gravity =
      // 2015/60 + 148 = ~36px per frame, so the default 16 tunnelled. 64 gives
      // headroom over both the fall (36px) and the jump launch (2170/60 = 36px).
      // Re-check this if MAX_FALL_SPEED, JUMP_VELOCITY or GRAVITY_FALL_RISE go
      // up — and note the failure is intermittent, not total: it depends on the
      // sub-pixel phase at the contact frame, so it looks like flakiness.
      //
      // THIS DOES NOT COVER THE ONE-WAY PLATFORMS. They are bodies, not tiles,
      // and body-vs-body separation in `GetOverlapY` uses `OVERLAP_BIAS` (4) to
      // widen a window that already scales with the frame's movement — so the
      // platform's own thickness does not enter into it, and a one-brick ledge
      // is caught exactly as a full-cell one is. Raising MAX_FALL_SPEED past
      // what a 4px bias can absorb is a separate calculation from this one.
      tileBias: 64,

      debug: false, // also toggleable at runtime with F1
    },
  },

  scene: [BootScene, LevelScene],
};
