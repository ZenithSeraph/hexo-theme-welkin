// Inspect an existing Hexo output. This command never builds or writes files.
import { readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export async function loadSiteConfig(filename = path.join(projectRoot, '_config.yml')) {
  return yaml.load(await readFile(filename, 'utf8'));
}

export async function readPostIndex(output) {
  const source = await readFile(path.join(output, 'assets/welkin/posts.js'), 'utf8');
  const assignment = source.match(/^\s*window\.WELKIN_POSTS\s*=\s*([\s\S]*);\s*$/);
  assert(assignment, 'Missing the generated WELKIN_POSTS assignment');
  const posts = JSON.parse(assignment[1]);
  assert(Array.isArray(posts), 'The post index must be an array');
  return posts;
}

function siteContext(config) {
  const site = new URL(config.url || 'https://welkin-check.example');
  const root = '/' + String(config.root || site.pathname || '/').replace(/^\/+|\/+$/g, '') + '/';
  return { origin: site.origin, root: root === '//' ? '/' : root };
}

export function resolveOutputFile(reference, fromRoute, config) {
  if (!reference || reference.startsWith('#')) return null;
  const site = siteContext(config);
  const url = new URL(reference, site.origin + site.root + fromRoute);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== site.origin) return null;
  const pathname = decodeURIComponent(url.pathname);
  const root = decodeURIComponent(site.root);
  assert(pathname.startsWith(root), 'Local URL is outside the configured root: ' + reference);
  let route = pathname.slice(root.length);
  assert(!route.includes('\\') && !route.split('/').includes('..'), 'Unsafe output path: ' + reference);
  if (!route || route.endsWith('/')) route += 'index.html';
  return route;
}

async function filesWithin(directory, relative = '') {
  const files = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await filesWithin(directory, name));
    else if (entry.isFile()) files.push(name);
  }
  return files.sort();
}

function inspectHtml(html, route) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const links = selector => [...document.querySelectorAll(selector)].map(element => ({
    href: element.getAttribute('href'), text: element.textContent.trim(),
  }));
  const imports = {};
  for (const script of document.querySelectorAll('script[type="importmap"]')) {
    Object.assign(imports, JSON.parse(script.textContent).imports || {});
  }
  const info = {
    route,
    articleTitle: document.querySelector('#article-title')?.textContent.trim(),
    articleBody: Boolean(document.querySelector('#article-start')),
    paper: Boolean(document.querySelector('.paper-sheet')),
    counter: document.querySelector('#article-total')?.textContent.trim(),
    scripts: [...document.querySelectorAll('script[src]')].map(element => element.getAttribute('src')),
    resources: [...document.querySelectorAll('script[src],link[href],img[src],source[src]')]
      .map(element => element.getAttribute('src') || element.getAttribute('href')),
    inlineStyles: [...document.querySelectorAll('style')].map(element => element.textContent),
    imports,
    categoryLinks: links('.reading-header .post-meta a'),
    tagLinks: links('.article-tags a[rel="tag"]'),
    categoryIndex: links('.cabinet-header a'),
    tagIndex: links('.taxonomy-row'),
    rows: links('.archive-row'),
    pagination: links('nav.pagination a[href]'),
    paginationText: document.querySelector('.collection-pagination')?.textContent.trim() || '',
    navigation: links('.site-header a,.back-link,.collection-nav a,.post-neighbours a,.archive-row,.cabinet-record,.cabinet-header a,.taxonomy-row,#feature-link,#detail-original,#entries .entry'),
    featureTitle: document.querySelector('#feature-title')?.textContent.trim(),
    featurePosition: document.querySelector('#feature-position')?.textContent.trim(),
    featureHref: document.querySelector('#feature-link')?.getAttribute('href'),
    archiveCount: document.querySelector('#archive-count')?.textContent.trim(),
    homeEntries: links('#entries .entry'),
  };
  dom.window.close();
  return info;
}

export async function checkTheme({ output = path.join(projectRoot, 'public'), config, requireGlassCovers = false } = {}) {
  config ||= await loadSiteConfig();
  output = path.resolve(output);
  const files = await filesWithin(output);
  const fileSet = new Set(files);
  const posts = await readPostIndex(output);
  const pages = new Map();
  for (const route of files.filter(file => file.endsWith('.html'))) {
    pages.set(route, inspectHtml(await readFile(path.join(output, route), 'utf8'), route));
  }
  const localFile = (reference, fromRoute = 'index.html') => {
    const route = resolveOutputFile(reference, fromRoute, config);
    assert(route && fileSet.has(route), 'Missing local target in ' + fromRoute + ': ' + reference);
    return route;
  };
  const localPage = (reference, fromRoute = 'index.html') => {
    const route = localFile(reference, fromRoute);
    assert(pages.has(route), 'Expected an HTML page: ' + reference);
    return pages.get(route);
  };
  const home = pages.get('index.html');
  assert(home, 'Missing homepage');
  assert.equal(home.archiveCount, String(posts.length), 'Homepage total differs from the generated index');
  assert.equal(home.featurePosition, posts.length ? '01 / ' + String(posts.length).padStart(2, '0') : '00 / 00');
  if (posts.length) {
    assert.equal(home.featureTitle, posts[0].title, 'Latest homepage title is stale');
    assert.equal(localFile(home.featureHref), localFile(posts[0].url), 'Latest homepage URL is stale');
  }
  const postRoutes = posts.map(post => localFile(post.url));
  assert.equal(new Set(postRoutes).size, posts.length, 'Two index entries point to the same article');
  assert.deepEqual(home.homeEntries.map(link => localFile(link.href)), postRoutes, 'Static homepage entries differ from the full index/order');
  const categories = new Map();
  const tags = new Map();
  const addTaxonomy = (groups, name, article, links, label) => {
    const link = links.find(item => item.text === name);
    assert(link, 'Article is missing its ' + label + ' link: ' + name + ' in ' + article);
    const target = localFile(link.href, article);
    if (!groups.has(name)) groups.set(name, { target, posts: new Set() });
    assert.equal(groups.get(name).target, target, 'Inconsistent taxonomy URL: ' + name);
    groups.get(name).posts.add(article);
  };
  const covers = new Set();
  const unavailableCovers = [];
  for (let index = 0; index < posts.length; index++) {
    const post = posts[index];
    assert(Number.isFinite(post.timestamp), 'Missing full publication timestamp: ' + post.title);
    if (index) assert(posts[index - 1].timestamp >= post.timestamp, 'Post index is not newest first');
    const article = pages.get(postRoutes[index]);
    assert(article?.paper && article.articleBody, 'Missing static paper article: ' + post.url);
    assert.equal(article.articleTitle, post.title, 'Article title differs from index: ' + post.url);
    for (const name of post.categories || (post.category ? [post.category] : [])) {
      addTaxonomy(categories, name, article.route, article.categoryLinks, 'category');
    }
    for (const name of post.tags || []) addTaxonomy(tags, name, article.route, article.tagLinks, 'tag');
    if (post.glassCover) {
      const cover = localFile(post.glassCover);
      if (!covers.has(cover)) {
        const filename = path.join(output, cover);
        const bytes = (await stat(filename)).size;
        assert(bytes > 0, 'Empty glass cover: ' + cover);
        const image = await sharp(filename, { limitInputPixels: false }).metadata();
        assert(image.width > 0 && image.height > 0, 'Unreadable glass cover: ' + cover);
        if (cover.startsWith('assets/welkin/covers/')) {
          assert.equal(image.format, 'webp');
          assert(bytes <= 2 * 1024 * 1024 && Math.max(image.width, image.height) <= 2560, 'Unbounded generated glass cover: ' + cover);
        }
        covers.add(cover);
      }
    } else if (post.cover) unavailableCovers.push(post.title);
  }
  if (requireGlassCovers) assert.equal(unavailableCovers.length, 0, 'Covers unavailable: ' + unavailableCovers.join(', '));

  const site = siteContext(config);
  const siteLink = route => site.root + route.replace(/^\/+/, '');
  const perPage = generator => Number(config[generator]?.per_page ?? config.per_page ?? 10);
  let listingsChecked = 0;
  let paginatedListings = 0;
  function checkListing(reference, expected, label, pageSize) {
    const start = localPage(reference);
    const queue = [start.route];
    const visited = new Set();
    const found = [];
    const expectedPages = pageSize > 0 ? Math.max(1, Math.ceil(expected.size / pageSize)) : 1;
    while (queue.length) {
      const route = queue.shift();
      if (visited.has(route)) continue;
      visited.add(route);
      const page = pages.get(route);
      assert(page?.paper, 'Missing paper listing: ' + route);
      const rows = page.rows.map(link => localFile(link.href, route));
      if (pageSize > 0) assert(rows.length <= pageSize, 'Pagination limit exceeded: ' + route);
      found.push(...rows);
      if (expectedPages > 1) {
        const caption = page.paginationText.match(/第\s*(\d+)\s*\/\s*(\d+)\s*页/);
        assert(caption && Number(caption[2]) === expectedPages, 'Wrong/missing pagination count: ' + route);
      }
      for (const link of page.pagination) queue.push(localPage(link.href, route).route);
    }
    assert.equal(visited.size, expectedPages, 'Pagination pages missing for ' + label);
    assert.equal(found.length, new Set(found).size, 'Duplicate articles across ' + label + ' pages');
    assert.deepEqual([...new Set(found)].sort(), [...expected].sort(), 'Wrong article membership in ' + label);
    listingsChecked++;
    if (expectedPages > 1) paginatedListings++;
  }
  const archiveDir = String(config.archive_dir || 'archives').replace(/^\/+|\/+$/g, '') + '/';
  const archiveOptions = config.archive_generator || {};
  if (archiveOptions.enabled !== false && posts.length) {
    const size = config.archive === 1 ? 0 : perPage('archive_generator');
    checkListing(siteLink(archiveDir), new Set(postRoutes), 'all archives', size);
    if (archiveOptions.yearly !== false) {
      const periods = new Map();
      posts.forEach((post, index) => {
        const [year, month, day] = post.date.split('-');
        const keys = [year];
        if (archiveOptions.monthly !== false) keys.push(year + '/' + month);
        if (archiveOptions.daily) keys.push(year + '/' + month + '/' + day);
        keys.forEach(key => { if (!periods.has(key)) periods.set(key, new Set()); periods.get(key).add(postRoutes[index]); });
      });
      for (const [period, expected] of periods) checkListing(siteLink(archiveDir + period + '/'), expected, 'archive ' + period, size);
    }
  }
  for (const [kind, groups, directory, generator] of [
    ['categories', categories, config.category_dir || 'categories', 'category_generator'],
    ['tags', tags, config.tag_dir || 'tags', 'tag_generator'],
  ]) {
    const index = localPage(siteLink(directory + '/'));
    const indexTargets = new Set(index[kind === 'categories' ? 'categoryIndex' : 'tagIndex'].map(link => localFile(link.href, index.route)));
    for (const [name, group] of groups) {
      assert(indexTargets.has(group.target), 'Taxonomy index omits ' + kind + ': ' + name);
      checkListing(siteLink(group.target), group.posts, kind + ': ' + name, perPage(generator));
    }
  }
  const indexPageSize = Number(config.index_generator?.per_page ?? 10);
  if (indexPageSize > 0) {
    const indexPages = Math.ceil(posts.length / indexPageSize);
    for (let number = 2; number <= indexPages; number++) {
      const page = localPage(siteLink((config.pagination_dir || 'page') + '/' + number + '/'));
      assert.deepEqual(new Set(page.rows.map(link => localFile(link.href, page.route))), new Set(postRoutes.slice((number - 1) * indexPageSize, number * indexPageSize)), 'Homepage pagination differs from the post index');
    }
  }

  const resourceQueue = [];
  const resourceSeen = new Set();
  const imports = home.imports;
  const enqueue = (reference, fromRoute) => {
    if (!reference || reference.startsWith('#') || /^(data|blob):/i.test(reference)) return;
    const resolved = new URL(reference, site.origin + site.root + fromRoute);
    if (resolved.origin !== site.origin || !resolved.pathname.includes('/assets/welkin/')) return;
    resourceQueue.push(localFile(reference, fromRoute));
  };
  const cssReferences = (text, fromRoute) => {
    for (const match of text.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) enqueue(match[2], fromRoute);
    for (const match of text.matchAll(/@import\s+['"]([^'"]+)['"]/g)) enqueue(match[1], fromRoute);
  };
  for (const page of pages.values()) {
    assert.equal(page.counter, posts.length + ' 篇记录', 'Footer total differs in ' + page.route);
    if (page.route !== 'index.html') {
      assert(!page.scripts.some(source => /(?:\/assets\/welkin\/(?:glass-scene|app|motion|detail-view)\.js|\/three(?:\.module|\.core)?\.js)(?:[?#]|$)/.test(source)), 'Homepage/Three.js code loaded by reading page: ' + page.route);
    }
    page.navigation.forEach(link => { if (link.href && !link.href.startsWith('#')) localPage(link.href, page.route); });
    page.resources.forEach(reference => enqueue(reference, page.route));
    Object.values(page.imports).forEach(reference => enqueue(reference, page.route));
    page.inlineStyles.forEach(text => cssReferences(text, page.route));
  }
  while (resourceQueue.length) {
    const route = resourceQueue.shift();
    if (resourceSeen.has(route)) continue;
    resourceSeen.add(route);
    if (!/\.(css|js|mjs)$/.test(route)) continue;
    const text = await readFile(path.join(output, route), 'utf8');
    if (route.endsWith('.css')) cssReferences(text, route);
    else {
      const expressions = [/(?:^|\n)\s*(?:import|export)\s+(?:[^;'"`]*?\sfrom\s*)?['"]([^'"]+)['"]/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g];
      for (const expression of expressions) for (const match of text.matchAll(expression)) {
        const specifier = imports[match[1]] || match[1];
        assert(/^(?:\.{0,2}\/|https?:)/.test(specifier), 'Unmapped module import: ' + match[1] + ' in ' + route);
        enqueue(specifier, route);
      }
    }
  }
  return {
    posts,
    summary: { output, htmlPages: pages.size, articles: posts.length, categories: categories.size, tags: tags.size,
      listingsChecked, paginatedListings, themeResourcesChecked: resourceSeen.size, readableSameOriginCovers: covers.size, unavailableCovers },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const output = path.resolve(projectRoot, args.find(arg => !arg.startsWith('--')) || 'public');
  const result = await checkTheme({ output, requireGlassCovers: args.includes('--require-covers') });
  console.log(JSON.stringify(result.summary, null, 2));
}
