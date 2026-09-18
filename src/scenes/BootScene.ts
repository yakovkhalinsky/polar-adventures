import Phaser from 'phaser';
import { TEX } from '../art/tileset';
import { TILE_H, TILE_W } from '../config/game';
import { DERIVED, MOVE } from '../config/movement';

/**
 * Loads the art, prints the tuning readout, then hands off to the level.
 *
 * The art is sliced out of the concept sheet by scripts/slice-art.mjs and lives
 * in public/art/. Those URLs are RELATIVE — no leading slash — because the game
 * deploys to a GitHub Pages subpath and `base` is './' (see vite.config.ts). An
 * absolute '/art/hero.png' works in dev and 404s in production, which is the
 * kind of failure that only shows up after a deploy.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.image(TEX.hero, 'art/hero.png');
    // frameWidth/frameHeight rather than a plain image: the tilemap derives its
    // UVs from the texture, but the one-way ledge is a sprite indexing a single
    // cell by frame index.
    this.load.spritesheet(TEX.tiles, 'art/tiles.png', {
      frameWidth: TILE_W,
      frameHeight: TILE_H,
    });
  }

  create(): void {
    // The tuning readout. If these numbers don't match what you intended, the
    // constants and the code have drifted apart.
    //
    // The design targets are in HERO HEIGHTS; tiles are shown too because level
    // geometry is authored in them. They used to be the same number, which is
    // exactly the confusion the rescale introduced.
    console.info(
      '[polar] jump apex %s hero-heights (%s px, %s tiles) | min hop %s px | ' +
        'rise %ss | run-up %ss | coyote %sms | buffer %sms',
      DERIVED.apexHeroes.toFixed(2),
      DERIVED.apexPx.toFixed(0),
      (DERIVED.apexPx / TILE_H).toFixed(2),
      DERIVED.minJumpPx.toFixed(0),
      DERIVED.riseSeconds.toFixed(2),
      DERIVED.runUpSeconds.toFixed(2),
      MOVE.COYOTE_MS,
      MOVE.JUMP_BUFFER_MS,
    );

    // Ice reads as a feel change only if the slide is dramatically longer than
    // rock's, so print the pair rather than the ice number alone.
    console.info(
      '[polar] release at top speed coasts %s px on rock, %s px on ice | ' +
        'ice run-up %ss (rock %ss)',
      DERIVED.rockSlidePx.toFixed(1),
      DERIVED.iceSlidePx.toFixed(1),
      DERIVED.iceRunUpSeconds.toFixed(2),
      DERIVED.runUpSeconds.toFixed(2),
    );

    this.scene.start('Level');
  }
}
