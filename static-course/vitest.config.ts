import path from 'node:path'
import { defineConfig } from 'vitest/config'

const repository = path.resolve(__dirname, '..')

export default defineConfig({
  resolve: { alias: { '@': path.join(repository, 'src') } },
  test: {
    environment: 'node',
    include: ['static-course/**/*.test.ts'],
  },
})
