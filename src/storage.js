export const statuses = ['Backlog', 'Planlagt', 'Pågår', 'Ferdig'];
export const priorities = ['Lav', 'Middels', 'Høy'];
export const threadColors = { rod: 'Rød', gronn: 'Bekreftet', bla: 'Mulig sammenheng', gul: 'Må sjekkes' };
export const colors = { gul: 'Gul', rosa: 'Rosa', gronn: 'Grønn', bla: 'Blå' };
export const emptyState = () => ({ version: 2, cards: [], pins: [], threads: [], tasks: [], groups: [] });
export const uid = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');

function upgradeState(value) {
  if (value.version !== 1) return value;
  const linked = new Set(value.threads.flatMap(thread => [thread.from, thread.to]));
  const pins = value.cards.filter(card => linked.has(card.id)).map(card => ({
    id: card.id, cardId: card.id, x: .5, y: 17 / card.h
  }));
  return { ...value, version: 2, pins };
}

export function makeWorkspace(state) {
  const id = uid();
  return { active: id, boards: [{ id, name: 'Min tavle', state }] };
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

let database;
export async function openStorage() {
  database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('sakstavla', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Lagringen er blokkert.'));
  });
  return new Promise((resolve, reject) => {
    const request = database.transaction('workspace').objectStore('workspace').get('current');
    request.onsuccess = () => {
      const stored = request.result ?? emptyState();
      resolve(stored.boards ? stored : makeWorkspace(upgradeState(stored)));
    };
    request.onerror = () => reject(request.error);
  });
}

export function writeState(value) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('workspace', 'readwrite');
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    transaction.objectStore('workspace').put(value, 'current');
  });
}

export function storageMessage(error) {
  return error?.name === 'QuotaExceededError'
    ? 'Lagringsplassen er full. Eksporter en sikkerhetskopi og frigjør plass før du prøver igjen.'
    : 'Kunne ikke skrive til lokal lagring. Eksporter en sikkerhetskopi av endringene.';
}

function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function serialize(state) {
  const snapshot = structuredClone(state);
  for (const card of snapshot.cards) {
    if (card.type === 'image') card.image = await toDataUrl(card.image);
    if (card.type === 'video' && card.video) card.video = await toDataUrl(card.video);
  }
  return JSON.stringify(snapshot);
}

const string = value => typeof value === 'string';
const id = value => string(value) && value.length > 0 && value.length < 128;
const finite = value => Number.isFinite(value) && Math.abs(value) < 1e8;
const validDate = value => value === '' || (string(value) && /^\d{4,}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)));
function requireValid(condition) {
  if (!condition) throw new Error('Filen er ikke en gyldig sikkerhetskopi fra Sakstavla.');
}

export function verifyImage(blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  return image.decode().finally(() => URL.revokeObjectURL(url));
}

export async function serializeWorkspace(workspace) {
  const boards = await Promise.all(workspace.boards.map(async ({ id, name, state }) =>
    ({ id, name, state: JSON.parse(await serialize(state)) })));
  return JSON.stringify({ version: 3, active: workspace.active, boards });
}

export async function deserialize(file) {
  let value;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error('Kunne ikke lese filen som en sikkerhetskopi i JSON-format.');
  }
  if (value?.version === 3) {
    requireValid(Array.isArray(value.boards) && value.boards.length > 0);
    const ids = new Set();
    const boards = [];
    for (const board of value.boards) {
      requireValid(board && id(board.id) && !ids.has(board.id) && string(board.name) &&
        board.name.trim() && [1, 2].includes(board.state?.version));
      ids.add(board.id);
      boards.push({ id: board.id, name: board.name, state: await validateBoard(board.state) });
    }
    requireValid(ids.has(value.active));
    return { active: value.active, boards };
  }
  return validateBoard(value);
}

async function validateBoard(value) {
  requireValid([1, 2].includes(value?.version) && [value.cards, value.threads, value.tasks].every(Array.isArray));
  const result = emptyState();
  const taskIds = new Set();
  for (const task of value.tasks) {
    requireValid(task && id(task.id) && !taskIds.has(task.id) && string(task.title) && task.title.trim() &&
      string(task.description) && statuses.includes(task.status) && ['', ...priorities].includes(task.priority) &&
      validDate(task.date) && Array.isArray(task.labels) && task.labels.every(string));
    taskIds.add(task.id);
    const { id: taskId, title, description, status, priority, date, labels } = task;
    result.tasks.push({ id: taskId, title, description, status, priority, date, labels });
  }
  const cardIds = new Set();
  for (const card of value.cards) {
    requireValid(card && id(card.id) && !cardIds.has(card.id) && [card.x, card.y, card.w, card.h].every(finite) &&
      (['image', 'video'].includes(card.type) ? card.w >= 40 && card.h >= 40 : card.w >= 150 && card.h >= 116));
    cardIds.add(card.id);
    const { id: cardId, x, y, w, h, type } = card;
    const clean = { id: cardId, x, y, w, h, type };
    switch (type) {
      case 'note':
        requireValid(string(card.text) && Object.hasOwn(colors, card.color));
        Object.assign(clean, { text: card.text, color: card.color });
        break;
      case 'link':
        requireValid(safeUrl(card.url) && string(card.title) && string(card.note));
        Object.assign(clean, { url: safeUrl(card.url), title: card.title, note: card.note });
        break;
      case 'image': {
        requireValid(string(card.caption) && string(card.image) && /^data:image\/[\w.+-]+;base64,[a-z0-9+/=]+$/i.test(card.image));
        try {
          clean.image = await (await fetch(card.image)).blob();
          await verifyImage(clean.image);
        } catch {
          throw new Error('Et bilde i sikkerhetskopien kunne ikke åpnes.');
        }
        clean.caption = card.caption;
        break;
      }
      case 'video':
        if (card.video !== undefined) {
          requireValid(string(card.video) && /^data:video\/[\w.+-]+;base64,[a-z0-9+/=]+$/i.test(card.video));
          try {
            clean.video = await (await fetch(card.video)).blob();
          } catch {
            throw new Error('En videofil i sikkerhetskopien kunne ikke leses.');
          }
          requireValid(clean.video.size > 0);
        } else {
          requireValid(safeUrl(card.url));
          clean.url = safeUrl(card.url);
        }
        break;
      case 'task':
        requireValid(taskIds.has(card.taskId));
        clean.taskId = card.taskId;
        break;
      default:
        requireValid(false);
    }
    requireValid(card.inbox === undefined || typeof card.inbox === 'boolean');
    if (card.inbox) clean.inbox = true;
    result.cards.push(clean);
  }
  if (value.version === 1) {
    requireValid(value.threads.every(thread => thread && cardIds.has(thread.from) && cardIds.has(thread.to)));
    value = upgradeState({ ...result, version: 1, threads: value.threads });
  }
  requireValid(Array.isArray(value.pins));
  const pinIds = new Set();
  for (const pin of value.pins) {
    requireValid(pin && id(pin.id) && !pinIds.has(pin.id) && finite(pin.x) && finite(pin.y));
    if (pin.cardId !== undefined) {
      requireValid(cardIds.has(pin.cardId) && [pin.x, pin.y].every(offset => offset >= 0 && offset <= 1));
    }
    const { id: pinId, cardId, x, y } = pin;
    result.pins.push({ id: pinId, cardId, x, y });
    pinIds.add(pinId);
  }
  for (const task of value.tasks) {
    requireValid(task.sourceId === undefined || cardIds.has(task.sourceId));
    if (task.sourceId !== undefined) result.tasks.find(item => item.id === task.id).sourceId = task.sourceId;
  }
  const threadIds = new Set();
  const pairs = new Set();
  for (const thread of value.threads) {
    requireValid(thread && id(thread.id) && !threadIds.has(thread.id) &&
      pinIds.has(thread.from) && pinIds.has(thread.to) && thread.from !== thread.to);
    const pair = JSON.stringify([thread.from, thread.to].sort());
    requireValid(!pairs.has(pair));
    pairs.add(pair);
    threadIds.add(thread.id);
    requireValid(thread.note === undefined || string(thread.note));
    requireValid(thread.color === undefined || Object.hasOwn(threadColors, thread.color));
    result.threads.push({ id: thread.id, from: thread.from, to: thread.to, note: thread.note ?? '', color: thread.color ?? 'rod' });
  }
  requireValid(value.groups === undefined || Array.isArray(value.groups));
  const groupIds = new Set();
  for (const group of value.groups ?? []) {
    requireValid(group && id(group.id) && !groupIds.has(group.id) && string(group.name) && group.name.trim() &&
      [group.x, group.y, group.w, group.h].every(finite) && group.w > 0 && group.h > 0 && (group.collapsed === undefined || typeof group.collapsed === 'boolean') &&
      Array.isArray(group.members) && group.members.every(member => cardIds.has(member)));
    groupIds.add(group.id);
    result.groups.push({ id: group.id, name: group.name, x: group.x, y: group.y, w: group.w, h: group.h,
      collapsed: group.collapsed === true, members: [...new Set(group.members)] });
  }
  return result;
}
