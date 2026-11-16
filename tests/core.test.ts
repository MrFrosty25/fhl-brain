import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REGISTRY } from '../src/registry.ts'
import {
  brainValue,
  checkDefaults,
  exportBrain,
  importAsDrafts,
  planDiscard,
  planDraft,
  planPublish,
  planRevert,
  readBrain,
  resolveBrain,
  unwrap,
  wrap,
  type BrainRow,
} from '../src/core.ts'

const ORG = '00000000-0000-0000-0000-0000000000aa'
const NOW = '2026-11-16T18:00:00.000Z'

/** A valid default for every registry entry, built from each kind. */
function fixtureDefaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const e of REGISTRY) {
    const candidates: unknown[] = [
      'Sample text',
      'info@example.com',
      'https://example.com',
      'example.com',
      '(555) 010-0000',
      '/brand/logo.png',
      '01-02',
      '#112233',
      2017,
      7,
      14,
      50,
      1000,
      ['Item one'],
      ['https://example.com/a'],
      [0, 48, 120],
      [{ label: 'low', cents: 800 }, { label: 'standard', cents: 1000 }, { label: 'high', cents: 1200 }],
      [{ title: 'T', body: 'B' }],
      [{ key: 'price', label: 'Price' }],
      { a: 1 },
      [],
      null,
    ]
    const v = candidates.find((c) => e.validate(c).ok)
    assert.notEqual(v, undefined, `no fixture for ${e.id}`)
    out[e.id] = (e.validate(v) as { value: unknown }).value
  }
  return out
}

const DEFAULTS = fixtureDefaults()

function row(over: Partial<BrainRow> & Pick<BrainRow, 'section' | 'key'>): BrainRow {
  return { id: `row-${over.section}.${over.key}`, org_id: ORG, value: wrap(null), version: 1, draft_value: null, ...over }
}

function fakeDb(result: { data?: unknown; error?: unknown } | Error) {
  const calls: string[] = []
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (col: string, v: string) => {
      calls.push(`${col}=${v}`)
      return q
    },
    in: () => q,
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      result instanceof Error ? reject(result) : resolve(result),
  }
  return { db: { from: (t: string) => (calls.push(t), q) }, calls }
}

test('the fixture defaults pass checkDefaults; a missing or bad default is named', () => {
  assert.deepEqual(checkDefaults(DEFAULTS), [])
  const { ['identity.phone']: _gone, ...rest } = DEFAULTS
  void _gone
  assert.deepEqual(checkDefaults(rest), ['identity.phone: no default'])
  assert.match(checkDefaults({ ...DEFAULTS, 'brand.accent': 'red' }).join(), /brand\.accent: default refused/)
  assert.match(checkDefaults({ ...DEFAULTS, 'made.up': 1 }).join(), /made\.up: not in the registry/)
})

test('with no rows, the Brain IS the defaults, every entry sourced "default"', () => {
  const brain = resolveBrain([], DEFAULTS)
  assert.deepEqual(brain.values, DEFAULTS)
  assert.equal(brain.entries.length, REGISTRY.length)
  for (const e of brain.entries) {
    assert.equal(e.source, 'default')
    assert.equal(e.version, 0)
    assert.equal(e.draft, null)
  }
})

test('a published row wins and says so; a draft does not change the value', () => {
  const brain = resolveBrain(
    [
      row({ section: 'identity', key: 'brand_name', value: wrap('New Name'), version: 3, published_at: NOW }),
      row({ section: 'identity', key: 'phone', value: wrap('(555) 010-0000'), version: 1, draft_value: wrap('(555) 010-9999') }),
    ],
    DEFAULTS,
  )
  const name = brain.entries.find((e) => e.id === 'identity.brand_name')!
  assert.equal(name.value, 'New Name')
  assert.equal(name.source, 'brain')
  assert.equal(name.version, 3)
  const phone = brain.entries.find((e) => e.id === 'identity.phone')!
  assert.equal(phone.value, '(555) 010-0000')
  assert.deepEqual(phone.draft?.value, '(555) 010-9999')
})

test('a never-published row (version 0) carries only a draft', () => {
  const brain = resolveBrain([row({ section: 'identity', key: 'phone', value: wrap('ignored'), version: 0, draft_value: wrap('(555) 010-1234') })], DEFAULTS)
  const e = brain.entries.find((x) => x.id === 'identity.phone')!
  assert.equal(e.source, 'default')
  assert.equal(e.value, DEFAULTS['identity.phone'])
  assert.equal(e.draft?.value, '(555) 010-1234')
})

test('an invalid stored value or an unknown key is ignored and named', () => {
  const brain = resolveBrain(
    [
      row({ section: 'brand', key: 'accent', value: wrap('not a colour') }),
      row({ section: 'brand', key: 'sparkle', value: wrap(1) }),
      row({ section: 'brand', key: 'text', value: { not: 'an envelope' } }),
    ],
    DEFAULTS,
  )
  assert.equal(brainValue(brain, 'brand.accent'), DEFAULTS['brand.accent'])
  assert.equal(brainValue(brain, 'brand.text'), DEFAULTS['brand.text'])
  assert.equal(brain.problems.length, 3)
})

test('a null cost is a real value, stored in its envelope', () => {
  const brain = resolveBrain([row({ section: 'costs', key: 'labor_per_crew_hour', value: wrap(4500) })], DEFAULTS)
  assert.equal(brainValue(brain, 'costs.labor_per_crew_hour'), 4500)
  assert.deepEqual(wrap(null), { v: null })
  assert.equal(unwrap({ v: null }), null)
  assert.equal(unwrap(null), undefined)
})

test('readBrain reads one org, and filters by section and audience', async () => {
  const { db, calls } = fakeDb({ data: [row({ section: 'identity', key: 'brand_name', value: wrap('X') })], error: null })
  const brain = await readBrain(db, ORG, DEFAULTS)
  assert.equal(brain.unreadable, false)
  assert.ok(calls.includes('brain_entries'))
  assert.ok(calls.includes(`org_id=${ORG}`))
  assert.equal(brainValue(brain, 'identity.brand_name'), 'X')

  const only = await readBrain(fakeDb({ data: [], error: null }).db, ORG, DEFAULTS, { sections: ['brand'] })
  assert.ok(only.entries.every((e) => e.section === 'brand'))

  const customer = await readBrain(
    fakeDb({ data: [row({ section: 'identity', key: 'phone', value: wrap('(555) 010-0000'), draft_value: wrap('(555) 010-1111') })], error: null }).db,
    ORG,
    DEFAULTS,
    { audience: 'customer' },
  )
  assert.ok(customer.entries.length > 0)
  for (const e of customer.entries) {
    assert.equal(e.audience, 'customer')
    assert.equal(e.draft, null)
  }
  assert.equal('pricing.roofline_rates' in customer.values, false)
  assert.equal('ai_rules.staff_names' in customer.values, false)
})

test('readBrain never throws: an error, a rejection or a bad shape all give the defaults', async () => {
  for (const result of [{ data: null, error: { message: 'boom' } }, new Error('network'), { data: 'nonsense', error: null }]) {
    const brain = await readBrain(fakeDb(result).db, ORG, DEFAULTS)
    assert.equal(brain.unreadable, true)
    assert.deepEqual(brain.values, DEFAULTS)
    assert.equal(brain.problems.length, 1)
  }
  const throwing = { from: () => { throw new Error('no client') } }
  const brain = await readBrain(throwing, ORG, DEFAULTS, { audience: 'customer' })
  assert.equal(brain.unreadable, true)
  assert.ok(brain.entries.every((e) => e.audience === 'customer'))
})

test('planDraft validates, cleans, and clears a draft that changes nothing', () => {
  const p = planDraft('identity.brand_name', '  Acme  ', 'Old')
  assert.ok(p.ok)
  if (p.ok) assert.deepEqual(p.draftValue, { v: 'Acme' })
  const same = planDraft('identity.brand_name', 'Old', 'Old')
  assert.ok(same.ok && same.draftValue === null)
  const badPlan = planDraft('brand.accent', 'red')
  assert.equal(badPlan.ok, false)
  assert.equal(planDraft('made.up', 1).ok, false)
})

test('planPublish: all, or only the picked ones; bumps versions; appends history', () => {
  const rows = [
    row({ section: 'identity', key: 'brand_name', value: wrap('A'), version: 2, draft_value: wrap('B') }),
    row({ section: 'identity', key: 'phone', value: wrap('x'), version: 0, draft_value: wrap('(555) 010-2222') }),
    row({ section: 'brand', key: 'accent', value: wrap('#000000'), version: 1, draft_value: wrap('nope') }),
    row({ section: 'brand', key: 'text', value: wrap('#ffffff'), version: 4 }),
  ]
  const all = planPublish(rows, 'all', { by: 'u1', note: ' season start ', now: NOW })
  assert.equal(all.updates.length, 2)
  assert.deepEqual(all.updates.map((u) => [u.rowId, u.expectVersion, u.set.version]), [
    ['row-identity.brand_name', 2, 3],
    ['row-identity.phone', 0, 1],
  ])
  assert.deepEqual(all.updates[0].set.value, { v: 'B' })
  assert.equal(all.updates[0].set.draft_value, null)
  assert.equal(all.versions.length, 2)
  assert.equal(all.versions[0].note, 'season start')
  assert.equal(all.versions[1].entry_id, 'row-identity.phone')
  assert.deepEqual(all.refused.map((r) => r.id), ['brand.accent'])

  const picked = planPublish(rows, ['identity.phone', 'brand.text'], { by: 'u1', now: NOW })
  assert.deepEqual(picked.updates.map((u) => u.rowId), ['row-identity.phone'])
  assert.deepEqual(picked.skipped, ['brand.text'])
  assert.equal(picked.versions[0].note, null)
})

test('planDiscard clears drafts, and deletes rows that only carried one', () => {
  const rows = [
    row({ section: 'identity', key: 'brand_name', version: 2, draft_value: wrap('B') }),
    row({ section: 'identity', key: 'phone', version: 0, draft_value: wrap('(555) 010-2222') }),
    row({ section: 'brand', key: 'text', version: 4 }),
  ]
  assert.deepEqual(planDiscard(rows, 'all'), { clear: ['row-identity.brand_name'], remove: ['row-identity.phone'] })
  assert.deepEqual(planDiscard(rows, ['identity.phone']), { clear: [], remove: ['row-identity.phone'] })
})

test('planRevert puts an old version back as a DRAFT, validated', () => {
  const p = planRevert({ section: 'identity', key: 'brand_name', value: wrap('Old') }, 'New')
  assert.ok(p.ok && p.draftValue && p.draftValue.v === 'Old')
  assert.equal(planRevert({ section: 'identity', key: 'brand_name', value: 'raw' }).ok, false)
  assert.equal(planRevert({ section: 'brand', key: 'accent', value: wrap('red') }).ok, false)
})

test('export then import round-trips with no drafts; a change becomes a draft only', () => {
  const brain = resolveBrain([], DEFAULTS)
  const doc = exportBrain(brain, NOW)
  assert.equal(doc.format, 'fhl-brain')
  assert.equal(Object.keys(doc.entries).length, REGISTRY.length)
  const same = importAsDrafts(JSON.parse(JSON.stringify(doc)), brain)
  assert.ok(same.ok)
  assert.equal(same.drafts.length, 0)
  assert.equal(same.unchanged, REGISTRY.length)

  const edited = JSON.parse(JSON.stringify(doc))
  edited.entries['identity.brand_name'].value = 'Imported Name'
  edited.entries['brand.accent'] = '#abcdef'
  edited.entries['brand.text'] = { value: 'nope' }
  edited.entries['made.up'] = { value: 1 }
  const plan = importAsDrafts(edited, brain)
  assert.deepEqual(plan.drafts, [
    { id: 'identity.brand_name', value: 'Imported Name' },
    { id: 'brand.accent', value: '#abcdef' },
  ])
  assert.deepEqual(plan.unknown, ['made.up'])
  assert.deepEqual(plan.errors.map((e) => e.id), ['brand.text'])
})

test('import refuses something that is not a Brain export', () => {
  const brain = resolveBrain([], DEFAULTS)
  assert.equal(importAsDrafts(null, brain).ok, false)
  assert.equal(importAsDrafts({ format: 'other', entries: {} }, brain).ok, false)
  assert.equal(importAsDrafts({ entries: [] }, brain).ok, false)
})
