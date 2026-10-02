import { spawnSync } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] ?? 'phyra-demo-trial.webm';
const scene = process.argv[3] ?? '3d';
if (!/^[a-z0-9][a-z0-9-]{0,79}\.webm$/.test(name))
  throw new Error(
    'Pass a lowercase recording name ending in .webm; files are written under artifacts/promo.',
  );
if (!['3d', '2d'].includes(scene)) throw new Error('Choose the 3d or 2d capture scene.');

const outputDir = path.join(root, 'artifacts/promo');
const output = path.join(outputDir, name);
const url = process.env.PHYRA_PROMO_URL ?? 'http://127.0.0.1:1420';
await mkdir(outputDir, { recursive: true });
try {
  await access(output);
  throw new Error(`Refusing to overwrite an existing recording: ${output}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const env = {
  ...process.env,
  NO_UPDATE_NOTIFIER: '1',
  PLAYWRIGHT_CLI_SESSION: 'phyra-launch-demo',
};
const runCli = (args) => {
  const result = spawnSync(
    'npm',
    ['exec', '--yes', '--package=@playwright/cli@0.1.22', '--', 'playwright-cli', ...args],
    { cwd: root, env, encoding: 'utf8', stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Playwright CLI exited with status ${result.status}`);
};

const response = await fetch(url);
if (!response.ok) throw new Error(`The local preview returned HTTP ${response.status}: ${url}`);

runCli(['open', url]);
const take = `async page => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const example = page.getByRole('combobox', { name: 'Load example' });
  const selected = await example.inputValue();
  const label = ${JSON.stringify(scene === '3d' ? '3D cantilever beam' : '2D plane-stress tension')};
  const expectedValue = ${JSON.stringify(scene === '3d' ? 'cantilever' : 'plane-stress-tension')};
  if (selected !== expectedValue) await example.selectOption({ label });
  const inspect = page.getByRole('button', {
    name: ${JSON.stringify(scene === '3d' ? 'Inspect 3D reference' : 'Inspect 2D comparison')},
  });
  await inspect.waitFor({ timeout: 10000 });
  await inspect.click();
  const referenceLabel = ${JSON.stringify(scene === '3d' ? 'Saved CPU reference · 3D cantilever · Desktop required to compute' : 'Saved CPU reference · 2D FEM/PINN comparison · Desktop required to compute')};
  await page.getByText(referenceLabel, { exact: true }).waitFor({ timeout: 10000 });

  await page.screencast.start({ path: ${JSON.stringify(output)}, size: { width: 1920, height: 1080 }, fps: 30 });
  await page.screencast.showActions({ cursor: 'pointer', duration: 600, style: { title: 'display: none' } });
  try {
    await page.waitForTimeout(1800);
    if (${JSON.stringify(scene)} === '3d') {
      await page.getByRole('button', { name: /^Geometry / }).click();
      await page.getByRole('heading', { name: 'Geometry' }).waitFor();
      await page.waitForTimeout(1300);
      await page.getByRole('button', { name: /Results Current solution/ }).click();
      await page.getByRole('heading', { name: 'Results' }).waitFor();
      const canvas = page.locator('canvas').first();
      const box = await canvas.boundingBox();
      if (!box) throw new Error('The 3D viewport canvas is not visible');
      await page.mouse.move(box.x + box.width * 0.47, box.y + box.height * 0.48);
      await page.mouse.down();
      try {
        await page.mouse.move(box.x + box.width * 0.50, box.y + box.height * 0.50, { steps: 2 });
      } finally {
        await page.mouse.up();
      }
    } else {
      await page.getByRole('button', { name: 'PINN', exact: true }).click();
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: 'Absolute Δ', exact: true }).click();
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: 'Stored training history', exact: true }).click();
    }
    await page.waitForTimeout(7800);
  } finally {
    await page.screencast.stop();
  }
}`;

try {
  runCli(['run-code', take]);
} finally {
  runCli(['close']);
}

console.log(`Recorded ${output}`);
