import Phaser from 'phaser';
import {
  makePlaceholderHero,
  makePlaceholderTiles,
} from '../art/placeholders';
import { DERIVED, MOVE } from '../config/movement';

/**
 * Generates the placeholder textures, prints the tuning readout, then hands
 * off to the level.
 *
 * Everything milestone 1 needs is generated rather than loaded. Swapping in
 * the sliced concept art later means adding `this.load.atlas(...)` here and
 * deleting the two make* calls.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    makePlaceholderTiles(this);
    makePlaceholderHero(this);

    // The tuning readout. If these numbers don't match what you intended, the
    // constants and the code have drifted apart.
    console.info(
      '[polar] jump apex %s tiles (%s px) | min hop %s px | rise %ss | ' +
        'run-up %ss | coyote %sms | buffer %sms',
      DERIVED.apexTiles.toFixed(2),
      DERIVED.apexPx.toFixed(0),
      DERIVED.minJumpPx.toFixed(0),
      DERIVED.riseSeconds.toFixed(2),
      DERIVED.runUpSeconds.toFixed(2),
      MOVE.COYOTE_MS,
      MOVE.JUMP_BUFFER_MS,
    );

    this.scene.start('Level');
  }
}
