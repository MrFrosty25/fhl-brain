import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REGISTRY, SECTIONS, entryById, entriesIn } from '../src/registry.ts'

test('every entry belongs to a declared section, and every section has entries', () => {
  const sections = new Set(SECTIONS.map((s) => s.key))
  for (const e of REGISTRY) assert.ok(sections.has(e.section), e.id)
  for (const s of SECTIONS) assert.ok(entriesIn(s.key).length > 0, s.key)
})

test('the sections are the owner\'s list, in order', () => {
  assert.deepEqual(SECTIONS.map((s) => s.key), [
    'identity', 'brand', 'pricing', 'money_terms', 'offer', 'promises', 'service_area',
    'season', 'sales_process', 'ai_rules', 'costs', 'definitions', 'lessons',
  ])
})

test('ids are unique and fit the database checks', () => {
  const ids = REGISTRY.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const e of REGISTRY) {
    assert.match(e.section, /^[a-z_]{2,40}$/)
    assert.match(e.key, /^[a-z0-9_.]{1,80}$/)
    assert.equal(e.id, `${e.section}.${e.key}`)
    assert.ok(e.label.trim() && e.help.trim(), e.id)
  }
})

test('nothing internal is marked safe for customers', () => {
  for (const s of ['pricing', 'sales_process', 'ai_rules', 'costs', 'definitions', 'lessons']) {
    for (const e of entriesIn(s)) assert.equal(e.audience, 'staff', e.id)
  }
  assert.equal(entryById('money_terms.tax_pointer')!.audience, 'staff')
  assert.equal(entryById('money_terms.rebook_rule')!.audience, 'staff')
  assert.equal(entryById('brand.voice')!.audience, 'staff')
})

test('the owner asked for these by name', () => {
  for (const id of [
    'offer.lease_statement', 'offer.lease_benefits', 'offer.color_change', 'lessons.log',
    'pricing.roofline_rates', 'pricing.designer_rates', 'money_terms.budget_bands', 'costs.labor_per_crew_hour',
  ]) assert.ok(entryById(id), id)
})

test('validators: text trims and refuses empty', () => {
  const e = entryById('identity.brand_name')!
  assert.deepEqual(e.validate('  Acme  '), { ok: true, value: 'Acme' })
  assert.equal(e.validate('   ').ok, false)
  assert.equal(e.validate(5).ok, false)
})

test('validators: email, url, phone, colour, month-day', () => {
  assert.equal(entryById('identity.email')!.validate('info@example.com').ok, true)
  assert.equal(entryById('identity.email')!.validate('not an email').ok, false)
  assert.equal(entryById('identity.email_sender')!.validate('Acme <a@example.com>').ok, true)
  assert.equal(entryById('identity.site_url')!.validate('http://insecure.example.com').ok, false)
  assert.equal(entryById('identity.phone')!.validate('(555) 010-0000').ok, true)
  assert.deepEqual(entryById('brand.accent')!.validate('#ABCDEF'), { ok: true, value: '#abcdef' })
  assert.equal(entryById('brand.accent')!.validate('red').ok, false)
  assert.equal(entryById('season.removal_date')!.validate('01-02').ok, true)
  assert.equal(entryById('season.removal_date')!.validate('13-02').ok, false)
})

test('validators: money and percent', () => {
  const min = entryById('money_terms.project_minimum')!
  assert.equal(min.validate(100_000).ok, true)
  assert.equal(min.validate(10.5).ok, false)
  assert.equal(min.validate(-1).ok, false)
  const dep = entryById('money_terms.deposit_percent')!
  assert.equal(dep.validate(50).ok, true)
  assert.equal(dep.validate(101).ok, false)
  // A typed rate a foot can never be $1,000 (audit item 12).
  assert.equal(entryById('pricing.promo_rate')!.validate(100_000).ok, false)
})

test('validators: the roofline ladder keeps its three named rungs, cheapest first', () => {
  const e = entryById('pricing.roofline_rates')!
  const good = [{ label: 'low', cents: 800 }, { label: 'standard', cents: 1000 }, { label: 'high', cents: 1200 }]
  assert.equal(e.validate(good).ok, true)
  assert.equal(e.validate([good[1], good[0], good[2]]).ok, false)
  assert.equal(e.validate(good.slice(0, 2)).ok, false)
  assert.equal(e.validate([{ label: 'low', cents: 50 }, good[1], good[2]]).ok, false)
})

test('validators: designer rungs take any labels but stay ordered and unique', () => {
  const e = entryById('pricing.designer_rates')!
  assert.equal(e.validate([{ label: 'a', cents: 800 }, { label: 'b', cents: 900 }]).ok, true)
  assert.equal(e.validate([{ label: 'a', cents: 900 }, { label: 'a', cents: 1000 }]).ok, false)
})

test('validators: lists refuse duplicates; follow-ups go in order', () => {
  assert.equal(entryById('offer.light_colors')!.validate(['Warm white', 'Warm white']).ok, false)
  assert.equal(entryById('sales_process.follow_up_hours')!.validate([0, 48, 120]).ok, true)
  assert.equal(entryById('sales_process.follow_up_hours')!.validate([48, 0]).ok, false)
  assert.equal(entryById('sales_process.follow_up_hours')!.validate([0, 1, 2, 3]).ok, false)
})

test('validators: costs may be unset', () => {
  assert.deepEqual(entryById('costs.labor_per_crew_hour')!.validate(null), { ok: true, value: null })
  assert.equal(entryById('costs.labor_per_crew_hour')!.validate(4500).ok, true)
  assert.equal(entryById('money_terms.project_minimum')!.validate(null).ok, false)
})

test('validators: lessons need a title, what happened and a rule; cost may be blank', () => {
  const e = entryById('lessons.log')!
  assert.equal(e.validate([]).ok, true)
  assert.equal(e.validate([{ title: 't', what_happened: 'w', cost: '', rule: 'r' }]).ok, true)
  assert.equal(e.validate([{ title: 't', what_happened: 'w', rule: '' }]).ok, false)
})

test('validators: lease benefits need a title and a sentence', () => {
  const e = entryById('offer.lease_benefits')!
  assert.equal(e.validate([{ title: 'Nothing to buy', body: 'You lease the season.' }]).ok, true)
  assert.equal(e.validate([{ title: 'Nothing to buy' }]).ok, false)
})

test('validators: response clocks are named numbers', () => {
  const e = entryById('sales_process.response_clocks')!
  assert.equal(e.validate({ newInHoursMinutes: 10 }).ok, true)
  assert.equal(e.validate({ newInHoursMinutes: -1 }).ok, false)
  assert.equal(e.validate([]).ok, false)
})
