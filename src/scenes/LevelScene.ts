import Phaser from 'phaser';
import { buildLevel, type BuiltLevel } from '../level/buildLevel';
import { LEVEL_01 } from '../level/levels';
import { Controls } from '../input/controls';
import { Player } from '../objects/Player';
import { TEX } from '../art/placeholders';

export class LevelScene extends Phaser.Scene {
  private player!: Player;
  private controls!: Controls;
  // Kept, not destructured away: the scene owns the level so it can ask what
  // is under the hero's feet each frame.
  private level!: BuiltLevel;

  constructor() {
    super('Level');
  }

  create(): void {
    const level = buildLevel(this, LEVEL_01);
    this.level = level;
    const { map, solidLayer, oneWayGroup, spawn } = level;

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    // Bounds collision args are (left, right, up, down). Down is OFF so pits
    // are actually fatal and therefore testable.
    this.physics.world.setBoundsCollision(true, true, true, false);

    this.player = new Player(this, spawn.x, spawn.y, TEX.hero);
    this.controls = new Controls(this);

    this.physics.add.collider(this.player, solidLayer);
    this.physics.add.collider(this.player, oneWayGroup);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    // roundPixels=true rounds the CAMERA SCROLL, not each object individually.
    // Rounding objects while the camera scrolls fractionally is what causes
    // 1px relative shimmer between the player and the tiles.
    cam.startFollow(this.player, true, 0.12, 0.12);

    // F1 toggles Arcade physics body outlines — the single most useful tool
    // for tuning feel. You will immediately see any hitbox that doesn't match
    // its art.
    this.input.keyboard!.on('keydown-F1', () => {
      const world = this.physics.world;
      // createDebugGraphic() makes a NEW Graphics object each call, so guard.
      if (!world.debugGraphic) world.createDebugGraphic();
      world.drawDebug = !world.drawDebug;
      if (!world.drawDebug) world.debugGraphic!.clear();
    });
  }

  update(_time: number, delta: number): void {
    const { x, y } = this.player.groundProbe;
    this.player.tick(delta, this.controls.read(), this.level.surfaceAt(x, y));

    // Fell out of the world.
    if (this.player.y > this.physics.world.bounds.bottom + 64) {
      this.player.respawn();
      this.cameras.main.flash(120, 24, 40, 64);
    }
  }
}
