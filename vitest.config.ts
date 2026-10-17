/*
 * Vitest config. Runs the unit tests in tests/ and leaves tests/e2e to Playwright.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['tests/*.test.ts'] } });
