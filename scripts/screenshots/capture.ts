import type { N2Client } from '@n2/client';
import type { Theme } from '@n2/contracts';
import type { Browser, Locator, Page } from 'playwright';

const VIEWPORT = { width: 1600, height: 1000 };
// Pinned so anything the interface derives from today's date is the same on every run.
const FIXED_NOW = new Date('2026-11-04T15:00:00Z');
// Lossy WebP keeps a 3200 x 2000 UI capture well under 300 KB with no visible ringing.
const WEBP_QUALITY = 0.9;

// Interface chrome that would distract in a still image: the canvas hint and text carets.
const STILL_IMAGE_CSS = `
  .canvas-hint { visibility: hidden !important; }
  * { caret-color: transparent !important; }
`;

// A cropped shot keeps only content, so floating canvas controls at its edges would show as slivers.
const CROPPED_SHOT_CSS = `
  .canvas-view-controls, .react-flow__controls, .canvas-toolbar { visibility: hidden !important; }
`;

export type Clip = { x: number; y: number; width: number; height: number };

export type Shot = {
  name: string;
  theme: Theme;
  /** Brings the page into the state to capture. */
  prepare?: (page: Page) => Promise<void>;
  /** The part of the page to keep, in CSS pixels; the whole viewport when absent. */
  frame?: (page: Page) => Promise<Clip>;
};

export type CaptureTarget = {
  browser: Browser;
  client: N2Client;
  origin: string;
  projectId: string;
};

/** Opens the Project in a fresh page with the given Theme, captures it and returns WebP bytes. */
export async function captureShot(target: CaptureTarget, shot: Shot): Promise<Buffer> {
  await target.client.updateApplicationPreference({ key: 'theme', value: shot.theme });
  const context = await target.browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce'
  });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`${target.origin}/projects/${target.projectId}`);
    await page.addStyleTag({ content: STILL_IMAGE_CSS });
    await settle(page);
    await shot.prepare?.(page);
    await settle(page);
    if (shot.frame) await page.addStyleTag({ content: CROPPED_SHOT_CSS });
    const clip = await shot.frame?.(page);
    return await toWebp(page, await page.screenshot({ type: 'png', ...(clip ? { clip } : {}) }));
  } finally {
    await context.close();
  }
}

/** Waits until the canvas has drawn its items, fonts have loaded and layout has stopped moving. */
async function settle(page: Page): Promise<void> {
  await page.locator('.react-flow__node').first().waitFor();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Two animation frames let React Flow apply its last measured layout.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await page.waitForTimeout(400);
}

/** Re-encodes a PNG as WebP with the browser's own encoder, so no image library is needed. */
async function toWebp(page: Page, png: Buffer): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    async ({ source, quality }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      return canvas.toDataURL('image/webp', quality);
    },
    { source: `data:image/png;base64,${png.toString('base64')}`, quality: WEBP_QUALITY }
  );
  const prefix = 'data:image/webp;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error('This browser cannot encode WebP.');
  return Buffer.from(dataUrl.slice(prefix.length), 'base64');
}

/** Switches the canvas to a Structured view, which frames itself to the board's width. */
export async function showView(
  page: Page,
  label: 'Kanban' | 'Roadmap' | 'Swimlanes'
): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Canvas view' })
    .getByRole('button', { name: label })
    .click();
  await parkPointer(page);
}

/** Selects a canvas item by its reference, which opens the Inspector beside the canvas. */
export async function inspect(page: Page, reference: string): Promise<void> {
  // The title is its own control (double-click renames it), so press the card's top strip.
  await card(page, reference).click({ position: { x: 16, y: 10 } });
  await inspector(page).waitFor();
  await parkPointer(page);
}

// The Inspector shot keeps a 16:10 frame as tall as the panel, with the work it explains beside it.
const INSPECTOR_FRAME_RATIO = 1.6;
const INSPECTOR_MARGIN = 12;

/**
 * Drags the canvas, as a person would, so the card `reference` sits just right of the Inspector and
 * near its top. Work further left then hides behind the panel instead of showing at its edge.
 */
export async function panBesideInspector(page: Page, reference: string): Promise<void> {
  const panel = await boxOf(inspector(page));
  const target = await boxOf(card(page, reference));
  const dx = panel.x + panel.width + 64 - target.x;
  const dy = panel.y + 40 - target.y;
  // Start on empty canvas just above the card and its Group region.
  const start = { x: target.x + 20, y: target.y - 40 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await page.mouse.up();
  await parkPointer(page);
}

/** The Inspector panel and the canvas to its right, from its top to its bottom. */
export async function inspectorFrame(page: Page): Promise<Clip> {
  const panel = await boxOf(inspector(page));
  const height = Math.round(panel.height + INSPECTOR_MARGIN * 2);
  // Start at the panel's own edge; left of it, the canvas shows only slivers of hidden cards.
  return {
    x: Math.round(panel.x),
    y: Math.round(panel.y - INSPECTOR_MARGIN),
    width: Math.round(height * INSPECTOR_FRAME_RATIO),
    height
  };
}

/**
 * The status columns, without Notes, down to the last card of the longest column other than Done.
 * Cards sit on one row grid, so that edge also falls between two Done cards rather than through one.
 */
export async function kanbanFrame(page: Page): Promise<Clip> {
  const column = (id: string) => boxOf(page.locator(`[data-kanban-column="${id}"]`));
  const [ready, done] = await Promise.all([column('ready'), column('done')]);
  const cards = await Promise.all(
    (await page.locator('.react-flow__node').all()).map((node) => boxOf(node))
  );
  const lastRow = Math.max(
    ...cards
      .filter(({ x, width }) => x + width / 2 >= ready.x && x + width / 2 < done.x)
      .map(({ y, height }) => y + height)
  );
  const x = Math.round(ready.x - 16);
  const y = Math.round(ready.y - 12);
  return {
    x,
    y,
    width: Math.round(done.x + done.width + 16 - x),
    height: Math.round(lastRow + 16 - y)
  };
}

const card = (page: Page, reference: string) =>
  page
    .locator('.react-flow__node')
    .filter({ has: page.locator(`.n2-node__reference[title="${reference}"]`) });

const inspector = (page: Page) => page.locator('aside.inspector');

async function boxOf(locator: Locator): Promise<Clip> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Not on screen: ${locator.toString()}`);
  return box;
}

// Rests the pointer on the empty middle of the top bar, so no card or edge shows a hover state.
async function parkPointer(page: Page): Promise<void> {
  await page.mouse.move(VIEWPORT.width / 2, 24);
}
