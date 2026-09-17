import Phaser from 'phaser';
import { TILE_SIZE } from '../config/game';

export const TEX = {
  hero: 'ph-hero',
  tiles: 'ph-tiles',
} as const;

/**
 * Tile indices into the placeholder tileset. When the sliced concept art
 * lands, these values change and nothing else does.
 */
export const TILE_INDEX = {
  INTERIOR: 0, // plain rock fill
  SOLID: 1,
  ONEWAY: 2,
  ICE: 3, // reserved for the first real mechanic
} as const;

/**
 * Taken from assets/concepts/ASSET-LOG.md so the placeholder already reads
 * against the real art direction. The green scarf is not decoration: it exists
 * to break the white-on-white silhouette against snow, and it belongs in the
 * placeholder for exactly the same reason it is in the concept art.
 */
const PAL = {
  furHi: '#F2F5F8',
  furLo: '#9FB3C8',
  eye: '#1B2430',
  scarf: '#3AAE52',
  scarfHi: '#6FD98A',
  snow: '#EAF2F8',
  rock: '#5A6B80',
  rockLo: '#3E4C5E',
  plank: '#8A6A44',
  plankHi: '#B08A5C',
  ice: '#8FD8E8',
} as const;

/** Creates a canvas texture, replacing any same-keyed texture from a hot reload. */
function canvasTexture(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
): Phaser.Textures.CanvasTexture {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, width, height);
  if (!tex) throw new Error(`failed to create canvas texture "${key}"`);
  return tex;
}

/**
 * Textures are drawn with Canvas 2D rather than Phaser Graphics so there is no
 * renderer interaction at all — and every edge is guaranteed to be a hard
 * pixel edge, since `fillRect` does not antialias.
 */
function makePainter(ctx: CanvasRenderingContext2D, originX: number) {
  return (x: number, y: number, w: number, h: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(originX + x, y, w, h);
  };
}

/** 24x32 hero. */
export function makePlaceholderHero(scene: Phaser.Scene): void {
  const W = 24;
  const H = 32;
  const tex = canvasTexture(scene, TEX.hero, W, H);
  const px = makePainter(tex.context, 0);

  px(4, 26, 6, 6, PAL.furLo); // left leg
  px(14, 26, 6, 6, PAL.furLo); // right leg
  px(3, 12, 18, 15, PAL.furHi); // torso
  px(3, 22, 18, 5, PAL.furLo); // torso underside shading
  px(4, 0, 5, 5, PAL.furHi); // left ear
  px(15, 0, 5, 5, PAL.furHi); // right ear
  px(5, 2, 14, 12, PAL.furHi); // head
  px(4, 8, 5, 4, PAL.furLo); // muzzle
  px(13, 5, 2, 2, PAL.eye); // eye
  px(2, 12, 20, 4, PAL.scarf); // scarf band
  px(2, 12, 20, 1, PAL.scarfHi); // scarf highlight (the 1px crispness probe)
  px(15, 16, 4, 7, PAL.scarf); // scarf tail

  tex.refresh(); // push the 2D canvas to the GPU
}

/**
 * Four 32x32 tiles in a 128x32 strip.
 *
 * The tilemap renderer does NOT need texture frames — it computes tile UVs
 * from `Tileset.texCoordinates` against the whole texture. But any ordinary
 * sprite that references this texture by tile index DOES, and without frames
 * Phaser logs "has no frame" and silently falls back to the entire 128x32
 * strip. That is exactly what happens to the one-way platform sprites, so the
 * frames below are load-bearing, not tidiness.
 */
export function makePlaceholderTiles(scene: Phaser.Scene): void {
  const T = TILE_SIZE;
  const TILE_COUNT = 4;
  const tex = canvasTexture(scene, TEX.tiles, T * TILE_COUNT, T);
  const ctx = tex.context;

  const col = (index: number) => makePainter(ctx, index * T);
  const px = (
    c: number,
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ) => col(c)(x, y, w, h, color);

  // 0: plain interior rock
  px(0, 0, 0, T, T, PAL.rockLo);

  // 1: snow-capped solid ground
  px(1, 0, 0, T, T, PAL.rock);
  px(1, 0, 0, T, 8, PAL.snow);
  px(1, 0, 8, T, 2, PAL.furLo);
  px(1, 6, 16, 6, 4, PAL.rockLo);
  px(1, 20, 22, 8, 4, PAL.rockLo);

  // 2: one-way plank. The canvas starts transparent, so simply not drawing
  //    above and below the plank is what makes the rest see-through.
  px(2, 0, 6, T, 8, PAL.plank);
  px(2, 0, 6, T, 2, PAL.plankHi);
  px(2, 0, 12, T, 2, PAL.rockLo);

  // 3: ice, reserved for the first real mechanic
  px(3, 0, 0, T, T, PAL.ice);
  px(3, 0, 0, T, 4, PAL.snow);

  // One frame per tile, registered by tile index so `sprite.setFrame(2)` and
  // `group.create(x, y, TEX.tiles, 2)` both resolve to a single 32x32 tile.
  for (let i = 0; i < TILE_COUNT; i++) {
    tex.add(i, 0, i * T, 0, T, T);
  }

  tex.refresh();
}
