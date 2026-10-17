/*
 * Image export.
 *
 * Exports a layer as PNG, JPG, or SVG at a scale, or copies it to the clipboard
 * as PNG, the way Figma's Export section and Copy as PNG do. HTML layers go
 * through html-to-image, which draws the element with its computed styles.
 * Vector layers export their own SVG markup.
 */

import { toBlob, toJpeg, toPng, toSvg } from 'html-to-image';
import { findRender, get, toast } from './state';
import { elementOf, frameHandles } from '../canvas/registry';
import type { RNode } from '../core/render';

/** The element to draw for a layer. Instances use their first element. */
function elementFor(node: RNode, frame: string): HTMLElement | undefined {
  const own = elementOf(frame, node.key);
  if (own) return own;
  for (const child of node.children) {
    const el = elementFor(child, frame);
    if (el) return el;
  }
}

function fileName(node: RNode, format: string, scale: number) {
  const base = node.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'layer';
  return `${base}${scale !== 1 ? `@${scale}x` : ''}.${format}`;
}

function save(url: string, name: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
}

export async function exportLayer(key: string, format: 'png' | 'jpg' | 'svg', scale = 1) {
  const state = get();
  const found = findRender(state, key);
  if (!found) return;
  const frame = frameHandles.has(state.activeFrame) ? state.activeFrame : found.frame.id;
  const element = elementFor(found.node, frame);
  if (!element) {
    toast('This layer has nothing to export.', 'error');
    return;
  }
  try {
    if (format === 'svg' && element.tagName.toLowerCase() === 'svg') {
      const markup = new XMLSerializer().serializeToString(element);
      save(URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' })), fileName(found.node, 'svg', 1));
      return;
    }
    const options = { pixelRatio: scale, cacheBust: true, skipFonts: false };
    const url = format === 'png' ? await toPng(element, options) : format === 'jpg' ? await toJpeg(element, { ...options, quality: 0.92, backgroundColor: '#ffffff' }) : await toSvg(element, options);
    save(url, fileName(found.node, format, format === 'svg' ? 1 : scale));
  } catch (error) {
    toast(`Export failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

export async function exportSelection(format: 'png' | 'jpg' | 'svg', scale = 2) {
  for (const key of get().selection) await exportLayer(key, format, scale);
}

export async function copyAsPng() {
  const state = get();
  const found = state.selection[0] ? findRender(state, state.selection[0]) : undefined;
  const element = found ? elementFor(found.node, state.activeFrame) : undefined;
  if (!element) return;
  try {
    const blob = await toBlob(element, { pixelRatio: 2 });
    if (!blob) throw new Error('nothing to copy');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Copied as PNG.', 'success');
  } catch (error) {
    toast(`Couldn't copy: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}
