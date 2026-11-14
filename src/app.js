import './style.css';
import { colors, threadColors, statuses, priorities, emptyState, uid, safeUrl, openStorage, writeState, storageMessage, makeWorkspace, serializeWorkspace, deserialize, verifyImage } from './storage.js';

const $ = id => document.getElementById(id);
const viewport = $('viewport');
const world = $('world');
const cards = $('cards');
const pins = $('pins');
const mediaRatios = new WeakMap();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const threadSprings = new Map();
let springFrame = 0;
let springTime = 0;
let pinDrag = null;
const threads = $('threads');
const dialog = $('dialog');
const taskList = $('kanban');
const camera = { x: 0, y: 0, scale: 1 };
const objectUrls = new Map();
let state = emptyState();
let workspace;
const histories = new Map();
let groupMode = false;
let focusPin = null;
let inboxCapture = false;
let cameraMotion = 0;
let groupDrag = null;
let view = 'tavle';
let pickerPosition;
let menuOrigin;
let source = null;
let preview = null;
let selectedThread = null;
let selectedPin = null;
let needleMode = false;
let gesture = null;
let needleDrag = null;
let suppressPinClick = false;
let draggedTask = null;
let saveNumber = 0;
let toastTimer;

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function button(label, action, className) {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function notify(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}

function history() {
  if (!histories.has(workspace.active)) histories.set(workspace.active, {
    current: structuredClone(state), undo: [], redo: [], batch: null
  });
  return histories.get(workspace.active);
}

function save(batch = null) {
  const entry = history();
  if (!batch || entry.batch !== batch) {
    entry.undo.push(entry.current);
    if (entry.undo.length > 40) entry.undo.shift();
  }
  entry.batch = batch;
  entry.redo.length = 0;
  entry.current = structuredClone(state);
  return persist();
}

function restoreHistory(redo) {
  if (gesture || groupDrag || pinDrag || needleDrag) return;
  const entry = history();
  const stack = redo ? entry.redo : entry.undo;
  if (!stack.length) return;
  (redo ? entry.undo : entry.redo).push(entry.current);
  entry.current = stack.pop();
  entry.batch = null;
  const board = workspace.boards.find(board => board.id === workspace.active);
  state = board.state = structuredClone(entry.current);
  focusPin = null;
  clearMediaUrls();
  setNeedleMode(false);
  setGroupMode(false);
  render();
  persist();
  notify(redo ? 'Gjort om' : 'Angret');
}

async function persist() {
  const number = ++saveNumber;
  $('saveStatus').textContent = 'Lagrer …';
  try {
    await writeState(workspace);
    if (number === saveNumber) $('saveStatus').textContent = 'Lagret lokalt';
  } catch (error) {
    if (number !== saveNumber) return;
    $('saveStatus').textContent = 'Endringer er ikke lagret';
    notify(storageMessage(error));
  }
}

function position(clientX, clientY) {
  const rect = viewport.getBoundingClientRect();
  return { x: (clientX - rect.left - camera.x) / camera.scale, y: (clientY - rect.top - camera.y) / camera.scale };
}

function updateCamera() {
  world.style.transform = 'translate(' + camera.x + 'px,' + camera.y + 'px) scale(' + camera.scale + ')';
  viewport.style.backgroundSize = (864 * camera.scale) + 'px';
  viewport.style.backgroundPosition = camera.x + 'px ' + camera.y + 'px';
}

function zoom(ratio, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
  cancelAnimationFrame(cameraMotion);
  const next = Math.min(3, Math.max(.08, camera.scale * ratio));
  const factor = next / camera.scale;
  camera.x = x - (x - camera.x) * factor;
  camera.y = y - (y - camera.y) * factor;
  camera.scale = next;
  updateCamera();
}

function reset() {
  cancelAnimationFrame(cameraMotion);
  Object.assign(camera, { x: 0, y: 0, scale: 1 });
  updateCamera();
}

function fit() {
  cancelAnimationFrame(cameraMotion);
  const boxes = [...state.cards.filter(card => !hiddenCard(card.id)), ...state.groups.map(groupBounds), ...state.pins.filter(pin => !hiddenCard(pin.cardId)).map(pin => ({ ...anchor(pin), w: 1, h: 1 }))];
  if (!boxes.length) return reset();
  const left = Math.min(...boxes.map(card => card.x));
  const top = Math.min(...boxes.map(card => card.y));
  const right = Math.max(...boxes.map(card => card.x + card.w));
  const bottom = Math.max(...boxes.map(card => card.y + card.h));
  camera.scale = Math.min(1.25, (viewport.clientWidth - 36) / (right - left), (viewport.clientHeight - 96) / (bottom - top));
  camera.x = (viewport.clientWidth - (left + right) * camera.scale) / 2;
  camera.y = (viewport.clientHeight - (top + bottom) * camera.scale) / 2 - 9;
  updateCamera();
}

function placement(w, h) {
  const origin = position(viewport.getBoundingClientRect().left + 32, viewport.getBoundingClientRect().top + 43);
  const gap = 24;
  const columns = Math.max(1, Math.floor((viewport.clientWidth / camera.scale - 32) / (w + gap)));
  for (let index = 0; ; index++) {
    const x = origin.x + (index % columns) * (w + gap);
    const y = origin.y + Math.floor(index / columns) * (h + gap);
    const overlaps = state.cards.some(card => !hiddenCard(card.id) &&
      x < card.x + card.w + gap && x + w + gap > card.x &&
      y < card.y + card.h + gap && y + h + gap > card.y);
    if (!overlaps) return { x, y };
  }
}

const cardSizes = { note: [210, 170], link: [245, 161], image: [255, 180], video: [320, 240], task: [215, 125] };

function addCard(type, fields, at) {
  const [w, h] = cardSizes[type];
  const card = { id: uid(), type, ...(at ?? (fields.inbox ? { x: 0, y: 0 } : placement(w, h))), w, h, ...fields };
  state.cards.push(card);
  if (!fields.inbox && !at && (card.y + h) * camera.scale + camera.y > viewport.clientHeight - 57) fit();
  return card;
}

function mediaUrl(card) {
  if (!objectUrls.has(card.id)) objectUrls.set(card.id, URL.createObjectURL(card.image ?? card.video));
  return objectUrls.get(card.id);
}

function cardSize(card) {
  const ratio = mediaRatios.get(card);
  if (!ratio) return { w: card.w, h: card.h };
  const width = Math.min(card.w, card.h * ratio);
  return { w: width, h: width / ratio, ratio };
}

function resizeCard(card, w, h, ratio) {
  if (ratio) {
    const width = Math.max(40, 40 * ratio, w, h * ratio);
    Object.assign(card, { w: width, h: width / ratio });
  } else {
    Object.assign(card, { w: Math.max(150, w), h: Math.max(116, h) });
  }
}

function placeCard(node, card) {
  const { w, h } = cardSize(card);
  Object.assign(node.style, { left: card.x + 'px', top: card.y + 'px', width: w + 'px', height: h + 'px' });
}

function cardName(card) {
  if (card.type === 'note') return card.text.trim().split('\n')[0].slice(0, 65) || 'Lapp';
  if (card.type === 'image') return card.caption || 'Bilde';
  if (card.type === 'video') return 'Video';
  if (card.type === 'link') return card.title || card.url;
  return state.tasks.find(task => task.id === card.taskId)?.title || 'Oppgave';
}

function hiddenCard(id) {
  return state.cards.some(card => card.id === id && card.inbox) ||
    state.groups.some(group => group.collapsed && group.members.includes(id));
}

function land(node) {
  if (!reducedMotion.matches) node?.animate([
    { translate: '0 -5px', scale: '1.025', filter: 'drop-shadow(0 6px 5px #38250c44)' },
    { translate: '0 0', scale: '.99', offset: .68 },
    { translate: '0 0', scale: '1', filter: 'none' }
  ], { duration: 210, easing: 'ease-out' });
}

function cardNode(id) {
  return [...cards.children].find(node => node.dataset.id === id);
}

function youtubeId(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const [, route, segment] = url.pathname.split('/');
  let id;
  if (host === 'youtu.be') id = route;
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
    if (route === 'watch') id = url.searchParams.get('v');
    if (['shorts', 'embed', 'live'].includes(route)) id = segment;
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id ?? '') ? id : null;
}

function renderVideo(body, card) {
  const youtube = card.url && youtubeId(card.url);
  if (youtube) {
    const frame = element('iframe', 'youtube-player');
    frame.title = 'YouTube-video';
    frame.src = 'https://www.youtube-nocookie.com/embed/' + youtube;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.loading = 'lazy';
    frame.allowFullscreen = true;
    frame.allow = 'encrypted-media; picture-in-picture; fullscreen';
    mediaRatios.set(card, 16 / 9);
    body.append(frame);
  } else {
    const video = element('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'none';
    video.setAttribute('aria-label', 'Spill av video');
    const error = element('p', 'video-error', 'Videoen kunne ikke spilles av her. Sjekk adressen eller bruk en MP4- eller WebM-fil.');
    error.hidden = true;
    video.addEventListener('error', () => { error.hidden = false; });
    video.addEventListener('loadedmetadata', () => {
      if (!video.videoWidth || !video.videoHeight) return;
      mediaRatios.set(card, video.videoWidth / video.videoHeight);
      const node = video.closest('.card');
      if (node?.isConnected) {
        placeCard(node, card);
        renderThreads();
      }
    });
    video.src = card.video ? mediaUrl(card) : card.url;
    body.append(video, error);
  }

}

function renderCards() {
  const active = new Set(state.cards.map(card => card.id));
  for (const [id, url] of objectUrls) if (!active.has(id)) {
    URL.revokeObjectURL(url);
    objectUrls.delete(id);
  }
  cards.replaceChildren(...state.cards.map(card => {
    const node = element('article', 'card');
    node.dataset.id = card.id;
    node.hidden = hiddenCard(card.id);
    node.dataset.type = card.type;
    placeCard(node, card);
    const head = element('div', 'card-head');
    const type = { note: 'Lapp', link: 'Kilde', image: 'Bilde', video: 'Video', task: 'Oppgave' }[card.type];
    const edit = button('⋯', () => editCard(card));
    edit.setAttribute('aria-label', (card.type === 'image' || card.type === 'video' ? 'Fjern ' : 'Rediger ') + type.toLowerCase());
    if (card.type !== 'image') head.append(element('span', '', type));
    head.append(edit);
    head.addEventListener('pointerdown', event => {
      if (!event.target.closest('button') && event.button === 0 && !needleMode && !groupMode) begin(event, 'move', card, node);
    });
    const body = element('div', 'card-body');
    if (card.type === 'note') {
      node.dataset.color = card.color;
      const input = element('textarea');
      input.value = card.text;
      input.placeholder = 'Skriv her …';
      input.setAttribute('aria-label', 'Tekst på lapp');
      input.addEventListener('input', () => {
        card.text = input.value;
        save(card.id);
      });
      input.addEventListener('blur', () => { if (workspace) history().batch = null; });
      body.append(input);
    } else if (card.type === 'image') {
      const image = element('img');
      image.src = mediaUrl(card);
      image.alt = card.caption || 'Vedlagt bilde';
      const surface = element('div', 'image-surface');
      surface.addEventListener('pointerdown', event => {
        if (event.button === 0 && !needleMode) begin(event, 'move', card, node);
      });
      surface.append(image);
      body.append(surface);
    } else if (card.type === 'video') {
      renderVideo(body, card);
    } else if (card.type === 'link') {
      const link = element('a', '', card.title || card.url);
      link.href = card.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      body.append(link);
      if (card.note) body.append(element('p', '', card.note));
    } else {
      const task = state.tasks.find(item => item.id === card.taskId);
      const open = button(task.title, () => editTask(task));
      const badges = element('div', 'badges');
      badges.append(element('span', '', task.status));
      body.append(open, badges);
    }
    const resize = button('', () => {}, 'resize');
    resize.setAttribute('aria-label', 'Endre størrelse med piltastene');
    resize.addEventListener('pointerdown', event => {
      if (event.button === 0 && !needleMode) begin(event, 'resize', card, node);
    });
    resize.addEventListener('keydown', event => {
      const sizes = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
      if (!Object.hasOwn(sizes, event.key)) return;
      event.preventDefault();
      const [x, y] = sizes[event.key];
      const size = cardSize(card);
      const width = size.ratio ? size.w + x + y * size.ratio : size.w + x;
      resizeCard(card, width, size.ratio ? width / size.ratio : size.h + y, size.ratio);
      placeCard(node, card);
      renderThreads();
      save();
    });
    if (card.type === 'image') {
      const frame = element('div', 'image-frame');
      const surface = body.querySelector('.image-surface');
      const image = surface.querySelector('img');
      const fitImage = () => {
        if (!image.naturalWidth) return;
        mediaRatios.set(card, image.naturalWidth / image.naturalHeight);
        placeCard(node, card);
        renderThreads();
      };
      image.addEventListener('load', fitImage);
      frame.append(surface, head, resize);
      node.append(frame);
      placeCard(node, card);
      if (image.complete) fitImage();
    } else {
      if (card.type === 'video') {
        const grip = element('div', 'video-grip');
        grip.title = 'Dra for å flytte videoen · høyreklikk for handlinger';
        const move = event => {
          if (event.button === 0 && !needleMode && !groupMode) begin(event, 'move', card, node);
        };
        grip.addEventListener('pointerdown', move);
        body.addEventListener('pointerdown', event => { if (event.target === body) move(event); });
        node.append(body, grip, resize);
        placeCard(node, card);
      } else {
        node.append(head, body, resize);
      }
    }
    return node;
  }));
  $('empty').hidden = state.cards.length > 0 || state.pins.length > 0 || state.groups.length > 0 || needleMode || groupMode;
  renderThreads();
  updateModes();
}

function threadShape(from, to) {
  const sag = Math.min(55, Math.hypot(to.x - from.x, to.y - from.y) * .12);
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + sag };
}

function advanceThreads(time) {
  springFrame = 0;
  const step = Math.min(.025, (time - springTime) / 1000);
  springTime = time;
  let moving = false;
  for (const spring of threadSprings.values()) {
    for (const axis of ['x', 'y']) {
      const difference = spring.goal[axis] - spring.point[axis];
      if (Math.abs(difference) < .08 && Math.abs(spring.velocity[axis]) < .15) {
        spring.point[axis] = spring.goal[axis];
        spring.velocity[axis] = 0;
      } else {
        spring.velocity[axis] += (difference * 210 - spring.velocity[axis] * 17) * step;
        spring.point[axis] += spring.velocity[axis] * step;
        moving = true;
      }
    }
    paintThread(spring);
  }
  if (moving) springFrame = requestAnimationFrame(advanceThreads);
}

function paintThread({ from, to, point, paths }) {
  const d = 'M ' + from.x + ' ' + from.y + ' Q ' + point.x + ' ' + point.y + ' ' + to.x + ' ' + to.y;
  for (const path of paths) path.setAttribute('d', d);
}

function trackThread(id, from, to, paths) {
  const goal = threadShape(from, to);
  let spring = threadSprings.get(id);
  if (!spring || reducedMotion.matches) {
    spring = { point: { ...goal }, velocity: { x: 0, y: 0 } };
    threadSprings.set(id, spring);
  }
  Object.assign(spring, { from, to, goal, paths });
  paintThread(spring);
  if (!springFrame && !reducedMotion.matches && (spring.point.x !== goal.x || spring.point.y !== goal.y)) {
    springTime = performance.now();
    springFrame = requestAnimationFrame(advanceThreads);
  }
}

function animateInsertion(pin) {
  if (reducedMotion.matches) return;
  const node = [...pins.children].find(item => item.dataset.pin === pin.id);
  node?.animate([
    { transform: 'translateY(-8px) scale(1.24)' },
    { transform: 'scale(.88)', offset: .56 },
    { transform: 'scale(1.06)', offset: .8 },
    { transform: 'none' }
  ], { duration: 240, easing: 'ease-out' });
}

function svg(tag, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function anchor(pin) {
  if (pinDrag?.pin === pin && pinDrag.at) return pinDrag.at;
  if (!pin.cardId) return pin;
  const card = state.cards.find(card => card.id === pin.cardId);
  const { w, h } = cardSize(card);
  return { x: card.x + w * pin.x, y: card.y + h * pin.y };
}

function pinName(pin) {
  const card = state.cards.find(card => card.id === pin.cardId);
  return card ? cardName(card) : 'nål på tavla';
}

function renderPins() {
  const visible = state.pins.filter(pin => !hiddenCard(pin.cardId));
  const active = new Set(visible.map(pin => pin.id));
  const related = focusedPins();
  for (const node of pins.children) {
    if (!active.has(node.dataset.pin)) node.remove();
  }
  for (const pin of [...visible, ...(source && !state.pins.includes(source) ? [source] : [])]) {
    let node = [...pins.children].find(item => item.dataset.pin === pin.id);
    if (!node) {
      node = button('', () => {
        if (suppressPinClick) return;
        if (needleMode) choosePin(pin);
        else {
          selectedPin = selectedPin === pin.id ? null : pin.id;
          selectedThread = null;
          renderThreads();
          updateModes();
        }
      }, 'pin');
      node.addEventListener('dblclick', event => {
        if (needleMode) return;
        event.preventDefault();
        focusPin = focusPin === pin.id ? null : pin.id;
        renderThreads();
      });
      node.dataset.pin = pin.id;
      pins.append(node);
    }
    const { x, y } = anchor(pin);
    Object.assign(node.style, { left: x + 'px', top: y + 'px' });
    node.setAttribute('aria-label', 'Nål ved ' + pinName(pin));
    node.classList.toggle('active', source === pin || selectedPin === pin.id);
    node.classList.toggle('dimmed', Boolean(focusPin) && !related.has(pin.id));
  }
}

function focusedPins() {
  return new Set([focusPin, ...state.threads
    .filter(thread => thread.from === focusPin || thread.to === focusPin)
    .flatMap(thread => [thread.from, thread.to])]);
}

function renderThreads() {
  const byId = new Map(state.pins.map(pin => [pin.id, pin]));
  const shown = state.threads.filter(thread => ![thread.from, thread.to]
    .some(id => hiddenCard(byId.get(id)?.cardId)));
  const active = new Set(shown.map(thread => thread.id));
  const related = focusedPins();
  for (const node of cards.children) {
    node.classList.toggle('dimmed', Boolean(focusPin) &&
      !state.pins.some(pin => related.has(pin.id) && pin.cardId === node.dataset.id));
  }
  if (source && preview) active.add(null);
  for (const id of threadSprings.keys()) if (!active.has(id)) threadSprings.delete(id);
  const nodes = shown.map(thread => {
    const group = svg('g', {
      class: 'thread-group' + (thread.id === selectedThread ? ' selected' : ''),
      'data-color': thread.color || 'rod',
      'data-focus': focusPin ? ([thread.from, thread.to].includes(focusPin) ? 'related' : 'dimmed') : '',
      tabindex: 0, role: 'button', 'aria-pressed': thread.id === selectedThread,
      'aria-label': 'Tråd mellom ' + pinName(byId.get(thread.from)) + ' og ' + pinName(byId.get(thread.to))
    });
    const select = () => {
      selectedPin = null;
      selectedThread = thread.id === selectedThread ? null : thread.id;
      for (const sibling of threads.querySelectorAll('.thread-group')) {
        const picked = sibling === group && Boolean(selectedThread);
        sibling.classList.toggle('selected', picked);
        sibling.setAttribute('aria-pressed', picked);
      }
      updateModes();
    };
    group.addEventListener('click', select);
    group.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });
    const paths = [svg('path', { class: 'thread-line' }), svg('path', { class: 'thread-hit' })];
    trackThread(thread.id, anchor(byId.get(thread.from)), anchor(byId.get(thread.to)), paths);
    group.append(...paths);
    return group;
  });
  if (source && preview) {
    const draft = svg('path', { class: 'thread-line' });
    trackThread(null, anchor(source), preview, [draft]);
    nodes.push(draft);
  }
  threads.replaceChildren(...nodes);
  renderPins();
}

function updateModes() {
  $('empty').hidden = state.cards.length > 0 || state.pins.length > 0 || state.groups.length > 0 || needleMode || groupMode;
  viewport.dataset.needleMode = needleMode ? 'active' : '';
  $('needleTools').setAttribute('aria-pressed', needleMode);
  const hint = $('boardHint');
  hint.replaceChildren();
  hint.hidden = !(groupMode || needleMode || selectedPin || selectedThread);
  if (groupMode) hint.append('Dra et område rundt kortene du vil gruppere.');
  else if (needleMode) hint.append(source
    ? 'Velg hvor tråden skal ende.'
    : 'Klikk for nål · Dra for tråd');
  else if (selectedPin) hint.append(button('Slett valgt nål', () => {
    state.pins = state.pins.filter(pin => pin.id !== selectedPin);
    state.threads = state.threads.filter(thread => thread.from !== selectedPin && thread.to !== selectedPin);
    selectedPin = null;
    renderThreads();
    updateModes();
    save();
  }, 'danger'));
  else if (selectedThread) {
    const thread = state.threads.find(thread => thread.id === selectedThread);
    if (thread.note) hint.append(element('span', 'thread-note', thread.note));
    hint.append(button(thread.note ? 'Rediger trådnotat' : 'Legg til trådnotat', () => editThreadNote(thread)),
      button('Slett valgt tråd', removeThread, 'danger'));
  }
}

function setNeedleMode(mode) {
  finishPinDrag();
  needleMode = mode;
  needleDrag = null;
  source = preview = selectedPin = selectedThread = null;
  renderThreads();
  updateModes();
}

function newPin(clientX, clientY, target) {
  const at = position(clientX, clientY);
  const node = target.closest('.image-frame, .card:not([data-type=image])');
  const card = node && state.cards.find(card => card.id === node.closest('.card').dataset.id);
  if (!card) return { id: uid(), ...at };
  const { w, h } = cardSize(card);
  const fraction = (distance, length) => Math.min(1, Math.max(0, distance / length));
  return { id: uid(), cardId: card.id, x: fraction(at.x - card.x, w), y: fraction(at.y - card.y, h) };
}

function choosePin(pin) {
  const inserted = [];
  if (!source) {
    source = pin;
  } else if (source.id === pin.id) {
    source = null;
  } else {
    const from = source.id;
    const to = pin.id;
    const duplicate = state.threads.some(thread =>
      (thread.from === from && thread.to === to) || (thread.from === to && thread.to === from));
    if (duplicate) {
      notify('Disse nålene er allerede koblet sammen.');
      return;
    }
    for (const endpoint of [source, pin]) {
      if (state.pins.includes(endpoint)) continue;
      state.pins.push(endpoint);
      inserted.push(endpoint);
    }

    const id = uid();
    state.threads.push({ id, from, to });
    if (threadSprings.has(null)) threadSprings.set(id, threadSprings.get(null));
    if (!reducedMotion.matches) {
      const a = anchor(source);
      const b = anchor(pin);
      const spring = threadSprings.get(id) ?? { point: threadShape(a, b), velocity: { x: 0, y: 0 } };
      spring.point.y += 5;
      spring.velocity.y -= Math.min(205, 65 + Math.hypot(b.x - a.x, b.y - a.y) * .4);
      threadSprings.set(id, spring);
    }
    source = null;
    save();
  }
  preview = null;
  renderThreads();
  updateModes();
  inserted.forEach(animateInsertion);
}

function editThreadNote(thread) {
  const form = element('form');
  const note = field(form, 'Trådnotat', 'text', thread.note ?? '');
  const color = field(form, 'Trådfarge', 'select', thread.color || 'rod', Object.entries(threadColors));
  actions(form, 'Lagre', () => {
    thread.note = note.value.trim();
    thread.color = color.value;
    renderThreads();
    dialog.close();
    updateModes();
    save();
  });
  openDialog('Trådnotat', form);
}

function removeThread() {
  state.threads = state.threads.filter(thread => thread.id !== selectedThread);
  selectedThread = null;
  renderThreads();
  updateModes();
  save();
}

function begin(event, kind, card, node) {
  if (gesture) return;
  cancelAnimationFrame(cameraMotion);
  gesture = {
    pointer: event.pointerId, kind, card, node, startX: event.clientX, startY: event.clientY,
    x: card?.x ?? camera.x, y: card?.y ?? camera.y, ...(card && cardSize(card)),
    moved: false
  };
  event.preventDefault();
  viewport.setPointerCapture(event.pointerId);
}

viewport.addEventListener('pointerdown', event => {
  if (event.target.closest('.hint,.empty,.board-menu,.needle-tools,.pin')) return;
  const background = !event.target.closest('.card,.thread-group,.board-group');
  if (event.button === 1 || (event.button === 0 && background && !needleMode && !groupMode)) {
    begin(event, 'pan');
  }
});

window.addEventListener('pointermove', event => {
  if (needleDrag?.pointer === event.pointerId &&
      Math.hypot(event.clientX - needleDrag.x, event.clientY - needleDrag.y) >= 5) {
    source = needleDrag.pin;
  }
  if (source && needleMode && !gesture && view === 'tavle') {
    preview = position(event.clientX, event.clientY);
    renderThreads();
  }
  if (!gesture || gesture.pointer !== event.pointerId) return;
  const { kind, card, node, startX, startY, x, y, w, h, ratio } = gesture;
  const dx = event.clientX - startX;
  const dy = event.clientY - startY;
  if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
  gesture.moved = true;
  if (kind === 'pan') {
    viewport.classList.add('is-moving');
    Object.assign(camera, { x: x + dx, y: y + dy });
    updateCamera();
  } else {
    if (kind === 'move') Object.assign(card, { x: x + dx / camera.scale, y: y + dy / camera.scale });
    else if (ratio) {
      const change = (dx + dy / ratio) / (1 + 1 / (ratio * ratio)) / camera.scale;
      resizeCard(card, w + change, (w + change) / ratio, ratio);
    } else resizeCard(card, w + dx / camera.scale, h + dy / camera.scale);
    placeCard(node, card);
    renderThreads();
  }
});

function endGesture(event) {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  const { kind, moved, node } = gesture;
  gesture = null;
  viewport.classList.remove('is-moving');
  if (!moved) return;
  if (kind === 'move' || kind === 'resize') {
    save();
    if (kind === 'move') land(node);
  }

}

function needlePoint(event, target) {
  const id = target.closest('.pin')?.dataset.pin;
  if (source && source.id === id) return source;
  return state.pins.find(pin => pin.id === id) ?? newPin(event.clientX, event.clientY, target);
}

const toolsSelector = '.needle-tools,  .hint, .board-menu';

pins.addEventListener('pointerdown', event => {
  const node = event.target.closest('.pin');
  if (event.button !== 0 || !node || needleMode || groupMode || gesture || pinDrag) return;
  const pin = state.pins.find(pin => pin.id === node.dataset.pin);
  if (!pin) return;
  const start = position(event.clientX, event.clientY);
  const fixed = anchor(pin);
  pinDrag = {
    pointer: event.pointerId, node, pin, start, last: start,
    offsetX: fixed.x - start.x, offsetY: fixed.y - start.y
  };
  node.setPointerCapture(event.pointerId);
});

window.addEventListener('pointermove', event => {
  if (pinDrag?.pointer !== event.pointerId) return;
  const drag = pinDrag;
  const point = position(event.clientX, event.clientY);
  if (!drag.at && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) * camera.scale < 4) return;
  drag.at = { x: point.x + drag.offsetX, y: point.y + drag.offsetY };
  const turn = (point.x - drag.last.x) * camera.scale * 2;
  drag.node.style.setProperty('--pin-turn', Math.max(-52, Math.min(52, turn)) + 'deg');
  drag.node.classList.add('is-lifted');
  drag.last = point;
  renderThreads();
});

function finishPinDrag(event) {
  if (!pinDrag || (event && event.pointerId !== pinDrag.pointer)) return;
  const { pin, node, at } = pinDrag;
  pinDrag = null;
  node.classList.remove('is-lifted');
  node.style.removeProperty('--pin-turn');
  if (!at) return;
  const rect = viewport.getBoundingClientRect();
  const x = rect.left + camera.x + at.x * camera.scale;
  const y = rect.top + camera.y + at.y * camera.scale;
  const target = document.elementsFromPoint(x, y).find(item => !item.closest('.pin, .thread-group'));
  if (event?.type === 'pointerup' && target && viewport.contains(target) && !target.closest(toolsSelector)) {
    const destination = newPin(x, y, target);
    Object.assign(pin, { cardId: destination.cardId, x: destination.x, y: destination.y });
    save();
  }
  suppressPinClick = true;
  setTimeout(() => { suppressPinClick = false; }, 0);
  renderThreads();
  animateInsertion(pin);
}

window.addEventListener('pointerup', finishPinDrag);
window.addEventListener('pointercancel', finishPinDrag);
viewport.addEventListener('pointerdown', event => {
  if (!needleMode || source || event.button !== 0 || event.target.closest(toolsSelector)) return;
  needleDrag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, pin: needlePoint(event, event.target) };
}, true);
window.addEventListener('pointerup', event => {
  if (needleDrag?.pointer !== event.pointerId) return;
  needleDrag = null;
  if (!source) return;
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  if (hit && viewport.contains(hit) && !hit.closest(toolsSelector)) choosePin(needlePoint(event, hit));
  else {
    source = preview = null;
    renderThreads();
    updateModes();
  }
  suppressPinClick = true;
  setTimeout(() => { suppressPinClick = false; }, 0);
});
window.addEventListener('pointercancel', event => {
  if (needleDrag?.pointer === event.pointerId) setNeedleMode(false);
});

viewport.addEventListener('click', event => {
  if (!needleMode || event.target.closest(toolsSelector)) return;
  event.preventDefault();
  event.stopPropagation();
  if (suppressPinClick) return;
  const pin = needlePoint(event, event.target);
  if (source || state.pins.includes(pin)) choosePin(pin);
  else {
    state.pins.push(pin);
    renderThreads();
    animateInsertion(pin);
    updateModes();
    save();
  }
}, true);
$('needleTools').addEventListener('click', () => setNeedleMode(!needleMode));

window.addEventListener('pointerup', endGesture);
window.addEventListener('pointercancel', endGesture);
viewport.addEventListener('wheel', event => {
  if (event.target.closest('textarea, .board-menu') && !event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const rect = viewport.getBoundingClientRect();
  const amount = event.deltaY * (event.deltaMode === 1 ? 15 : 1);
  zoom(Math.exp(-amount * .002), event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });

function openDialog(title, contents) {
  const head = element('div', 'dialog-head');
  const heading = element('h2', '', title);
  heading.id = 'dialogTitle';
  const close = button('×', () => dialog.close());
  close.setAttribute('aria-label', 'Lukk');
  head.append(heading, close);
  $('dialogBody').replaceChildren(head, contents);
  if (!dialog.open) dialog.showModal();
  const field = contents.querySelector('input, textarea, select, button');
  (field || close).focus();
}

function field(form, label, kind, value = '', options = []) {
  const wrapper = element('label');
  const input = element(kind === 'textarea' || kind === 'select' ? kind : 'input');
  if (input.tagName === 'INPUT') input.type = kind;
  if (kind === 'select') input.append(...options.map(([value, title]) => new Option(title, value)));
  if (kind === 'textarea') input.rows = 4;
  input.value = value;
  const caption = element('span', '', label);
  caption.id = 'field-' + uid();
  input.setAttribute('aria-labelledby', caption.id);
  wrapper.append(caption, input);
  form.append(wrapper);
  return input;
}

function actions(form, submit, callback) {
  const container = element('div', 'form-actions');
  const saveButton = element('button', 'primary', submit);
  saveButton.type = 'submit';
  container.append(saveButton, button('Avbryt', () => dialog.close()));
  form.append(container);
  form.addEventListener('submit', event => { event.preventDefault(); callback(); });
  return container;
}

function textRequired(input) {
  input.required = true;
  input.addEventListener('input', () => input.setCustomValidity(''));
  return () => {
    input.setCustomValidity(input.value.trim() ? '' : 'Skriv inn en tittel.');
    return input.reportValidity();
  };
}

function confirmAction(title, message, label, action) {
  const content = element('div');
  const controls = element('div', 'form-actions');
  controls.append(button('Avbryt', () => dialog.close()), button(label, () => {
    dialog.close();
    action();
  }, 'danger'));
  content.append(element('p', '', message), controls);
  openDialog(title, content);
}

function eraseCards(ids) {
  state.cards = state.cards.filter(card => !ids.has(card.id));
  for (const task of state.tasks) if (ids.has(task.sourceId)) delete task.sourceId;
  for (const group of state.groups) group.members = group.members.filter(id => !ids.has(id));
  const removedPins = new Set(state.pins.filter(pin => ids.has(pin.cardId)).map(pin => pin.id));
  state.pins = state.pins.filter(pin => !removedPins.has(pin.id));
  state.threads = state.threads.filter(thread => !removedPins.has(thread.from) && !removedPins.has(thread.to));
  if (source && ids.has(source.cardId)) source = preview = null;
  if (removedPins.has(selectedPin)) selectedPin = null;
  if (!state.threads.some(thread => thread.id === selectedThread)) selectedThread = null;
}

function removeCard(card) {
  confirmAction('Fjern tavlekort', card.type === 'task'
    ? 'Oppgaven beholdes i backlogen. Kortet og trådene på kortet fjernes fra tavla.'
    : 'Kortet og trådene på kortet fjernes fra tavla.', 'Fjern kort', () => {
    eraseCards(new Set([card.id]));
    renderCards();
    save();
  });
}

function linkForm(card, at) {
  const form = element('form');
  const url = field(form, 'Nettadresse', 'url', card?.url);
  url.required = true;
  const title = field(form, 'Tittel (valgfritt)', 'text', card?.title);
  const note = field(form, 'Kildenotat (valgfritt)', 'textarea', card?.note);
  url.addEventListener('input', () => url.setCustomValidity(''));
  const controls = actions(form, card ? 'Lagre' : 'Legg til kilde', () => {
    const href = safeUrl(url.value);
    if (!href) {
      url.setCustomValidity('Bruk en nettadresse som starter med https:// eller http://.');
      url.reportValidity();
      return;
    }
    const fields = { url: href, title: title.value.trim(), note: note.value };
    if (card) Object.assign(card, fields);
    else addCard('link', fields, at);
    dialog.close();
    renderCards();
    save();
  });
  if (card) controls.append(button('Fjern kort', () => removeCard(card), 'danger'));
  openDialog(card ? 'Rediger kilde' : 'Ny kilde', form);
}

function editCard(card) {
  if (card.type === 'link') return linkForm(card);
  if (card.type === 'image' || card.type === 'video') return removeCard(card);
  if (card.type === 'task') return editTask(state.tasks.find(task => task.id === card.taskId), undefined, card);
  const form = element('form');
  const input = field(form, 'Farge', 'select', card.color, Object.entries(colors));
  const controls = actions(form, 'Lagre', () => {
    card.color = input.value;
    dialog.close();
    renderCards();
    save();
  });
  controls.append(button('Fjern kort', () => removeCard(card), 'danger'));
  openDialog('Rediger lapp', form);
}

function videoForm(at) {
  const form = element('form');
  form.append(element('p', '', 'Lim inn en YouTube-lenke eller en direkte lenke til en MP4- eller WebM-fil.'));
  const url = field(form, 'Videolenke', 'url');
  url.required = true;
  url.addEventListener('input', () => url.setCustomValidity(''));
  actions(form, 'Legg til video', () => {
    const href = safeUrl(url.value);
    if (!href) {
      url.setCustomValidity('Bruk en nettadresse som starter med https:// eller http://.');
      url.reportValidity();
      return;
    }
    addCard('video', { url: href }, at);
    dialog.close();
    renderCards();
    save();
  });
  openDialog('Ny videolenke', form);
}

function closeBoardMenu(restoreFocus = false) {
  $('boardMenu').hidden = true;
  if (restoreFocus) menuOrigin?.focus({ preventScroll: true });
}

function addMenu(clientX, clientY, origin, at) {
  const menu = $('boardMenu');
  menuOrigin = origin;
  const item = (label, action) => button(label, () => {
    closeBoardMenu(true);
    action();
  });
  const pick = id => {
    pickerPosition = at;
    delete $(id).dataset.inbox;
    $(id).click();
  };
  const note = item('Gul lapp', () => {
    const card = addCard('note', { text: '', color: 'gul' }, at);
    renderCards();
    land(cardNode(card.id));
    cards.querySelector('[data-id="' + card.id + '"] textarea').focus({ preventScroll: true });
    save();
  });
  menu.replaceChildren(note, item('Kildelenke', () => linkForm(null, at)),
    item('Bilder og skjermbilder', () => pick('images')),
    item('Videofiler', () => pick('videos')),
    item('Direkte videolenke', () => videoForm(at)),
    item('Oppgave fra backlog', () => { location.hash = 'backlog'; }));
  menu.hidden = false;
  const rect = viewport.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(clientX - rect.left, rect.width - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(clientY - rect.top, rect.height - menu.offsetHeight - 8)) + 'px';
  const inbox = item('Innboks', openInbox);
  menu.append(inbox, item('Tilpass alt innhold', fit), item('Tilbakestill visning', reset));
  note.focus({ preventScroll: true });
}

const videoTypes = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', ogv: 'video/ogg' };

async function addMedia(files, at, forceInbox = false) {
  const destination = state;
  const capture = forceInbox || inboxCapture;
  const accepted = [];
  let rejected = false;
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      try {
        await verifyImage(file);
        accepted.push(['image', { image: file, caption: '' }]);
      } catch {
        rejected = true;
      }
    } else {
      const type = file.type.startsWith('video/') ? file.type : videoTypes[file.name.split('.').pop().toLowerCase()];
      if (type && file.size) accepted.push(['video', { video: file.slice(0, file.size, type) }]);
      else rejected = true;
    }
  }
  if (destination !== state) {
    notify('Tavla ble byttet før filene var klare. Legg dem til på nytt.');
    return;
  }
  const step = 27 / camera.scale;
  const added = accepted.map(([type, fields], index) => capture
    ? addInboxCard(type, fields)
    : addCard(type, fields, at ? { x: at.x + step * index, y: at.y + step * index } : undefined));
  if (accepted.length) {
    renderCards();
    updateInboxButton();
    added.filter(card => !card.inbox).forEach(card => land(cardNode(card.id)));
    if (capture) notify(added.length + ' mediefiler lagt i innboksen.');
    save();
  }
  if (rejected) notify('Én eller flere filer kunne ikke legges til som bilde eller video.');
}

function editTask(task, initialStatus = 'Backlog', boardCard, sourceCard) {
  const form = element('form');
  const title = field(form, 'Tittel', 'text', task?.title ?? (sourceCard ? cardName(sourceCard) : ''));
  const validateTitle = textRequired(title);
  const description = field(form, 'Beskrivelse', 'textarea', task?.description ?? (sourceCard?.text || sourceCard?.note || sourceCard?.url || ''));
  const status = field(form, 'Status', 'select', task?.status ?? initialStatus, statuses.map(value => [value, value]));
  const priority = field(form, 'Prioritet', 'select', task?.priority, [['', 'Ingen'], ...priorities.map(value => [value, value])]);
  const date = field(form, 'Planlagt dato', 'date', task?.date);
  const labels = field(form, 'Merkelapper (skilt med komma)', 'text', task?.labels.join(', '));
  const pinned = task && state.cards.find(card => card.taskId === task.id);
  const commit = pin => {
    if (!validateTitle()) return;
    const values = {
      title: title.value.trim(), description: description.value, status: status.value,
      priority: priority.value, date: date.value,
      labels: [...new Set(labels.value.split(',').map(value => value.trim()).filter(Boolean))]
    };
    if (task) Object.assign(task, values);
    else {
      task = { id: uid(), ...values };
      if (sourceCard) task.sourceId = sourceCard.id;
      state.tasks.push(task);
    }
    if (pin) {
      switchView('tavle');
      location.hash = 'tavle';
      addCard('task', { taskId: task.id });
    }
    dialog.close();
    render();
    save();
    if (pin) notify('Oppgaven er festet til tavla.');
  };
  const controls = actions(form, 'Lagre oppgave', () => commit(false));
  const linked = state.cards.find(card => card.id === task?.sourceId);
  if (linked) controls.append(button('Vis kildesporet', () => {
    dialog.close();
    revealCard(linked);
  }));
  if (!pinned) controls.append(button('Lagre og fest på tavla', () => commit(true)));
  if (pinned) controls.append(button('Fjern tavlekort', () => removeCard(boardCard || pinned)));
  if (task) {
    controls.append(button('Slett oppgave', () => confirmAction('Slett oppgave',
      'Oppgaven, eventuelle tavlekort og tilhørende tråder slettes.', 'Slett oppgave', () => {
        eraseCards(new Set(state.cards.filter(card => card.taskId === task.id).map(card => card.id)));
        state.tasks = state.tasks.filter(item => item.id !== task.id);
        render();
        save();
      }), 'danger'));
  }
  openDialog(task ? 'Oppgavedetaljer' : 'Ny oppgave', form);
}

function renderTasks() {
  const labelFilter = $('labelFilter');
  const labelValue = labelFilter.value;
  const labels = [...new Set(state.tasks.flatMap(task => task.labels))].sort((a, b) => a.localeCompare(b, 'nb'));
  labelFilter.replaceChildren(new Option('Alle merkelapper', ''), ...labels.map(label => new Option(label, label)));
  labelFilter.value = labels.includes(labelValue) ? labelValue : '';
  const query = $('search').value.trim().toLocaleLowerCase('nb');
  const priority = $('priorityFilter').value;
  const shown = state.tasks.filter(task =>
    (!priority || task.priority === priority) &&
    (!labelFilter.value || task.labels.includes(labelFilter.value)) &&
    (task.title + '\n' + task.description).toLocaleLowerCase('nb').includes(query));
  $('taskCount').textContent = shown.length === state.tasks.length
    ? state.tasks.length + (state.tasks.length === 1 ? ' oppgave' : ' oppgaver')
    : shown.length + ' av ' + state.tasks.length + ' oppgaver';
  taskList.replaceChildren(...statuses.map(status => {
    const column = element('section', 'column');
    column.dataset.status = status;
    column.setAttribute('aria-label', status);
    const tasks = shown.filter(task => task.status === status);
    const header = element('header');
    const add = button('＋', () => editTask(null, status));
    add.setAttribute('aria-label', 'Legg til oppgave i ' + status);
    header.append(element('strong', '', status), element('span', '', tasks.length), add);
    const tiles = tasks.map(task => {
      const tile = element('article', 'task-tile');
      tile.dataset.task = task.id;
      tile.draggable = true;
      tile.append(button(task.title, () => editTask(task)));
      const badges = element('div', 'badges');
      for (const value of [task.priority, task.date, ...task.labels].filter(Boolean)) badges.append(element('span', '', value));
      tile.append(badges);
      tile.addEventListener('dragstart', event => {
        draggedTask = task.id;
        event.dataTransfer.setData('text/plain', task.id);
        event.dataTransfer.effectAllowed = 'move';
      });
      return tile;
    });
    column.append(header, ...tiles);
    return column;
  }));
}

function clearDragMarkers() {
  for (const node of taskList.querySelectorAll('.drag-over,.drop-before')) node.classList.remove('drag-over', 'drop-before');
}

function dropTarget(event) {
  const column = event.target.closest('.column');
  if (!column || !draggedTask) return null;
  const candidates = [...column.querySelectorAll('.task-tile')].filter(node => node.dataset.task !== draggedTask);
  const before = candidates.find(node => {
    const rect = node.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2;
  });
  return { column, before };
}

taskList.addEventListener('dragover', event => {
  const target = dropTarget(event);
  if (!target) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  clearDragMarkers();
  target.column.classList.add('drag-over');
  target.before?.classList.add('drop-before');
});
taskList.addEventListener('dragend', () => {
  draggedTask = null;
  clearDragMarkers();
});
taskList.addEventListener('dragleave', event => {
  if (!taskList.contains(event.relatedTarget)) clearDragMarkers();
});
taskList.addEventListener('drop', event => {
  const target = dropTarget(event);
  if (!target) return;
  event.preventDefault();
  const task = state.tasks.find(item => item.id === draggedTask);
  draggedTask = null;
  const remaining = state.tasks.filter(item => item !== task);
  task.status = target.column.dataset.status;
  const index = target.before ? remaining.findIndex(item => item.id === target.before.dataset.task)
    : remaining.findLastIndex(item => item.status === task.status) + 1;
  remaining.splice(index, 0, task);
  state.tasks = remaining;
  render();
  land([...taskList.querySelectorAll('.task-tile')].find(tile => tile.dataset.task === task.id));
  save();
});

function render() {
  renderGroups();
  renderCards();
  renderTasks();
  updateInboxButton();
}

function switchView(next) {
  view = next;
  const backlog = view === 'backlog';
  if (backlog) {
    setGroupMode(false);
    closeBoardMenu();
    setNeedleMode(false);
  }
  $('boardView').hidden = backlog;
  $('backlogView').hidden = !backlog;
  $('boardTab').toggleAttribute('aria-current', !backlog);
  $('backlogTab').toggleAttribute('aria-current', backlog);
  $(backlog ? 'backlogTab' : 'boardTab').setAttribute('aria-current', 'page');
}

async function exportBackup() {
  try {
    const blob = new Blob([await serializeWorkspace(workspace)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = element('a');
    link.href = url;
    link.download = 'sakstavla-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Sikkerhetskopien er klar.');
  } catch {
    notify('Kunne ikke eksportere sikkerhetskopien.');
  }
}

async function importBackup(file) {
  let next;
  try {
    next = await deserialize(file);
    if (!next.boards) next = makeWorkspace(next);
  } catch (error) {
    notify(error.message);
    return;
  }
  const apply = async () => {
    document.querySelector('main').inert = true;
    $('backupButton').disabled = true;
    try {
      await writeState(next);
      workspace = next;
      histories.clear();
      activateBoard(next.active);
      $('saveStatus').textContent = 'Lagret lokalt';
      notify('Sikkerhetskopien er importert.');
    } catch (error) {
      notify(storageMessage(error));
    } finally {
      document.querySelector('main').inert = false;
      $('backupButton').disabled = false;
    }
  };
  if (workspace.boards.length > 1 || state.cards.length || state.tasks.length || state.pins.length || state.groups.length) {
    confirmAction('Erstatt innholdet?', 'Importen erstatter alle tavler og oppgavene deres i denne nettleseren.', 'Erstatt og importer', apply);
  } else {
    await apply();
  }
}

$('priorityFilter').append(new Option('Alle prioriteter', ''), ...priorities.map(value => new Option(value, value)));
$('search').addEventListener('input', renderTasks);
$('priorityFilter').addEventListener('change', renderTasks);
$('labelFilter').addEventListener('change', renderTasks);
$('clearFilters').addEventListener('click', () => {
  for (const id of ['search', 'priorityFilter', 'labelFilter']) $(id).value = '';
  renderTasks();
});

$('first').addEventListener('click', event => {
  const rect = event.currentTarget.getBoundingClientRect();
  addMenu(rect.left, rect.bottom + 6, event.currentTarget);
});
viewport.addEventListener('contextmenu', event => {
  if (event.target.closest(' .board-menu, .hint, .thread-group, .pin, .needle-tools')) return;
  const node = event.target.closest('.card');
  if (node) {
    const card = state.cards.find(card => card.id === node.dataset.id);
    if (!card || card.type === 'task') return;
    event.preventDefault();
    openCardMenu(event, card);
    return;
  }
  event.preventDefault();
  const rect = viewport.getBoundingClientRect();
  const keyboard = event.target === viewport && event.clientX === 0 && event.clientY === 0;
  const x = keyboard ? rect.left + 24 : event.clientX;
  const y = keyboard ? rect.top + 24 : event.clientY;
  addMenu(x, y, viewport, position(x, y));
});
document.addEventListener('pointerdown', event => {
  if (!dialog.open && event.button === 0 && (selectedPin || selectedThread || focusPin) &&
      !event.target.closest('.pin, .thread-group, #boardHint')) {
    selectedPin = selectedThread = focusPin = null;
    renderThreads();
    updateModes();
  }
  if (!$('boardMenu').hidden && !event.target.closest('#boardMenu')) closeBoardMenu();
  if ($('boardPicker').open && !event.target.closest('#boardPicker')) closeBoardPicker();
});
$('newTask').addEventListener('click', () => editTask());

window.addEventListener('hashchange', () => switchView(location.hash === '#backlog' ? 'backlog' : 'tavle'));
window.addEventListener('keydown', event => {
  if (dialog.open || document.querySelector('main').inert) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'k') {
    event.preventDefault();
    commandPalette();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && ['z', 'y'].includes(key) &&
      !event.target.closest('input, textarea, [contenteditable]')) {
    event.preventDefault();
    restoreHistory(key === 'y' || event.shiftKey);
    return;
  }
  if (view !== 'tavle') return;
  if (event.key === 'Escape') {
    if (!$('boardMenu').hidden) {
      closeBoardMenu(true);
      return;
    }
    focusPin = null;
    setNeedleMode(false);
    setGroupMode(false);
  }
  if (event.key === 'Delete' && selectedThread && !event.target.closest('input, textarea')) removeThread();
});

for (const id of ['images', 'videos']) {
  $(id).addEventListener('change', event => {
    const toInbox = event.target.dataset.inbox === 'true';
    delete event.target.dataset.inbox;
    addMedia([...event.target.files], pickerPosition, toInbox);
    pickerPosition = undefined;
    event.target.value = '';
  });
}
window.addEventListener('paste', event => {
  if (view !== 'tavle' || dialog.open || document.querySelector('main').inert) return;
  const images = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'));
  if (images.length) {
    event.preventDefault();
    addMedia(images);
  }
});
window.addEventListener('dragover', event => {
  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
});
window.addEventListener('drop', event => {
  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
});
viewport.addEventListener('dragover', event => {
  if (document.querySelector('main').inert || !event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  viewport.classList.add('is-drop');
});
viewport.addEventListener('dragleave', event => {
  if (!viewport.contains(event.relatedTarget)) viewport.classList.remove('is-drop');
});
viewport.addEventListener('drop', event => {
  viewport.classList.remove('is-drop');
  if (document.querySelector('main').inert || !event.dataTransfer.files.length) return;
  event.preventDefault();
  addMedia([...event.dataTransfer.files], position(event.clientX, event.clientY));
});

$('backupButton').addEventListener('click', () => {
  const contents = element('div');
  const controls = element('div', 'form-actions');
  controls.append(button('Eksporter sikkerhetskopi', exportBackup, 'primary'), button('Importer sikkerhetskopi', () => {
    dialog.close();
    $('restore').click();
  }));
  contents.append(element('p', '', 'En sikkerhetskopi inneholder alle kort, medier, nåler, tråder og oppgaver. Data lagres i denne nettleseren.'), controls);
  openDialog('Sikkerhetskopi', contents);
});
$('restore').addEventListener('change', event => {
  const [file] = event.target.files;
  event.target.value = '';
  if (file) importBackup(file);
});

function clearMediaUrls() {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}

function activateBoard(id, fitBoard = true) {
  finishPinDrag();
  focusPin = null;
  inboxCapture = false;
  workspace.active = id;
  const board = workspace.boards.find(board => board.id === id);
  state = board.state;
  state.groups ??= [];
  history();
  clearMediaUrls();
  closeBoardMenu();
  setNeedleMode(false);
  setGroupMode(false);
  reset();
  $('activeBoardName').textContent = board.name;
  $('boardChoices').replaceChildren(...workspace.boards.map(choice => {
    const option = button(choice.name, () => {
      closeBoardPicker(true);
      if (choice.id !== workspace.active) {
        activateBoard(choice.id);
        persist();
      }
    });
    if (choice.id === id) {
      option.setAttribute('aria-current', 'true');
      const check = element('span', 'picker-check', '✓');
      check.setAttribute('aria-hidden', 'true');
      option.append(check);
    }
    return option;
  }));
  for (const field of ['search', 'priorityFilter', 'labelFilter']) $(field).value = '';
  render();
  if (fitBoard && view === 'tavle') fit();
}

function closeBoardPicker(restoreFocus = false) {
  $('boardPicker').open = false;
  if (restoreFocus) $('boardPicker').querySelector('summary').focus();
}

$('boardPicker').addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('boardPicker').open) {
    event.stopPropagation();
    closeBoardPicker(true);
  }
});
$('newBoard').addEventListener('click', () => {
  closeBoardPicker(true);
  const form = element('form');
  const name = field(form, 'Tavlenavn', 'text');
  name.required = true;
  actions(form, 'Opprett tavle', () => {
    if (!name.value.trim()) return;
    const id = uid();
    workspace.boards.push({ id, name: name.value.trim(), state: emptyState() });
    dialog.close();
    activateBoard(id);
    persist();
  });
  openDialog('Ny tavle', form);
});

$('boardSearch').addEventListener('click', () => {
  const content = element('div', 'dialog-grid');
  const input = element('input');
  input.type = 'search';
  input.placeholder = 'Søk i lapper, kilder og oppgaver';
  input.setAttribute('aria-label', 'Søk i tavleinnhold');
  const results = element('div', 'dialog-grid');
  function searchBoard() {
    const query = input.value.trim().toLocaleLowerCase('nb');
    const matches = [];
    if (query) {
      for (const card of state.cards) {
        const task = state.tasks.find(task => task.id === card.taskId);
        if ([card.text, card.title, card.note, card.url, task?.title, task?.description]
          .filter(Boolean).join(' ').toLocaleLowerCase('nb').includes(query)) {
          matches.push(button(cardName(card), () => {
            dialog.close();
            revealCard(card);
          }));
        }
      }
      for (const task of state.tasks) {
        if (state.cards.some(card => card.taskId === task.id)) continue;
        if ((task.title + ' ' + task.description).toLocaleLowerCase('nb').includes(query)) {
          matches.push(button(task.title + ' · Backlog', () => editTask(task)));
        }
      }
    }
    results.replaceChildren(...matches);
    if (query && !matches.length) results.append(element('p', '', 'Ingen treff.'));
  }
  input.addEventListener('input', searchBoard);
  content.append(input, results);
  openDialog('Søk på tavla', content);
});

function setGroupMode(active) {
  if (groupDrag?.group && groupDrag.moved) save();
  groupMode = active;
  groupDrag = null;
  $('groupDraft').hidden = true;
  $('groupTool').setAttribute('aria-pressed', active);
  updateModes();
}

function renderGroups() {
  $('groups').replaceChildren(...state.groups.map(group => {
    const frame = element('section', 'board-group');
    frame.classList.toggle('collapsed', group.collapsed === true);
    const title = button(group.name, () => editGroup(group));
    title.title = 'Dra for å flytte gruppen · klikk for å redigere';
    title.addEventListener('pointerdown', event => {
      if (event.button !== 0 || groupMode || needleMode) return;
      groupDrag = {
        pointer: event.pointerId, start: position(event.clientX, event.clientY), group, frame,
        original: { x: group.x, y: group.y },
        members: state.cards.filter(card => group.members.includes(card.id))
          .map(card => ({ card, x: card.x, y: card.y }))
      };
      event.stopPropagation();
      title.setPointerCapture(event.pointerId);
    });
    frame.append(title);
    if (group.collapsed) frame.append(element('span', 'group-total', group.members.length + ' kort'));
    placeGroup(frame, group);
    return frame;
  }));
}

function groupBounds(group) {
  return group.collapsed ? { ...group, w: 190, h: 56 } : group;
}

function placeGroup(frame, group) {
  group = groupBounds(group);
  Object.assign(frame.style, {
    left: group.x + 'px', top: group.y + 'px', width: group.w + 'px', height: group.h + 'px'
  });
}

function editGroup(group, creating = false) {
  const form = element('form');
  const name = field(form, 'Gruppenavn', 'text', group.name);
  name.required = true;
  const controls = actions(form, 'Lagre', () => {
    if (!name.value.trim()) return;
    group.name = name.value.trim();
    if (creating) state.groups.push(group);
    dialog.close();
    renderGroups();
    updateModes();
    save();
  });
  if (!creating) controls.append(button(group.collapsed ? 'Åpne gruppen' : 'Brett sammen', () => {
    group.collapsed = !group.collapsed;
    focusPin = null;
    setNeedleMode(false);
    dialog.close();
    render();
    save();
  }));
  if (!creating) controls.append(button('Fjern gruppe', () => {
    state.groups = state.groups.filter(item => item !== group);
    dialog.close();
    render();
    updateModes();
    save();
  }, 'danger'));
  openDialog(creating ? 'Ny gruppe' : 'Rediger gruppe', form);
}

$('groupTool').addEventListener('click', () => {
  setNeedleMode(false);
  setGroupMode(!groupMode);
});
$('needleTools').addEventListener('click', () => setGroupMode(false));

viewport.addEventListener('pointerdown', event => {
  if (!groupMode || event.button !== 0 || event.target.closest(toolsSelector)) return;
  const start = position(event.clientX, event.clientY);
  groupDrag = { pointer: event.pointerId, start };
  viewport.setPointerCapture(event.pointerId);
  event.preventDefault();
}, true);
viewport.addEventListener('click', event => {
  if (groupMode && !event.target.closest(toolsSelector)) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

window.addEventListener('pointermove', event => {
  const drag = groupDrag;
  if (drag?.pointer !== event.pointerId) return;
  const point = position(event.clientX, event.clientY);
  const dx = point.x - drag.start.x;
  const dy = point.y - drag.start.y;
  if (!drag.moved && Math.hypot(dx, dy) * camera.scale < 5) return;
  drag.moved = true;
  if (drag.group) {
    Object.assign(drag.group, { x: drag.original.x + dx, y: drag.original.y + dy });
    placeGroup(drag.frame, drag.group);
    const nodes = new Map([...cards.children].map(node => [node.dataset.id, node]));
    for (const member of drag.members) {
      Object.assign(member.card, { x: member.x + dx, y: member.y + dy });
      placeCard(nodes.get(member.card.id), member.card);
    }
    renderThreads();
  } else {
    drag.rect = { x: Math.min(point.x, drag.start.x), y: Math.min(point.y, drag.start.y),
      w: Math.abs(dx), h: Math.abs(dy) };
    const draft = $('groupDraft');
    draft.hidden = false;
    placeGroup(draft, { x: drag.rect.x * camera.scale + camera.x, y: drag.rect.y * camera.scale + camera.y,
      w: drag.rect.w * camera.scale, h: drag.rect.h * camera.scale });
  }
});

function finishGroup(event) {
  const drag = groupDrag;
  if (drag?.pointer !== event.pointerId) return;
  groupDrag = null;
  $('groupDraft').hidden = true;
  if (!drag.moved) return;
  if (drag.group) {
    const suppress = click => { click.preventDefault(); click.stopImmediatePropagation(); };
    drag.frame.addEventListener('click', suppress, { capture: true, once: true });
    setTimeout(() => drag.frame.removeEventListener('click', suppress, true), 0);
    save();
    return;
  }
  if (event.type !== 'pointerup') return;
  const bounds = drag.rect;
  const members = state.cards.filter(card => {
    const size = cardSize(card);
    return !hiddenCard(card.id) && card.x >= bounds.x && card.y >= bounds.y &&
      card.x + size.w <= bounds.x + bounds.w && card.y + size.h <= bounds.y + bounds.h;
  }).map(card => card.id);
  if (!members.length) {
    notify('Dra rundt minst ett helt kort.');
    return;
  }
  setGroupMode(false);
  editGroup({ id: uid(), name: '', ...bounds, members }, true);
}
window.addEventListener('pointerup', finishGroup);
window.addEventListener('pointercancel', finishGroup);

function revealCard(card) {
  const obscuring = state.groups.filter(group => group.collapsed && group.members.includes(card.id));
  if (card.inbox || obscuring.length) {
    if (card.inbox) {
      switchView('tavle');
      Object.assign(card, placement(card.w, card.h));
    }
    delete card.inbox;
    for (const group of obscuring) group.collapsed = false;
    render();
    save();
  }
  switchView('tavle');
  location.hash = 'tavle';
  cancelAnimationFrame(cameraMotion);
  const size = cardSize(card);
  const start = { ...camera };
  const scale = Math.min(1.5, Math.max(1, camera.scale));
  const target = {
    scale,
    x: viewport.clientWidth / 2 - (card.x + size.w / 2) * scale,
    y: viewport.clientHeight / 2 - (card.y + size.h / 2) * scale
  };
  const highlight = () => {
    if (!reducedMotion.matches) cardNode(card.id)?.animate([
      { outline: '4px solid #a52e32' }, { outline: '4px solid transparent' }
    ], 1350);
    else {
      const node = cardNode(card.id);
      node?.classList.add('search-highlight');
      setTimeout(() => node?.classList.remove('search-highlight'), 1350);
    }
  };
  if (reducedMotion.matches) {
    Object.assign(camera, target);
    updateCamera();
    highlight();
    return;
  }
  const began = performance.now();
  const glide = now => {
    const progress = Math.min(1, (now - began) / 360);
    const eased = 1 - (1 - progress) ** 3;
    for (const axis of ['x', 'y', 'scale']) camera[axis] = start[axis] + (target[axis] - start[axis]) * eased;
    updateCamera();
    if (progress < 1) cameraMotion = requestAnimationFrame(glide);
    else {
      cameraMotion = 0;
      highlight();
    }
  };
  cameraMotion = requestAnimationFrame(glide);
}

function openCardMenu(event, card) {
  const menu = $('boardMenu');
  const rect = viewport.getBoundingClientRect();
  menuOrigin = viewport;
  const action = (label, callback) => button(label, () => {
    closeBoardMenu(true);
    callback();
  });
  menu.replaceChildren(action('Gjør til oppgave', () => {
    const existing = state.tasks.find(task => task.sourceId === card.id);
    editTask(existing, 'Backlog', undefined, card);
  }), action('Legg i innboks', () => {
    card.inbox = true;
    focusPin = null;
    setNeedleMode(false);
    render();
    save();
  }));
  if (card.type === 'video') {
    if (card.url) {
      const link = element('a', 'menu-link', youtubeId(card.url) ? 'Åpne på YouTube' : 'Åpne videolenken');
      link.href = card.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.addEventListener('click', () => closeBoardMenu(true));
      menu.append(link);
    }
    menu.append(action('Fjern video', () => removeCard(card)));
  }
  menu.hidden = false;
  menu.style.left = Math.max(8, Math.min(event.clientX - rect.left, rect.width - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(event.clientY - rect.top, rect.height - menu.offsetHeight - 8)) + 'px';
  menu.firstElementChild.focus({ preventScroll: true });
}

function addInboxCard(type, fields) {
  return addCard(type, { ...fields, inbox: true });
}

function updateInboxButton() {
  const size = state.cards.filter(card => card.inbox).length;
  $('inboxButton').textContent = 'Innboks' + (size ? ' (' + size + ')' : '');
  $('inboxButton').classList.toggle('capture-on', inboxCapture);
}

function openInbox() {
  const content = element('div', 'dialog-grid');
  const label = element('label', 'inbox-capture');
  const capture = element('input');
  capture.type = 'checkbox';
  capture.checked = inboxCapture;
  capture.addEventListener('change', () => {
    inboxCapture = capture.checked;
    updateInboxButton();
  });
  label.append(capture, ' Send bilder og videoer fra tavla til innboksen');
  content.append(label);
  const controls = element('div', 'form-actions');
  const pick = id => {
    const input = $(id);
    pickerPosition = undefined;
    input.dataset.inbox = 'true';
    dialog.close();
    input.click();
  };
  controls.append(button('Ny lapp', () => inboxText('note')),
    button('Ny lenke', () => inboxText('link')),
    button('Legg inn bilder', () => pick('images')),
    button('Legg inn video', () => pick('videos')));
  content.append(controls);
  const queued = state.cards.filter(card => card.inbox);
  if (!queued.length) content.append(element('p', '', 'Innboksen er tom.'));
  for (const card of queued) {
    const row = element('div', 'inbox-row');
    row.append(element('strong', '', cardName(card)), button('Legg på tavla', () => {
      Object.assign(card, placement(card.w, card.h));
      delete card.inbox;
      dialog.close();
      render();
      revealCard(card);
      land(cardNode(card.id));
      save();
    }), button('Slett', () => confirmAction('Slett spor?', 'Sporet og eventuelle tråder til det fjernes.', 'Slett spor', () => {
      eraseCards(new Set([card.id]));
      render();
      save();
      openInbox();
    }), 'danger'));
    content.append(row);
  }
  openDialog('Innboks', content);
}

function inboxText(type) {
  const form = element('form');
  const value = field(form, type === 'note' ? 'Notat' : 'Nettadresse', type === 'note' ? 'textarea' : 'url');
  value.required = true;
  value.addEventListener('input', () => value.setCustomValidity(''));
  actions(form, 'Legg i innboks', () => {
    if (!value.value.trim()) return;
    if (type === 'link') {
      const url = safeUrl(value.value);
      if (!url) {
        value.setCustomValidity('Bruk en nettadresse som starter med https:// eller http://.');
        value.reportValidity();
        return;
      }
      addInboxCard(type, { url, title: '', note: '' });
    } else addInboxCard(type, { text: value.value, color: 'gul' });
    render();
    save();
    openInbox();
  });
  openDialog(type === 'note' ? 'Ny lapp i innboksen' : 'Ny lenke i innboksen', form);
}

$('inboxButton').addEventListener('click', openInbox);

function commandPalette() {
  const content = element('div', 'dialog-grid');
  const input = element('input');
  input.type = 'search';
  input.placeholder = 'Søk etter en handling, tavle eller oppgave';
  input.setAttribute('aria-label', 'Søk etter kommando');
  const results = element('div', 'dialog-grid command-results');
  const navigate = next => {
    switchView(next);
    location.hash = next;
  };
  const commands = [
    ['Ny lapp', () => {
      navigate('tavle');
      const card = addCard('note', { text: '', color: 'gul' });
      renderCards();
      land(cardNode(card.id));
      cardNode(card.id).querySelector('textarea').focus({ preventScroll: true });
      save();
    }],
    ['Ny kilde', () => { navigate('tavle'); linkForm(); }],
    ['Ny oppgave', () => editTask()],
    ['Åpne innboksen', openInbox],
    ['Søk på tavla', () => { navigate('tavle'); $('boardSearch').click(); }],
    ['Åpne backlog', () => navigate('backlog')],
    ['Legg til på tavla', () => {
      navigate('tavle');
      const rect = viewport.getBoundingClientRect();
      addMenu(rect.left + 16, rect.top + 90, viewport);
    }],
    ['Tilbakestill visning', () => { navigate('tavle'); reset(); }],
    ['Tilpass alt innhold', () => { navigate('tavle'); fit(); }],
    ['Angre', () => restoreHistory(false)],
    ['Gjør om', () => restoreHistory(true)],
    ...workspace.boards.map(board => ['Bytt tavle · ' + board.name, () => { activateBoard(board.id); persist(); }]),
    ...state.tasks.map(task => ['Finn oppgave · ' + task.title, () => editTask(task)])
  ];
  function filter() {
    const query = input.value.trim().toLocaleLowerCase('nb');
    const matches = commands.filter(([name]) => name.toLocaleLowerCase('nb').includes(query)).slice(0, 30);
    results.replaceChildren(...matches.map(([name, run]) => button(name, () => {
      dialog.close();
      run();
    })));
    if (!matches.length) results.append(element('p', '', 'Ingen treff.'));
  }
  input.addEventListener('input', filter);
  content.addEventListener('keydown', event => {
    const items = [...results.querySelectorAll('button')];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const index = current < 0 ? (step > 0 ? 0 : items.length - 1) : (current + step + items.length) % items.length;
      items[index].focus();
    } else if (event.key === 'Enter' && event.target === input) {
      event.preventDefault();
      items[0].click();
    }
  });
  content.append(input, results);
  filter();
  openDialog('Kommandopalett', content);
}

document.querySelector('main').inert = true;
$('backupButton').disabled = true;
try {
  workspace = await openStorage();
  $('saveStatus').textContent = 'Lagret lokalt';
} catch {
  $('saveStatus').textContent = 'Lokal lagring er utilgjengelig';
  notify('Nettleseren kunne ikke åpne lokal lagring. Sjekk lagringsinnstillingene.');
}
workspace ??= makeWorkspace(emptyState());
switchView(location.hash === '#backlog' ? 'backlog' : 'tavle');
activateBoard(workspace.active, false);
document.querySelector('main').inert = false;
$('backupButton').disabled = false;


