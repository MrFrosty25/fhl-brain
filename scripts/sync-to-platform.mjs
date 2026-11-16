#!/usr/bin/env node
// Copy this repo's src/*.ts into frosty-saas, stamped with the commit.
//   node scripts/sync-to-platform.mjs /path/to/frosty-saas
// The platform's copy is never edited by hand: change it here, sync, open a
// PR in frosty-saas. frosty-saas's test checks every file carries the stamp
// AND that its body equals this repo's source (after `toPlatform` below).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Always this repo, wherever the command is run from (Ask Frosty lesson 4).
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The ONE transform: node's test runner needs `from './registry.ts'`, the
 * platform's TypeScript refuses a `.ts` extension in an import. Nothing else
 * changes. The platform test applies the same rule before comparing.
 */
export function toPlatform(body) {
  return body.replace(/(from\s+'\.\/[A-Za-z0-9_-]+)\.ts'/g, "$1'")
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const platform = process.argv[2]
  if (!platform) {
    console.error('usage: node scripts/sync-to-platform.mjs /path/to/frosty-saas')
    process.exit(1)
  }
  const sha = execSync('git rev-parse --short HEAD', { cwd: repo }).toString().trim()
  const out = join(platform, 'src/lib/brain-core')
  mkdirSync(out, { recursive: true })
  for (const f of readdirSync(join(repo, 'src')).filter((n) => n.endsWith('.ts'))) {
    const body = toPlatform(readFileSync(join(repo, 'src', f), 'utf8'))
    const stamp = `// SYNCED from MrFrosty25/fhl-brain@${sha} — src/${f}. Do not edit here;\n// change it in that repo and run scripts/sync-to-platform.mjs.\n\n`
    writeFileSync(join(out, f), stamp + body)
    console.log(`synced ${f}`)
  }
}
