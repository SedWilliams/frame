/*
 * End-to-end tests. Playwright starts the dev server, opens the editor on the demo
 * page in Chromium, and drives it the way a user would. See playwright.config.ts.
 */

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('loads the demo without runtime errors and selects the hero heading', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.reload();
  await expect(page.locator('.artboard h1')).toHaveText('Good spaces. Better living.');
  await expect(page.locator('.layer-row.selected')).toContainText('Hero heading');
  await expect(page.getByLabel('Resize selected element')).toBeVisible();
  await expect(page.locator('.artboard img').first()).toHaveJSProperty('naturalWidth', 1200);
  expect(errors).toEqual([]);
});

test('edits typography, supports undo and redo, and cancels fields with Escape', async ({
  page,
}) => {
  const size = page.getByRole('textbox', { name: 'Size', exact: true });
  await size.fill('48');
  await size.press('Enter');
  await expect(page.locator('.artboard h1')).toHaveCSS('font-size', '48px');
  await page.getByRole('button', { name: 'Undo (⌘Z)', exact: true }).click();
  await expect(page.locator('.artboard h1')).toHaveCSS('font-size', '64px');
  await page.getByRole('button', { name: 'Redo (⌘⇧Z)', exact: true }).click();
  await expect(page.locator('.artboard h1')).toHaveCSS('font-size', '48px');
  await size.fill('90');
  await size.press('Escape');
  await expect(page.locator('.artboard h1')).toHaveCSS('font-size', '48px');
});

test('edits text directly and persists the draft after reload', async ({ page }) => {
  const heading = page.locator('.artboard h1');
  await heading.dblclick();
  await heading.fill('A home for new ideas.');
  await heading.press('Enter');
  await expect(heading).toHaveText('A home for new ideas.');
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('.artboard h1')).toHaveText('A home for new ideas.');
});

test('inserts, duplicates and removes elements', async ({ page }) => {
  await page.getByRole('button', { name: 'Insert text', exact: true }).click();
  await expect(
    page.locator('.artboard').getByText('A little room for your next big idea.'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(
    page.locator('.artboard').getByText('A little room for your next big idea.'),
  ).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(
    page.locator('.artboard').getByText('A little room for your next big idea.'),
  ).toHaveCount(1);
});

test('drags layers to reorder without dropping source content', async ({ page }) => {
  const heading = page.locator('.layer-select').filter({ hasText: /^Hero heading$/ });
  const description = page.locator('.layer-select').filter({ hasText: /^Hero description$/ });
  await description.dragTo(heading);
  const tags = await page
    .locator('.artboard h1')
    .evaluate((el) => [...el.parentElement!.children].map((child) => child.tagName));
  expect(tags.indexOf('P')).toBeLessThan(tags.indexOf('H1'));
});

test('drags an asset onto a canvas container', async ({ page }) => {
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page
    .getByRole('button', { name: 'Text', exact: true })
    .dragTo(page.locator('.artboard main'), { targetPosition: { x: 12, y: 12 } });
  await expect(
    page.locator('.artboard').getByText('A little room for your next big idea.'),
  ).toBeVisible();
});

test('resizes the selection and exports changed dimensions', async ({ page }) => {
  const handle = page.getByRole('button', { name: 'Resize selected element', exact: true });
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 45, box!.y + 30, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('textbox', { name: 'W', exact: true })).not.toHaveValue('auto');
  await expect(page.locator('.artboard h1')).toHaveCSS('max-width', 'none');
});

test('switches responsive viewports and preview mode', async ({ page }) => {
  await page.getByRole('button', { name: 'Mobile viewport' }).click();
  await expect(page.locator('.artboard')).toHaveCSS('width', '390px');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.right-panel')).toHaveCount(0);
  await expect(page.locator('.selection-outline')).toHaveCount(0);
  await expect(page.locator('.artboard h1')).toBeVisible();
  await page.getByRole('button', { name: 'Exit preview' }).click();
  await expect(page.locator('.right-panel')).toBeVisible();
});

test('imports a TSX component and preserves handlers in generated code', async ({ page }) => {
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await page.getByRole('button', { name: 'Paste JSX', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'React source' })
    .fill(
      'import { useState } from "react"; export default function Card() { const [n, setN] = useState(0); return <section style={{ padding: 32 }}><h1 onClick={() => setN(n + 1)}>Imported heading</h1><p>{n}</p></section>; }',
    );
  await page.getByRole('button', { name: 'Open in canvas' }).click();
  await page.locator('.artboard h1').click();
  await page.getByRole('textbox', { name: 'Text content' }).fill('Updated heading');
  await page.getByRole('textbox', { name: 'Text content' }).blur();
  await page.locator('.toolbar-end').getByRole('button', { name: 'Code', exact: true }).click();
  const code = page.getByLabel('Generated React source');
  await expect(code).toContainText('onClick={() => setN(n + 1)}');
  await expect(code).toContainText('Updated heading');
  await expect(code).toContainText('{n}');
});

test('downloads valid generated source', async ({ page }) => {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export code' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('HomePage.tsx');
  expect(await download.failure()).toBeNull();
});

test('can save a permission-granted file and blocks an external edit', async ({ page }) => {
  // Chromium only shows its real file picker after a user gesture, so swap in a fake
  // picker whose file lives in page memory. externalEdit simulates another editor
  // changing the file between saves.
  await page.evaluate(() => {
    let contents = 'export default () => <h1>Hello from disk</h1>';
    const state = window as unknown as {
      showOpenFilePicker: () => Promise<unknown[]>;
      savedSource: string;
      externalEdit: () => void;
    };
    state.externalEdit = () => {
      contents = 'external change';
    };
    state.showOpenFilePicker = async () => [
      {
        name: 'Disk.tsx',
        getFile: async () => new File([contents], 'Disk.tsx'),
        createWritable: async () => ({
          write: async (source: string) => {
            contents = source;
            state.savedSource = source;
          },
          close: async () => {},
          abort: async () => {},
        }),
      },
    ];
  });
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await page.getByRole('button', { name: 'Open a .jsx or .tsx file' }).click();
  await expect(page.locator('.artboard h1')).toHaveText('Hello from disk');
  await page.getByRole('textbox', { name: 'Text content' }).fill('Saved from canvas');
  await page.getByRole('textbox', { name: 'Text content' }).press('ControlOrMeta+s');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { savedSource: string }).savedSource))
    .toContain('Saved from canvas');
  await page.evaluate(() => (window as unknown as { externalEdit: () => void }).externalEdit());
  await page.getByRole('button', { name: 'Save to file', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed outside Frame');
});

test('locks selected layers and restores hidden layers', async ({ page }) => {
  const row = page.locator('.layer-row.selected');
  await row.hover();
  await row.getByRole('button', { name: 'Lock Hero heading' }).click();
  await expect(page.getByRole('textbox', { name: 'Size', exact: true })).toBeDisabled();
  await row.getByRole('button', { name: 'Unlock Hero heading' }).click();
  await row.getByRole('button', { name: 'Hide Hero heading' }).click();
  await expect(page.locator('.artboard h1')).toHaveCount(0);
  await row.getByRole('button', { name: 'Show Hero heading' }).click();
  await expect(page.locator('.artboard h1')).toBeVisible();
});
