import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Compose genuine Phyra screenshots with a narration and an instrumental score.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const captures = path.join(root, 'artifacts/promo');
const segments = path.join(captures, 'segments');
const output = path.join(root, 'assets/media');
const ffmpeg = process.env.PHYRA_FFMPEG ?? 'ffmpeg';
const narration = path.join(captures, 'narration.mp3');
const music = path.join(captures, 'music.mp3');
const icon = path.join(root, 'src-tauri/icons/icon.png');
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
await Promise.all([mkdir(output, { recursive: true }), mkdir(segments, { recursive: true })]);
await Promise.all([access(icon), access(narration), access(music)]);

const scenes = JSON.parse(await readFile(path.join(root, 'scripts/promo-scenes.json'), 'utf8'));
if (!Array.isArray(scenes) || scenes.length < 5)
  throw new Error('Capture at least five real application or roadmap scenes before rendering');

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

async function textFile(name, text) {
  const file = path.join(captures, `${name}.txt`);
  await writeFile(file, text);
  return file;
}

function drawText(file, size, x, y, color = '0xf4f5f6') {
  return `drawtext=fontfile='${escapeFilter(font)}':textfile='${escapeFilter(file)}':fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}`;
}

function validScene(scene) {
  return (
    scene &&
    ['screen', 'recording', 'card'].includes(scene.type) &&
    typeof scene.name === 'string' &&
    /^[a-z0-9-]+$/.test(scene.name) &&
    typeof scene.heading === 'string' &&
    typeof scene.detail === 'string' &&
    Number.isFinite(scene.duration) &&
    scene.duration > 0 &&
    scene.duration <= 20
  );
}

async function titleCard(name, duration, heading, detail, footer, logoScale) {
  const file = path.join(segments, `${name}.mp4`);
  const headingFile = await textFile(`${name}-heading`, heading);
  const detailFile = await textFile(`${name}-detail`, detail);
  const footerFile = await textFile(`${name}-footer`, footer);
  const filters = [
    `[0:v]scale=${logoScale}:${logoScale}[mark]`,
    '[1:v][mark]overlay=(W-w)/2:224[brand]',
    `[brand]${drawText(headingFile, 74, '(w-text_w)/2', 426)},${drawText(detailFile, 31, '(w-text_w)/2', 550, '0xb5c6d1')},drawbox=x=900:y=625:w=120:h=4:color=0x64b8ac:t=fill,${drawText(footerFile, 22, '(w-text_w)/2', 930, '0x9caab4')},fade=t=in:d=0.45,fade=t=out:st=${duration - 0.45}:d=0.45[v]`,
  ].join(';');
  run([
    '-loop',
    '1',
    '-framerate',
    '30',
    '-i',
    icon,
    '-f',
    'lavfi',
    '-i',
    'color=c=0x151b22:s=1920x1080:r=30',
    '-filter_complex',
    filters,
    '-map',
    '[v]',
    '-t',
    String(duration),
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-an',
    file,
  ]);
  return { file, duration };
}

async function screenScene(scene, index) {
  const image = path.resolve(root, scene.image);
  if (!image.startsWith(`${root}${path.sep}`)) throw new Error('Scene image must stay in the repository');
  await access(image);
  const heading = await textFile(`${scene.name}-heading`, scene.heading);
  const detail = await textFile(`${scene.name}-detail`, scene.detail);
  const chapter = await textFile(
    `${scene.name}-chapter`,
    `${String(index + 1).padStart(2, '0')}  /  ${String(scenes.length).padStart(2, '0')}`,
  );
  const file = path.join(segments, `${String(index + 1).padStart(2, '0')}-${scene.name}.mp4`);
  const filters = [
    '[0:v]scale=1800:920:force_original_aspect_ratio=decrease,pad=1800:920:(ow-iw)/2:(oh-ih)/2:color=0xf0f2f0,fps=30,format=yuv420p,setsar=1[screen]',
    '[1:v]drawbox=x=0:y=0:w=1920:h=76:color=0x151b22:t=fill,drawbox=x=0:y=1022:w=1920:h=58:color=0x151b22:t=fill,drawbox=x=0:y=76:w=1920:h=3:color=0x64b8ac:t=fill[base]',
    '[base][screen]overlay=60:80:shortest=1[frame]',
    `[frame]${drawText(heading, 30, '64', '21')},${drawText(chapter, 20, 'w-text_w-64', '27', '0xb5c6d1')},${drawText(detail, 22, '64', '1038', '0xe2e7eb')},fps=30,format=yuv420p[v]`,
  ].join(';');
  run([
    '-loop',
    '1',
    '-framerate',
    '30',
    '-i',
    image,
    '-f',
    'lavfi',
    '-i',
    'color=c=0xf0f2f0:s=1920x1080:r=30',
    '-filter_complex',
    filters,
    '-map',
    '[v]',
    '-t',
    String(scene.duration),
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-an',
    file,
  ]);
  return { file, duration: scene.duration };
}

async function recordingScene(scene, index) {
  const source = path.resolve(root, scene.source);
  if (!source.startsWith(`${root}${path.sep}`)) throw new Error('Recording source must stay in the repository');
  await access(source);
  const heading = await textFile(`${scene.name}-heading`, scene.heading);
  const detail = await textFile(`${scene.name}-detail`, scene.detail);
  const chapter = await textFile(
    `${scene.name}-chapter`,
    `${String(index + 1).padStart(2, '0')}  /  ${String(scenes.length).padStart(2, '0')}`,
  );
  const file = path.join(segments, `${String(index + 1).padStart(2, '0')}-${scene.name}.mp4`);
  const filters = [
    `[0:v]fps=30,scale=1800:760:force_original_aspect_ratio=decrease,pad=1800:760:(ow-iw)/2:(oh-ih)/2:color=0xf0f2f0,tpad=stop_mode=clone:stop_duration=1,trim=duration=${scene.duration},format=yuv420p,setsar=1[screen]`,
    '[1:v]drawbox=x=0:y=0:w=1920:h=76:color=0x151b22:t=fill,drawbox=x=0:y=1022:w=1920:h=58:color=0x151b22:t=fill,drawbox=x=0:y=76:w=1920:h=3:color=0x64b8ac:t=fill[base]',
    '[base][screen]overlay=60:150[frame]',
    `[frame]drawbox=x=60:y=150:w=1800:h=760:color=0x64b8ac@0.65:t=2,${drawText(heading, 30, '64', '21')},${drawText(chapter, 20, 'w-text_w-64', '27', '0xb5c6d1')},${drawText(detail, 22, '64', '1038', '0xe2e7eb')},fps=30,format=yuv420p[v]`,
  ].join(';');
  run([
    '-i',
    source,
    '-f',
    'lavfi',
    '-i',
    'color=c=0x151b22:s=1920x1080:r=30',
    '-filter_complex',
    filters,
    '-map',
    '[v]',
    '-t',
    String(scene.duration),
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-an',
    file,
  ]);
  return { file, duration: scene.duration };
}

async function informationCard(scene, index) {
  if (!Array.isArray(scene.items) || scene.items.length < 3 || scene.items.length > 4)
    throw new Error('Information cards need three or four concise items');
  const file = path.join(segments, `${String(index + 1).padStart(2, '0')}-${scene.name}.mp4`);
  const heading = await textFile(`${scene.name}-heading`, scene.heading);
  const detail = await textFile(`${scene.name}-detail`, scene.detail);
  const footer = await textFile(`${scene.name}-footer`, scene.footer ?? '');
  const filters = [
    `[0:v]${drawText(heading, 46, '90', '130')},${drawText(detail, 25, '92', '220', '0xb5c6d1')}[base]`,
  ];
  const cardWidth = scene.items.length === 4 ? 410 : 500;
  const gap = scene.items.length === 4 ? 40 : 58;
  const totalWidth = cardWidth * scene.items.length + gap * (scene.items.length - 1);
  const left = Math.floor((1920 - totalWidth) / 2);
  let previous = 'base';
  for (const [itemIndex, item] of scene.items.entries()) {
    const title = await textFile(`${scene.name}-item-${itemIndex}-title`, item.title);
    const body = await textFile(`${scene.name}-item-${itemIndex}-body`, item.body);
    const next = `card${itemIndex}`;
    const x = left + itemIndex * (cardWidth + gap);
    filters.push(
      `[${previous}]drawbox=x=${x}:y=385:w=${cardWidth}:h=410:color=0x202832:t=fill,drawbox=x=${x}:y=385:w=${cardWidth}:h=4:color=0x64b8ac:t=fill,${drawText(title, 25, `${x + 24}`, '432', '0x77c8bb')},${drawText(body, 22, `${x + 24}`, '492', '0xf0f2f3')}[${next}]`,
    );
    previous = next;
  }
  filters.push(`[${previous}]${drawText(footer, 21, '(w-text_w)/2', '944', '0x9caab4')},fade=t=in:d=0.35,fade=t=out:st=${scene.duration - 0.35}:d=0.35[v]`);
  run([
    '-f',
    'lavfi',
    '-i',
    'color=c=0x151b22:s=1920x1080:r=30',
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[v]',
    '-t',
    String(scene.duration),
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-an',
    file,
  ]);
  return { file, duration: scene.duration };
}

const clips = [
  await titleCard(
    'intro',
    4,
    'PHYRA',
    'Engineering analysis, with Physics ML.',
    'OPEN SOURCE  /  LOCAL ANALYSIS  /  LINEAR ELASTICITY',
    132,
  ),
];
for (const [index, scene] of scenes.entries()) {
  if (!validScene(scene)) throw new Error('Invalid capture manifest');
  clips.push(
    scene.type === 'screen'
      ? await screenScene(scene, index)
      : scene.type === 'recording'
        ? await recordingScene(scene, index)
        : await informationCard(scene, index),
  );
}
clips.push(
  await titleCard(
    'outro',
    6,
    'Prepare. Solve locally. Understand.',
    'Start with a built-in example. Help shape what comes next.',
    'github.com/oguzhankir/phyra  /  GPL-3.0-or-later',
    88,
  ),
);

const transition = 0.6;
const totalDuration = clips.reduce((sum, clip) => sum + clip.duration, 0) - transition * (clips.length - 1);
const graph = clips.map((_, index) => `[${index}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=30,format=yuv420p[v${index}]`);
let previous = 'v0';
let offset = clips[0].duration - transition;
for (let index = 1; index < clips.length; index += 1) {
  const current = `v${index}`;
  const next = `mix${index}`;
  graph.push(`[${previous}][${current}]xfade=transition=fade:duration=${transition}:offset=${offset.toFixed(2)}[${next}]`);
  previous = next;
  offset += clips[index].duration - transition;
}
const narrationIndex = clips.length;
const musicIndex = clips.length + 1;
graph.push(
  `[${narrationIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atempo=0.972,volume=1.0,apad=pad_dur=${totalDuration},atrim=duration=${totalDuration}[voice]`,
  `[${musicIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.2,afade=t=in:st=0:d=1.8,afade=t=out:st=${Math.max(0, totalDuration - 3)}:d=3,atrim=duration=${totalDuration}[bed]`,
  '[voice][bed]amix=inputs=2:duration=longest:dropout_transition=2,loudnorm=I=-16:TP=-1.5:LRA=10[audio]',
);
const args = clips.flatMap((clip) => ['-i', clip.file]);
args.push('-i', narration, '-stream_loop', '-1', '-i', music, '-filter_complex', graph.join(';'));
const video = path.join(output, 'phyra-introduction.mp4');
run([
  ...args,
  '-map',
  `[${previous}]`,
  '-map',
  '[audio]',
  '-t',
  totalDuration.toFixed(3),
  '-c:v',
  'libx264',
  '-preset',
  'slow',
  '-crf',
  '26',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '160k',
  '-ar',
  '48000',
  '-movflags',
  '+faststart',
  video,
]);
const poster = path.join(output, 'phyra-introduction-poster.jpg');
run(['-ss', '6', '-i', video, '-frames:v', '1', '-q:v', '2', poster]);
console.log(`Rendered ${video} (${totalDuration.toFixed(1)} seconds) and ${poster}`);
