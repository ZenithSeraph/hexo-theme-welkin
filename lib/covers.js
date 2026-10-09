'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { url_for } = require('hexo-util');

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_ORIGINAL_BYTES = 128 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const ORIGINAL_TIMEOUT_MS = 90000;
const CONCURRENCY = 2;
const OSS_PROCESS = 'image/resize,m_lfit,w_2560,h_2560/quality,q_88/format,webp';
const EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'],
  ['image/avif', 'avif'], ['image/gif', 'gif'],
]);

function localUrl(value, config) {
  let route = value.replace(/^\.\//, '');
  const root = config.root || '/';
  if (root !== '/' && route.startsWith(root)) route = route.slice(root.length);
  return url_for.call({ config }, route, { relative: false });
}

function coverSource(value, config = {}) {
  if (typeof value !== 'string') return { kind: 'none' };
  const cover = value.trim();
  if (!cover || /[\\\u0000-\u001f\u007f]/.test(cover) || /^[?#]/.test(cover)) return { kind: 'none' };
  if (!/^[a-z][a-z\d+.-]*:/i.test(cover) && !cover.startsWith('//')) {
    try { return { kind: 'local', url: localUrl(cover, config) }; }
    catch (_) { return { kind: 'none' }; }
  }
  let url;
  try { url = new URL(cover.startsWith('//') ? 'https:' + cover : cover); }
  catch (_) { return { kind: 'none' }; }
  if (url.protocol !== 'https:' || url.username || url.password) return { kind: 'none' };
  try {
    if (url.origin === new URL(config.url).origin) {
      return { kind: 'local', url: localUrl(url.pathname + url.search + url.hash, config) };
    }
  } catch (_) { /* A missing site URL does not invalidate an external HTTPS image. */ }
  url.hash = '';
  const oss = /(^|\.)oss-[a-z\d-]+\.aliyuncs\.com$/i.test(url.hostname);
  const original = new URL(url);
  if (oss) {
    original.searchParams.delete('x-oss-process');
    const previous = url.searchParams.get('x-oss-process');
    // Retain an author's crop/watermark before applying the bounded rendition.
    url.searchParams.set('x-oss-process', previous && previous.startsWith('image/')
      ? previous + '/' + OSS_PROCESS.slice('image/'.length) : OSS_PROCESS);
  }
  const source = url.href;
  return {
    kind: 'remote', url: source, originalUrl: original.href, oss,
    key: createHash('sha256').update(source + '\nwelkin-webp-2560-q88-max2mb-v1').digest('hex'),
  };
}

function localGlassCover(cover, config) {
  const source = coverSource(cover, config);
  return source.kind === 'local' ? source.url : '';
}

function diskCache(directory) {
  return {
    async get(key) {
      try {
        const manifestPath = path.join(directory, key + '.json');
        if ((await fs.stat(manifestPath)).size > 1024) return null;
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        const extension = EXTENSIONS.get(manifest.mime);
        if (manifest.mime !== 'image/webp' || !extension || !Number.isInteger(manifest.length) || manifest.length < 1 || manifest.length > MAX_THUMBNAIL_BYTES) return null;
        const imagePath = path.join(directory, key + '.' + extension);
        if ((await fs.stat(imagePath)).size !== manifest.length) return null;
        const data = await fs.readFile(imagePath);
        return data.length === manifest.length ? { mime: manifest.mime, data } : null;
      } catch (_) { return null; }
    },
    async set(key, image) {
      await fs.mkdir(directory, { recursive: true });
      const extension = EXTENSIONS.get(image.mime);
      const suffix = '.' + randomUUID() + '.tmp';
      const imagePath = path.join(directory, key + '.' + extension);
      const manifestPath = path.join(directory, key + '.json');
      const imageTemporary = imagePath + suffix;
      const manifestTemporary = manifestPath + suffix;
      try {
        await fs.writeFile(imageTemporary, image.data);
        await fs.rename(imageTemporary, imagePath);
        await fs.writeFile(manifestTemporary, JSON.stringify({ mime: image.mime, length: image.data.length }));
        await fs.rename(manifestTemporary, manifestPath);
      } finally {
        await Promise.all([imageTemporary, manifestTemporary].map(file => fs.unlink(file).catch(() => {})));
      }
    },
  };
}

async function downloadCover(source, { fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('HTTPS image fetching is unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, ORIGINAL_TIMEOUT_MS));
  let response;
  let reader;
  try {
    let destination = new URL(source);
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (destination.protocol !== 'https:' || destination.username || destination.password) throw new Error('Only HTTPS images are accepted');
      response = await fetchImpl(destination.href, {
        method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw new Error('Too many image redirects');
      destination = new URL(location, destination);
    }
    if (!response.ok) {
      let errorBody = '';
      if (response.status === 400 && response.body) {
        reader = response.body.getReader();
        const chunks = [];
        let length = 0;
        while (length < 8192) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value).subarray(0, 8192 - length);
          chunks.push(chunk);
          length += chunk.length;
        }
        errorBody = Buffer.concat(chunks).toString('utf8');
      }
      const error = new Error('Image request returned HTTP ' + response.status);
      if (/ImageTooLarge/.test(errorBody)) error.code = 'OSS_IMAGE_TOO_LARGE';
      throw error;
    }
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!EXTENSIONS.has(mime)) throw new Error('Unsupported image content type');
    const limit = Math.min(maxBytes, MAX_ORIGINAL_BYTES);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > limit) {
      throw Object.assign(new Error('Image exceeds the download limit'), { code: 'IMAGE_SIZE_LIMIT' });
    }
    if (!response.body) throw new Error('Image response has no body');
    reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw Object.assign(new Error('Image exceeds the download limit'), { code: 'IMAGE_SIZE_LIMIT' });
      chunks.push(Buffer.from(value));
    }
    if (!length) throw new Error('Image response is empty');
    return { mime, data: Buffer.concat(chunks, length) };
  } finally {
    clearTimeout(timer);
    controller.abort();
    try {
      if (reader) await reader.cancel();
      else await response?.body?.cancel();
    } catch (_) { /* The request may already have been aborted or consumed. */ }
  }
}

async function thumbnail(image, options) {
  if (image.mime === 'image/webp' && image.data.length <= MAX_THUMBNAIL_BYTES && options.processedByOss) return image;
  const sharp = options.sharpImpl || require('sharp');
  // Header inspection does not decode the image. JPEG can shrink during loading,
  // so allow large photographic originals without relaxing other format limits.
  const probe = sharp(image.data, { limitInputPixels: false, sequentialRead: true });
  let header;
  try { header = await probe.metadata(); }
  finally { probe.destroy?.(); }
  const pixelLimit = header.format === 'jpeg' ? 1000000000 : 144000000;
  const pixels = header.width * header.height;
  if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > pixelLimit) {
    throw new Error('Input image exceeds the ' + pixelLimit + ' pixel limit');
  }
  // Each attempt starts from the same input; only the bounded WebP is retained.
  for (const quality of [88, 80, 72, 64]) {
    const pipeline = sharp(image.data, { limitInputPixels: pixelLimit, sequentialRead: true });
    try {
      const data = await pipeline.autoOrient()
        .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true, fastShrinkOnLoad: true })
        .webp({ quality }).timeout({ seconds: 45 }).toBuffer();
      if (data.length && data.length <= MAX_THUMBNAIL_BYTES) return { mime: 'image/webp', data };
    } finally { pipeline.destroy?.(); }
  }
  throw new Error('Generated cover exceeds the 2 MB thumbnail limit');
}

async function fetchThumbnail(source, options) {
  let image;
  let processedByOss = false;
  if (source.oss) {
    try {
      image = await downloadCover(source.url, options);
      processedByOss = true;
    } catch (error) {
      if (!['OSS_IMAGE_TOO_LARGE', 'IMAGE_SIZE_LIMIT'].includes(error.code)) throw error;
    }
  }
  if (!image) {
    image = await downloadCover(source.originalUrl, {
      ...options, timeoutMs: ORIGINAL_TIMEOUT_MS, maxBytes: MAX_ORIGINAL_BYTES,
    });
  }
  return thumbnail(image, { ...options, processedByOss });
}

async function prepareGlassCovers(posts, options) {
  const { config, baseDir, warn = () => {} } = options;
  const cache = options.cache || diskCache(path.join(baseDir, '.cache', 'welkin-covers'));
  const indexed = posts.map(post => ({ ...post, glassCover: '' }));
  const downloads = new Map();
  const routes = [];
  for (const post of indexed) {
    const source = coverSource(post.cover, config);
    if (source.kind === 'local') post.glassCover = source.url;
    if (source.kind !== 'remote') continue;
    if (!downloads.has(source.key)) downloads.set(source.key, { ...source, posts: [] });
    downloads.get(source.key).posts.push(post);
  }
  const queue = [...downloads.values()];
  let next = 0;
  async function worker() {
    while (next < queue.length) {
      const source = queue[next++];
      try {
        let image;
        try { image = await cache.get(source.key); } catch (_) { /* Download when a cache cannot be read. */ }
        if (!image || image.mime !== 'image/webp' || !Buffer.isBuffer(image.data) || !image.data.length || image.data.length > MAX_THUMBNAIL_BYTES) {
          image = await fetchThumbnail(source, options);
          try { await cache.set(source.key, image); }
          catch (_) { warn('Welkin cover cache could not be written; this build still includes the image.'); }
        }
        const routePath = 'assets/welkin/covers/' + source.key + '.' + EXTENSIONS.get(image.mime);
        routes.push({ path: routePath, data: image.data });
        const glassCover = localUrl(routePath, config);
        source.posts.forEach(post => { post.glassCover = glassCover; });
      } catch (error) {
        warn('Welkin glass cover unavailable (' + new URL(source.url).hostname + '): ' + error.message);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));
  routes.sort((a, b) => a.path.localeCompare(b.path));
  return { posts: indexed, routes };
}

module.exports = {
  coverSource, localGlassCover, downloadCover, prepareGlassCovers, OSS_PROCESS,
  MAX_BYTES, MAX_ORIGINAL_BYTES, MAX_THUMBNAIL_BYTES,
};
