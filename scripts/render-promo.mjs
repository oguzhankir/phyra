import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Compose real application captures; no synthetic results or UI mockups.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const captures = path.join(root, 'artifacts/promo');
const output = path.join(root, 'assets/media');
const ffmpeg = process.env.PHYRA_FFMPEG ?? 'ffmpeg';
const candidates = process.env.PHYRA_PROMO_FONT
  ? [process.env.PHYRA_PROMO_FONT]
  : process.platform === 'darwin'
    ? ['/System/Library/Fonts/Supplemental/Arial.ttf']
    : process.platform === 'win32'
      ? [path.join(process.env.WINDIR ?? 'C:/Windows', 'Fonts/arial.ttf')]
      : ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
let font;
for (const candidate of candidates) {
  try {
    await access(candidate);
    font = candidate;
    break;
  } catch {
    // A caller can supply a local font without bundling it in the repository.
  }
}
if (!font) throw new Error('Set PHYRA_PROMO_FONT to an installed font file');
await mkdir(output, { recursive: true });
const segments = path.join(captures, 'segments');
await mkdir(segments, { recursive: true });
const scenes = JSON.parse(await readFile(path.join(captures, 'scenes.json'), 'utf8'));
if (!Array.isArray(scenes) || scenes.length < 3)
  throw new Error('Capture at least three real application scenes before rendering');

function run(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `ffmpeg exited ${result.status}`);
}
function escapeFilter(value) {
  return value.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'");
}
async function caption(name, text, size, y, centered = false, color = '0x252726') {
  const file = path.join(captures, `${name}.txt`);
  await writeFile(file, text);
  return `drawtext=fontfile='${escapeFilter(font)}':textfile='${escapeFilter(file)}':fontsize=${size}:fontcolor=${color}:x=${centered ? '(w-text_w)/2' : '64'}:y=${y}`;
}
const encode = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-an'];
const files = [];
async function card(name, duration, heading, description, footer) {
  const file = path.join(segments, `${name}.mp4`);
  const text = [
    await caption(`${name}-heading`, heading, 68, 515, true),
    await caption(`${name}-description`, description, 29, 621, true, '0x626861'),
    await caption(`${name}-footer`, footer, 23, 929, true, '0x626861'),
  ];
  run([
    '-f',
    'lavfi',
    '-i',
    'color=c=0xfafaf8:s=1920x1080:r=30',
    '-loop',
    '1',
    '-i',
    path.join(root, 'src-tauri/icons/icon.png'),
    '-filter_complex',
    `[1:v]scale=160:160[mark];[0:v][mark]overlay=(W-w)/2:294,${text.join(',')},fade=t=in:d=0.4,fade=t=out:st=${duration - 0.4}:d=0.4[v]`,
    '-map',
    '[v]',
    '-t',
    String(duration),
    ...encode,
    file,
  ]);
  files.push(file);
}

await card(
  'intro',
  4,
  'Phyra',
  'Engineering analysis, with Physics ML.',
  'v0.1.0 · GPL-3.0 desktop workbench',
);
for (const [index, scene] of scenes.entries()) {
  if (
    typeof scene.name !== 'string' ||
    !/^[a-z0-9-]+$/.test(scene.name) ||
    typeof scene.heading !== 'string' ||
    typeof scene.detail !== 'string' ||
    !Number.isFinite(scene.duration) ||
    scene.duration <= 0 ||
    scene.duration > 15
  )
    throw new Error('Invalid capture manifest');
  const directory = path.join(captures, scene.name);
  const still = path.join(captures, `${scene.name}.jpg`);
  const file = path.join(segments, `${index}-${scene.name}.mp4`);
  const input = scene.frames
    ? ['-framerate', String(scene.frames / scene.duration), '-i', path.join(directory, '%05d.jpg')]
    : ['-loop', '1', '-i', still];
  await access(scene.frames ? path.join(directory, '00000.jpg') : still);
  const title = await caption(`${scene.name}-heading`, scene.heading, 32, 30);
  const detail = await caption(`${scene.name}-detail`, scene.detail, 21, 1040, false, '0x626861');
  const number = await caption(
    `${scene.name}-number`,
    `${String(index + 1).padStart(2, '0')} / ${String(scenes.length).padStart(2, '0')}`,
    21,
    30,
    false,
    '0x626861',
  );
  const filter = `[0:v]scale=1792:942:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:94:color=0xfafaf8,setsar=1,fps=30,${title},${detail},${number.replace(':x=64:', ':x=w-text_w-64:')},fade=t=in:d=0.25,fade=t=out:st=${scene.duration - 0.25}:d=0.25[v]`;
  run([
    ...input,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-t',
    String(scene.duration),
    ...encode,
    file,
  ]);
  files.push(file);
}
await card(
  'outro',
  6,
  'Physics ML, grounded in engineering.',
  'Explore the workbench. Help shape what comes next.',
  'Phyra v0.1.0 · CAD, broader physics and reusable models on the roadmap',
);
const list = path.join(segments, 'concat.txt');
await writeFile(list, files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'));
const video = path.join(output, 'phyra-introduction.mp4');
run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', video]);
run([
  '-ss',
  '5',
  '-t',
  '5',
  '-i',
  video,
  '-filter_complex',
  '[0:v]fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
  '-loop',
  '0',
  path.join(output, 'phyra-preview.gif'),
]);
console.log(`Rendered ${video}`);
