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
      tilesFrames: game.textures.get('ph-tiles').getFrameNames().length,
      heroFrames: game.textures.get('ph-hero').getFrameNames().length,
    };
  });

  const checks = [
    ['canvas backing store is 480x270', report.canvasBacking[0] === 480 && report.canvasBacking[1] === 270],
    ['canvas CSS-scaled up', report.canvasDisplay[0] >= 480],
    ['image-rendering is pixelated', report.imageRendering === 'pixelated'],
    ['player exists', report.player !== null],
    ['player hitbox is 16x30', report.player?.w === 16 && report.player?.h === 30],
    ['player collides with world bounds', report.player?.collidesWorld === true],
    ['max velocity caps jump, not fall (y=560)', report.player?.maxVel[1] === 560],
    ['one-way platform bodies built', report.oneWayBodies >= 2],
    ['one-way runs collapsed into stretched bodies', report.oneWayStretched >= 1],
    // A createCanvas texture has one base frame unless frames are added. The
    // one-way platform sprites index this texture by tile, and without frames
    // Phaser silently falls back to the whole 128x32 strip.
    ['tiles texture exposes one frame per tile', report.tilesFrames === 4],
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
