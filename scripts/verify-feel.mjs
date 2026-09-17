/**
 * Movement verification.
 *
 * Boots the real game and measures the movement constants against the claims
 * made in src/config/movement.ts. This is the milestone's actual acceptance
 * criterion — "it boots" says nothing about whether the jump is 3.5 tiles.
 *
 * Phaser steps Arcade physics at a fixed 60Hz by default, so these numbers are
 * framerate-independent and safe to assert.
 *
 * Usage: npm run verify
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const PORT = 5198;
const URL = `http://localhost:${PORT}/`;

const CHROME_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
];

const chromePath = CHROME_CANDIDATES.find(existsSync);
if (!chromePath) {
  console.error('No Chromium/Chrome binary found.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('dev server did not come up');
}

const vite = spawn(
  'npx',
  ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let browser;
const results = [];

try {
  await waitForServer();

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });

  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.game && window.game.isBooted && window.game.scene.isActive('Level'),
    { timeout: 20_000 },
  );

  // Install a per-frame recorder driven by the scene's own update event, so
  // samples line up with physics steps rather than with whatever Node happens
  // to poll.
  await page.evaluate(() => {
    const scene = window.game.scene.getScene('Level');
    const rec = { on: false, ys: [], minY: Infinity, vxs: [], vyAtJump: [] };
    window.__rec = rec;
    window.__begin = () => {
      rec.on = true;
      rec.ys = [];
      rec.minY = Infinity;
      rec.vxs = [];
    };
    window.__end = () => {
      rec.on = false;
      const ys = rec.ys;
      return {
        minY: rec.minY,
        maxY: ys.length ? Math.max(...ys) : NaN,
        firstY: ys.length ? ys[0] : NaN,
        lastY: ys.length ? ys[ys.length - 1] : NaN,
        yRange: ys.length ? Math.max(...ys) - Math.min(...ys) : NaN,
        maxVx: rec.vxs.length ? Math.max(...rec.vxs.map(Math.abs)) : NaN,
        frames: ys.length,
      };
    };
    scene.events.on('update', () => {
      if (!rec.on) return;
      const p = scene.player;
      if (!p) return;
      rec.ys.push(p.y);
      rec.vxs.push(p.body.velocity.x);
      rec.minY = Math.min(rec.minY, p.y);
    });
  });

  /** Put the hero back at spawn, on the ground, at rest, and let it settle. */
  const reset = async () => {
    await page.evaluate(() => window.game.scene.getScene('Level').player.respawn());
    await sleep(500);
  };

  const baseline = await page.evaluate(() => {
    const p = window.game.scene.getScene('Level').player;
    return { x: p.x, y: p.y, groundTop: 13 * 32 };
  });

  // ---- 1. standing stability -------------------------------------------
  // The design decision this guards: gravity is left ON while grounded rather
  // than zeroed. If that were wrong, the body would oscillate on a 2-frame
  // cycle and this range would be large.
  await reset();
  await page.evaluate(() => window.__begin());
  await sleep(1000);
  const standing = await page.evaluate(() => window.__end());
  results.push([
    'standing still: y is stable (no shimmer)',
    standing.yRange < 1.0,
    `y range ${standing.yRange.toFixed(3)}px over ${standing.frames} frames`,
  ]);

  // ---- 2. full-hold jump apex ------------------------------------------
  await reset();
  await page.evaluate(() => window.__begin());
  await page.keyboard.down('ArrowUp');
  await sleep(900);
  await page.keyboard.up('ArrowUp');
  const fullJump = await page.evaluate(() => window.__end());
  const fullApex = baseline.y - fullJump.minY;
  results.push([
    'held jump apex ~112px (3.5 tiles)',
    Math.abs(fullApex - 112) <= 6,
    `apex ${fullApex.toFixed(1)}px (${(fullApex / 32).toFixed(2)} tiles)`,
  ]);

  // ---- 3. tap jump has a floor -----------------------------------------
  // The claim in movement.ts is that the clamp guarantees a MINIMUM hop,
  // unlike a multiplier whose result depends on release timing. So a very
  // short tap must still clear ~39px, and must be strictly less than a hold.
  await reset();
  await page.evaluate(() => window.__begin());
  await page.keyboard.down('ArrowUp');
  await sleep(25);
  await page.keyboard.up('ArrowUp');
  await sleep(900);
  const tapJump = await page.evaluate(() => window.__end());
  const tapApex = baseline.y - tapJump.minY;
  results.push([
    'tap jump has a floor (>= 39px)',
    tapApex >= 39,
    `apex ${tapApex.toFixed(1)}px (${(tapApex / 32).toFixed(2)} tiles)`,
  ]);
  results.push([
    'tap jump is strictly shorter than held jump',
    tapApex < fullApex - 10,
    `tap ${tapApex.toFixed(1)}px vs held ${fullApex.toFixed(1)}px`,
  ]);

  // ---- 4. run-up to top speed ------------------------------------------
  // 160px/s at 1300px/s^2 = 0.123s to reach top speed.
  await reset();
  await page.evaluate(() => window.__begin());
  await page.keyboard.down('ArrowRight');
  await sleep(500);
  const runUp = await page.evaluate(() => window.__end());
  await page.keyboard.up('ArrowRight');
  results.push([
    'run reaches max speed 160px/s',
    Math.abs(runUp.maxVx - 160) <= 1,
    `max |vx| ${runUp.maxVx}px/s over ${runUp.frames} frames`,
  ]);

  // ---- 5. ground friction stops crisply --------------------------------
  // Release at full speed: drag is 1500px/s^2, so it should stop in ~0.11s.
  // Sample how far it travels after release.
  await reset();
  await page.keyboard.down('ArrowRight');
  await sleep(600); // reach top speed
  const beforeRelease = await page.evaluate(() => {
    const p = window.game.scene.getScene('Level').player;
    return { x: p.x, vx: p.body.velocity.x };
  });
  await page.keyboard.up('ArrowRight');
  await sleep(600); // well past the stop
  const afterStop = await page.evaluate(() => {
    const p = window.game.scene.getScene('Level').player;
    return { x: p.x, vx: p.body.velocity.x };
  });
  const slideDist = afterStop.x - beforeRelease.x;
  results.push([
    'ground friction stops crisply (< 32px slide)',
    Math.abs(slideDist) < 32 && Math.abs(afterStop.vx) < 1,
    `slid ${slideDist.toFixed(1)}px, final vx ${afterStop.vx.toFixed(1)}`,
  ]);

  // ---- 6. one-way platform: pass through from below --------------------
  // Column 20-24 at row 10 is a one-way platform. Walking under it and
  // jumping must NOT be blocked. This is the case the common
  // processCallback + velocity.y > 0 idiom gets wrong at the apex.
  const oneWay = await page.evaluate(() => {
    const scene = window.game.scene.getScene('Level');
    const plats = scene.children.list.filter(
      (c) => c.body && c.body.physicsType === 1 && c.displayWidth > 32,
    );
    return plats.map((p) => ({
      x: Math.round(p.x),
      y: Math.round(p.y),
      w: p.displayWidth,
      up: p.body.checkCollision.up,
      down: p.body.checkCollision.down,
      left: p.body.checkCollision.left,
      right: p.body.checkCollision.right,
    }));
  });
  const allCorrectFlags = oneWay.every(
    (p) => p.up === true && !p.down && !p.left && !p.right,
  );
  results.push([
    'one-way platforms have exactly the right collision faces',
    allCorrectFlags,
    JSON.stringify(oneWay),
  ]);

  // ---- report ----------------------------------------------------------
  console.log(`\nbaseline: spawn y=${baseline.y}, ground top=${baseline.groundTop}`);
  console.log('\n--- movement verification ---');
  let failed = 0;
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    console.log(`        ${detail}`);
    if (!ok) failed++;
  }
  console.log(
    failed === 0
      ? `\nall ${results.length} movement checks passed`
      : `\n${failed} of ${results.length} movement checks FAILED`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
} catch (err) {
  console.error('verify-feel threw:', err.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  vite.kill('SIGTERM');
}
