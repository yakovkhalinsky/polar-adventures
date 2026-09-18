/**
 * Regenerates docs/*.png from the running game.
 *
 * The README's screenshots are the project's shop window, and every one of them
 * is wrong the moment the art or the level changes. Capturing them by hand is
 * how they end up a year out of date, so this drives the real game in headless
 * Chromium exactly as the test harnesses do and writes the three frames the
 * README refers to.
 *
 * Usage: npm run screenshots
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 5197;
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

  // 1920x1080, which the 960x540 internal resolution doubles into exactly. Any
  // other viewport would put the canvas on a fractional scale and the shots
  // would be soft — the one thing a pixel-art screenshot must not be.
  await page.setViewport({ width: 1920, height: 1080 });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.game && window.game.isBooted && window.game.scene.isActive('Level'),
    { timeout: 20_000 },
  );
  await sleep(600);

  const playerX = () =>
    page.evaluate(() => window.game.scene.getScene('Level').player.x);

  const shoot = async (name) => {
    const path = join(ROOT, 'docs', name);
    await page.screenshot({ path });
    console.log(`wrote docs/${name}`);
  };

  /**
   * Run right, with a deadline on every wait.
   *
   * The deadline is not decoration: without one, a hero that falls in the pit
   * respawns and walks back into it forever, and the script hangs until the
   * outer timeout kills it with no output at all.
   */
  const runRightTo = async (x, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    await page.keyboard.down('ArrowRight');
    while ((await playerX()) < x && Date.now() < deadline) await sleep(30);
  };

  /** Jump the pit at columns 10-13: the run-up has to start before x=700. */
  const jumpPit = async () => {
    await page.keyboard.down('ArrowUp');
    await sleep(420);
    await page.keyboard.up('ArrowUp');
  };

  // 1. Standing at the edge of the pit, with the plateau and the one-way
  //    ledges to the right — the frame that shows the level.
  await runRightTo(640);
  await page.keyboard.up('ArrowRight');
  await sleep(900);
  await shoot('screenshot.png');

  // 2. The same frame with the Arcade debug overlay on. F1 is the game's own
  //    toggle, so the shot uses it — and the result is CHECKED, because a debug
  //    screenshot that is byte-identical to the normal one is worse than none.
  //
  //    down+up rather than press(): `press` sends both with no gap and the
  //    handler ends up firing twice, leaving the overlay off. Verified against
  //    the real game.
  await page.keyboard.down('F1');
  await page.keyboard.up('F1');
  await sleep(400);
  const debugOn = await page.evaluate(
    () => window.game.scene.getScene('Level').physics.world.drawDebug,
  );
  if (!debugOn) throw new Error('F1 did not toggle the debug overlay');
  await shoot('physics-debug.png');
  await page.keyboard.down('F1');
  await page.keyboard.up('F1');

  // 3. Sliding on the ice. Jump the pit at full speed, land on the sheet, then
  //    let go and capture while it is still carrying the hero: the point of the
  //    image is that the hero is moving without any input.
  await runRightTo(640);
  await jumpPit();
  await runRightTo(1380);
  await page.keyboard.up('ArrowRight');
  await sleep(600);
  await shoot('ice.png');
} catch (err) {
  console.error('screenshots threw:', err.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  vite.kill('SIGTERM');
}
