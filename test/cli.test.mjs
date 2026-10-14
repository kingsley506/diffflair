import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'bin', 'diffflair.mjs');

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10_000 });
}

async function fixture(t, before = { amount: 12, apiToken: 'private_old_value' }, after = { amount: 15, apiToken: 'private_new_value' }) {
  const dir = await mkdtemp(join(tmpdir(), 'diffflair-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const files = [join(dir, 'before.json'), join(dir, 'after.json')];
  await Promise.all([writeFile(files[0], JSON.stringify(before)), writeFile(files[1], JSON.stringify(after))]);
  return { dir, files };
}

test('CLI prints an actionable summary without value disclosure', async (t) => {
  const { files } = await fixture(t);
  const result = run(files);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 differences/);
  assert.match(result.stdout, /\/amount/);
  assert.doesNotMatch(result.stdout, /private_(old|new)_value/);
});

test('JSON report masks secrets by default and records comparison rules', async (t) => {
  const { files } = await fixture(t);
  const result = run([...files, '--format', 'json', '--ignore', '/amount']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.rules.ignorePaths, ['/amount']);
  assert.equal(report.rules.redact, true);
  assert.equal(report.changes.length, 1);
  assert.equal(report.changes[0].path, '/apiToken');
  assert.doesNotMatch(result.stdout, /private_(old|new)_value/);
});

test('--no-redact retains original report values', async (t) => {
  const { files } = await fixture(t);
  const result = run([...files, '--format=json', '--no-redact']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /private_old_value/);
  assert.match(result.stdout, /private_new_value/);
  assert.equal(JSON.parse(result.stdout).rules.redact, false);
});

test('RFC 6902 patches preserve original values', async (t) => {
  const { files } = await fixture(t);
  const result = run([...files, '--format', 'patch']);
  assert.equal(result.status, 0, result.stderr);
  const patch = JSON.parse(result.stdout);
  assert.deepEqual(patch.find((op) => op.path === '/apiToken'), { op: 'replace', path: '/apiToken', value: 'private_new_value' });
});

for (const format of ['html', 'markdown']) {
  test(`${format} writes an offline report with values masked`, async (t) => {
    const { dir, files } = await fixture(t);
    const output = join(dir, `report.${format === 'html' ? 'html' : 'md'}`);
    const result = run([...files, '--format', format, '--output', output, '--ignore', '/amount']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Saved/);
    const report = await readFile(output, 'utf8');
    assert.match(report, /apiToken/);
    assert.doesNotMatch(report, /private_(old|new)_value/);
    if (format === 'html') assert.match(report, /<!doctype html>/i);
  });
}

test('--check returns 1 for changes and still produces output', async (t) => {
  const { files } = await fixture(t);
  const result = run([...files, '--check']);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /differences/);
});

test('--check writes the requested report before returning 1', async (t) => {
  const { dir, files } = await fixture(t);
  const output = join(dir, 'report.json');
  const result = run([...files, '--format', 'json', '--output', output, '--check']);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).changes.length, 2);
});

test('partially ignored array additions do not export an invalid patch', async (t) => {
  const { files } = await fixture(t, [], ['skip', 'include']);
  const result = run([...files, '--ignore', '/0', '--format', 'patch']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /partially ignored array additions/);
  assert.equal(result.stdout, '');
});

test('removing earlier array items does not shift an ignored index in a patch', async (t) => {
  const { files } = await fixture(t, ['keep', 'remove', 'ignored'], ['keep']);
  const result = run([...files, '--ignore', '/2', '--format', 'patch']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /preserves an ignored array index/);
  assert.equal(result.stdout, '');
});

test('a descendant ignore inside an added container returns an actionable error', async (t) => {
  const { files } = await fixture(t, {}, { profile: { name: 'A', token: 'private_value' } });
  const result = run([...files, '--ignore', '/profile/token', '--format', 'json', '--no-redact']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /ignore the whole container/);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /private_value/);
});

test('--check returns 0 for equal JSON including object-key order changes', async (t) => {
  const { files } = await fixture(t, { a: 1, b: 2 }, { b: 2, a: 1 });
  const result = run([...files, '--check']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'No differences.\n');
});

test('repeated ignore paths exclude subtrees', async (t) => {
  const { files } = await fixture(t, { user: { name: 'A' }, stamp: 1, value: 2 }, { user: { name: 'B' }, stamp: 2, value: 2 });
  const result = run([...files, '--check', '--ignore', '/user', '--ignore=/stamp']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'No differences.\n');
});

test('the empty JSON Pointer ignores the entire document', async (t) => {
  const { files } = await fixture(t);
  const result = run([...files, '--check', '--ignore', '']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'No differences.\n');
});

test('invalid JSON returns 2 and identifies the file', async (t) => {
  const { files } = await fixture(t);
  await writeFile(files[1], '{"broken":');
  const result = run(files);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /after\.json: invalid UTF-8 JSON/);
  assert.equal(result.stdout, '');
});

test('invalid UTF-8 is rejected rather than silently replaced', async (t) => {
  const { files } = await fixture(t);
  await writeFile(files[1], Buffer.from([0x22, 0xff, 0x22]));
  const result = run(files);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid UTF-8 JSON/);
});

test('files exceeding 2 MiB return 2', async (t) => {
  const { files } = await fixture(t);
  await writeFile(files[1], `"${'a'.repeat(2 * 1024 * 1024)}"`);
  const result = run(files);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /2 MiB limit/);
});

test('missing input files return 2', async (t) => {
  const { dir, files } = await fixture(t);
  const result = run([files[0], join(dir, 'missing.json')]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing\.json/);
});

test('unwritable report destinations return 2', async (t) => {
  const { dir, files } = await fixture(t);
  const result = run([...files, '--output', join(dir, 'missing-folder', 'report.html')]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /ENOENT/);
});

for (const args of [[], ['one.json'], ['a', 'b', 'c'], ['a', 'b', '--format', 'xml'], ['a', 'b', '--wat'], ['a', 'b', '--output'], ['a', 'b', '--ignore', 'invalid'], ['a', 'b', '--ignore', '/bad~2escape']]) {
  test(`invalid arguments exit 2: ${JSON.stringify(args)}`, () => {
    const result = run(args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^DiffFlair:/);
  });
}

test('help and version are available without input files', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /RFC 6902 patches always use original/);
  const version = run(['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
});
