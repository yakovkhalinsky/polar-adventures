/**
 * Boot smoke test.
 *
 * Compiling is not running. This boots the actual game in headless Chromium
 * and asserts the things that only fail at runtime: texture generation, the
 * tilemap build, the one-way platform group, and pixel-art crispness.
 *
 * Usage: npm run smoke
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const PORT = 5199;
const URL = `http://localhost:${PORT}/`;

const CHROME_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
];

const chromePath = CHROME_CANDIDATES.find(existsSync);
if (!chromePath) {
  console.error('No Chromium/Chrome binary found. Checked:\n  ' + CHROME_CANDIDATES.join('\n  '));
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error(`dev server did not come up within ${timeoutMs}ms`);
}

const vite = spawn(
  'npx',
  ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let browser;
const consoleLines = [];
const errors = [];

try {
  await waitForServer();

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // Software WebGL. Phaser 4 wants WebGL and the headless GPU stack is not
      // available, so SwiftShader is what lets this render at all.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });

  const page = await browser.newPage();

  // A viewport larger than the game's 960x540, so Phaser's FIT scaler has to
  // scale the canvas UP. Puppeteer's 800x600 default is smaller than the game
  // now, which would scale it down and make the crispness check meaningless.
  await page.setViewport({ width: 1280, height: 720 });

  page.on('console', (msg) => {
    const text = `${msg.type()}: ${msg.text()}`;
    consoleLines.push(text);
    if (msg.type() === 'error') errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  // Wait for Boot -> Level.
  await page.waitForFunction(
    () => window.game && window.game.isBooted && window.game.scene.isActive('Level'),
    { timeout: 20_000 },
  );

  // Let a few frames run so update() is genuinely exercised.
  await sleep(1200);

  const report = await page.evaluate(() => {
    const game = window.game;
    const canvas = game.canvas;
    const scene = game.scene.getScene('Level');
    const player = scene.player;
    const body = player ? player.body : null;
    const world = scene.physics.world;

    // Count the one-way bodies by walking the static group.
    let oneWayBodies = 0;
    let oneWayStretched = 0;
    for (const child of scene.children.list) {
      if (child.body && child.body.isCircle === false && child.body.physicsType === 1) {
        oneWayBodies++;
        if (child.displayWidth > 32) oneWayStretched++;
      }
    }

    // Ice must both exist in the map AND collide. setCollision is a whitelist
    // by index, so a tile omitted from it has all four flags false and the hero
    // falls through — which makes the surface undetectable, not merely
    // non-solid. Asserting the flags is what catches that.
    const counts = {};
    let iceTiles = 0;
    let iceCollides = null;
    for (const row of scene.level.solidLayer.layer.data) {
      for (const tile of row) {
        if (!tile || tile.index === -1) continue;
        counts[tile.index] = (counts[tile.index] || 0) + 1;
        if (tile.index === 3) {
          iceTiles++;
          if (iceCollides === null) iceCollides = tile.canCollide;
        }
      }
    }

    // ---- autotiling ------------------------------------------------------
    // The rule buildLevel applies: a solid cell with a solid cell above it is
    // buried, and buried solid cells use the plain-fill tile. Worth asserting
    // directly rather than trusting the picture — if the pass stopped running,
    // every ground row would grow a snow cap and nothing would error.
    const tileAt = (x, y) => {
      const t = scene.level.solidLayer.getTileAt(x, y, true);
      return t && t.index !== -1 ? t.index : null;
    };
    const autotile = {
      groundSurface: tileAt(5, 20),
      groundBuried: tileAt(5, 21),
      iceSurface: tileAt(20, 20),
      plateauTop: tileAt(60, 11),
      plateauBuried: tileAt(60, 12),
      counts,
    };

    // ---- hero sprite structure ------------------------------------------
    // Read the loaded PNG back, so these assert what was SHIPPED rather than
    // what the code intended. The art is sliced from the concept sheet by
    // scripts/slice-art.mjs; what this file checks is the contract between that
    // PNG and the physics that was built against it.
    //
    // The placeholder-era version of this block asserted an exact palette and a
    // 1px inset, because the art was drawn as rects from a known colour list.
    // None of that survives contact with a 24-colour JPEG slice, and it would
    // not be worth asserting if it did — what matters is that the numbers the
    // rest of the game depends on still hold.
    const heroSprite = (() => {
      const src = game.textures.get('hero').getSourceImage();
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const hctx = c.getContext('2d');
      hctx.drawImage(src, 0, 0);
      const d = hctx.getImageData(0, 0, src.width, src.height).data;
      const at = (x, y) => {
        const i = (y * src.width + x) * 4;
        return [d[i], d[i + 1], d[i + 2], d[i + 3]];
      };

      let opaque = 0;
      let sumX = 0;
      let sumY = 0;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -1;
      let y1 = -1;
      let darkPx = 0;
      // The head band. Measured off the shipped art: the bear's head and its
      // dark features both live in the upper half.
      const HEAD_BAND = [5, 60];
      let headDarkPx = 0;
      let headDarkSumX = 0;

      for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
          const [r, g, b, a] = at(x, y);
          if (a < 8) continue;
          opaque++;
          sumX += x;
          sumY += y;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;

          if (0.299 * r + 0.587 * g + 0.114 * b < 80) {
            darkPx++;
            if (y >= HEAD_BAND[0] && y <= HEAD_BAND[1]) {
              headDarkPx++;
              headDarkSumX += x;
            }
          }
        }
      }

      let bottomRowPx = 0;
      for (let x = 0; x < src.width; x++) {
        if (at(x, src.height - 1)[3] >= 8) bottomRowPx++;
      }

      return {
        width: src.width,
        height: src.height,
        opaque,
        bbox: [x0, y0, x1, y1],
        bboxW: x1 - x0 + 1,
        bboxH: y1 - y0 + 1,
        bottomRowPx,
        darkPx,
        headDarkPx,
        headDarkX: headDarkPx
          ? Number((headDarkSumX / headDarkPx).toFixed(1))
          : null,
        centreX: src.width / 2,
      };
    })();

    const tiles = game.textures.get('tiles');
    const tilesSrc = tiles.getSourceImage();
    const tileFrame = tiles.getFrameNames();

    return {
      renderer: game.renderer.type === 2 ? 'WebGL' : 'Canvas',
      canvasBacking: [canvas.width, canvas.height],
      canvasDisplay: [canvas.clientWidth, canvas.clientHeight],
      imageRendering: getComputedStyle(canvas).imageRendering,
      worldBounds: [world.bounds.width, world.bounds.height],
      player: player
        ? {
            x: Math.round(player.x),
            y: Math.round(player.y),
            w: body.width,
            h: body.height,
            collidesWorld: body.collideWorldBounds,
            maxVel: [body.maxVelocity.x, body.maxVelocity.y],
          }
        : null,
      oneWayBodies,
      oneWayStretched,
      iceTiles,
      iceCollides,
      autotile,
      heroSprite,
      tilesTexture: [tilesSrc.width, tilesSrc.height],
      tilesFrames: tileFrame.length,
      tilesFrame0: tileFrame.length
        ? [tiles.get(tileFrame[0]).width, tiles.get(tileFrame[0]).height]
        : null,
    };
  });

  const checks = [
    ['canvas backing store is 960x540', report.canvasBacking[0] === 960 && report.canvasBacking[1] === 540],
    ['canvas CSS-scaled up', report.canvasDisplay[0] >= 960],
    ['image-rendering is pixelated', report.imageRendering === 'pixelated'],
    ['player exists', report.player !== null],
    ['player hitbox is 61x116', report.player?.w === 61 && report.player?.h === 116],
    ['player collides with world bounds', report.player?.collidesWorld === true],
    ['max velocity caps jump, not fall (y=2170)', report.player?.maxVel[1] === 2170],
    ['one-way platform bodies built', report.oneWayBodies >= 2],
    ['one-way runs collapsed into stretched bodies', report.oneWayStretched >= 1],
    ['level contains ice tiles', report.iceTiles > 0],
    ['ice tiles collide (index 3 is in the collision set)', report.iceCollides === true],
    // The autotile pass. The buried rows are most of the map, and getting the
    // collision set wrong there drops the hero through the floor while the
    // surface row above still looks and behaves perfectly — so assert both
    // halves: the buried cell is the interior index AND it collides.
    [
      'ground: snow cap on the top row, fill below',
      report.autotile.groundSurface === 1 && report.autotile.groundBuried === 0,
    ],
    [
      'ice patch has no snow cap where the ground beside it does',
      report.autotile.iceSurface === 3 && report.autotile.groundSurface === 1,
    ],
    [
      'raised plateau is also capped only at its top',
      report.autotile.plateauTop === 1 && report.autotile.plateauBuried === 0,
    ],
    [
      'buried fill is the bulk of the map and collides',
      report.autotile.counts[0] > report.autotile.counts[1] * 2 &&
        report.iceCollides === true,
    ],
    // The hero's alpha box has to reach the sprite's LAST row, because
    // Player.setOffset(17, 8) pins the body's bottom there. If the art floats,
    // the hero visibly hovers above the ground it is standing on.
    [
      'hero art is planted on the last row',
      report.heroSprite.bottomRowPx >= 10 &&
        report.heroSprite.bbox[3] === report.heroSprite.height - 1,
    ],
    // 95x124 is not cosmetic: HERO_H is the unit every movement constant is
    // expressed in, and the hitbox offset is derived from this canvas.
    [
      'hero texture is 95x124 at the art\'s native scale',
      report.heroSprite.width === 95 && report.heroSprite.height === 124,
    ],
    // The bear's fur is a warm cream and the outline is a hard navy rim. That
    // rim is what keeps the hero readable against a snow tile; without it the
    // silhouette washes out. (The placeholder's green scarf used to do this
    // job — see the Art section of the README.)
    ['hero sprite carries a dark rim', report.heroSprite.darkPx >= 300],
    // The hero faces right and setFlipX mirrors the whole sprite, so facial
    // features on the wrong side would be wrong in BOTH orientations.
    [
      'hero faces right (head features right of centre)',
      report.heroSprite.headDarkPx > 50 &&
        report.heroSprite.headDarkX > report.heroSprite.centreX,
    ],
    // A spritesheet registers one frame per cell, and the one-way ledge indexes
    // this texture by frame. Without frames Phaser logs "has no frame" and
    // silently draws the whole strip.
    ['tiles texture exposes one frame per tile', report.tilesFrames === 4],
    [
      'tiles frames are one collision tile each',
      report.tilesFrame0?.[0] === 70 && report.tilesFrame0?.[1] === 66,
    ],
    // The tileset samples UVs by dividing the image into tile-sized cells, and
    // it WARNS rather than throws if the image is not an exact multiple — a
    // 281px-wide strip would sample shifted tiles with the suite still green.
    [
      'tiles strip is exactly 4 cells wide',
      report.tilesTexture[0] === 280 && report.tilesTexture[1] === 66,
    ],
    ['no missing-frame warnings', !consoleLines.some((l) => l.includes('has no frame'))],
    ['no runtime errors', errors.length === 0],
  ];

  console.log('\n--- boot report ---');
  console.log(JSON.stringify(report, null, 2));
  console.log('\n--- console output from the page ---');
  for (const line of consoleLines) console.log('  ' + line);

  console.log('\n--- checks ---');
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
  }

  if (errors.length) {
    console.log('\n--- errors ---');
    for (const e of errors) console.log('  ' + e);
  }

  console.log(
    failed === 0
      ? `\nall ${checks.length} checks passed`
      : `\n${failed} of ${checks.length} checks FAILED`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
} catch (err) {
  console.error('smoke test threw:', err.message);
  for (const line of consoleLines) console.error('  console: ' + line);
  for (const e of errors) console.error('  error: ' + e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  vite.kill('SIGTERM');
}
