import { defineConfig } from 'vitest/config'

// Tests here cover the office's pure modules (layout, navigation grid, pathfinding,
// decoration, sprite manifest). They need no DOM, so the fast node environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
  },
})
