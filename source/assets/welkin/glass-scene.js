/*
 * Procedural glass archives for the Welkin theme.
 * Art direction: layered glass and quiet studio lighting, informed by RhineLabUI.
 * Models, textures and marks are original. The signed travelling-wave profile
 * follows RhineLabUI's MIT-licensed baselineSelectionWave:
 * https://github.com/LBEILC/RhineLabUI/blob/main/src/motion.ts
 * Adapted motion formulas: Copyright (c) 2026 LBEILC (MIT).
 */
import * as THREE from 'three';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { createArchiveTouchGestures } from './touch-gestures.mjs';
import { articleIndexAt, classifyArchiveTarget, createWheelAccumulator, fingerDirection, nearestArticleCell } from './archive-input.mjs';

let disposeScene = null;

function initializeGlassScene() {
  const mount = document.getElementById('glass-scene');
  const stage = document.getElementById('feature-stage');
  const selector = document.getElementById('post-selector');
  const homeView = document.getElementById('home-view');
  const articleList = document.getElementById('archive');
  const featureTitleLink = document.getElementById('feature-link');
  if (document.getElementById('home-view')?.hidden) return;
  const buttons = selector ? [...selector.querySelectorAll('button[data-post-index]')] : [];
  if (!mount || !stage || !buttons.length || mount.dataset.webgl === 'ready') return;
  if (disposeScene) disposeScene();

  const posts = (window.WELKIN_FEATURED || window.WELKIN_POSTS || []).slice(0, buttons.length);
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const pointerQuery = matchMedia('(hover: hover) and (pointer: fine)');
  let reduced = reducedQuery.matches;
  let disposed = false;
  let inView = true;
  let frame = 0;
  let idleTimer = 0;
  let previousTime = 0;
  let lastPaintTime = 0;
  let renderAverage = 0;
  let measuredFrames = 0;
  const rafIntervals = new Float64Array(240);
  let rafWindowSize = 0;
  let rafCursor = 0;
  let rafCycleSamples = 0;
  let rafCycleTotalMs = 0;
  let rafLatestMs = 0;
  let rafCycle = 0;
  let rafCycleActive = false;
  let rafLastPublishedAt = 0;
  let qualityLocked = false;
  let qualityRestoreTimer = 0;
  let qualityChangeCount = 0;
  let appliedQuality = null;
  let renderWidth = 1;
  let renderHeight = 1;
  let prewarmHandle = null;
  let prewarmPromise = null;
  let prewarmComplete = false;
  let warmupCursor = 0;
  const coverCache = new Map();
  const coverCacheLimit = 4;
  let coverWarmTimer = 0;
  let coverGeneration = 0;
  let activeCoverIndex = -1;
  const readiness = { value: 0, velocity: 0 };
  let dwellTimer = 0;
  let hovered = -1;
  let pointerStart = null;
  let touchGestures = null;
  let wheelInput = null;
  let lastPointerClick = null;
  let suppressNextClick = false;
  let hoverIndex = -1;
  let hoverCellKey = '';
  let titleHoverTimer = 0;
  let titleHoverGeneration = 0;
  let titlePendingKey = '';
  let titleVisibleKey = '';
  let externallyPaused = false;
  let mobileView = matchMedia('(max-width: 700px)').matches;
  let selected = Math.max(0, Math.min(buttons.length - 1, Number(stage.dataset.selectedIndex) || 0));
  // Logical articles and the overscanned drawing pool are independent. Every
  // physical cell repeats one of the real article identities, never a fake post.
  let columns = mobileView ? 3 : 5;
  const rows = 32;
  let selectedCell = { column: 0, row: -selected };
  let inspectionCell = { ...selectedCell };
  let pendingCell = null;
  let pendingInspectionCell = null;
  let holdTimer = 0;
  const columnArticleOffset = Math.max(1, Math.ceil(buttons.length / 5));
  const columnPitch = 2.53;
  const rowPitch = 0.365;
  const shoulder = { value: selectedCell.row, velocity: 0 };
  const laneFocus = { value: selectedCell.column, velocity: 0 };
  const extraction = { value: 0, velocity: 0 };
  const inspection = { value: 0, velocity: 0 };
  let viewIntent = false;
  let viewPhase = 'overview';
  let inspectionIndex = selected;
  let pendingOpenIndex = null;
  let lastInteraction = performance.now();
  let overviewSpan = 7;
  let inspectionSpan = 2.6;
  let hasFramed = false;
  let pulses = [];
  let hoverLockedUntil = 0;
  let renderer;

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  } catch (_) {
    mount.dataset.webgl = 'unavailable';
    mount.hidden = true;
    return;
  }

  const scene = new THREE.Scene();
  const background = new THREE.Color('#eae5e1');
  scene.background = background;
  scene.fog = new THREE.Fog(background, 125, 170);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(background, 1);
  const canvas = renderer.domElement;
  const renderingContext = renderer.getContext();
  const maximumTextureSize = renderer.capabilities.maxTextureSize;
  const maximumRenderbufferSize = renderingContext.getParameter(renderingContext.MAX_RENDERBUFFER_SIZE);
  const maximumViewport = renderingContext.getParameter(renderingContext.MAX_VIEWPORT_DIMS);
  const maximumBufferWidth = Math.min(maximumTextureSize, maximumRenderbufferSize, maximumViewport[0]);
  const maximumBufferHeight = Math.min(maximumTextureSize, maximumRenderbufferSize, maximumViewport[1]);
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  // The stage Touch Events controller sets the complete ancestor chain before
  // gestures begin; detail and expanded-list modes remain native-scrollable.
  canvas.style.touchAction = 'auto';
  mount.appendChild(canvas);
  mount.dataset.webgl = 'ready';
  mount.dataset.archiveCount = String(buttons.length);
  mount.dataset.uniqueArticleCount = String(buttons.length);
  mount.dataset.maxTextureSize = String(maximumTextureSize);
  mount.dataset.titleHoverPending = '';
  mount.dataset.titleHoverVisible = '';
  mount.dataset.titleHoverOpacity = '0';
  stage.dataset.archiveView = 'overview';
  stage.dataset.archiveSettling = 'false';
  stage.dataset.archiveDetail = '0';
  stage.dataset.glassCover = 'none';
  stage.style.setProperty('--archive-detail', '0');

  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(environment, 0.04);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.48;
  environment.dispose();
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight('#fffaf5', '#b4a18c', 0.65));
  const key = new THREE.DirectionalLight('#fff7ed', 1.4);
  key.position.set(-6, 14, -5);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#ffffff', 0.6);
  fill.position.set(7, 8, -10);
  scene.add(fill);

  const focus = new THREE.Vector3(0, 1.12, 0);
  const layoutFocus = focus.clone();
  const focusTarget = focus.clone();
  const desiredFocus = focus.clone();
  const focusVelocity = new THREE.Vector3();
  // The camera stays at least 72 units from the archive. A tighter near plane
  // gives the ink sitting 0.0015 units above the top surface stable depth.
  const camera = new THREE.PerspectiveCamera(3, 1, 10, 250);
  const returnProbeCamera = new THREE.PerspectiveCamera(3, 1, 10, 250);
  const currentReturnProbe = new THREE.Vector3();
  const settledReturnProbe = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const cameraRight = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  const inspectionDirection = new THREE.Vector3(-0.277, 0.238, 0.931).normalize();
  const liveDirection = new THREE.Vector3();
  function setCameraAngle(mobile) {
    const yaw = THREE.MathUtils.degToRad(59);
    const elevation = THREE.MathUtils.degToRad(mobile ? 23 : 19);
    direction.set(-Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation));
    cameraRight.set(Math.cos(yaw), 0, Math.sin(yaw));
    cameraUp.set(Math.sin(yaw) * Math.sin(elevation), Math.cos(elevation), -Math.cos(yaw) * Math.sin(elevation));
  }
  setCameraAngle(columns === 3);
  const cameraPosition = focus.clone().addScaledVector(direction, 100);
  camera.position.copy(cameraPosition);
  camera.lookAt(focus);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointerTarget = new THREE.Vector2();
  const pointerCurrent = new THREE.Vector2();
  const archives = [];
  const hitTargets = [];
  const poolCells = [];
  const cellStates = new Map();
  let shellBatch;
  let backingBatch;
  let hitBatch;
  let frameBatch;
  let tabBatch;
  let shadowBatch;
  let titleBatch;
  let atlasAttribute;
  let titleOpacityAttribute;
  let detailMixAttribute;
  let contentsMixAttribute;
  const resources = new Set();
  const textures = new Set();
  const registry = resource => { resources.add(resource); return resource; };
  const boxGeometries = new Map();
  const metal = registry(new THREE.MeshStandardMaterial({ color: '#969f9b', roughness: 0.25, metalness: 0.28 }));
  const softMetal = registry(new THREE.MeshStandardMaterial({ color: '#f0ede7', roughness: 0.35, metalness: 0.12 }));
  const graphite = registry(new THREE.MeshStandardMaterial({ color: '#454845', roughness: 0.36, metalness: 0.08 }));
  const paperMaterial = registry(new THREE.MeshStandardMaterial({ color: '#eeeae3', roughness: 0.87, metalness: 0 }));
  const tabMaterial = registry(new THREE.MeshStandardMaterial({ color: '#e4d6c5', roughness: 0.45, metalness: 0.05 }));
  const rimMaterial = registry(new THREE.MeshStandardMaterial({ color: '#fff5e9', roughness: 0.27, metalness: 0.08, envMapIntensity: 0.75 }));
  const rearMaterial = registry(new THREE.MeshStandardMaterial({ color: '#f3f0e9', roughness: 0.55, metalness: 0, transparent: true, opacity: 0.14, depthWrite: false }));
  const contentsCoverage = { value: 0 };
  const contentsOrigin = { value: new THREE.Vector3() };

  // Coverage is fixed in each archive's local XY plane, not randomized per
  // frame. Interior pieces remain opaque so the transmission pass can see them.
  const stableCoverageShader = `
float welkinCoverageThreshold(vec2 localXY) {
  vec2 cell = floor(localXY * 180.0);
  return fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
}
`;
  function addContentsCoverage(material) {
    material.onBeforeCompile = shader => {
      shader.uniforms.uWelkinContentsCoverage = contentsCoverage;
      shader.uniforms.uWelkinContentsOrigin = contentsOrigin;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform vec3 uWelkinContentsOrigin;\nvarying vec2 vWelkinContentsXY;');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWelkinContentsXY = (modelMatrix * vec4(transformed, 1.0)).xy - uWelkinContentsOrigin.xy;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWelkinContentsCoverage;\nvarying vec2 vWelkinContentsXY;\n' + stableCoverageShader);
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\nif (uWelkinContentsCoverage <= 0.0) discard;\nif (uWelkinContentsCoverage < 1.0 && welkinCoverageThreshold(vWelkinContentsXY) >= uWelkinContentsCoverage) discard;');
    };
    material.customProgramCacheKey = () => 'welkin-opaque-contents-coverage-v1';
    return material;
  }
  [metal, softMetal, graphite, paperMaterial].forEach(addContentsCoverage);

  function box(width, height, depth, material, radius = 0.018) {
    const key = `${width}/${height}/${depth}/${radius}`;
    let geometry = boxGeometries.get(key);
    if (!geometry) {
      geometry = registry(new RoundedBoxGeometry(width, height, depth, 2, Math.min(radius, depth * 0.46)));
      boxGeometries.set(key, geometry);
    }
    return new THREE.Mesh(geometry, material);
  }

  function textureFrom(draw, width, height) {
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    draw(surface.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(surface);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    textures.add(texture);
    return texture;
  }

  // A small original print plate; all article names remain real DOM text.
  function makePrint(index, date) {
    return textureFrom((context, width, height) => {
      context.fillStyle = '#eeeae3';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#4e504b';
      context.textBaseline = 'top';
      context.font = '500 104px Arial, sans-serif';
      context.fillText(String(index + 1).padStart(2, '0'), 22, 30);
      context.font = '44px Arial, sans-serif';
      context.fillStyle = '#76786e';
      context.fillText((date || '').replaceAll('-', '.'), 24, 184);
      context.fillStyle = '#c6c5b9';
      context.fillRect(24, 240, 272, 1.5);
    }, 384, 1170);
  }

  function makeCaption(index) {
    const post = posts[index] || {};
    return textureFrom((context, width, height) => {
      context.fillStyle = '#eeeae3';
      context.fillRect(0, 0, width, height);
      context.scale(2, 2);
      context.textBaseline = 'top';
      context.fillStyle = '#555b54';
      context.font = '500 34px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
      const title = Array.from(post.title || '');
      context.fillText(title.slice(0, 16).join('') + (title.length > 16 ? '…' : ''), 18, 18, width / 2 - 36);
      context.fillStyle = '#878b80';
      context.font = '26px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
      context.fillText(Array.from(post.category || '').slice(0, 12).join(''), 18, 75, width / 2 - 36);
    }, 1536, 246);
  }

  const shadowTexture = textureFrom((context, width, height) => {
    const gradient = context.createRadialGradient(width / 2, height / 2, 1, width / 2, height / 2, width / 2);
    gradient.addColorStop(0, 'rgba(74,67,59,.27)');
    gradient.addColorStop(0.22, 'rgba(74,67,59,.20)');
    gradient.addColorStop(0.58, 'rgba(74,67,59,.07)');
    gradient.addColorStop(1, 'rgba(74,67,59,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }, 256, 256);
  const shadowGeometry = registry(new THREE.PlaneGeometry(1, 1));
  const width = 2.35;
  const height = 1.73;
  const baseY = height / 2 + 0.09;
  const coverWidth = 1.37;
  const coverHeight = 1.06;
  const coverTop = 0.68;
  const paperFrontZ = -0.074;
  const printedFaceZ = paperFrontZ + 0.0008;
  const coverGeometry = registry(new THREE.PlaneGeometry(coverWidth, coverHeight));
  const fallbackCoverTexture = textureFrom((context, w, h) => {
    context.fillStyle = '#eeebe4';
    context.fillRect(0, 0, w, h);
    context.strokeStyle = 'rgba(141,145,133,0.25)';
    context.lineWidth = 1.2;
    for (let i = 0; i < 8; i += 1) {
      context.beginPath();
      context.moveTo(w * 0.46 + i * 18, h + 2);
      context.bezierCurveTo(w * 0.12 + i * 17, h * 0.45, w * 0.98 + i * 14, h * 0.79, w + 4, h * 0.28 - i * 17);
      context.stroke();
    }
  }, 512, 560);
  // A static, opaque diffusion layer is captured behind the clear front glass.
  // It masks the rear archive rows without blurring the photograph or adding
  // another transmission pass. Only the selected contents group renders it.
  const diffuserTexture = textureFrom((context, w, h) => {
    const pixels = context.createImageData(w, h);
    let seed = 173;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const grain = ((seed >>> 24) / 255 - 0.5) * 3;
      pixels.data[i] = 245 + grain;
      pixels.data[i + 1] = 243 + grain;
      pixels.data[i + 2] = 238 + grain;
      pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
  }, 512, 512);
  const diffuserMaterial = registry(addContentsCoverage(new THREE.MeshBasicMaterial({ map: diffuserTexture, toneMapped: false, transparent: false, depthTest: true, depthWrite: true })));
  const diffuserGeometry = box(width - 0.14, height - 0.13, 0.008, diffuserMaterial, 0.003).geometry;
  const detailPaperMaterial = registry(addContentsCoverage(new THREE.MeshBasicMaterial({ color: '#eeeae3', toneMapped: false, depthTest: true, depthWrite: true })));
  const blankPaperTexture = textureFrom(context => { context.fillStyle = '#eeeae3'; context.fillRect(0, 0, 1, 1); }, 1, 1);
  let diffuserTextureReady = false;
  const frontCoverGeometry = box(width, height, 0.045, paperMaterial, 0.018).geometry;
  const emptyPrintTexture = textureFrom(() => {}, 1, 1);
  // A single hollow extrusion replaces four separate edge meshes per archive.
  const frameShape = new THREE.Shape();
  frameShape.moveTo(-width / 2, -height / 2);
  frameShape.lineTo(width / 2, -height / 2);
  frameShape.lineTo(width / 2, height / 2);
  frameShape.lineTo(-width / 2, height / 2);
  frameShape.closePath();
  const aperture = new THREE.Path();
  aperture.moveTo(-width / 2 + 0.036, -height / 2 + 0.036);
  aperture.lineTo(-width / 2 + 0.036, height / 2 - 0.036);
  aperture.lineTo(width / 2 - 0.036, height / 2 - 0.036);
  aperture.lineTo(width / 2 - 0.036, -height / 2 + 0.036);
  aperture.closePath();
  frameShape.holes.push(aperture);
  const frameGeometry = registry(new THREE.ExtrudeGeometry(frameShape, { depth: 0.26, bevelEnabled: false, steps: 1 }));
  frameGeometry.translate(0, 0, -0.13);
  const screwGeometry = registry(new THREE.CylinderGeometry(0.023, 0.023, 0.016, 12));
  const printGeometry = registry(new THREE.PlaneGeometry(0.42, 1.28));
  const captionGeometry = registry(new THREE.PlaneGeometry(coverWidth, 0.22));

  for (let index = 0; index < buttons.length; index += 1) {
    const group = new THREE.Group();
    group.userData.index = index;
    const base = new THREE.Vector3();
    group.position.copy(base);
    scene.add(group);

    // The instance keeps its exterior for the entire open/close trajectory.
    // This group contains only the contents revealed inside that same shell.
    const detailGroup = new THREE.Group();
    group.add(detailGroup);

    const diffuser = new THREE.Mesh(diffuserGeometry, diffuserMaterial);
    diffuser.position.z = -0.124;
    detailGroup.add(diffuser);

    const paper = box(0.50, 1.49, 0.022, detailPaperMaterial, 0.009);
    paper.position.set(-0.825, 0, paperFrontZ - 0.011);
    detailGroup.add(paper);
    const photoPaper = box(1.49, 1.49, 0.014, detailPaperMaterial, 0.006);
    photoPaper.position.set(0.285, 0, paperFrontZ - 0.007);
    detailGroup.add(photoPaper);

    const printMaterial = registry(addContentsCoverage(new THREE.MeshBasicMaterial({ map: blankPaperTexture, transparent: false, depthTest: true, depthWrite: true, toneMapped: false, side: THREE.FrontSide })));
    const print = new THREE.Mesh(printGeometry, printMaterial);
    print.position.set(-0.825, 0.02, printedFaceZ);
    detailGroup.add(print);

    // An opaque photo plate enters the transmission capture. It sits just
    // behind the inner glass face, fitted without cropping the source image.
    const coverMaterial = registry(addContentsCoverage(new THREE.MeshBasicMaterial({ map: fallbackCoverTexture, toneMapped: false, depthTest: true, depthWrite: true })));
    const cover = new THREE.Mesh(coverGeometry, coverMaterial);
    cover.position.set(0.285, coverTop - coverHeight / 2, printedFaceZ);
    detailGroup.add(cover);
    const captionMaterial = registry(addContentsCoverage(new THREE.MeshBasicMaterial({ map: blankPaperTexture, toneMapped: false, depthTest: true, depthWrite: true })));
    const caption = new THREE.Mesh(captionGeometry, captionMaterial);
    caption.position.set(0.285, -0.55, printedFaceZ);
    detailGroup.add(caption);
    for (const sign of [-1, 1]) {
      const screw = new THREE.Mesh(screwGeometry, metal);
      screw.rotation.x = Math.PI / 2;
      screw.position.set(sign * (width / 2 - 0.095), -height / 2 + 0.1, 0.05);
      detailGroup.add(screw);
    }

    const active = index === selected ? 1 : 0;
    const record = { index, group, base, active, target: active, hover: 0, detailGroup, printMaterial, captionMaterial, captionMesh: caption, printReady: false, coverMaterial, coverMesh: cover };
    archives.push(record);
    applyArchive(record);
  }

  // One atlas supplies every top-edge title, regardless of how many physical
  // repeats appear on screen. Padding keeps adjacent titles out of the mipmaps.
  const atlasColumns = Math.max(1, Math.ceil(Math.sqrt(buttons.length / 8)));
  const atlasTileWidth = 512;
  const atlasTileHeight = 64;
  const atlasWidth = THREE.MathUtils.ceilPowerOfTwo(atlasColumns * atlasTileWidth);
  const atlasHeight = THREE.MathUtils.ceilPowerOfTwo(Math.ceil(buttons.length / atlasColumns) * atlasTileHeight);
  const spineAtlas = textureFrom(context => {
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.font = '500 27px "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
    context.fillStyle = 'rgba(61,55,48,0.72)';
    posts.forEach((post, index) => {
      const characters = Array.from(post.title || '未命名文章');
      const title = characters.slice(0, 16).join('') + (characters.length > 16 ? '…' : '');
      const x = (index % atlasColumns) * atlasTileWidth + 16;
      const y = Math.floor(index / atlasColumns) * atlasTileHeight + atlasTileHeight / 2;
      context.fillText(title, x, y, atlasTileWidth - 32);
    });
  }, atlasWidth, atlasHeight);
  const spineMaterial = registry(new THREE.MeshBasicMaterial({ map: spineAtlas, transparent: true, opacity: 0.24, depthTest: true, depthWrite: false, toneMapped: false, side: THREE.FrontSide, forceSinglePass: true }));
  spineMaterial.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 instanceAtlas;\nattribute float instanceTitleOpacity;\nvarying vec2 vArchiveUv;\nvarying float vTitleOpacity;');
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvArchiveUv = uv * instanceAtlas.zw + instanceAtlas.xy;\nvTitleOpacity = instanceTitleOpacity;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vArchiveUv;\nvarying float vTitleOpacity;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replaceAll('vMapUv', 'vArchiveUv') + '\ndiffuseColor.a *= vTitleOpacity;\nif (diffuseColor.a < 0.003) discard;');
  };
  spineMaterial.customProgramCacheKey = () => 'welkin-spine-atlas-v1';
  const spineGeometry = registry(new THREE.PlaneGeometry(width - 0.35, 0.16));
  spineGeometry.rotateX(-Math.PI / 2);
  spineGeometry.translate(0, height / 2 + 0.0015, 0.035);
  const poolCapacity = 5 * rows;
  atlasAttribute = new THREE.InstancedBufferAttribute(new Float32Array(poolCapacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  spineGeometry.setAttribute('instanceAtlas', atlasAttribute);
  titleOpacityAttribute = new THREE.InstancedBufferAttribute(new Float32Array(poolCapacity), 1).setUsage(THREE.DynamicDrawUsage);
  spineGeometry.setAttribute('instanceTitleOpacity', titleOpacityAttribute);

  const shellGeometry = registry(frontCoverGeometry.clone());
  shellGeometry.translate(0, 0, 0.135);
  const poolTabGeometry = registry(box(0.16, 0.045, 0.07, tabMaterial, 0.01).geometry.clone());
  poolTabGeometry.translate(0.68, height / 2 + 0.006, -0.065);
  // A warm opaque diffuser behind one instanced glass pass restores the body
  // contrast of the reference without duplicating the detailed model 160 times.
  const poolBackingGeometry = registry(box(width - 0.14, height - 0.13, 0.018, rearMaterial, 0.008).geometry.clone());
  poolBackingGeometry.translate(0, 0, -0.075);
  const poolBackingMaterial = registry(new THREE.MeshStandardMaterial({ color: '#b8a38a', roughness: 0.72, metalness: 0 }));
  const poolShellMaterial = registry(new THREE.MeshPhysicalMaterial({ color: '#fff7ed', transmission: 0.84, thickness: 0.10, roughness: 0.19, ior: 1.46, attenuationColor: '#e4d8c9', attenuationDistance: 3, metalness: 0, envMapIntensity: 0.70, clearcoat: 0.36, clearcoatRoughness: 0.20 }));
  detailMixAttribute = new THREE.InstancedBufferAttribute(new Float32Array(poolCapacity), 1).setUsage(THREE.DynamicDrawUsage);
  contentsMixAttribute = new THREE.InstancedBufferAttribute(new Float32Array(poolCapacity), 1).setUsage(THREE.DynamicDrawUsage);
  shellGeometry.setAttribute('instanceDetailMix', detailMixAttribute);
  poolBackingGeometry.setAttribute('instanceContentsMix', contentsMixAttribute);
  const clearColor = new THREE.Color('#fffdfa');
  const clearAttenuation = new THREE.Color('#eee6df');
  const clearColorRatio = new THREE.Vector3(clearColor.r / poolShellMaterial.color.r, clearColor.g / poolShellMaterial.color.g, clearColor.b / poolShellMaterial.color.b);
  // Height tint adapted from RhineLabUI's array material (MIT, LBEILC).
  // The local model is centred on Y=0, unlike the reference's base-origin mesh.
  poolShellMaterial.onBeforeCompile = shader => {
    shader.uniforms.uWelkinClearColorRatio = { value: clearColorRatio };
    shader.uniforms.uWelkinClearAttenuation = { value: clearAttenuation };
    shader.vertexShader = 'attribute float instanceDetailMix;\nvarying float vWelkinDetailMix;\nvarying float vWelkinPanelHeight;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWelkinPanelHeight = (position.y + 0.865) / 1.73;\nvWelkinDetailMix = instanceDetailMix;');
    shader.fragmentShader = 'uniform vec3 uWelkinClearColorRatio;\nuniform vec3 uWelkinClearAttenuation;\nvarying float vWelkinDetailMix;\nvarying float vWelkinPanelHeight;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nvec3 welkinWarmTint = mix(vec3(0.52, 0.42, 0.32), vec3(1.0, 0.99, 0.97), smoothstep(0.03, 1.0, vWelkinPanelHeight));\ndiffuseColor.rgb *= mix(welkinWarmTint, uWelkinClearColorRatio, vWelkinDetailMix);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.006, vWelkinDetailMix);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.roughness = mix(material.roughness, max(0.006, geometryRoughness), vWelkinDetailMix);\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat = mix(material.clearcoat, 0.24, vWelkinDetailMix);\nmaterial.clearcoatRoughness = mix(material.clearcoatRoughness, min(0.07 + geometryRoughness, 1.0), vWelkinDetailMix);\n#endif');
    const transmissionChunk = THREE.ShaderChunk.transmission_fragment
      .replace('material.transmission = transmission;', 'material.transmission = mix(transmission, 0.99, vWelkinDetailMix);')
      .replace('material.thickness = thickness;', 'material.thickness = mix(thickness, 0.006, vWelkinDetailMix);')
      .replace('material.attenuationDistance = attenuationDistance;', 'material.attenuationDistance = mix(attenuationDistance, 8.0, vWelkinDetailMix);')
      .replace('material.attenuationColor = attenuationColor;', 'material.attenuationColor = mix(attenuationColor, uWelkinClearAttenuation, vWelkinDetailMix);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <transmission_fragment>', transmissionChunk);
  };
  poolShellMaterial.customProgramCacheKey = () => 'welkin-continuous-array-glass-v2';
  poolBackingMaterial.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float instanceContentsMix;\nvarying float vWelkinContentsMix;\nvarying vec2 vWelkinBackingXY;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWelkinContentsMix = instanceContentsMix;\nvWelkinBackingXY = transformed.xy;');
    shader.fragmentShader = 'varying float vWelkinContentsMix;\nvarying vec2 vWelkinBackingXY;\n' + stableCoverageShader + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\nif (vWelkinContentsMix >= 1.0) discard;\nif (vWelkinContentsMix > 0.0 && welkinCoverageThreshold(vWelkinBackingXY) < vWelkinContentsMix) discard;');
  };
  poolBackingMaterial.customProgramCacheKey = () => 'welkin-complementary-backing-v1';
  const poolShadowMaterial = registry(new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.22, toneMapped: false }));
  function batch(geometry, material) {
    const mesh = new THREE.InstancedMesh(geometry, material, poolCapacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    scene.add(mesh);
    resources.add(mesh);
    return mesh;
  }
  shellBatch = batch(shellGeometry, poolShellMaterial);
  backingBatch = batch(poolBackingGeometry, poolBackingMaterial);
  hitBatch = batch(registry(new THREE.BoxGeometry(width, height, 0.30)), registry(new THREE.MeshBasicMaterial()));
  hitBatch.visible = false;
  frameBatch = batch(frameGeometry, rimMaterial);
  tabBatch = batch(poolTabGeometry, tabMaterial);
  shadowBatch = batch(shadowGeometry, poolShadowMaterial);
  titleBatch = batch(spineGeometry, spineMaterial);
  shellBatch.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(poolCapacity * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
  const poolMatrix = new THREE.Object3D();
  const poolShadowMatrix = new THREE.Object3D();
  const poolColor = new THREE.Color();

  function modulo(value, period) {
    return ((value % period) + period) % period;
  }

  function cellKey(cell) { return `${cell.column}:${cell.row}`; }
  function articleAt(cell) { return articleIndexAt(cell, buttons.length, columnArticleOffset); }
  function nearestCellFor(index) {
    return nearestArticleCell(index, selectedCell, buttons.length, columnArticleOffset);
  }

  function surfaceAt(column, row, time) {
    const columnDistance = column - laneFocus.value;
    const columnStrength = 0.25 + 0.75 * Math.exp(-0.5 * (columnDistance / 0.55) ** 2);
    const rowDistance = (row - shoulder.value) * 1.5 + columnDistance * 0.38;
    const shoulderHeight = standingWave(rowDistance) * columnStrength;
    const valley = 0.10 * Math.sin((row - shoulder.value) * 0.82 + columnDistance * 0.71) * (0.3 + 0.7 * columnStrength);
    let wave = 0;
    if (!reduced) {
      for (const pulse of pulses) wave += selectionWave(Math.hypot(row - pulse.row, (column - pulse.column) * 2.2), (time - pulse.time) / 1000);
    }
    return shoulderHeight + valley + THREE.MathUtils.clamp(wave, -0.6, 0.6) * 0.11;
  }

  function advanceTitleFade(state, target, time) {
    if (reduced) {
      state.title = target;
      state.titleTarget = target;
      state.titleFrom = target;
      state.titleStartedAt = time;
      return false;
    }
    if (state.titleTarget !== target) {
      state.titleFrom = state.title;
      state.titleTarget = target;
      state.titleStartedAt = time;
    }
    const progress = Math.min(1, Math.max(0, (time - state.titleStartedAt) / 650));
    state.title = state.titleFrom + (target - state.titleFrom) * smooth(progress);
    if (progress === 1) state.title = target;
    return state.title !== target;
  }

  function detailMixes(extracted, cameraProgress, ready = 1) {
    // The opaque contents finish their stable coverage transition while the
    // exterior is still frosted; only then do fine glass reflections sharpen.
    const contents = smooth((cameraProgress - 0.08) / 0.42) * smooth((extracted - 0.25) / 0.55) * ready;
    const glass = smooth((cameraProgress - 0.40) / 0.55) * smooth(contents);
    return { contents, glass };
  }

  function updatePool(time, blend) {
    const regularAnchorColumn = Math.round(laneFocus.value);
    const halfColumns = Math.floor(columns / 2);
    const keepInspectedColumn = viewPhase !== 'overview' || extraction.value > 0 || inspection.value > 0;
    // Resizing five columns to three must not evict the exterior of a detail
    // opened from an outer column. Only the pool window moves, not the archive.
    const anchorColumn = keepInspectedColumn
      ? THREE.MathUtils.clamp(regularAnchorColumn, inspectionCell.column - halfColumns, inspectionCell.column + halfColumns)
      : regularAnchorColumn;
    const anchorRow = Math.floor(shoulder.value);
    const selectedKey = cellKey(selectedCell);
    const inspectedKey = cellKey(inspectionCell);
    const mixes = detailMixes(extraction.value, inspection.value, readiness.value);
    const count = columns * rows;
    let slot = 0;
    let moving = false;
    const alive = new Set();
    // Far columns and rows are submitted first for the translucent shell pass.
    for (let c = Math.floor(columns / 2); c >= -Math.floor(columns / 2); c -= 1) {
      for (let r = Math.floor(rows / 2) - 1; r >= -Math.floor(rows / 2); r -= 1) {
        const cell = { column: anchorColumn + c, row: anchorRow + r };
        const key = cellKey(cell);
        const postIndex = articleAt(cell);
        alive.add(key);
        let state = cellStates.get(key);
        if (!state) { state = { active: key === selectedKey ? 1 : 0, hover: 0, title: 0, titleFrom: 0, titleTarget: 0, titleStartedAt: time }; cellStates.set(key, state); }
        const activeTarget = key === selectedKey ? 1 : 0;
        const hoverTarget = viewPhase === 'overview' && key === hoverCellKey ? 1 : 0;
        state.active = Math.abs(state.active - activeTarget) < 0.00035 ? activeTarget : state.active + (activeTarget - state.active) * blend;
        state.hover = Math.abs(state.hover - hoverTarget) < 0.001 ? hoverTarget : state.hover + (hoverTarget - state.hover) * blend;
        moving ||= state.active !== activeTarget || state.hover !== hoverTarget;
        const titleTarget = viewPhase === 'overview' && key === titleVisibleKey ? 1 : 0;
        moving = advanceTitleFade(state, titleTarget, time) || moving;
        const extracted = key === inspectedKey ? extraction.value : 0;
        const retreat = key === inspectedKey ? 0 : inspection.value;
        const contentsMix = key === inspectedKey ? mixes.contents : 0;
        const glassMix = key === inspectedKey ? mixes.glass : 0;
        const y = baseY + surfaceAt(cell.column, cell.row, time) + state.active * 0.32 + extracted * 1.62 - retreat * 0.40 + state.hover * 0.03;
        const liveScroll = key === inspectedKey ? THREE.MathUtils.lerp(shoulder.value, inspectionCell.anchorScroll ?? shoulder.value, extracted) : shoulder.value;
        poolMatrix.position.set(cell.column * columnPitch, y, (liveScroll - cell.row) * rowPitch + extracted * 0.23 - retreat * 6.2);
        poolMatrix.rotation.set(0, 0, 0);
        poolMatrix.scale.setScalar(1);
        poolMatrix.updateMatrix();
        shellBatch.setMatrixAt(slot, poolMatrix.matrix);
        backingBatch.setMatrixAt(slot, poolMatrix.matrix);
        hitBatch.setMatrixAt(slot, poolMatrix.matrix);
        frameBatch.setMatrixAt(slot, poolMatrix.matrix);
        tabBatch.setMatrixAt(slot, poolMatrix.matrix);
        titleBatch.setMatrixAt(slot, poolMatrix.matrix);
        poolColor.setScalar(1 + state.hover * 0.10 + state.active * 0.025);
        shellBatch.setColorAt(slot, poolColor);
        atlasAttribute.setXYZW(slot, (postIndex % atlasColumns) * atlasTileWidth / atlasWidth, 1 - (Math.floor(postIndex / atlasColumns) + 1) * atlasTileHeight / atlasHeight, atlasTileWidth / atlasWidth, atlasTileHeight / atlasHeight);
        const centralInk = cell.column === 0 ? 0.68 * Math.exp(-0.5 * ((cell.row - shoulder.value) / 4.2) ** 2) : 0;
        titleOpacityAttribute.setX(slot, cell.column === 0 ? centralInk : state.title);
        detailMixAttribute.setX(slot, glassMix);
        contentsMixAttribute.setX(slot, contentsMix);
        poolCells[slot] = { ...cell, postIndex, key, detailed: contentsMix > 0, worldPosition: poolMatrix.position.clone() };
        slot += 1;
      }
    }
    for (const key of cellStates.keys()) if (!alive.has(key)) cellStates.delete(key);
    // Stable, continuous contact shadows for the archive lanes. Repeating a
    // blurred blob under every moving plate creates dark bands whose overlaps
    // pulse as the pool recycles; these five strips do not follow scroll rows.
    let shadowSlot = 0;
    for (let column = -Math.floor(columns / 2); column <= Math.floor(columns / 2); column += 1) {
      poolShadowMatrix.position.set((anchorColumn + column) * columnPitch + 0.08, -0.009, -inspection.value * 6.2);
      poolShadowMatrix.rotation.set(-Math.PI / 2, 0, 0);
      poolShadowMatrix.scale.set(3.1, rows * rowPitch + 6, 1);
      poolShadowMatrix.updateMatrix();
      shadowBatch.setMatrixAt(shadowSlot++, poolShadowMatrix.matrix);
    }
    // Only the extracted archive needs its own moving contact shadow.
    const extractedCell = poolCells.find(cell => cell?.key === inspectedKey);
    const liftedShadow = extractedCell ? smooth(extraction.value) : 0;
    poolShadowMatrix.position.set((extractedCell?.worldPosition.x || 0) + 0.08, -0.008, (extractedCell?.worldPosition.z || 0) - 0.1);
    poolShadowMatrix.scale.set(3.25 * liftedShadow, 1.2 * liftedShadow, 1);
    poolShadowMatrix.updateMatrix();
    shadowBatch.setMatrixAt(shadowSlot++, poolShadowMatrix.matrix);
    shadowBatch.count = shadowSlot;
    shadowBatch.instanceMatrix.needsUpdate = true;
    mount.dataset.shadowCount = String(shadowSlot);
    for (const mesh of [shellBatch, backingBatch, hitBatch, frameBatch, tabBatch, titleBatch]) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
    shellBatch.instanceColor.needsUpdate = true;
    shellBatch.boundingSphere = null;
    hitBatch.boundingSphere = null;
    atlasAttribute.needsUpdate = true;
    titleOpacityAttribute.needsUpdate = true;
    detailMixAttribute.needsUpdate = true;
    contentsMixAttribute.needsUpdate = true;
    mount.dataset.poolCount = String(count);
    mount.dataset.visibleShellCount = String(count);
    mount.dataset.contentsMix = mixes.contents.toFixed(3);
    mount.dataset.glassMix = mixes.glass.toFixed(3);
    let titleOpacity = 0;
    for (const state of cellStates.values()) titleOpacity = Math.max(titleOpacity, state.title);
    mount.dataset.titleHoverOpacity = titleOpacity.toFixed(3);
    return moving;
  }

  function smooth(value) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * t * (10 - 15 * t + 6 * t * t);
  }

  // Exact critically damped integration preserves velocity when a user reverses
  // opening or closing. No queued tweens or reconstructed endpoint animations.
  function spring(state, target, rate, dt) {
    if (reduced) { state.value = target; state.velocity = 0; return false; }
    const offset = state.value - target;
    const exponential = Math.exp(-rate * dt);
    const step = (state.velocity + rate * offset) * dt;
    state.value = target + (offset + step) * exponential;
    state.velocity = (state.velocity - rate * step) * exponential;
    if (Math.abs(state.value - target) < 0.0006 && Math.abs(state.velocity) < 0.0015) {
      state.value = target;
      state.velocity = 0;
      return false;
    }
    return true;
  }

  function springFocus(target, dt) {
    let moving = false;
    for (const axis of ['x', 'y', 'z']) {
      const state = { value: focus[axis], velocity: focusVelocity[axis] };
      moving = spring(state, target[axis], 6.2, dt) || moving;
      focus[axis] = state.value;
      focusVelocity[axis] = state.velocity;
    }
    return moving;
  }

  // A standing wave shoulder supplies the scene's layered silhouette even when
  // no input occurs. Its centre migrates continuously between rows and columns.
  function standingWave(distance) {
    const age = 1.51 - 0.065 * Math.abs(distance);
    const envelope = Math.max(-0.42, 2.15 - 0.17 * (Math.sqrt(distance * distance + 1) - 1));
    const shoulderRise = smooth(age / 0.62);
    const crest = age > 0 ? 0.18 * Math.sin(age * 5.1) * Math.exp(-age * 1.3) * smooth(age / 0.16) : 0;
    return envelope * (shoulderRise + crest) * 0.4676;
  }

  function selectionWave(distance, age) {
    if (age < 0 || age > 3.2) return 0;
    const t = Math.max(0, Math.min(1, age / 0.2));
    const onset = t * t * t * (10 - 15 * t + 6 * t * t);
    const travelled = distance - age * 8;
    return 0.8 * onset * Math.exp(-age * 1.15) * Math.cos(travelled * 0.58) * Math.exp(-0.5 * (travelled / 3.4) ** 2);
  }

  function applyArchive(record, time = performance.now()) {
    const cell = record.index === inspectionIndex ? inspectionCell : nearestCellFor(record.index);
    const state = cellStates.get(cellKey(cell));
    const a = state?.active ?? (cellKey(cell) === cellKey(selectedCell) ? 1 : 0);
    const extracted = record.index === inspectionIndex ? extraction.value : 0;
    const liveScroll = THREE.MathUtils.lerp(shoulder.value, inspectionCell.anchorScroll ?? shoulder.value, extracted);
    record.base.set(cell.column * columnPitch, baseY, (liveScroll - cell.row) * rowPitch);
    const surfaceHeight = surfaceAt(cell.column, cell.row, time);
    record.group.position.set(record.base.x, baseY + surfaceHeight + a * 0.32 + extracted * 1.62 + (state?.hover || 0) * 0.03, record.base.z + extracted * 0.23);
    // Every shell stays parallel, including the high point of the standing wave.
    record.group.rotation.set(0, 0, 0);
    const mix = record.index === inspectionIndex ? detailMixes(extracted, inspection.value, readiness.value).contents : 0;
    record.group.visible = mix > 0;
    record.detailGroup.visible = mix > 0;
    if (record.index === inspectionIndex) {
      contentsCoverage.value = mix;
      contentsOrigin.value.copy(record.group.position);
    }
  }

  function qualityProfile(crisp) {
    const cap = crisp ? (mobileView ? 1.5 : 2) : (mobileView ? 1.05 : 1.25);
    const pixelBudget = crisp ? (mobileView ? 4000000 : 3840 * 2160) : 2250000;
    const dpr = Math.min(window.devicePixelRatio || 1, cap, Math.sqrt(pixelBudget / Math.max(1, renderWidth * renderHeight)), maximumBufferWidth / Math.max(1, renderWidth), maximumBufferHeight / Math.max(1, renderHeight));
    return { dpr, transmission: crisp ? (viewPhase === 'open' ? 1 : 0.65) : 0.55, name: crisp ? 'crisp' : 'balanced' };
  }

  function publishDrawingBuffer() {
    const width = renderingContext.drawingBufferWidth;
    const height = renderingContext.drawingBufferHeight;
    mount.dataset.drawingBufferWidth = String(width);
    mount.dataset.drawingBufferHeight = String(height);
    mount.dataset.drawingBufferPixels = String(width * height);
  }

  function publishRafStats(time) {
    const sorted = Array.from(rafIntervals.subarray(0, rafWindowSize)).sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] : 0;
    mount.dataset.rafCycle = String(rafCycle);
    mount.dataset.rafSampleCount = String(rafCycleSamples);
    mount.dataset.rafWindowCount = String(rafWindowSize);
    mount.dataset.rafLastMs = rafLatestMs.toFixed(2);
    mount.dataset.rafMeanMs = (rafCycleSamples ? rafCycleTotalMs / rafCycleSamples : 0).toFixed(2);
    mount.dataset.rafP95Ms = p95.toFixed(2);
    mount.dataset.rafActive = String(rafCycleActive);
    rafLastPublishedAt = time;
    publishDrawingBuffer();
  }

  function recordRafInterval(time, interval, moving) {
    if (interval === 0) {
      // A lone first/quality-restoration frame is not an FPS sample. Preserve
      // the completed motion's measurements while the page is stationary.
      if (moving) {
        rafCycle += 1;
        rafCycleActive = true;
        rafWindowSize = 0;
        rafCursor = 0;
        rafCycleSamples = 0;
        rafCycleTotalMs = 0;
        rafLatestMs = 0;
        publishRafStats(time);
      } else if (rafCycleActive) {
        rafCycleActive = false;
        publishRafStats(time);
      }
      return;
    }
    if (!rafCycleActive || !Number.isFinite(interval) || interval <= 0) return;
    rafIntervals[rafCursor] = interval;
    rafCursor = (rafCursor + 1) % rafIntervals.length;
    rafWindowSize = Math.min(rafWindowSize + 1, rafIntervals.length);
    rafCycleSamples += 1;
    rafCycleTotalMs += interval;
    rafLatestMs = interval;
    if (!moving) rafCycleActive = false;
    if (!moving || time - rafLastPublishedAt >= 250) publishRafStats(time);
  }

  function applyQuality(profile) {
    if (appliedQuality && Math.abs(appliedQuality.dpr - profile.dpr) < 0.01 && appliedQuality.transmission === profile.transmission) return;
    renderer.setPixelRatio(profile.dpr);
    renderer.transmissionResolutionScale = profile.transmission;
    appliedQuality = { ...profile };
    qualityChangeCount += 1;
    mount.dataset.qualityChangeCount = String(qualityChangeCount);
    mount.dataset.qualityChanges = String(qualityChangeCount);
    publishDrawingBuffer();
  }

  function cancelQualityRestore() {
    if (qualityRestoreTimer) clearTimeout(qualityRestoreTimer);
    qualityRestoreTimer = 0;
  }

  function lockTransitionQuality() {
    cancelQualityRestore();
    // Reversals inherit the current buffers. No resize or transmission FBO
    // allocation is triggered by an opening/closing velocity threshold.
    qualityLocked = true;
    mount.dataset.qualityLocked = 'true';
  }

  function restoreCrispAfterRest() {
    if (qualityLocked || qualityRestoreTimer || pointerStart || touchGestures?.isActive() || !visible()) return;
    const profile = qualityProfile(true);
    if (appliedQuality && Math.abs(profile.dpr - appliedQuality.dpr) < 0.01 && profile.transmission === appliedQuality.transmission) return;
    qualityRestoreTimer = setTimeout(() => {
      qualityRestoreTimer = 0;
      if (disposed || qualityLocked || pointerStart || touchGestures?.isActive() || !visible() || (viewPhase !== 'overview' && viewPhase !== 'open')) return;
      applyQuality(qualityProfile(true));
      invalidate();
    }, 220);
  }

  function prepareLabel(record) {
    if (!record || record.printReady || disposed || mount.dataset.webgl !== 'ready') return;
    try {
      const texture = makePrint(record.index, posts[record.index]?.date);
      const caption = makeCaption(record.index);
      renderer.initTexture(texture);
      renderer.initTexture(caption);
      // The placeholder already compiled USE_MAP; replacing a pre-uploaded map
      // does not change the material's shader defines during the animation.
      record.printMaterial.map = texture;
      record.captionMaterial.map = caption;
      record.printReady = true;
    } catch (_) {
      record.printReady = true;
      mount.dataset.labelWarmup = 'failed';
    }
  }

  function coverSources(index) {
    const post = posts[index] || {};
    const local = typeof post.glassCover === 'string' ? post.glassCover.trim() : '';
    const original = typeof post.cover === 'string' ? post.cover.trim() : '';
    const sources = [];
    if (local) {
      try { sources.push(new URL(local, window.location.href).href); }
      catch (_) { /* Invalid generated URLs still permit the original fallback. */ }
    }
    if (original) {
      try {
        const url = new URL(original, window.location.href);
        if (/\.oss-[^.]+\.aliyuncs\.com$/i.test(url.hostname) && !url.search) {
          url.searchParams.set('x-oss-process', 'image/resize,w_2000/format,webp/quality,q_90');
          sources.push(url.href);
        }
        sources.push(new URL(original, window.location.href).href);
      } catch (_) { /* An invalid cover falls back to the local paper plate. */ }
    }
    return [...new Set(sources)];
  }

  function coverPlaneScale(imageWidth, imageHeight) {
    const imageAspect = imageWidth / imageHeight;
    const plateAspect = coverWidth / coverHeight;
    return imageAspect > plateAspect ? { x: 1, y: plateAspect / imageAspect } : { x: imageAspect / plateAspect, y: 1 };
  }

  function assignCover(record, entry) {
    record.coverMaterial.map = entry.texture || fallbackCoverTexture;
    const scale = entry.status === 'ready' ? coverPlaneScale(entry.width, entry.height) : { x: 1, y: 1 };
    record.coverMesh.scale.set(scale.x, scale.y, 1);
    const displayedHeight = coverHeight * scale.y;
    record.coverMesh.position.y = coverTop - displayedHeight / 2;
    record.captionMesh.position.y = Math.max(-0.58, coverTop - displayedHeight - 0.17);
  }

  async function loadBoundedCover(url, entry) {
    const controller = new AbortController();
    entry.cancel = () => controller.abort();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let objectUrl = '';
    try {
      // Anonymous CORS also works for the preferred same-origin build cache.
      // A hard byte limit prevents a raw 100 MB source from being downloaded.
      const response = await fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal, cache: 'force-cache' });
      if (!response.ok) throw new Error('Cover response failed');
      const maxBytes = 8 * 1024 * 1024;
      const advertised = Number(response.headers.get('content-length'));
      if (advertised > maxBytes) { controller.abort(); throw new Error('Cover exceeds byte budget'); }
      if (!response.body) throw new Error('Cover stream is unavailable');
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > maxBytes) { controller.abort(); throw new Error('Cover exceeds byte budget'); }
        chunks.push(next.value);
      }
      const blob = new Blob(chunks, { type: response.headers.get('content-type') || 'image/jpeg' });
      objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Cover decode failed'));
        controller.signal.addEventListener('abort', () => reject(new Error('Cover request cancelled')), { once: true });
        image.src = objectUrl;
      });
      image.onload = null;
      image.onerror = null;
      if (typeof image.decode === 'function') {
        try { await image.decode(); }
        catch (_) { if (!image.naturalWidth) throw new Error('Cover decode failed'); }
      }
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 24000000) throw new Error('Cover dimensions exceed budget');
      return image;
    } finally {
      clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      entry.cancel = null;
    }
  }

  function discardCover(key, entry) {
    entry.cancelled = true;
    entry.cancel?.();
    if (entry.texture) {
      for (const record of archives) if (record.coverMaterial.map === entry.texture) assignCover(record, { status: 'none', texture: fallbackCoverTexture });
      textures.delete(entry.texture);
      entry.texture.dispose();
    }
    if (coverCache.get(key) === entry) coverCache.delete(key);
  }

  function trimCoverCache() {
    const protectedKeys = new Set([coverSources(activeCoverIndex)[0], viewPhase === 'overview' ? '' : coverSources(inspectionIndex)[0]]);
    while (coverCache.size > coverCacheLimit) {
      let oldest = null;
      for (const item of coverCache) if (!protectedKeys.has(item[0]) && (!oldest || item[1].usedAt < oldest[1].usedAt)) oldest = item;
      if (!oldest) break;
      discardCover(oldest[0], oldest[1]);
    }
  }

  function ensureCover(index) {
    const sources = coverSources(index);
    if (!sources.length) return Promise.resolve({ status: 'none', texture: fallbackCoverTexture });
    const key = sources[0];
    let entry = coverCache.get(key);
    if (entry) { entry.usedAt = performance.now(); return entry.promise || Promise.resolve(entry); }
    entry = { status: 'loading', texture: null, cancelled: false, cancel: null, usedAt: performance.now(), promise: null };
    coverCache.set(key, entry);
    trimCoverCache();
    entry.promise = (async () => {
      for (const source of sources) {
        try {
          const image = await loadBoundedCover(source, entry);
          if (disposed || entry.cancelled || coverCache.get(key) !== entry || mount.dataset.webgl !== 'ready') return entry;
          const texture = new THREE.Texture(image);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          texture.needsUpdate = true;
          try { renderer.initTexture(texture); }
          catch (error) { texture.dispose(); throw error; }
          textures.add(texture);
          entry.texture = texture;
          entry.width = image.naturalWidth;
          entry.height = image.naturalHeight;
          entry.status = 'ready';
          return entry;
        } catch (_) {
          if (disposed || entry.cancelled || mount.dataset.webgl !== 'ready') return entry;
        }
      }
      entry.status = 'fallback';
      return entry;
    })();
    return entry.promise;
  }

  function requestCover(index, immediate = false) {
    if (coverWarmTimer) clearTimeout(coverWarmTimer);
    coverWarmTimer = 0;
    activeCoverIndex = index;
    const generation = ++coverGeneration;
    const sources = coverSources(index);
    if (!sources.length) {
      assignCover(archives[index], { status: 'none', texture: fallbackCoverTexture });
      stage.dataset.glassCover = 'none';
      return;
    }
    const cached = coverCache.get(sources[0]);
    stage.dataset.glassCover = cached?.status === 'ready' ? 'ready' : cached?.status === 'fallback' ? 'fallback' : 'loading';
    const load = () => {
      coverWarmTimer = 0;
      if (disposed || generation !== coverGeneration || mount.dataset.webgl !== 'ready') return;
      ensureCover(index).then(entry => {
        if (disposed || generation !== coverGeneration || activeCoverIndex !== index || entry.cancelled || mount.dataset.webgl !== 'ready') return;
        assignCover(archives[index], entry);
        stage.dataset.glassCover = entry.status === 'ready' ? 'ready' : entry.status === 'none' ? 'none' : 'fallback';
        invalidate();
      });
    };
    if (immediate || cached?.status === 'ready') load();
    else coverWarmTimer = setTimeout(load, 220);
  }

  function cancelCovers(disposeTextures = false) {
    coverGeneration += 1;
    if (coverWarmTimer) clearTimeout(coverWarmTimer);
    coverWarmTimer = 0;
    for (const [key, entry] of coverCache) if (disposeTextures || entry.status === 'loading') discardCover(key, entry);
  }

  function cancelWarmup() {
    if (!prewarmHandle) return;
    if (prewarmHandle.idle) window.cancelIdleCallback(prewarmHandle.id);
    else clearTimeout(prewarmHandle.id);
    prewarmHandle = null;
  }

  function scheduleWarmup(priority = false) {
    if (disposed || mount.dataset.webgl !== 'ready') return;
    if (priority) cancelWarmup();
    if (prewarmHandle) return;
    const run = () => {
      prewarmHandle = null;
      if (disposed || mount.dataset.webgl !== 'ready') return;
      if (!diffuserTextureReady) {
        try { renderer.initTexture(diffuserTexture); diffuserTextureReady = true; }
        catch (_) { mount.dataset.diffuserWarmup = 'failed'; }
      }
      prepareLabel(archives[inspectionIndex]);
      if (!prewarmPromise) {
        mount.dataset.prewarm = 'pending';
        try {
          prewarmPromise = renderer.compileAsync(archives[inspectionIndex].group, camera, scene);
        } catch (error) {
          prewarmPromise = Promise.reject(error);
        }
        prewarmPromise = prewarmPromise.then(() => {
          if (!disposed) mount.dataset.prewarm = 'ready';
        }).catch(() => {
          if (!disposed) mount.dataset.prewarm = 'failed';
        }).finally(() => {
          prewarmComplete = true;
          if (disposed || mount.dataset.webgl !== 'ready') return;
          if (viewPhase === 'overview') { readiness.value = archives[inspectionIndex].printReady ? 1 : 0; readiness.velocity = 0; }
          invalidate();
        });
      }
      if (viewPhase === 'overview') {
        while (warmupCursor < archives.length && archives[warmupCursor].printReady) warmupCursor += 1;
        if (warmupCursor < archives.length) { prepareLabel(archives[warmupCursor]); warmupCursor += 1; }
        if (warmupCursor < archives.length) scheduleWarmup();
      }
    };
    if (!priority && typeof window.requestIdleCallback === 'function') prewarmHandle = { idle: true, id: window.requestIdleCallback(run, { timeout: 350 }) };
    else prewarmHandle = { idle: false, id: setTimeout(run, priority ? 0 : 32) };
  }

  function advanceSceneMotion(dt) {
    let moving = false;
    let remaining = dt;
    const maxStep = Math.max(1 / 120, dt / 32);
    // Use actual elapsed time in small substeps rather than losing time after a
    // slow frame. The analytical springs retain velocity during reversals.
    while (remaining > 0.000001) {
      const step = Math.min(remaining, maxStep);
      moving = spring(shoulder, selectedCell.row, 5, step) || moving;
      moving = spring(laneFocus, 0, 4, step) || moving;
      const liftTarget = viewIntent || inspection.value > 0.075 ? 1 : 0;
      moving = spring(extraction, liftTarget, 4.9, step) || moving;
      const cameraTarget = viewIntent ? smooth((extraction.value - 0.15) / 0.66) : 0;
      moving = spring(inspection, cameraTarget, 4.6, step) || moving;
      const readyTarget = prewarmComplete && archives[inspectionIndex]?.printReady ? 1 : 0;
      moving = spring(readiness, readyTarget, 8, step) || moving;
      remaining -= step;
    }
    return moving;
  }

  function visible() {
    return inView && !externallyPaused && !document.hidden && !disposed && mount.getBoundingClientRect().height > 0;
  }

  function invalidate() {
    cancelQualityRestore();
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; }
    if (!frame && visible()) frame = requestAnimationFrame(render);
  }

  function render(time) {
    frame = 0;
    if (!visible()) { previousTime = 0; return; }
    const frameStart = performance.now();
    const frameInterval = previousTime ? Math.max(0, time - previousTime) : 0;
    lastPaintTime = time;
    const dt = previousTime ? frameInterval / 1000 : 1 / 60;
    previousTime = time;
    const blend = reduced ? 1 : 1 - Math.exp(-7.4 * dt);
    pulses = reduced ? [] : pulses.filter(pulse => time - pulse.time < 3200);
    let unsettled = pulses.length > 0;
    unsettled = advanceSceneMotion(dt) || unsettled;
    unsettled = updatePool(time, blend) || unsettled;
    for (const record of archives) {
      applyArchive(record, time);
    }
    mount.dataset.visibleArchiveCount = String(columns * rows);
    const cameraBlend = reduced ? 1 : 1 - Math.exp(-4.8 * dt);
    const detail = THREE.MathUtils.clamp(inspection.value, 0, 1);
    const distance = THREE.MathUtils.lerp(100, 72, detail);
    const span = THREE.MathUtils.lerp(overviewSpan, inspectionSpan, detail);
    liveDirection.copy(direction).lerp(inspectionDirection, detail).normalize();
    desiredFocus.copy(focusTarget);
    const inspected = archives[inspectionIndex];
    if (inspected && detail > 0) {
      const closeFocus = inspected.group.position.clone();
      const closeRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), inspectionDirection).normalize();
      const closeUp = new THREE.Vector3().crossVectors(inspectionDirection, closeRight).normalize();
      // Desktop leaves the right side for the record panel. Portrait places
      // the glass above the panel, without shrinking it to a small thumbnail.
      closeFocus.addScaledVector(closeRight, (mobileView ? 0 : 0.18) * inspectionSpan * camera.aspect);
      closeFocus.addScaledVector(closeUp, mobileView ? -0.225 * inspectionSpan : 0);
      desiredFocus.lerp(closeFocus, detail);
    }
    unsettled = springFocus(desiredFocus, dt) || unsettled;
    pointerCurrent.lerp(pointerTarget, cameraBlend);
    if (pointerCurrent.distanceToSquared(pointerTarget) < 0.000002) pointerCurrent.copy(pointerTarget);
    unsettled ||= pointerCurrent.distanceToSquared(pointerTarget) > 0;
    cameraPosition.copy(focus).addScaledVector(liveDirection, distance);
    camera.position.copy(cameraPosition);
    camera.position.x += pointerCurrent.x * 0.22 * (1 - detail);
    camera.position.y += pointerCurrent.y * 0.15 * (1 - detail);
    camera.lookAt(focus);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(span / (2 * distance)));
    camera.updateProjectionMatrix();
    scene.fog.near = THREE.MathUtils.lerp(125, distance + 1.8, detail);
    scene.fog.far = THREE.MathUtils.lerp(170, distance + 11, detail);
    const detailText = detail.toFixed(3);
    if (stage.dataset.archiveDetail !== detailText) {
      stage.dataset.archiveDetail = detailText;
      stage.style.setProperty('--archive-detail', detailText);
    }
    const renderStart = performance.now();
    renderer.render(scene, camera);
    const renderMs = performance.now() - renderStart;
    renderAverage = measuredFrames ? renderAverage * 0.88 + renderMs * 0.12 : renderMs;
    measuredFrames += 1;
    mount.dataset.renderMs = renderAverage.toFixed(2);
    mount.dataset.frameMs = frameInterval.toFixed(2);
    mount.dataset.frameCpuMs = (performance.now() - frameStart).toFixed(2);
    mount.dataset.drawCalls = String(renderer.info.render.calls);
    mount.dataset.renderFrames = String(measuredFrames);
    mount.dataset.quality = `${qualityLocked ? 'locked' : appliedQuality.name}-${inspection.value > 0.035 ? 'detail' : 'shell'}@${appliedQuality.dpr.toFixed(2)}/${appliedQuality.transmission.toFixed(2)}`;
    mount.dataset.detailedArchiveCount = String(archives.filter(record => record.detailGroup.visible).length);
    finishViewTransition();
    recordRafInterval(time, frameInterval, unsettled);
    if (unsettled) invalidate();
    else {
      if ((viewPhase === 'overview' || viewPhase === 'open') && qualityLocked) {
        qualityLocked = false;
        mount.dataset.qualityLocked = 'false';
        stage.dataset.archiveSettling = 'false';
      }
      previousTime = 0;
      restoreCrispAfterRest();
    }
  }

  function resize() {
    const bounds = mount.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const mobile = matchMedia('(max-width: 700px)').matches;
    mobileView = mobile;
    renderWidth = Math.round(bounds.width);
    renderHeight = Math.round(bounds.height);
    const aspect = bounds.width / bounds.height;
    const nextColumns = mobile ? 3 : 5;
    if (nextColumns !== columns) pulses = [];
    columns = nextColumns;
    setCameraAngle(mobile);
    archives.forEach(record => applyArchive(record));
    mount.dataset.archiveColumns = String(columns);
    mount.dataset.archiveRows = String(rows);
    // This is a viewport into an archive field, not a product grid fitted into a
    // box. Background layers deliberately continue beyond the screen edges.
    layoutFocus.set(0, mobile ? 1.57 : 1.42, 0);
    updateFocusTarget();
    if (!hasFramed) { focus.copy(focusTarget); hasFramed = true; }
    overviewSpan = mobile ? 5.65 : Math.min(4.6, 7.5 / aspect);
    // Reserve the actual text column on desktop; fitting the glass to 80% of
    // the entire viewport clipped its left edge behind a narrow desktop panel.
    inspectionSpan = Math.max(1.91 / (mobile ? 0.8 : 0.76), 2.5 / (aspect * (mobile ? 0.8 : 0.54)));
    if (!appliedQuality) applyQuality(qualityProfile(false));
    else if (!qualityLocked) applyQuality(qualityProfile(appliedQuality.name === 'crisp'));
    else {
      // Only a real viewport resize can force a safety clamp while buffers are
      // locked; animation timing never feeds back into the resolution.
      const safeDpr = Math.min(appliedQuality.dpr, maximumBufferWidth / renderWidth, maximumBufferHeight / renderHeight);
      if (safeDpr < appliedQuality.dpr) applyQuality({ ...appliedQuality, dpr: safeDpr });
    }
    renderer.setSize(renderWidth, renderHeight, false);
    publishDrawingBuffer();
    camera.aspect = aspect;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(overviewSpan / 200));
    camera.updateProjectionMatrix();
    invalidate();
  }

  function updateFocusTarget() {
    focusTarget.copy(layoutFocus);
  }

  function updateSelection() {
    const index = Number(stage.dataset.selectedIndex);
    if (!Number.isInteger(index) || index < 0 || index >= archives.length || (index === selected && !pendingCell && !pendingInspectionCell)) return;
    if (pendingInspectionCell) {
      inspectionCell = { ...pendingInspectionCell, anchorScroll: shoulder.value };
    } else {
      selectedCell = pendingCell || nearestCellFor(index);
      selectedCell.column = 0;
    }
    pendingCell = null;
    selected = index;
    requestCover(index);
    clearTitleHover();
    lastInteraction = performance.now();
    if (!pendingInspectionCell && viewPhase !== 'overview' && index !== inspectionIndex) {
      lockTransitionQuality();
      pendingOpenIndex = index;
      viewIntent = false;
      setViewPhase('closing');
    }
    updateFocusTarget();
    clearDwell();
    hovered = -1;
    hoverLockedUntil = performance.now() + 520;
    if (reduced) focus.copy(focusTarget);
    else {
      if (!pendingInspectionCell) pulses.push({ row: selectedCell.row, column: 0, time: performance.now() });
      pulses = pulses.slice(-6);
    }
    archives.forEach((record, i) => { record.target = i === selected ? 1 : 0; });
    invalidate();
  }

  function setViewPhase(state) {
    if (viewPhase === state) return;
    viewPhase = state;
    stage.dataset.archiveView = state;
    if (state !== 'overview') wheelInput?.reset();
    touchGestures?.refresh();
    if (state === 'open' || state === 'overview') {
      stage.dataset.archiveSettling = String(qualityLocked);
      scheduleWarmup();
      window.dispatchEvent(new CustomEvent('welkin-view-change', { detail: { state, index: selected } }));
    }
  }

  function beginOpen(index) {
    if (!Number.isInteger(index) || index < 0 || index >= archives.length) return;
    clearTitleHover();
    const continuingInspection = viewPhase !== 'overview' && inspectionIndex === index;
    if (viewPhase !== 'overview' && inspectionIndex !== index) {
      lockTransitionQuality();
      pendingOpenIndex = index;
      viewIntent = false;
      setViewPhase('closing');
      invalidate();
      return;
    }
    if (index !== selected) { buttons[index].click(); updateSelection(); }
    inspectionIndex = index;
    inspectionCell = pendingInspectionCell ? { ...pendingInspectionCell, anchorScroll: shoulder.value } : continuingInspection ? inspectionCell : { ...selectedCell, anchorScroll: shoulder.value };
    pendingInspectionCell = null;
    pendingOpenIndex = null;
    lockTransitionQuality();
    if (!continuingInspection && (!prewarmComplete || !archives[index].printReady)) { readiness.value = 0; readiness.velocity = 0; }
    viewIntent = true;
    lastInteraction = performance.now();
    hoverIndex = -1;
    hoverCellKey = '';
    pointerTarget.set(0, 0);
    clearDwell();
    setViewPhase('opening');
    requestCover(index, true);
    scheduleWarmup(true);
    if (reduced) {
      extraction.value = 1;
      extraction.velocity = 0;
      inspection.value = 1;
      inspection.velocity = 0;
    }
    invalidate();
  }

  function openEvent(event) {
    const index = event.detail?.index === undefined ? selected : Number(event.detail.index);
    beginOpen(index);
  }

  function closeEvent() {
    clearTitleHover();
    pendingOpenIndex = null;
    pendingInspectionCell = null;
    viewIntent = false;
    lastInteraction = performance.now();
    if (viewPhase !== 'overview') { lockTransitionQuality(); setViewPhase('closing'); }
    if (reduced) {
      extraction.value = 0;
      extraction.velocity = 0;
      inspection.value = 0;
      inspection.velocity = 0;
    }
    invalidate();
  }

  function returnPixelError() {
    if (extraction.value === 0 && inspection.value === 0) return 0;
    const record = archives[inspectionIndex];
    if (!record) return Infinity;
    returnProbeCamera.aspect = camera.aspect;
    returnProbeCamera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(overviewSpan / 200));
    returnProbeCamera.position.copy(focusTarget).addScaledVector(direction, 100);
    returnProbeCamera.lookAt(focusTarget);
    returnProbeCamera.updateProjectionMatrix();
    returnProbeCamera.updateMatrixWorld();
    camera.updateMatrixWorld();
    const lift = extraction.value * 1.62;
    const depth = extraction.value * (0.23 + ((inspectionCell.anchorScroll ?? shoulder.value) - shoulder.value) * rowPitch);
    let maximum = Math.abs(inspection.value) * 6.2 * renderHeight / overviewSpan;
    for (const [x, y] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, 0]]) {
      currentReturnProbe.copy(record.group.position).add(new THREE.Vector3(x * width / 2, y * height / 2, 0.16));
      settledReturnProbe.copy(currentReturnProbe);
      settledReturnProbe.y -= lift;
      settledReturnProbe.z -= depth;
      currentReturnProbe.project(camera);
      settledReturnProbe.project(returnProbeCamera);
      maximum = Math.max(maximum, Math.hypot((currentReturnProbe.x - settledReturnProbe.x) * renderWidth / 2, (currentReturnProbe.y - settledReturnProbe.y) * renderHeight / 2));
    }
    return maximum;
  }

  function finishViewTransition() {
    if (viewIntent && extraction.value === 1 && inspection.value === 1) setViewPhase('open');
    else if (!viewIntent && viewPhase === 'closing') {
      const remainingPixels = returnPixelError();
      mount.dataset.returnPixelError = Number.isFinite(remainingPixels) ? remainingPixels.toFixed(3) : 'pending';
      // Release input once the remaining pose is subpixel, but let the springs
      // finish naturally. The quality lock stays until every motion settles.
      if (remainingPixels > 0.85) return;
      let restoredIndex = null;
      if (pendingOpenIndex === null) {
        const centralIndex = articleAt(selectedCell);
        if (selected !== centralIndex) {
          // This restores the caption, not a new user selection. Set the local
          // identity first so the queued MutationObserver does not enqueue a
          // fresh wave, replace selectedCell, or move the standing shoulder.
          selected = centralIndex;
          requestCover(centralIndex);
          archives.forEach((record, index) => { record.target = index === centralIndex ? 1 : 0; });
          restoredIndex = centralIndex;
        }
      }
      setViewPhase('overview');
      // The detail controller blocks selector clicks until overview. Restore
      // its DOM caption only after releasing that guard; local identity is
      // already synchronized, so the observer cannot start another wave.
      if (restoredIndex !== null) {
        stage.dataset.selectionRestore = 'true';
        try { buttons[restoredIndex].click(); }
        finally { delete stage.dataset.selectionRestore; }
      }
      if (pendingOpenIndex !== null) {
        const index = pendingOpenIndex;
        pendingOpenIndex = null;
        beginOpen(index);
      }
    }
  }

  function pauseEvent(event) {
    externallyPaused = event.detail?.paused !== false;
    touchGestures?.refresh();
    if (externallyPaused) {
      wheelInput?.reset();
      if (frame) cancelAnimationFrame(frame);
      if (idleTimer) clearTimeout(idleTimer);
      frame = 0;
      idleTimer = 0;
      previousTime = 0;
      clearDwell();
      clearHold();
      clearTitleHover();
      cancelQualityRestore();
      cancelWarmup();
    } else { scheduleWarmup(); invalidate(); }
  }

  function hitCell(event) {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(hitBatch, false)[0];
    return hit && hit.instanceId !== undefined ? poolCells[hit.instanceId] : null;
  }

  function choose(index) {
    if (index >= 0 && index < buttons.length && index !== selected) buttons[index].click();
  }

  function step(direction) {
    clearDwell();
    pendingCell = { column: 0, row: selectedCell.row + direction };
    const index = articleAt(pendingCell);
    if (index !== selected) buttons[index].click();
    updateSelection();
  }

  function openCell(cell) {
    if (!cell || cell.detailed) return;
    pendingInspectionCell = { column: cell.column, row: cell.row, worldPosition: cell.worldPosition };
    beginOpen(cell.postIndex);
  }

  function wheel(event) {
    // WheelEvent already incorporates the operating system's scroll setting.
    if (!wheelInput) return;
    if (event.ctrlKey || event.defaultPrevented || !canNavigateArchives() || !classifyArchiveTarget(event.target, stage)) {
      wheelInput.reset();
      return;
    }
    // Some browsers only allow cancelling the first event in a wheel stream.
    // Continue that owned stream, but never seize an already-native gesture.
    if (!event.cancelable && !wheelInput.hasActiveSession()) { wheelInput.reset(); return; }
    if (!wheelInput.push(event, { width: stage.clientWidth, height: stage.clientHeight })) return;
    if (event.cancelable) event.preventDefault();
    cancelQualityRestore();
    clearTitleHover();
    hoverCellKey = '';
    hoverLockedUntil = performance.now() + 520;
    clearDwell();
  }

  function interruptWheelInput() { wheelInput?.reset(); }

  function clearDwell() {
    if (dwellTimer) clearTimeout(dwellTimer);
    dwellTimer = 0;
  }

  function clearHold() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = 0;
  }

  function clearTitleHover() {
    const hadTitle = titleHoverTimer || titlePendingKey || titleVisibleKey;
    titleHoverGeneration += 1;
    if (titleHoverTimer) clearTimeout(titleHoverTimer);
    titleHoverTimer = 0;
    titlePendingKey = '';
    titleVisibleKey = '';
    mount.dataset.titleHoverPending = '';
    mount.dataset.titleHoverVisible = '';
    if (hadTitle) invalidate();
  }

  function prepareTitleHover(cell) {
    clearTitleHover();
    if (!cell || cell.column === 0 || viewPhase !== 'overview') return;
    const key = cell.key;
    const generation = titleHoverGeneration;
    titlePendingKey = key;
    mount.dataset.titleHoverPending = key;
    titleHoverTimer = setTimeout(() => {
      if (generation !== titleHoverGeneration) return;
      titleHoverTimer = 0;
      const heldHere = pointerStart?.type === 'touch' && pointerStart.cell?.key === key && !pointerStart.moved && !pointerStart.cancelled;
      if (titlePendingKey !== key || viewPhase !== 'overview' || !visible() || (hoverCellKey !== key && !heldHere)) {
        clearTitleHover();
        return;
      }
      titlePendingKey = '';
      titleVisibleKey = key;
      mount.dataset.titleHoverPending = '';
      mount.dataset.titleHoverVisible = key;
      // A stopped renderer must wake after the intentional dwell delay.
      invalidate();
    }, 350);
  }

  function pointerMove(event) {
    if (touchGestures?.ignoresPointer(event)) return;
    if (pointerStart) {
      if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 8) { pointerStart.moved = true; clearHold(); clearTitleHover(); }
      return;
    }
    if (!pointerQuery.matches || event.pointerType === 'touch' || viewPhase !== 'overview') return;
    const cell = hitCell(event);
    canvas.style.cursor = cell ? 'pointer' : 'default';
    // Hover only gives this one object a small highlight. It never changes the
    // selected article, the standing wave centre, or the camera target.
    const key = cell?.key || '';
    if (hoverCellKey !== key) { hoverCellKey = key; prepareTitleHover(cell); invalidate(); }
    else if (cell && cell.column !== 0 && !titlePendingKey && !titleVisibleKey) prepareTitleHover(cell);
  }

  function pointerLeave(event) {
    if (touchGestures?.ignoresPointer(event)) return;
    clearTitleHover();
    clearDwell();
    hovered = -1;
    hoverIndex = -1;
    hoverCellKey = '';
    canvas.style.cursor = 'default';
    pointerTarget.set(0, 0);
    invalidate();
  }

  function click(event) {
    clearDwell();
    const origin = lastPointerClick;
    lastPointerClick = null;
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    if (viewPhase === 'open' || viewPhase === 'opening') {
      // The pointer that opened an archive belongs to overview and must not
      // immediately close it as the same click bubbles through the page.
      if (!origin || origin.phase === 'overview' || origin.moved) return;
      const cell = hitCell(event);
      if (!cell || cell.key !== cellKey(inspectionCell)) closeEvent();
      return;
    }
    if (viewPhase !== 'overview' || (origin && origin.phase !== 'overview')) return;
    openCell(hitCell(event));
  }

  function pointerDown(event) {
    if (touchGestures?.ignoresPointer(event)) return;
    if (viewPhase !== 'overview' && viewPhase !== 'opening' && viewPhase !== 'open') return;
    cancelQualityRestore();
    wheelInput?.reset();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (pointerStart && event.pointerId !== pointerStart.id) {
      pointerStart.cancelled = true;
      clearHold();
      clearTitleHover();
      suppressNextClick = true;
      return;
    }
    suppressNextClick = false;
    lastPointerClick = null;
    clearTitleHover();
    clearDwell();
    hoverLockedUntil = performance.now() + 520;
    pointerStart = { id: event.pointerId, type: event.pointerType, phase: viewPhase, x: event.clientX, y: event.clientY, time: performance.now(), moved: false, cancelled: false, held: false, cell: hitCell(event) };
    canvas.setPointerCapture(event.pointerId);
    if (event.pointerType === 'touch' && pointerStart.phase === 'overview' && pointerStart.cell) {
      prepareTitleHover(pointerStart.cell);
      holdTimer = setTimeout(() => {
        holdTimer = 0;
        if (!pointerStart || pointerStart.moved || pointerStart.cancelled) return;
        pointerStart.held = true;
        hoverCellKey = pointerStart.cell.key;
        invalidate();
      }, 300);
    }
  }

  function pointerUp(event) {
    if (touchGestures?.ignoresPointer(event)) return;
    clearHold();
    clearTitleHover();
    if (pointerStart) {
      const dx = event.clientX - pointerStart.x;
      const dy = event.clientY - pointerStart.y;
      const elapsed = performance.now() - pointerStart.time;
      const swipe = pointerStart.phase === 'overview' && viewPhase === 'overview' && !pointerStart.cancelled && !pointerStart.held && Math.abs(dx) >= 36 && Math.abs(dx) >= Math.abs(dy) * 1.3 && elapsed <= 1400;
      const detailHold = pointerStart.phase !== 'overview' && elapsed > 650;
      suppressNextClick = pointerStart.cancelled || pointerStart.held || pointerStart.moved || detailHold || Math.hypot(dx, dy) > 8;
      lastPointerClick = { phase: pointerStart.phase, moved: suppressNextClick };
      if (pointerStart.held) { hoverCellKey = ''; invalidate(); }
      pointerStart = null;
      if (swipe) step(fingerDirection(dx));
    }
    if (viewPhase === 'overview' || viewPhase === 'open') restoreCrispAfterRest();
  }

  function pointerCancel(event) {
    if (touchGestures?.ignoresPointer(event) || !pointerStart) return;
    clearHold();
    clearTitleHover();
    pointerStart = null;
    lastPointerClick = null;
    suppressNextClick = true;
    pointerLeave();
  }

  function visibilityChange() {
    if (document.hidden) {
      wheelInput?.reset();
      clearDwell();
      clearHold();
      clearTitleHover();
      cancelQualityRestore();
      cancelWarmup();
      if (frame) cancelAnimationFrame(frame);
      if (idleTimer) clearTimeout(idleTimer);
      frame = 0;
      idleTimer = 0;
      previousTime = 0;
    } else { scheduleWarmup(); invalidate(); }
  }

  function motionPreference() {
    reduced = reducedQuery.matches;
    if (reduced) {
      pointerTarget.set(0, 0);
      pointerCurrent.set(0, 0);
      focus.copy(focusTarget);
      pulses = [];
      shoulder.value = selectedCell.row;
      shoulder.velocity = 0;
      laneFocus.value = 0;
      laneFocus.velocity = 0;
      extraction.value = viewIntent ? 1 : 0;
      extraction.velocity = 0;
      inspection.value = viewIntent ? 1 : 0;
      inspection.velocity = 0;
      archives.forEach(record => { record.active = record.target; });
    }
    invalidate();
  }

  function touchMode() {
    if (disposed || document.hidden || externallyPaused || homeView?.hidden || mount.dataset.webgl !== 'ready') return 'inactive';
    return viewPhase;
  }

  function canNavigateArchives() {
    return touchMode() === 'overview' && buttons.length > 1 && (!articleList || articleList.hidden) && !document.body.classList.contains('articles-visible') && visible();
  }

  touchGestures = createArchiveTouchGestures({
    surface: stage,
    touchSurfaces: [mount, canvas],
    observeTargets: [homeView, articleList, mount],
    getMode: touchMode,
    canPan: canNavigateArchives,
    onPress(gesture) {
      wheelInput?.reset();
      cancelQualityRestore();
      clearHold();
      clearTitleHover();
      clearDwell();
      lastPointerClick = null;
      suppressNextClick = false;
      const cell = gesture.kind === 'feature-link'
        ? poolCells.find(item => item.key === cellKey(selectedCell))
        : hitCell(gesture.start);
      if (gesture.pan && cell) prepareTitleHover(cell);
      return { cell };
    },
    onStep(direction) {
      cancelQualityRestore();
      clearTitleHover();
      hoverCellKey = '';
      step(direction);
    },
    onHold(gesture) {
      if (viewPhase !== 'overview' || !gesture.payload?.cell) return;
      hoverCellKey = gesture.payload.cell.key;
      invalidate();
    },
    onPreviewEnd() {
      clearTitleHover();
      if (hoverCellKey) { hoverCellKey = ''; invalidate(); }
    },
    onTap(gesture) {
      if (gesture.kind === 'feature-link') {
        // Keep the title's own target/metadata; do not open an unrelated tile
        // behind its overlay. Programmatic clicks bypass only the ghost guard.
        featureTitleLink?.click();
        return;
      }
      const cell = gesture.payload?.cell;
      if (gesture.mode === 'overview' && viewPhase === 'overview') openCell(cell);
      else if ((gesture.mode === 'open' || gesture.mode === 'opening') && (viewPhase === 'open' || viewPhase === 'opening')) {
        if (!cell || cell.key !== cellKey(inspectionCell)) closeEvent();
      }
    },
    onRelease() {
      if (viewPhase === 'overview' || viewPhase === 'open') restoreCrispAfterRest();
    },
  });

  wheelInput = createWheelAccumulator({ onStep: step, canRun: canNavigateArchives, onEnd: restoreCrispAfterRest });

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(mount);
  const selectionObserver = new MutationObserver(updateSelection);
  selectionObserver.observe(stage, { attributes: true, attributeFilter: ['data-selected-index'] });
  const intersectionObserver = new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    touchGestures?.refresh();
    if (inView) invalidate();
    else {
      wheelInput?.reset();
      clearDwell();
      clearHold();
      clearTitleHover();
      cancelQualityRestore();
      cancelWarmup();
      if (frame) cancelAnimationFrame(frame);
      if (idleTimer) clearTimeout(idleTimer);
      frame = 0;
      idleTimer = 0;
      previousTime = 0;
    }
  }, { rootMargin: '60px 0px' });
  intersectionObserver.observe(mount);
  canvas.addEventListener('pointermove', pointerMove, { passive: true });
  canvas.addEventListener('pointerdown', pointerDown, { passive: true });
  canvas.addEventListener('pointerup', pointerUp, { passive: true });
  canvas.addEventListener('pointercancel', pointerCancel, { passive: true });
  canvas.addEventListener('lostpointercapture', pointerCancel, { passive: true });
  canvas.addEventListener('pointerleave', pointerLeave, { passive: true });
  canvas.addEventListener('click', click);
  stage.addEventListener('wheel', wheel, { passive: false });
  stage.addEventListener('pointerdown', interruptWheelInput, { capture: true, passive: true });
  stage.addEventListener('touchstart', interruptWheelInput, { capture: true, passive: true });
  stage.addEventListener('keydown', interruptWheelInput, true);
  function canvasContextMenu(event) { event.preventDefault(); }
  canvas.addEventListener('contextmenu', canvasContextMenu);
  document.addEventListener('visibilitychange', visibilityChange);
  reducedQuery.addEventListener('change', motionPreference);
  window.addEventListener('welkin-open', openEvent);
  window.addEventListener('welkin-close', closeEvent);
  window.addEventListener('welkin-pause', pauseEvent);

  function contextLost(event) {
    event.preventDefault();
    wheelInput?.reset();
    clearHold();
    clearTitleHover();
    cancelQualityRestore();
    cancelWarmup();
    cancelCovers();
    if (frame) cancelAnimationFrame(frame);
    if (idleTimer) clearTimeout(idleTimer);
    frame = 0;
    idleTimer = 0;
    mount.dataset.webgl = 'unavailable';
    mount.hidden = true;
    touchGestures?.refresh();
    viewIntent = false;
    viewPhase = 'overview';
    qualityLocked = false;
    mount.dataset.qualityLocked = 'false';
    extraction.value = 0;
    inspection.value = 0;
    stage.dataset.archiveView = 'overview';
    stage.dataset.archiveSettling = 'false';
    stage.dataset.archiveDetail = '0';
    stage.dataset.glassCover = 'fallback';
    stage.style.setProperty('--archive-detail', '0');
    window.dispatchEvent(new CustomEvent('welkin-view-change', { detail: { state: 'overview', index: selected } }));
  }
  canvas.addEventListener('webglcontextlost', contextLost);

  disposeScene = () => {
    disposed = true;
    wheelInput?.destroy();
    touchGestures?.destroy();
    touchGestures = null;
    clearDwell();
    clearHold();
    clearTitleHover();
    cancelQualityRestore();
    cancelWarmup();
    cancelCovers(true);
    if (frame) cancelAnimationFrame(frame);
    if (idleTimer) clearTimeout(idleTimer);
    resizeObserver.disconnect();
    selectionObserver.disconnect();
    intersectionObserver.disconnect();
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerCancel);
    canvas.removeEventListener('lostpointercapture', pointerCancel);
    canvas.removeEventListener('pointerleave', pointerLeave);
    canvas.removeEventListener('click', click);
    stage.removeEventListener('wheel', wheel);
    stage.removeEventListener('pointerdown', interruptWheelInput, true);
    stage.removeEventListener('touchstart', interruptWheelInput, true);
    stage.removeEventListener('keydown', interruptWheelInput, true);
    canvas.removeEventListener('contextmenu', canvasContextMenu);
    canvas.removeEventListener('webglcontextlost', contextLost);
    document.removeEventListener('visibilitychange', visibilityChange);
    reducedQuery.removeEventListener('change', motionPreference);
    window.removeEventListener('welkin-open', openEvent);
    window.removeEventListener('welkin-close', closeEvent);
    window.removeEventListener('welkin-pause', pauseEvent);
    const releaseGpu = () => {
      for (const resource of resources) resource.dispose();
      for (const texture of textures) texture.dispose();
      environmentTarget.dispose();
      renderer.dispose();
    };
    // compileAsync polls its program objects; keep them valid until that job
    // finishes, while DOM listeners, timers and all rendering stop immediately.
    if (prewarmPromise && !prewarmComplete) prewarmPromise.finally(releaseGpu);
    else releaseGpu();
    canvas.remove();
    delete mount.dataset.webgl;
    disposeScene = null;
  };

  resize();
  mount.dataset.prewarm = 'pending';
  scheduleWarmup();
  requestCover(selected);
}

window.addEventListener('welkin-ready', initializeGlassScene);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeGlassScene, { once: true });
else initializeGlassScene();
