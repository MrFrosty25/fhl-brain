import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error — a plain .mjs script, no types
import { fingerprint, stampFor, toPlatform } from '../scripts/sync-to-platform.mjs'

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

test('the stamp carries the body fingerprint, FNV-1a 32-bit as 8 hex', () => {
  // Published FNV-1a vectors: "" and "a".
  assert.equal(fingerprint(''), '811c9dc5')
  assert.equal(fingerprint('a'), 'e40c292c')
  assert.equal(fingerprint('foobar'), 'bf9cf968')
  const stamp = stampFor('abc1234', 'core.ts', 'export const x = 1\n')
  assert.equal(
    stamp,
    `// SYNCED from MrFrosty25/fhl-brain@abc1234 — src/core.ts. Do not edit here;\n// change it in that repo and run scripts/sync-to-platform.mjs. fnv1a:${fingerprint('export const x = 1\n')}\n\n`,
  )
  assert.notEqual(fingerprint('export const x = 1\n'), fingerprint('export const x = 2\n'))
})
