// Homepage behaviour. Hexo renders complete article pages separately.
(() => {
'use strict';
if (!document.getElementById('home-view')) return;

// Hexo supplies the complete publication order and prepared static covers.
const posts = [...(window.WELKIN_POSTS || [])];
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const entries = document.getElementById('entries');
const category = document.getElementById('category');
const search = document.getElementById('search');
const more = document.getElementById('more');
let expanded = false;
document.getElementById('article-total').textContent = posts.length + ' 篇记录';
function displayCover(post) {
  return post.glassCover || post.cover;
}
window.WELKIN_FEATURED = posts.map(post => ({ ...post, displayCover: displayCover(post) }));
const selector = document.getElementById('post-selector');
window.WELKIN_FEATURED.forEach((post, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'post-choice';
  button.dataset.postIndex = index;
  button.dataset.number = String(index + 1).padStart(2, '0');
  button.style.setProperty('--slot', index);
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', '预览：' + post.title);
  const title = document.createElement('span');
  title.className = 'choice-title';
  title.textContent = post.title;
  const date = document.createElement('span');
  date.className = 'choice-date';
  date.textContent = post.date.replaceAll('-', '.');
  if (index === 0) {
    const badge = document.createElement('span');
    badge.className = 'choice-new';
    badge.textContent = '最新';
    date.append(badge);
  }
  const face = document.createElement('span');
  face.className = 'file-face';
  face.append(title, date);
  button.append(face);
  selector.append(button);
});
if (typeof window.initWelkinMotion === 'function') window.initWelkinMotion(window.WELKIN_FEATURED);
window.dispatchEvent(new Event('welkin-ready'));

const arrow = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('entry-arrow');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M4 16 16 4M4 4h12v12');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.2');
  svg.append(path);
  return svg;
};
function postCategories(post) {
  const values = Array.isArray(post.categories) ? post.categories : [post.category];
  return values.filter(value => typeof value === 'string' && value.trim());
}
for (const value of new Set(posts.flatMap(postCategories))) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = value;
  category.append(option);
}
const revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver(items => {
  for (const item of items) if (item.isIntersecting) {
    if (!motionPreference.matches) item.target.classList.add('is-revealing');
    revealObserver.unobserve(item.target);
  }
}, { threshold: .1 }) : null;
function renderEntries() {
  revealObserver?.disconnect();
  const term = search.value.trim().toLocaleLowerCase();
  const matches = posts.filter(post => (category.value === 'all' || postCategories(post).includes(category.value)) &&
    [post.title, post.excerpt, ...(post.tags || [])].join(' ').toLocaleLowerCase().includes(term));
  const visible = expanded || term || category.value !== 'all' ? matches : matches.slice(0, 8);
  entries.replaceChildren();
  visible.forEach((post, index) => {
    const link = document.createElement('a');
    link.className = 'entry';
    link.href = post.url;
    link.style.setProperty('--reveal-delay', (Math.min(index % 4, 3) * 40) + 'ms');
    for (const [style, value] of [['entry-date', post.date.replaceAll('-', '.')], ['entry-title', post.title], ['entry-category', post.category]]) {
      const span = document.createElement('span');
      span.className = style;
      span.textContent = value;
      link.append(span);
    }
    link.append(arrow());
    entries.append(link);
    revealObserver?.observe(link);
  });
  document.getElementById('empty').hidden = matches.length > 0;
  document.getElementById('archive-count').textContent = matches.length;
  document.getElementById('search-status').textContent = '找到 ' + matches.length + ' 篇文章，显示 ' + visible.length + ' 篇。';
  more.hidden = visible.length >= matches.length;
}
category.addEventListener('change', () => { expanded = false; renderEntries(); });
search.addEventListener('input', renderEntries);
more.addEventListener('click', () => { expanded = true; renderEntries(); });
renderEntries();

// Static contour artwork for covers that have not loaded.
const fallbackContours = document.getElementById('fallback-contours');
for (let ring = 0; ring < 26; ring++) {
  let d = '';
  for (let step = 0; step <= 160; step++) {
    const angle = step / 160 * Math.PI * 2;
    const radius = 50 + ring * 16;
    const modulation = 1 + Math.sin(angle * 3 + .5) * .13 + Math.cos(angle * 5 - ring * .045) * .055;
    const x = 780 + Math.cos(angle) * radius * modulation * 1.25;
    const y = 360 + Math.sin(angle) * radius * modulation * .85 + Math.cos(angle * 2) * 22;
    d += (step ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d + 'Z');
  path.setAttribute('transform', 'translate(-140 20) scale(.65)');
  fallbackContours.append(path);
}
function updateNavigation() {
  const active = location.hash === '#archive' ? 'archive' : 'home';
  for (const item of document.querySelectorAll('[data-nav]')) {
    const selected = item.dataset.nav === active;
    item.classList.toggle('active', selected);
    if (selected) item.setAttribute('aria-current', active === 'archive' ? 'location' : 'page');
    else item.removeAttribute('aria-current');
  }
}
updateNavigation();
window.addEventListener('hashchange', updateNavigation);
})();
