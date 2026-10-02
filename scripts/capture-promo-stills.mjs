import { spawnSync } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
const outputDir = path.join(root, 'artifacts/promo', `validated-stills-${stamp}`);
const url = process.env.PHYRA_PROMO_URL ?? 'http://127.0.0.1:1420';
await mkdir(outputDir, { recursive: false });

const env = {
  ...process.env,
  NO_UPDATE_NOTIFIER: '1',
  PLAYWRIGHT_CLI_SESSION: 'phyra-promo-stills',
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
const capture = `async page => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const save = async name => {
    await page.mouse.move(0, 0);
    await page.screenshot({ path: ${JSON.stringify(outputDir)} + '/' + name, animations: 'disabled', caret: 'hide' });
  };
  const example = page.getByRole('combobox', { name: 'Load example' });
  if (await example.inputValue() !== 'cantilever') await example.selectOption({ label: '3D cantilever beam' });
  await page.getByRole('button', { name: 'Inspect 3D reference' }).click();
  await page.getByText('Saved CPU reference · 3D cantilever · Desktop required to compute', { exact: true }).waitFor();
  await page.getByRole('button', { name: /^Geometry / }).click();
  await page.getByRole('heading', { name: 'Geometry' }).waitFor();
  await save('3d-geometry.png');
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
  await page.waitForTimeout(500);
  await save('3d-orbit-results.png');

  if (await example.inputValue() !== 'plane-stress-tension') await example.selectOption({ label: '2D plane-stress tension' });
  await page.getByRole('button', { name: 'Inspect 2D comparison' }).click();
  await page.getByText('Saved CPU reference · 2D FEM/PINN comparison · Desktop required to compute', { exact: true }).waitFor();
  await save('2d-comparison.png');
  await page.getByRole('button', { name: 'PINN', exact: true }).click();
  await save('2d-pinn.png');
  await page.getByRole('button', { name: 'Absolute Δ', exact: true }).click();
  await save('2d-absolute-delta.png');
  await page.getByRole('button', { name: 'Stored training history', exact: true }).click();
  await save('2d-stored-history.png');
}`;

try {
  runCli(['run-code', capture]);
} finally {
  runCli(['close']);
}

console.log(`Captured verified UI stills under ${outputDir}`);
