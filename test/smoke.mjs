// Standalone theme smoke test. All fixtures are synthetic and created under work/.
import { mkdir, mkdtemp, writeFile, readFile, cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { checkTheme, readPostIndex } from './check-theme.mjs';

const require = createRequire(import.meta.url);
const themeRoot = fileURLToPath(new URL('../', import.meta.url));
const temporary = path.join(themeRoot, 'work', 'tmp');
await mkdir(temporary, { recursive: true });
const run = await mkdtemp(path.join(temporary, 'smoke-'));
const cli = path.join(path.dirname(require.resolve('hexo/package.json')), 'bin', 'hexo');
const plugins = ['hexo-generator-archive', 'hexo-generator-category', 'hexo-generator-index', 'hexo-generator-tag', 'hexo-renderer-ejs', 'hexo-renderer-marked'];
const pluginDependencies = Object.fromEntries(plugins.map(name => [name, '*']));
const reports = [];

for (const [label, siteRoot, count] of [['empty', '/', 0], ['root', '/', 3], ['subdirectory', '/demo/', 3]]) {
  const site = path.join(run, label);
  await mkdir(path.join(site, 'source', '_posts'), { recursive: true });
  await mkdir(path.join(site, 'source', '_drafts'), { recursive: true });
  await mkdir(path.join(site, 'themes', 'welkin'), { recursive: true });
  for (const item of ['layout', 'lib', 'scripts', 'source', '_config.yml']) {
    await cp(path.join(themeRoot, item), path.join(site, 'themes', 'welkin', item), { recursive: true });
  }
  await writeFile(path.join(site, 'package.json'), JSON.stringify({ name: 'welkin-smoke-fixture', version: '1.0.0', private: true, hexo: { version: '8.1.2' }, dependencies: pluginDependencies }));
  const config = {
    title: 'Example Site', author: 'Example Author', description: 'Synthetic theme verification.', language: 'zh-CN', timezone: 'UTC',
    url: 'https://example.com' + siteRoot, root: siteRoot,
    theme: 'welkin', source_dir: 'source', public_dir: 'public',
    permalink: ':year/:month/:day/:title/', future: true,
    archive_dir: 'archives', category_dir: 'categories', tag_dir: 'tags', pagination_dir: 'page',
    per_page: 1, index_generator: { path: '', per_page: 1, order_by: '-date' },
    archive_generator: { enabled: true, per_page: 1, yearly: true, monthly: true },
    category_generator: { per_page: 1 }, tag_generator: { per_page: 1 },
  };
  await writeFile(path.join(site, '_config.yml'), require('js-yaml').dump(config));
  for (const [directory, type] of [['categories', 'categories'], ['tags', 'tags']]) {
    await mkdir(path.join(site, 'source', directory), { recursive: true });
    await writeFile(path.join(site, 'source', directory, 'index.md'), `---\ntitle: ${type}\ntype: ${type}\nlayout: page\n---\n`);
  }
  if (count) {
    await mkdir(path.join(site, 'source', 'images'), { recursive: true });
    await writeFile(path.join(site, 'source', 'images', 'cover.png'), await sharp({ create: { width: 64, height: 48, channels: 3, background: '#bda98b' } }).png().toBuffer());
  }
  for (let number = 1; number <= count; number++) {
    await writeFile(path.join(site, 'source', '_posts', 'example-' + number + '.md'), `---\ntitle: Example ${number}\ndate: 2026-01-0${number} 12:00:00\ncategories: [Notes]\ntags: [Example]\n${number === 1 ? 'cover: /images/cover.png\n' : ''}---\n## Example heading\n\nSynthetic content for theme verification.\n\n\`\`\`js\nconsole.log('example');\n\`\`\`\n`);
  }
  await writeFile(path.join(site, 'source', '_drafts', 'draft.md'), '---\ntitle: Private Draft Fixture\n---\nThis draft must not be published.\n');
  const result = spawnSync(process.execPath, [cli, 'generate', '--config', path.join(site, '_config.yml')], { cwd: site, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  assert(!/Plugin load failed|Script load failed/.test(result.stdout + result.stderr), result.stdout + result.stderr);
  const output = path.join(site, 'public');
  const posts = await readPostIndex(output);
  assert.equal(posts.length, count);
  assert(posts.every(post => /^Example \d$/.test(post.title)), 'Draft or unexpected content entered the index.');
  const checked = await checkTheme({ output, config, requireGlassCovers: true });
  if (count) {
    const articlePath = posts[0].url.slice(siteRoot.length);
    const html = await readFile(path.join(output, articlePath, 'index.html'), 'utf8');
    assert(html.includes('Synthetic content for theme verification.'), 'Missing static article content.');
  }
  reports.push({ fixture: label, ...checked.summary });
}
console.log(JSON.stringify({ smokeTests: reports }, null, 2));
