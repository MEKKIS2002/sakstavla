import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const restPath = d => {
  const [x1, y1, , , x2, y2] = d.match(/-?[\d.]+(?:e[+-]?\d+)?/gi).map(Number);
  const sag = Math.min(55, Math.hypot(x2 - x1, y2 - y1) * .12);
  return 'M ' + x1 + ' ' + y1 + ' Q ' + (x1 + x2) / 2 + ' ' + ((y1 + y2) / 2 + sag) + ' ' + x2 + ' ' + y2;
};

const saved = page => expect(page.locator('#saveStatus')).toHaveText('Lagret lokalt');
const pin = (page, name) => page.getByRole('button', { name: 'Nål ved ' + name, exact: true });

async function needleTool(page) {
  await page.getByRole('button', { name: 'Nåler og tråder' }).click();
  await expect(page.getByRole('button', { name: 'Nåler og tråder' })).toHaveAttribute('aria-pressed', 'true');
}

async function placeNeedle(page, type) {
  await page.locator('[data-type=' + type + ']').click({ position: { x: 30, y: 55 } });
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.up();
}

async function center(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function addTask(page, title) {
  await page.getByRole('button', { name: 'Ny oppgave', exact: false }).click();
  await page.getByLabel('Tittel', { exact: true }).fill(title);
  await page.getByLabel('Beskrivelse').fill('Kontroller opptaksdato');
  await page.getByLabel('Prioritet', { exact: true }).selectOption('Høy');
  await page.getByLabel('Planlagt dato').fill('2026-12-01');
  await page.getByLabel('Merkelapper (skilt med komma)').fill('foto, kontroll');
  await page.getByRole('button', { name: 'Lagre oppgave' }).click();
}

test('tavle, tråder, Kanban, IndexedDB og gjenoppretting under undermappe', async ({ page, browser }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/sakstavla/');
  await saved(page);
  await expect(page.getByText('Begynn med et spor')).toBeVisible();

  const screenshot = await page.locator('.empty').screenshot();
  await page.evaluate(bytes => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([new Uint8Array(bytes)], 'skjermbilde.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData, cancelable: true }));
  }, [...screenshot]);
  await expect(page.locator('.card img')).toBeVisible();
  const imageWidth = await page.locator('.card img').evaluate(image => image.naturalWidth);
  expect(imageWidth).toBeGreaterThan(0);
  await expect(page.locator('[data-type=image] .card-head span')).toHaveCount(0);
  const picture = page.locator('.image-surface');
  await picture.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const pictureCenter = await center(picture);
  await drag(page, pictureCenter, { x: pictureCenter.x, y: pictureCenter.y + 24 });
  await expect.poll(async () => (await center(picture)).y).toBeCloseTo(pictureCenter.y + 24, 0);

  await page.getByRole('button', { name: 'Åpne tavlemeny' }).click();
  await page.getByRole('button', { name: 'Kildelenke' }).click();
  await page.getByLabel('Nettadresse').fill('https://example.org/kilde');
  await page.getByLabel('Tittel (valgfritt)').fill('Arkiv');
  await page.getByRole('button', { name: 'Legg til kilde' }).click();
  await expect(page.getByRole('link', { name: 'Arkiv' })).toHaveAttribute('href', 'https://example.org/kilde');
  await page.getByRole('button', { name: 'Åpne tavlemeny' }).click();
  await page.getByRole('button', { name: 'Gul lapp' }).click();
  await expect(page.getByRole('textbox', { name: 'Tekst på lapp' })).toBeFocused();
  await page.keyboard.type('Sjekk datoen');
  await expect(page.locator('#pins .pin')).toHaveCount(0);
  const image = page.locator('.image-frame');
  const handle = image.locator('.resize');
  await page.mouse.move(5, 5);
  await expect(handle).toHaveCSS('opacity', '0');
  await image.hover();
  await expect(handle).toHaveCSS('opacity', '1');
  const before = await image.boundingBox();
  const corner = await center(handle);
  await drag(page, corner, { x: corner.x + 30, y: corner.y + 24 });
  const after = await image.boundingBox();
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
  expect(after.width).toBeGreaterThan(before.width);
  const grip = await handle.boundingBox();
  expect(Math.abs(grip.x + grip.width - after.x - after.width)).toBeLessThan(1);
  expect(Math.abs(grip.y + grip.height - after.y - after.height)).toBeLessThan(1);
  await needleTool(page);
  for (const type of ['image', 'link', 'note']) await placeNeedle(page, type);
  await pin(page, 'Bilde').focus();
  await page.keyboard.press('Enter');
  await pin(page, 'Arkiv').focus();
  await page.keyboard.press('Enter');
  await drag(page, await center(pin(page, 'Arkiv')), await center(pin(page, 'Sjekk datoen')));
  const lines = page.locator('.thread-group .thread-line');
  await expect(lines).toHaveCount(2);
  await page.keyboard.press('Escape');

  const old = await lines.first().getAttribute('d');
  const note = page.locator('[data-type=link] .card-head span');
  const start = await center(note);
  await drag(page, start, { x: start.x + 280, y: start.y + 150 });
  const moved = await lines.first().getAttribute('d');
  expect(moved).not.toBe(old);
  await page.locator('[data-type=link] .resize').focus();
  await page.keyboard.press('ArrowRight');
  const resized = await lines.first().getAttribute('d');
  expect(resized).not.toBe(moved);
  const transform = await page.locator('#world').getAttribute('style');
  await drag(page, { x: 100, y: 570 }, { x: 225, y: 630 });
  await page.getByRole('button', { name: 'Zoom inn' }).click();
  expect(await page.locator('#world').getAttribute('style')).not.toBe(transform);
  await expect(lines.first()).toHaveAttribute('d', restPath(resized));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Tilpass alt innhold' }).click();

  await page.getByRole('link', { name: 'Backlog' }).click();
  await addTask(page, 'Sjekk opptaket');
  const tile = page.locator('.task-tile').filter({ hasText: 'Sjekk opptaket' });
  await tile.dragTo(page.locator('[data-status="Planlagt"]'), { targetPosition: { x: 20, y: 150 } });
  await expect(page.locator('[data-status="Planlagt"]').getByRole('button', { name: 'Sjekk opptaket', exact: true })).toBeVisible();
  await tile.getByRole('button').click();
  await expect(page.getByLabel('Planlagt dato')).toHaveValue('2026-12-01');
  await page.getByRole('button', { name: 'Lagre og fest på tavla' }).click();
  await page.getByRole('button', { name: 'Tilpass alt innhold' }).click();
  await needleTool(page);
  await pin(page, 'Bilde').click();
  await placeNeedle(page, 'task');
  await page.keyboard.press('Escape');
  await expect(lines).toHaveCount(3);
  const taskCard = page.locator('[data-type=task]');
  await taskCard.getByRole('button', { name: 'Sjekk opptaket', exact: true }).click();
  await page.getByLabel('Status', { exact: true }).selectOption('Pågår');
  await page.getByRole('button', { name: 'Lagre oppgave' }).click();
  await expect(taskCard.getByText('Pågår')).toBeVisible();
  const coordinates = await page.locator('.card').evaluateAll(cards => cards.map(card => card.style.cssText));
  const geometry = (await lines.evaluateAll(paths => paths.map(path => path.getAttribute('d')))).map(restPath);
  await saved(page);

  await page.reload();
  await saved(page);
  await expect(page.locator('.card')).toHaveCount(4);
  expect(await page.locator('.card').evaluateAll(cards => cards.map(card => card.style.cssText))).toEqual(coordinates);
  expect(await lines.evaluateAll(paths => paths.map(path => path.getAttribute('d')))).toEqual(geometry);
  await expect(page.locator('.card img')).toHaveJSProperty('naturalWidth', imageWidth);
  await expect(taskCard.getByText('Pågår')).toBeVisible();
  await page.getByRole('link', { name: 'Backlog' }).click();
  await expect(page.locator('[data-status="Pågår"]').getByRole('button', { name: 'Sjekk opptaket', exact: true })).toBeVisible();
  await page.getByRole('searchbox').fill('opptaksdato');
  await page.getByLabel('Filtrer på prioritet').selectOption('Høy');
  await page.getByLabel('Filtrer på merkelapp').selectOption('foto');
  await expect(tile).toBeVisible();
  await page.getByLabel('Filtrer på prioritet').selectOption('Lav');
  await expect(tile).toHaveCount(0);

  await page.getByRole('button', { name: 'Sikkerhetskopi', exact: true }).click();
  const delivery = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Eksporter sikkerhetskopi' }).click();
  const backup = await readFile(await (await delivery).path());
  expect(JSON.parse(backup).boards[0].state.cards.find(card => card.type === 'image').image).toMatch(/^data:image\/png;base64,/);

  const fresh = await browser.newContext();
  const restored = await fresh.newPage();
  await restored.goto(new URL('/sakstavla/', page.url()).href);
  await saved(restored);
  await expect(restored.locator('.card')).toHaveCount(0);
  await restored.locator('#restore').setInputFiles({ name: 'sakstavla.json', mimeType: 'application/json', buffer: backup });
  await expect(restored.locator('.card')).toHaveCount(4);
  await expect(restored.locator('.thread-group')).toHaveCount(3);
  await expect(restored.locator('#pins .pin')).toHaveCount(4);
  await expect(restored.locator('.card img')).toHaveJSProperty('naturalWidth', imageWidth);
  await expect(restored.locator('[data-type=task]').getByText('Pågår')).toBeVisible();
  await restored.reload();
  await expect(restored.locator('.card img')).toHaveJSProperty('naturalWidth', imageWidth);

  await restored.locator('#restore').setInputFiles({ name: 'feil.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1}') });
  await expect(restored.getByText('Filen er ikke en gyldig sikkerhetskopi fra Sakstavla.')).toBeVisible();
  await expect(restored.locator('.card')).toHaveCount(4);
  await restored.locator('#restore').setInputFiles({ name: 'sakstavla.json', mimeType: 'application/json', buffer: backup });
  await expect(restored.getByRole('dialog')).toContainText('Erstatt innholdet?');
  await restored.getByRole('button', { name: 'Avbryt' }).click();
  const thread = restored.locator('.thread-group').first();
  await thread.focus();
  await restored.keyboard.press('Enter');
  await restored.keyboard.press('Delete');
  await expect(restored.locator('.thread-group')).toHaveCount(2);
  await expect(restored.locator('.card')).toHaveCount(4);
  await fresh.close();
  expect(errors).toEqual([]);
});



test('rekkefølge i kolonnen og fjerning av tavlekort', async ({ page }) => {
  await page.goto('/sakstavla/#backlog');
  await saved(page);
  await addTask(page, 'A');
  await addTask(page, 'B');
  const tiles = page.locator('[data-status=Backlog] .task-tile');
  await tiles.nth(1).dragTo(tiles.first(), { targetPosition: { x: 12, y: 3 } });
  await expect(tiles.locator('button')).toHaveText(['B', 'A']);
  await tiles.first().getByRole('button').click();
  await page.getByRole('button', { name: 'Lagre og fest på tavla' }).click();
  await page.getByRole('button', { name: 'Rediger oppgave' }).click();
  await page.getByRole('button', { name: 'Fjern tavlekort' }).click();
  await page.getByRole('button', { name: 'Fjern kort', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(0);
  await saved(page);
  await page.goto('/sakstavla/#backlog');
  await expect(tiles.locator('button')).toHaveText(['B', 'A']);
});

test('trykk og redigering på en smal berøringsskjerm', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto('/sakstavla/');
  await saved(page);
  await page.getByRole('button', { name: /Legg til første element/ }).tap();
  await page.getByRole('button', { name: 'Gul lapp' }).tap();
  await page.getByRole('textbox', { name: 'Tekst på lapp' }).fill('Mobilnotat');
  await page.getByRole('button', { name: 'Åpne tavlemeny' }).tap();
  await page.getByRole('button', { name: 'Kildelenke' }).tap();
  await page.getByLabel('Nettadresse').fill('https://example.org/');
  await page.getByRole('button', { name: 'Legg til kilde' }).tap();
  await page.getByRole('button', { name: 'Tilpass alt innhold' }).tap();
  await needleTool(page);
  await page.locator('[data-type=note]').tap({ timeout: 4000 });
  await pin(page, 'Mobilnotat').tap();
  await page.locator('[data-type=link]').tap({ timeout: 4000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.thread-group')).toHaveCount(1);
  await page.getByRole('link', { name: 'Backlog' }).tap();
  await addTask(page, 'Mobiloppgave');
  await page.getByRole('button', { name: 'Mobiloppgave', exact: true }).tap();
  await page.getByLabel('Status', { exact: true }).selectOption('Planlagt');
  await page.getByRole('button', { name: 'Lagre oppgave' }).tap();
  await expect(page.locator('[data-status=Planlagt] .task-tile')).toHaveCount(1);
  await context.close();
});

test('høyreklikk, videofiler og direkte videolenker', async ({ page }) => {
  await page.goto('/sakstavla/');
  await saved(page);
  await expect(page.locator('#boardView .bar')).toHaveCount(0);
  const buffer = Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const drawing = canvas.getContext('2d');
    const stream = canvas.captureStream(20);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();
    const start = performance.now();
    while (performance.now() - start < 300) {
      drawing.fillStyle = '#ad4333';
      drawing.fillRect(0, 0, 64, 48);
      await new Promise(requestAnimationFrame);
    }
    recorder.stop();
    await stopped;
    for (const track of stream.getTracks()) track.stop();
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  }));
  const viewport = page.locator('#viewport');
  await viewport.click({ button: 'right', position: { x: 55, y: 65 } });
  const files = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Videofiler' }).click();
  await (await files).setFiles({ name: 'opptak.webm', mimeType: 'video/webm', buffer });
  const local = page.locator('.card video').first();
  await expect(page.locator('.card[data-type=video]').first()).toHaveCSS('left', '55px');
  await local.evaluate(video => video.play());
  await expect(local).toHaveJSProperty('videoWidth', 64);
  await local.evaluate(video => video.pause());

  const direct = new URL('/video.webm', page.url()).href;
  await page.route(direct, route => route.fulfill({ contentType: 'video/webm', body: buffer }));
  await viewport.click({ button: 'right', position: { x: 430, y: 65 } });
  await page.getByRole('button', { name: 'Direkte videolenke' }).click();
  await page.getByLabel('Videolenke', { exact: true }).fill(direct);
  await page.getByRole('button', { name: 'Legg til video' }).click();
  const remote = page.locator('.card video').last();
  await expect(remote).toHaveAttribute('src', direct);
  await remote.evaluate(video => video.play());
  await expect(remote).toHaveJSProperty('videoWidth', 64);
  await saved(page);
  await page.reload();
  await expect(page.locator('.card video')).toHaveCount(2);
  await local.evaluate(video => video.play());

  await page.getByRole('button', { name: 'Sikkerhetskopi', exact: true }).click();
  const file = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Eksporter sikkerhetskopi' }).click();
  const backup = await readFile(await (await file).path());
  expect(JSON.parse(backup).boards[0].state.cards[0].video).toMatch(/^data:video\/webm;base64,/);
  await page.getByRole('button', { name: 'Lukk' }).click();
  await page.locator('#restore').setInputFiles({ name: 'sakstavla.json', mimeType: 'application/json', buffer: backup });
  await page.getByRole('button', { name: 'Erstatt og importer' }).click();
  await expect(page.getByText('Sikkerhetskopien er importert.')).toBeVisible();
  await local.evaluate(video => video.play());
  await expect(local).toHaveJSProperty('videoWidth', 64);
  await expect(remote).toHaveAttribute('src', direct);
});

test('frie nåler og import av tråder fra forrige versjon', async ({ page }) => {
  await page.goto('/sakstavla/');
  await saved(page);
  await needleTool(page);
  const viewport = page.locator('#viewport');
  const box = await viewport.boundingBox();
  await drag(page, { x: box.x + 80, y: box.y + 180 }, { x: box.x + 250, y: box.y + 240 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#pins .pin')).toHaveCount(2);
  await expect(page.locator('.thread-group')).toHaveCount(1);
  await saved(page);
  await page.reload();
  await expect(page.locator('#pins .pin')).toHaveCount(2);
  await expect(page.locator('.thread-group')).toHaveCount(1);

  const old = {
    version: 1, tasks: [],
    cards: ['a', 'b', 'c'].map((id, index) => ({
      id, type: 'note', text: id, color: 'gul', x: 50 + index * 230, y: 60, w: 190, h: 140
    })),
    threads: [{ id: 'gammel-traad', from: 'a', to: 'b' }]
  };
  await page.locator('#restore').setInputFiles({
    name: 'gammel.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old))
  });
  await page.getByRole('button', { name: 'Erstatt og importer' }).click();
  await expect(page.locator('.card')).toHaveCount(3);
  await expect(page.locator('#pins .pin')).toHaveCount(2);
  await expect(page.locator('.thread-group')).toHaveCount(1);
});


test('flytting av nål løfter stiften og lar tråden svinge før den faller til ro', async ({ page }) => {
  await page.goto('/sakstavla/');
  await saved(page);
  await needleTool(page);
  const board = page.locator('#viewport');
  await board.click({ position: { x: 100, y: 180 } });
  await page.getByRole('button', { name: 'Nål ved nål på tavla', exact: true }).click();
  await board.click({ position: { x: 360, y: 220 } });
  await page.keyboard.press('Escape');
  const pin = page.locator('#pins .pin').last();
  const thread = page.locator('.thread-group .thread-line');
  await pin.click();
  await expect(page.getByRole('button', { name: 'Slett valgt nål' })).toBeVisible();
  await board.click({ position: { x: 600, y: 310 } });
  await expect(page.getByRole('button', { name: 'Slett valgt nål' })).toHaveCount(0);
  await page.locator('.thread-group').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Slett valgt tråd' })).toBeVisible();
  await board.click({ position: { x: 600, y: 310 } });
  await expect(page.getByRole('button', { name: 'Slett valgt tråd' })).toHaveCount(0);
  const origin = await center(pin);
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + 190, origin.y + 100, { steps: 3 });
  await expect(pin).toHaveClass(/is-lifted/);
  const during = await thread.getAttribute('d');
  expect(during).not.toBe(restPath(during));
  await page.mouse.up();
  await expect(pin).not.toHaveClass(/is-lifted/);
  await expect(pin).toHaveCSS('left', '550px');
  await expect(thread).toHaveAttribute('d', restPath(during));
  await saved(page);
  await page.reload();
  await expect(pin).toHaveCSS('left', '550px');
  await expect(thread).toHaveAttribute('d', restPath(during));
});

test('grupper, tavlesøk, angre, trådnotater og separate tavler', async ({ page }) => {
  await page.goto('/sakstavla/');
  await saved(page);
  await page.getByRole('button', { name: /Legg til første element/ }).click();
  await page.getByRole('button', { name: 'Gul lapp' }).click();
  await page.getByRole('textbox', { name: 'Tekst på lapp' }).fill('Spor ved brygga');
  const card = page.locator('.card');
  await card.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
  const box = await card.boundingBox();
  await page.getByRole('button', { name: 'Grupper', exact: true }).click();
  await drag(page, { x: box.x - 12, y: box.y - 12 }, { x: box.x + box.width + 12, y: box.y + box.height + 12 });
  await page.getByLabel('Gruppenavn').fill('Brygga');
  await page.getByRole('button', { name: 'Lagre', exact: true }).click();
  const title = await center(page.getByRole('button', { name: 'Brygga', exact: true }));
  await drag(page, title, { x: title.x + 70, y: title.y + 55 });
  expect((await card.boundingBox()).x).toBeCloseTo(box.x + 70, 0);
  await page.keyboard.press('Control+z');
  expect((await card.boundingBox()).x).toBeCloseTo(box.x, 0);
  await page.keyboard.press('Control+Shift+z');
  expect((await card.boundingBox()).x).toBeCloseTo(box.x + 70, 0);

  await page.getByRole('button', { name: 'Søk på tavla' }).click();
  await page.getByRole('searchbox', { name: 'Søk i tavleinnhold' }).fill('brygga');
  await page.getByRole('button', { name: 'Spor ved brygga' }).click();
  await expect.poll(async () => (await center(card)).x).toBeCloseTo(680, 0);

  await needleTool(page);
  await drag(page, { x: 300, y: 270 }, { x: 450, y: 350 });
  await page.keyboard.press('Escape');
  await page.locator('.thread-group').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Legg til trådnotat' }).click();
  await page.getByRole('textbox', { name: 'Trådnotat', exact: true }).fill('Samme sted');
  await page.getByRole('button', { name: 'Lagre', exact: true }).click();
  await expect(page.getByText('Samme sted', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Ny tavle', exact: true }).click();
  await page.getByLabel('Tavlenavn').fill('Ny sak');
  await page.getByRole('button', { name: 'Opprett tavle' }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('link', { name: 'Backlog' }).click();
  await addTask(page, 'Kun i ny sak');
  const boards = page.getByLabel('Velg tavle');
  await boards.selectOption({ label: 'Min tavle' });
  await expect(page.getByRole('button', { name: 'Kun i ny sak' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Korktavle' }).click();
  await expect(card).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Brygga', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Sikkerhetskopi', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Eksporter sikkerhetskopi' }).click();
  const backup = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(backup.boards).toHaveLength(2);
  expect(backup.boards[0].state.threads[0].note).toBe('Samme sted');
  expect(backup.boards[0].state.groups[0].name).toBe('Brygga');
  expect(backup.boards[1].state.tasks[0].title).toBe('Kun i ny sak');
  await page.reload();
  await boards.selectOption({ label: 'Ny sak' });
  await page.getByRole('link', { name: 'Backlog' }).click();
  await expect(page.getByRole('button', { name: 'Kun i ny sak' })).toBeVisible();
});

test('kommandopalett, innboks, kildespor, trådfokus og sammenbrettede grupper', async ({ page }) => {
  await page.goto('/sakstavla/');
  await saved(page);
  await page.keyboard.press('Control+k');
  await page.getByRole('searchbox', { name: 'Søk etter kommando' }).fill('innboksen');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Ny lapp', exact: true }).click();
  await page.getByRole('textbox', { name: 'Notat', exact: true }).fill('Spor ved døra');
  await page.getByRole('button', { name: 'Legg i innboks', exact: true }).click();
  await expect(page.locator('.card:visible')).toHaveCount(0);
  await page.getByRole('button', { name: 'Legg på tavla' }).click();
  const card = page.locator('.card:visible');
  await expect(card).toHaveCount(1);
  await card.click({ button: 'right' });
  await page.getByRole('button', { name: 'Gjør til oppgave' }).click();
  await expect(page.getByRole('textbox', { name: 'Tittel', exact: true })).toHaveValue('Spor ved døra');
  await page.getByRole('button', { name: 'Lagre oppgave' }).click();
  await page.getByRole('link', { name: 'Backlog' }).click();
  await page.getByRole('button', { name: 'Spor ved døra', exact: true }).click();
  await page.getByRole('button', { name: 'Vis kildesporet' }).click();
  await expect(card).toBeVisible();

  await needleTool(page);
  await drag(page, { x: 300, y: 250 }, { x: 450, y: 300 });
  await drag(page, { x: 800, y: 220 }, { x: 950, y: 300 });
  await page.keyboard.press('Escape');
  const thread = page.locator('.thread-group').first();
  await thread.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Legg til trådnotat' }).click();
  await page.getByRole('combobox', { name: 'Trådfarge' }).selectOption('gronn');
  await page.getByRole('button', { name: 'Lagre', exact: true }).click();
  await expect(thread).toHaveAttribute('data-color', 'gronn');
  await page.locator('#pins .pin').first().dblclick();
  await expect(thread).toHaveAttribute('data-focus', 'related');
  await expect(page.locator('.thread-group').last()).toHaveAttribute('data-focus', 'dimmed');
  await page.keyboard.press('Escape');

  const box = await card.boundingBox();
  await page.getByRole('button', { name: 'Grupper', exact: true }).click();
  await drag(page, { x: box.x - 12, y: box.y - 12 }, { x: box.x + box.width + 12, y: box.y + box.height + 12 });
  await page.getByLabel('Gruppenavn').fill('Døra');
  await page.getByRole('button', { name: 'Lagre', exact: true }).click();
  const group = page.getByRole('button', { name: 'Døra', exact: true });
  await group.click();
  await page.getByRole('button', { name: 'Brett sammen' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('1 kort', { exact: true })).toBeVisible();
  await saved(page);
  await page.reload();
  await expect(card).toHaveCount(0);
  await group.click();
  await page.getByRole('button', { name: 'Åpne gruppen' }).click();
  await expect(card).toHaveCount(1);
});

test('YouTube-lenke bruker innebygd spiller med lenke til originalen', async ({ page }) => {
  await page.route('https://www.youtube-nocookie.com/embed/**', route => route.fulfill({ body: 'YouTube' }));
  await page.goto('/sakstavla/');
  await saved(page);
  await page.getByRole('button', { name: 'Åpne tavlemeny' }).click();
  await page.getByRole('button', { name: 'Direkte videolenke' }).click();
  await page.getByLabel('Videolenke', { exact: true }).fill('https://www.youtube.com/watch?v=M7lc1UVf-VE');
  await page.getByRole('button', { name: 'Legg til video' }).click();
  const frame = page.locator('iframe[title="YouTube-video"]');
  await expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE');
  const card = page.locator('.card[data-type=video]');
  await expect(card.locator('.card-head')).toHaveCount(0);
  await expect(card.getByRole('link')).toHaveCount(0);
  const grip = await center(card.locator('.video-grip'));
  const before = await card.boundingBox();
  await drag(page, grip, { x: grip.x + 60, y: grip.y + 25 });
  await expect.poll(async () => (await card.boundingBox()).x).toBeCloseTo(before.x + 60, 0);
  await card.locator('.video-grip').click({ button: 'right' });
  await expect(page.getByRole('link', { name: 'Åpne på YouTube' })).toBeVisible();
  await saved(page);
  await page.reload();
  await expect(frame).toBeVisible();
});
