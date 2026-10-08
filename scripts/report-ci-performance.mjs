import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const durationMs = (start, end) => {
  const started = Date.parse(start ?? '');
  const finished = Date.parse(end ?? '');
  return Number.isFinite(started) && Number.isFinite(finished) && finished >= started
    ? finished - started
    : null;
};

const minutes = (value) => (value === null ? 'n/a' : `${(value / 60_000).toFixed(1)} min`);

function stepsDuration(job, predicate) {
  const matching = (job.steps ?? []).filter((step) => predicate(step.name));
  const measured = matching
    .map((step) => durationMs(step.started_at, step.completed_at))
    .filter((duration) => duration !== null);
  if (measured.length) return minutes(measured.reduce((total, duration) => total + duration, 0));
  if (matching.length && matching.every((step) => step.conclusion === 'skipped')) return 'skipped';
  return 'n/a';
}

const step = (pattern) => (name) => pattern.test(name);
const isRunnerSetupStep = (name) =>
  name === 'Set up job' ||
  /^Run actions\/(?:checkout|setup-node|setup-python)@/.test(name) ||
  /^Run dtolnay\/rust-toolchain@/.test(name) ||
  /^Run Swatinem\/rust-cache@/.test(name);

export function buildPerformanceSummary(run, jobs) {
  const platformJobs = jobs
    .map((job) => ({ job, match: /desktop \(([^)]+)\)$/.exec(job.name) }))
    .filter(({ match }) => match)
    .map(({ job, match }) => ({ ...job, platform: match[1] }))
    .sort((left, right) => left.platform.localeCompare(right.platform));

  const runStarted = Date.parse(run.run_started_at ?? run.created_at ?? '');
  const lastPlatformCompletion = Math.max(
    0,
    ...platformJobs.map((job) => Date.parse(job.completed_at ?? '')).filter(Number.isFinite),
  );
  const validationWall =
    Number.isFinite(runStarted) && lastPlatformCompletion >= runStarted
      ? lastPlatformCompletion - runStarted
      : null;
  const reportingElapsed = Number.isFinite(runStarted) ? Date.now() - runStarted : null;

  const rows = platformJobs.map((job) => {
    const queue = durationMs(job.created_at, job.started_at);
    const total = durationMs(job.started_at, job.completed_at);
    return [
      job.platform,
      job.conclusion === 'skipped' ? 'skipped' : minutes(queue),
      job.conclusion === 'skipped' ? 'skipped' : minutes(total),
      stepsDuration(job, isRunnerSetupStep),
      stepsDuration(job, step(/^Run npm ci$/)),
      stepsDuration(job, step(/^Run npm run setup$/)),
      stepsDuration(job, step(/^Run npm run (?:test:native|check:native)$/)),
      stepsDuration(job, step(/^Run npm (?:test|run test:numerics-slow)$/)),
      stepsDuration(job, step(/^Run npm run package$/)),
      stepsDuration(job, step(/^Run npm run test:desktop$/)),
    ];
  });

  const markdown = [
    `## CI performance (${run.event}, run [${run.run_number}](https://github.com/${run.repository}/actions/runs/${run.id}))`,
    '',
    `- Platform validation wall time (run start to last platform completion): **${minutes(validationWall)}**`,
    `- Workflow elapsed when this report was generated: **${minutes(reportingElapsed)}**`,
    '- Runner queue delay is job creation to runner start; `n/a` means GitHub did not return both timestamps.',
    '- Cache hit/miss is recorded in each platform job summary by the Rust cache step.',
    '',
    '| Platform | Queue | Job | Runner setup | npm ci | Python/CAD setup | Rust tests + Clippy | Tests + numerics | Package | Desktop |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
    'Packaging remains a full engine + Tauri bundle because desktop verification launches the packaged application and checks its bundled engine and native resources.',
    '',
  ];

  if (!platformJobs.length)
    markdown.splice(
      2,
      0,
      '- GitHub returned no `desktop (...)` jobs for this workflow run; inspect the Actions jobs view for reusable-workflow nesting.',
    );

  return markdown.join('\n');
}

async function main() {
  const repository = process.env.CI_REPOSITORY;
  const runId = process.env.CI_RUN_ID;
  const token = process.env.CI_GITHUB_TOKEN;
  const apiUrl = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;

  if (!repository || !runId || !token || !summaryPath)
    throw new Error('CI timing report requires repository, run ID, token, and step summary paths');

  const [owner, repo] = repository.split('/');
  if (!owner || !repo) throw new Error(`Invalid GitHub repository: ${repository}`);

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  async function get(endpoint) {
    const response = await fetch(`${apiUrl}${endpoint}`, { headers });
    if (!response.ok) throw new Error(`GitHub API ${endpoint} returned ${response.status}`);
    return response.json();
  }

  const [run, jobsResponse] = await Promise.all([
    get(`/repos/${owner}/${repo}/actions/runs/${runId}`),
    get(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100&filter=latest`),
  ]);
  run.repository = repository;
  run.id = runId;
  await appendFile(summaryPath, buildPerformanceSummary(run, jobsResponse.jobs ?? []), 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
