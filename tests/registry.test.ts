import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LESSON_LIMITS, REGISTRY, SECTIONS, SOP_NOT_WRITTEN, SOP_SLOTS, entryById, entriesIn, personalDataIn, validationContextFrom } from '../src/registry.ts'

test('every entry belongs to a declared section, and every section has entries', () => {
  const sections = new Set(SECTIONS.map((s) => s.key))
  for (const e of REGISTRY) assert.ok(sections.has(e.section), e.id)
  for (const s of SECTIONS) assert.ok(entriesIn(s.key).length > 0, s.key)
})

test('the sections are the owner\'s list, in order', () => {
  assert.deepEqual(SECTIONS.map((s) => s.key), [
    'identity', 'brand', 'pricing', 'money_terms', 'offer', 'promises', 'service_area',
    'season', 'sales_process', 'ai_rules', 'costs', 'definitions', 'sops', 'lessons',
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
  for (const s of ['pricing', 'sales_process', 'ai_rules', 'costs', 'definitions', 'sops', 'lessons']) {
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

// ─── SOPs ───────────────────────────────────────────────────────────────────

const SOP = { title: 'Install day', steps: ['Timers set and tested.', 'After photos taken.'], owner_role: 'Crew lead', updated: '2026-11-16' }

test('SOPs: one entry per slot, staff only, unset allowed, unwritten slots say so', () => {
  assert.deepEqual(entriesIn('sops').map((e) => e.key), SOP_SLOTS.map((s) => s.key))
  for (const e of entriesIn('sops')) {
    assert.equal(e.audience, 'staff', e.id)
    assert.equal(e.kind, 'sop', e.id)
    assert.equal(e.nullable, true, e.id)
    assert.deepEqual(e.validate(null), { ok: true, value: null })
  }
  for (const slot of SOP_SLOTS.filter((s) => !s.written)) assert.equal(entryById(`sops.${slot.key}`)!.help, SOP_NOT_WRITTEN)
  for (const id of ['sops.install_day', 'sops.takedown', 'sops.repair_call', 'sops.new_lead', 'sops.quote_follow_up', 'sops.rebook']) {
    assert.ok(entryById(id), id)
  }
})

test('SOPs: a title of 80 characters at most, 1 to 25 steps of 300 at most, trimmed', () => {
  const e = entryById('sops.install_day')!
  assert.deepEqual(e.validate({ ...SOP, title: '  Install day ', steps: [' One. '] }), {
    ok: true,
    value: { title: 'Install day', steps: ['One.'], owner_role: 'Crew lead', updated: '2026-11-16' },
  })
  assert.equal(e.validate({ ...SOP, title: 'x'.repeat(80) }).ok, true)
  assert.equal(e.validate({ ...SOP, title: 'x'.repeat(81) }).ok, false)
  assert.equal(e.validate({ ...SOP, title: ' ' }).ok, false)
  assert.equal(e.validate({ ...SOP, steps: [] }).ok, false)
  assert.equal(e.validate({ ...SOP, steps: Array.from({ length: 25 }, (_, i) => `Step ${i}.`) }).ok, true)
  assert.equal(e.validate({ ...SOP, steps: Array.from({ length: 26 }, (_, i) => `Step ${i}.`) }).ok, false)
  assert.equal(e.validate({ ...SOP, steps: ['x'.repeat(300)] }).ok, true)
  assert.equal(e.validate({ ...SOP, steps: ['x'.repeat(301)] }).ok, false)
  assert.equal(e.validate({ ...SOP, steps: ['ok', '  '] }).ok, false)
  assert.equal(e.validate({ ...SOP, steps: [5] }).ok, false)
  assert.equal(e.validate({ ...SOP, owner_role: '' }).ok, false)
  assert.equal(e.validate({ ...SOP, updated: '16/11/2026' }).ok, false)
  assert.equal(e.validate(['not', 'an', 'sop']).ok, false)
})

// ─── Lessons carry no personal data ─────────────────────────────────────────

test('lessons: an email address or a phone number is refused, in any field', () => {
  const e = entryById('lessons.log')!
  const base = { title: 't', what_happened: 'w', cost: '', rule: 'r' }
  assert.equal(e.validate([{ ...base, what_happened: 'Wrote to jane.doe@example.com twice.' }]).ok, false)
  assert.equal(e.validate([{ ...base, cost: 'Called (469) 555-0142 for nothing.' }]).ok, false)
  assert.equal(e.validate([{ ...base, rule: 'Text 972-555-0199 first.' }]).ok, false)
  assert.equal(e.validate([{ ...base, title: 'Lead +19725550199 lost' }]).ok, false)
  assert.equal(e.validate([{ ...base, what_happened: 'Number 9725550199 was wrong.' }]).ok, false)
  const refused = e.validate([base, { ...base, rule: 'Mail a@b.co' }])
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.error, /Item 2: "rule" contains an email address/)
})

test('lessons: ordinary numbers, dates, sizes and money are not mistaken for contact details', () => {
  const e = entryById('lessons.log')!
  const text = 'On 2026-11-14 the budget went from $75 to $120; check at 390 × 844; PR #568 and #574; 235 runs; ~150 ZIP codes; 08:00-20:00.'
  assert.equal(e.validate([{ title: 'Dates (2026-11-16)', what_happened: text, cost: '', rule: text }]).ok, true)
  assert.deepEqual(personalDataIn(text), [])
  assert.deepEqual(personalDataIn('jane@gmail.com, (972) 267-3719'), ['an email address', 'a phone number'])
})

test('lessons: our own email domains are allowed, read from the identity values', () => {
  const identity = {
    'identity.email': 'info@ourshop.example',
    'identity.email_domain': 'mail.ourshop-llc.example',
    'identity.email_sender': 'Our Shop <hello@ourshop-llc.example>',
  }
  const ctx = validationContextFrom(identity)
  assert.deepEqual([...(ctx.ownEmailDomains ?? [])].sort(), ['mail.ourshop-llc.example', 'ourshop-llc.example', 'ourshop.example'])
  const e = entryById('lessons.log')!
  const base = { title: 't', what_happened: 'w', cost: '', rule: 'r' }
  assert.equal(e.validate([{ ...base, rule: 'Alerts go to info@ourshop.example.' }], ctx).ok, true)
  assert.equal(e.validate([{ ...base, rule: 'Bounced from leads@mail.ourshop-llc.example' }], ctx).ok, true)
  assert.equal(e.validate([{ ...base, rule: 'Wrote to jane@gmail.com' }], ctx).ok, false)
  assert.equal(e.validate([{ ...base, rule: 'Wrote to x@ourshop.example.evil.com' }], ctx).ok, false)
  // Without a context, every address is refused.
  assert.equal(e.validate([{ ...base, rule: 'Alerts go to info@ourshop.example.' }]).ok, false)
})

test('lessons: phone-shaped numbers are refused; timestamps and ids are not phones', () => {
  const phones = ['(469) 555-0142', '469-555-0142', '469.555.0142', '469 555 0142', '+1 469 555 0142', '+14695550142', '1 (469) 555-0142', 'call 4695550142 now']
  for (const p of phones) assert.deepEqual(personalDataIn(p), ['a phone number'], p)
  const notPhones = [
    'Unix time 1731715200 was logged',
    'lead id 4695550142',
    'id: 4695550142',
    'PR 4695550142',
    '#4695550142',
    'order 12345678901 (eleven digits)',
    'ref 0123456789',
    '2026-11-14 and 2026-11-16',
    '$1,000 minimum, 390 × 844 screen',
    'version 1.2.3.4567890123',
  ]
  for (const t of notPhones) assert.deepEqual(personalDataIn(t), [], t)
})

test('lessons: capped at 200 lessons of 600 characters a field, and the maximum passes', () => {
  const e = entryById('lessons.log')!
  const field = 'x'.repeat(LESSON_LIMITS.field)
  const max = Array.from({ length: LESSON_LIMITS.maxLessons }, () => ({ title: field, what_happened: field, cost: field, rule: field }))
  assert.equal(LESSON_LIMITS.maxLessons, 200)
  assert.equal(LESSON_LIMITS.field, 600)
  assert.equal(e.validate(max).ok, true)
  assert.equal(e.validate([...max, max[0]]).ok, false)
  assert.equal(e.validate([{ ...max[0], rule: `${field}x` }]).ok, false)
})

test('owner, 2026-11-16: the install sub day rate, when we start hanging, and staying in touch', () => {
  const sub = entryById('costs.install_sub_per_day')!
  assert.equal(sub.audience, 'staff')
  assert.equal(sub.kind, 'money_cents')
  assert.equal(sub.label, 'Install sub, per day')
  assert.equal(sub.help, 'What we pay an install subcontractor for a day.')
  assert.deepEqual(sub.validate(25_000), { ok: true, value: 25_000 })
  assert.equal(sub.validate(-1).ok, false)
  assert.equal(sub.validate(250.5).ok, false)
  // The other two costs stay unset until the owner records them.
  assert.equal(entryById('costs.labor_per_crew_hour')!.nullable, true)
  assert.equal(entryById('costs.material_per_foot')!.nullable, true)

  const hang = entryById('season.install_start_month')!
  assert.equal(hang.audience, 'staff')
  assert.equal(hang.label, 'We start hanging lights')
  assert.equal(hang.validate(10).ok, true)
  assert.equal(hang.validate(0).ok, false)
  assert.equal(hang.validate(13).ok, false)
  // The reporting-season boundary is still undecided, and separate.
  assert.equal(entryById('season.start_month')!.nullable, true)
  assert.equal(entryById('definitions.season')!.nullable, true)

  const touch = entryById('sales_process.stay_in_touch')!
  assert.equal(touch.audience, 'staff')
  assert.equal(touch.kind, 'text')
  assert.equal(touch.label, 'Staying in touch')
  assert.equal(touch.validate('We stay in touch with every client all year, once per quarter.').ok, true)
  assert.equal(touch.validate('   ').ok, false)
})
