/**
 * Test setup — the minimum a page needs to render outside a browser.
 *
 * Everything stubbed here is stubbed because jsdom genuinely does not implement
 * it, NOT to make failures go away. If a page breaks for a real reason, it must
 * still break here — that is the entire point of the harness.
 */
import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom implements neither of these; charting and responsive layout need both.
// `globalThis` rather than Node's `global`: this file is linted with the app's
// browser config, and it is the portable spelling regardless.
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
if (!window.matchMedia) {
    window.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
}
// lightweight-charts measures the canvas; jsdom has no layout engine.
if (!HTMLCanvasElement.prototype.getContext) HTMLCanvasElement.prototype.getContext = () => null;
window.scrollTo = window.scrollTo || (() => {});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
