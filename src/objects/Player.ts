import Phaser from 'phaser';
import { GRAVITY_FALL, MOVE } from '../config/movement';

export type InputState = {
  left: boolean;
  right: boolean;
  jumpDown: boolean;
  jumpPressed: boolean;
};

/**
 * The hero. Bipedal, upright.
 *
 * Movement and presentation are kept as separate concerns inside this class:
 * `tick()` is physics only, so adding sprite animation later is additive and
 * never touches the movement code.
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
  private coyoteMs = 0;
  private jumpBufferMs = 0;
  private readonly spawnX: number;
  private readonly spawnY: number;

  /*
    Do NOT declare `body` as a class field here. With `useDefineForClassFields`
    (required by the Phaser TS setup), a field declaration is initialised to
    `undefined` AFTER super() returns, clobbering the Arcade body super() just
    created. This is the #1 Phaser + TypeScript bug. Go through a getter.
  */
  private get arcade(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string) {
    super(scene, x, y, texture);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Hitbox is deliberately narrower than the 24px art so the hero fits
    // through 1-tile gaps without pixel-hunting the edge, and 30 tall so it
    // reads as standing on the tile rather than floating above it.
    this.arcade.setSize(16, 30);
    this.arcade.setOffset(4, 2); // feet flush with the sprite's bottom edge

    this.arcade.setCollideWorldBounds(true);

    // X is capped at run speed. Y is capped at JUMP_VELOCITY — NOT at
    // MAX_FALL_SPEED. Phaser's `maxVelocity.y` clamps BOTH directions, so
    // passing the terminal fall speed here silently clips the jump's launch
    // velocity (560 -> 520, measured) and the hero never reaches its intended
    // apex. Terminal velocity is enforced downward-only in tick() instead.
    this.arcade.setMaxVelocity(MOVE.MAX_RUN_SPEED, MOVE.JUMP_VELOCITY);

    this.arcade.setAllowGravity(true);

    this.spawnX = x;
    this.spawnY = y;
  }

  respawn(): void {
    this.arcade.reset(this.spawnX, this.spawnY);
    this.arcade.setVelocity(0, 0);
    this.arcade.setAcceleration(0, 0);
    this.coyoteMs = 0;
    this.jumpBufferMs = 0;
  }

  tick(deltaMs: number, input: InputState): void {
    const body = this.arcade;
    const grounded = body.blocked.down;

    // ---- 1. forgiveness windows ------------------------------------------
    this.coyoteMs = grounded
      ? MOVE.COYOTE_MS
      : Math.max(0, this.coyoteMs - deltaMs);

    this.jumpBufferMs = input.jumpPressed
      ? MOVE.JUMP_BUFFER_MS
      : Math.max(0, this.jumpBufferMs - deltaMs);

    // ---- 2. jump ---------------------------------------------------------
    if (this.jumpBufferMs > 0 && this.coyoteMs > 0) {
      body.setVelocityY(-MOVE.JUMP_VELOCITY);
      this.jumpBufferMs = 0;
      this.coyoteMs = 0; // consume, so one press == one jump
    }

    // ---- 3. variable jump height -----------------------------------------
    // Deliberately stateless — no `isJumping` flag. This is idempotent: once
    // velocity.y rises above -JUMP_CUT_VELOCITY the condition is false for the
    // rest of the jump, and gravity only ever brings velocity.y up, so the
    // clamp cannot re-fire.
    if (!input.jumpDown && body.velocity.y < -MOVE.JUMP_CUT_VELOCITY) {
      body.setVelocityY(-MOVE.JUMP_CUT_VELOCITY);
    }

    // ---- 4. horizontal ---------------------------------------------------
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    if (dir !== 0) {
      const moving = Math.sign(body.velocity.x);
      const isTurning = moving !== 0 && moving !== dir;
      const accel = isTurning
        ? MOVE.TURN_ACCEL
        : grounded
          ? MOVE.GROUND_ACCEL
          : MOVE.AIR_ACCEL;

      body.setAccelerationX(dir * accel);
      // Acceleration and drag are mutually exclusive in Phaser anyway, but be
      // explicit so a future change cannot surprise us.
      body.setDragX(0);
      this.setFlipX(dir < 0);
    } else {
      body.setAccelerationX(0);
      // Friction on the ground; ZERO in the air so jump momentum survives.
      body.setDragX(grounded ? MOVE.GROUND_DRAG : MOVE.AIR_DRAG);
    }

    // ---- 5. asymmetric gravity -------------------------------------------
    // Applied unconditionally, including while grounded. Gravity while resting
    // costs nothing: the body nudges into the floor by a fraction of a pixel,
    // Phaser separates it back and zeroes velocity.y, and the rendered
    // position is stable.
    //
    // An earlier version disabled gravity while grounded to avoid that
    // sub-pixel nudge. Don't: `blocked.down` only becomes true on a frame
    // where separation actually ran, so with gravity off the flag goes false
    // the next frame, gravity switches back on, and the body oscillates on a
    // 2-frame cycle — which rounds into a visible 1px standing shimmer.
    body.setGravityY(body.velocity.y < 0 ? MOVE.GRAVITY_RISE : GRAVITY_FALL);

    // Terminal velocity, applied to downward motion ONLY. This cannot live in
    // setMaxVelocity() because that clamps the jump too.
    if (body.velocity.y > MOVE.MAX_FALL_SPEED) {
      body.setVelocityY(MOVE.MAX_FALL_SPEED);
    }
  }
}
