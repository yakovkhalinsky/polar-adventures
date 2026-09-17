import Phaser from 'phaser';

export type InputState = {
  left: boolean;
  right: boolean;
  /** Is a jump key held down this frame? */
  jumpDown: boolean;
  /** Did a jump key go down this frame? */
  jumpPressed: boolean;
};

/**
 * The single seam between the keyboard and the game. Everything the game knows
 * about input enters through `read()`; nothing else touches the keyboard
 * plugin. That is what makes rebinding and gamepad support a change to this
 * file alone.
 */
export class Controls {
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly jumpKeys: Phaser.Input.Keyboard.Key[];

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard!;

    this.cursors = kb.createCursorKeys();

    // createCursorKeys() and addKey() capture by default, so arrows and space
    // do not scroll the page.
    this.jumpKeys = [
      this.cursors.up,
      this.cursors.space,
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.Z),
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.X),
    ];
  }

  read(): InputState {
    // .map then .some, NOT .some directly: JustDown() has the side effect of
    // consuming the key's justDown flag, and .some short-circuits — which would
    // leave later keys' flags set and fire them a frame late.
    const jumpPressed = this.jumpKeys
      .map((k) => Phaser.Input.Keyboard.JustDown(k))
      .some(Boolean);

    return {
      left: this.cursors.left.isDown,
      right: this.cursors.right.isDown,
      jumpDown: this.jumpKeys.some((k) => k.isDown),
      jumpPressed,
    };
  }
}
