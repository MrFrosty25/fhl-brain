import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error — a plain .mjs script, no types
import { toPlatform } from '../scripts/sync-to-platform.mjs'

test('the sync drops only the .ts extension from sibling imports', () => {
  assert.equal(toPlatform("import { A } from './registry.ts'\n"), "import { A } from './registry'\n")
  assert.equal(toPlatform("const s = 'x.ts'\n"), "const s = 'x.ts'\n")
})

test('src imports nothing from outside its own folder', () => {
  const dir = join(import.meta.dirname, '..', 'src')
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const body = readFileSync(join(dir, f), 'utf8')
    for (const m of body.matchAll(/from\s+'([^']+)'/g)) assert.match(m[1], /^\.\/[A-Za-z0-9_-]+\.ts$/, `${f}: ${m[1]}`)
  }
})
