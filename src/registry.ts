// THE BRAIN'S REGISTRY — the closed list of everything the Brain holds.
//
// Owner, 2026-11-16: "one source of truth containing our branding, our
// pricing, our SOPs and everything that belongs at the source that we can
// plug tools into."
//
// ─── A CLOSED LIST, ON PURPOSE ───────────────────────────────────────────────
//
// A Brain entry is a fact a tool can rely on. If anybody could invent a key
// from a screen, a tool reading `pricing.roofline_rates` could never be sure
// the entry it found means what it thinks. So every entry is declared here,
// with a label in plain English, one line of help, who may see it and a
// validator. A stored row whose key is not in this list is ignored.
//
// ─── AUDIENCE ────────────────────────────────────────────────────────────────
//
// 'customer' — safe for a customer-facing tool (website, chat widget, quote
//              page, customer email). No feet, no per-foot rates, no costs,
//              no staff names, no internal rules.
// 'staff'    — everything else. `readBrain(..., { audience: 'customer' })`
//              drops every staff entry before a customer tool sees it.
//
// Pure: no imports, no I/O.

export type Audience = 'customer' | 'staff'

export type Kind =
  | 'text'
  | 'long_text'
  | 'money_cents'
  | 'percent'
  | 'number'
  | 'list'
  | 'rate_ladder'
  | 'color'
  | 'json'
  | 'sop'

export type Validation = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string }

export interface SectionDef {
  readonly key: string
  readonly label: string
  readonly help: string
}

export interface RegistryEntry {
  readonly section: string
  readonly key: string
  /** `section.key` — how every tool refers to it. */
  readonly id: string
  readonly label: string
  readonly help: string
  readonly audience: Audience
  readonly kind: Kind
  /** True when "not set yet" (null) is a legitimate value. */
  readonly nullable: boolean
  /** Checks a value and returns it cleaned (strings trimmed). */
  readonly validate: (value: unknown) => Validation
}

// ─── The sections, in the order the screen shows them ───────────────────────

export const SECTIONS: readonly SectionDef[] = [
  { key: 'identity', label: 'Business facts', help: 'Names, phone, address, emails, websites, hours, review link and socials.' },
  { key: 'brand', label: 'Brand', help: 'Colours, logo, fonts and the voice we write in.' },
  { key: 'pricing', label: 'Pricing', help: 'Internal rates. Never shown to a customer.' },
  { key: 'money_terms', label: 'Money terms', help: 'Minimum, deposit, balance, tax and the budget question.' },
  { key: 'offer', label: 'What we offer', help: 'Light colours, what is included, and the lease.' },
  { key: 'promises', label: 'Promises', help: 'What we promise customers, word for word.' },
  { key: 'service_area', label: 'Service area', help: 'Where we work.' },
  { key: 'season', label: 'Season', help: 'When the season starts and when removal begins.' },
  { key: 'sales_process', label: 'Sales process', help: 'Follow-up timing, response clocks and lost reasons.' },
  { key: 'ai_rules', label: 'AI rules', help: 'What the assistants may and may not say.' },
  { key: 'costs', label: 'Costs', help: 'What a job costs us. Not recorded yet.' },
  { key: 'definitions', label: 'Definitions', help: 'What counts as a lead, a close and a season, so every report agrees.' },
  { key: 'sops', label: 'SOPs', help: 'How we do each job, step by step. Staff only.' },
  { key: 'lessons', label: 'Lessons', help: 'Every mistake, what it cost, and the rule that prevents it.' },
]

// ─── Validators ─────────────────────────────────────────────────────────────

const ok = (value: unknown): Validation => ({ ok: true, value })
const bad = (error: string): Validation => ({ ok: false, error })

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textValidator(max: number, pattern?: { re: RegExp; what: string }) {
  return (value: unknown): Validation => {
    if (typeof value !== 'string') return bad('Must be text.')
    const t = value.trim()
    if (!t) return bad('Cannot be empty.')
    if (t.length > max) return bad(`At most ${max} characters.`)
    if (pattern && !pattern.re.test(t)) return bad(`Must be ${pattern.what}.`)
    return ok(t)
  }
}

const EMAIL = { re: /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i, what: 'an email address' }
const URL_RE = { re: /^https:\/\/[^\s]+$/i, what: 'a web address starting https://' }
const HOST = { re: /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i, what: 'a domain name, like example.com' }
const PHONE = { re: /^[0-9()+\-. ]{7,20}$/, what: 'a phone number' }
const SENDER = { re: /^(?:[^<>]+<[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}>|[^\s@<>]+@[^\s@<>]+\.[a-z]{2,})$/i, what: 'an email address, or Name <address>' }
const PATH = { re: /^\/[A-Za-z0-9/_.-]+$/, what: 'a path starting with /' }
const MONTH_DAY = { re: /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/, what: 'a date as MM-DD' }

function intValidator(min: number, max: number, what: string) {
  return (value: unknown): Validation => {
    if (typeof value !== 'number' || !Number.isInteger(value)) return bad(`${what} must be a whole number.`)
    if (value < min || value > max) return bad(`${what} must be between ${min} and ${max}.`)
    return ok(value)
  }
}

const centsValidator = (max = 100_000_000) => intValidator(0, max, 'Cents')

function percentValidator(value: unknown): Validation {
  if (typeof value !== 'number' || !Number.isFinite(value)) return bad('Must be a number.')
  if (value < 0 || value > 100) return bad('Must be between 0 and 100.')
  return ok(value)
}

function colorValidator(value: unknown): Validation {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.trim())) return bad('Must be a colour like #a1b2c3.')
  return ok(value.trim().toLowerCase())
}

type ItemType = 'text' | 'url' | 'email' | 'number'

function listValidator(opts: { items: ItemType; min?: number; max?: number; itemMax?: number; ascending?: boolean }) {
  return (value: unknown): Validation => {
    if (!Array.isArray(value)) return bad('Must be a list.')
    const min = opts.min ?? 1
    const max = opts.max ?? 100
    if (value.length < min) return bad(min === 1 ? 'Needs at least one item.' : `Needs at least ${min} items.`)
    if (value.length > max) return bad(`At most ${max} items.`)
    const out: unknown[] = []
    for (const [i, item] of value.entries()) {
      if (opts.items === 'number') {
        if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) return bad(`Item ${i + 1} must be a whole number of 0 or more.`)
        out.push(item)
        continue
      }
      const check =
        opts.items === 'url'
          ? textValidator(500, URL_RE)
          : opts.items === 'email'
            ? textValidator(200, EMAIL)
            : textValidator(opts.itemMax ?? 300)
      const r = check(item)
      if (!r.ok) return bad(`Item ${i + 1}: ${r.error}`)
      out.push(r.value)
    }
    if (opts.items !== 'number' && new Set(out).size !== out.length) return bad('The list has a duplicate.')
    if (opts.ascending) {
      for (let i = 1; i < out.length; i++) {
        if ((out[i] as number) < (out[i - 1] as number)) return bad('Must be in order, smallest first.')
      }
    }
    return ok(out)
  }
}

/**
 * A ladder of rates: `[{ label, cents }]`, cheapest first, labels unique.
 * `labels` fixes the rung names when the rungs are a rule's own (low /
 * standard / high); otherwise any labels are allowed.
 */
function rateLadderValidator(opts: { labels?: readonly string[]; minCents: number; maxCents: number }) {
  return (value: unknown): Validation => {
    if (!Array.isArray(value) || value.length === 0) return bad('Must be a list of rungs.')
    if (value.length > 12) return bad('At most 12 rungs.')
    const out: { label: string; cents: number }[] = []
    for (const [i, rung] of value.entries()) {
      if (!isPlainObject(rung)) return bad(`Rung ${i + 1} must have a label and cents.`)
      const label = typeof rung.label === 'string' ? rung.label.trim() : ''
      if (!label || label.length > 60) return bad(`Rung ${i + 1} needs a label (60 characters at most).`)
      const cents = rung.cents
      if (typeof cents !== 'number' || !Number.isInteger(cents)) return bad(`Rung ${i + 1} must be whole cents.`)
      if (cents < opts.minCents || cents > opts.maxCents) return bad(`Rung ${i + 1} must be between ${opts.minCents} and ${opts.maxCents} cents.`)
      out.push({ label, cents })
    }
    if (new Set(out.map((r) => r.label)).size !== out.length) return bad('Two rungs have the same label.')
    for (let i = 1; i < out.length; i++) {
      if (out[i].cents < out[i - 1].cents) return bad('Rungs must go cheapest first.')
    }
    if (opts.labels) {
      const got = out.map((r) => r.label)
      if (got.length !== opts.labels.length || got.some((l, i) => l !== opts.labels![i])) {
        return bad(`The rungs must be exactly: ${opts.labels.join(', ')}.`)
      }
    }
    return ok(out)
  }
}

function objectOfNumbers(value: unknown): Validation {
  if (!isPlainObject(value)) return bad('Must be a set of named numbers.')
  const out: Record<string, number> = {}
  const keys = Object.keys(value)
  if (keys.length === 0 || keys.length > 40) return bad('Needs between 1 and 40 numbers.')
  for (const k of keys) {
    const n = value[k]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return bad(`"${k}" must be a number of 0 or more.`)
    out[k] = n
  }
  return ok(out)
}

function recordList(fields: readonly { name: string; max: number; optional?: boolean }[], max: number, min = 1) {
  return (value: unknown): Validation => {
    if (!Array.isArray(value)) return bad('Must be a list.')
    if (value.length < min) return bad('Needs at least one item.')
    if (value.length > max) return bad(`At most ${max} items.`)
    const out: Record<string, string>[] = []
    for (const [i, item] of value.entries()) {
      if (!isPlainObject(item)) return bad(`Item ${i + 1} is not a record.`)
      const rec: Record<string, string> = {}
      for (const f of fields) {
        const raw = item[f.name]
        const s = typeof raw === 'string' ? raw.trim() : ''
        if (!s && !f.optional) return bad(`Item ${i + 1} needs "${f.name}".`)
        if (raw !== undefined && raw !== null && typeof raw !== 'string') return bad(`Item ${i + 1}: "${f.name}" must be text.`)
        if (s.length > f.max) return bad(`Item ${i + 1}: "${f.name}" is longer than ${f.max} characters.`)
        rec[f.name] = s
      }
      out.push(rec)
    }
    return ok(out)
  }
}

// ─── Personal data ──────────────────────────────────────────────────────────
//
// A lesson is about what WE did, never about who it happened to. Owner,
// 2026-11-16: lessons carry no customer names and no personal data. A name
// cannot be told from any other word, but an email address and a phone number
// can, so those two are refused outright.

const EMAIL_IN_TEXT = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i
const PHONE_IN_TEXT = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b|\b\d{10}\b|\+1\d{10}\b/

/** What personal data a piece of text carries, in plain words; empty when none. */
export function personalDataIn(text: string): readonly string[] {
  const found: string[] = []
  if (EMAIL_IN_TEXT.test(text)) found.push('an email address')
  if (PHONE_IN_TEXT.test(text)) found.push('a phone number')
  return found
}

/** Run `check`, then refuse any text field that carries personal data. */
function noPersonalData(check: (value: unknown) => Validation) {
  return (value: unknown): Validation => {
    const r = check(value)
    if (!r.ok) return r
    const items = Array.isArray(r.value) ? r.value : [r.value]
    for (const [i, item] of items.entries()) {
      const fields = isPlainObject(item) ? Object.entries(item) : [['text', item] as const]
      for (const [name, v] of fields) {
        if (typeof v !== 'string') continue
        const found = personalDataIn(v)
        if (found.length) return bad(`Item ${i + 1}: "${name}" contains ${found.join(' and ')}. Lessons carry no personal data.`)
      }
    }
    return r
  }
}

// ─── SOPs ───────────────────────────────────────────────────────────────────

/** An SOP as stored: a title, ordered steps, who owns it and when it changed. */
export interface Sop {
  readonly title: string
  readonly steps: readonly string[]
  readonly owner_role: string
  /** YYYY-MM-DD. */
  readonly updated: string
}

export const SOP_LIMITS = { title: 80, minSteps: 1, maxSteps: 25, step: 300, ownerRole: 60 } as const

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/

function sopValidator(value: unknown): Validation {
  if (!isPlainObject(value)) return bad('An SOP needs a title, steps, an owner and a date.')
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  if (!title) return bad('An SOP needs a title.')
  if (title.length > SOP_LIMITS.title) return bad(`The title is longer than ${SOP_LIMITS.title} characters.`)
  if (!Array.isArray(value.steps)) return bad('The steps must be a list.')
  if (value.steps.length < SOP_LIMITS.minSteps) return bad('An SOP needs at least one step.')
  if (value.steps.length > SOP_LIMITS.maxSteps) return bad(`At most ${SOP_LIMITS.maxSteps} steps.`)
  const steps: string[] = []
  for (const [i, raw] of value.steps.entries()) {
    if (typeof raw !== 'string' || !raw.trim()) return bad(`Step ${i + 1} is empty.`)
    const t = raw.trim()
    if (t.length > SOP_LIMITS.step) return bad(`Step ${i + 1} is longer than ${SOP_LIMITS.step} characters.`)
    steps.push(t)
  }
  const owner = typeof value.owner_role === 'string' ? value.owner_role.trim() : ''
  if (!owner) return bad('Say who owns this SOP.')
  if (owner.length > SOP_LIMITS.ownerRole) return bad(`"Owner" is longer than ${SOP_LIMITS.ownerRole} characters.`)
  const updated = typeof value.updated === 'string' ? value.updated.trim() : ''
  if (!ISO_DATE.test(updated)) return bad('"Updated" must be a date as YYYY-MM-DD.')
  return ok({ title, steps, owner_role: owner, updated })
}

/**
 * The SOP slots, in the order the screen shows them. A CLOSED LIST like every
 * other entry: a new SOP is a new slot here. `written: false` marks a slot no
 * written procedure exists for yet; its help says so and its built-in value
 * is null until the owner writes one.
 */
export const SOP_SLOTS: readonly { readonly key: string; readonly label: string; readonly written: boolean }[] = [
  { key: 'new_lead', label: 'A new lead', written: true },
  { key: 'quote_follow_up', label: 'Following up a quote', written: true },
  { key: 'rebook', label: 'A returning client (rebook)', written: true },
  { key: 'install_day', label: 'Install day', written: true },
  { key: 'repair_call', label: 'A repair call in season', written: true },
  { key: 'takedown', label: 'Takedown', written: true },
  { key: 'design_and_quote', label: 'Designing and pricing a quote', written: false },
  { key: 'hoa_commercial_proposal', label: 'An HOA or commercial proposal', written: false },
  { key: 'balance_collection', label: 'Collecting the balance', written: false },
]

export const SOP_NOT_WRITTEN = 'Not written yet.'

function nullable(check: (value: unknown) => Validation) {
  return (value: unknown): Validation => (value === null ? ok(null) : check(value))
}

// ─── The entries ────────────────────────────────────────────────────────────

interface Spec {
  key: string
  label: string
  help: string
  audience: Audience
  kind: Kind
  validate: (value: unknown) => Validation
  nullable?: boolean
}

function section(name: string, specs: readonly Spec[]): RegistryEntry[] {
  return specs.map((s) => ({
    section: name,
    key: s.key,
    id: `${name}.${s.key}`,
    label: s.label,
    help: s.help,
    audience: s.audience,
    kind: s.kind,
    nullable: s.nullable === true,
    validate: s.nullable ? nullable(s.validate) : s.validate,
  }))
}

const C: Audience = 'customer'
const S: Audience = 'staff'
const LINE = textValidator(300)
const PARA = textValidator(2000)

/** The three rungs of the owner's roofline rate rule, in order. */
export const ROOFLINE_RUNGS = ['low', 'standard', 'high'] as const

/**
 * The season boundary is NOT decided (2026-11-16): the app uses July, August
 * and September in three places. Until the owner picks, both season entries
 * are unset and say so.
 */
export const SEASON_UNDECIDED =
  'Not decided: three parts of the app use different season start months (July, August, September). The owner needs to pick one.'

export const LESSON_FIELDS = ['title', 'what_happened', 'cost', 'rule'] as const

export const REGISTRY: readonly RegistryEntry[] = [
  ...section('identity', [
    { key: 'brand_name', label: 'Business name', help: 'The name customers know us by.', audience: C, kind: 'text', validate: textValidator(120) },
    { key: 'legal_name', label: 'Legal name', help: 'The name on contracts and invoices.', audience: C, kind: 'text', validate: textValidator(160) },
    { key: 'phone', label: 'Phone', help: 'The business line. Calls and texts.', audience: C, kind: 'text', validate: textValidator(20, PHONE) },
    { key: 'address', label: 'Address', help: 'The street address customers see.', audience: C, kind: 'text', validate: textValidator(200) },
    { key: 'email', label: 'Customer email', help: 'The inbox customers write to.', audience: C, kind: 'text', validate: textValidator(200, EMAIL) },
    { key: 'email_sender', label: 'Email sender', help: 'Who our emails come from.', audience: C, kind: 'text', validate: textValidator(200, SENDER) },
    { key: 'email_domain', label: 'Email domain', help: 'Every email we send must come from this domain.', audience: C, kind: 'text', validate: textValidator(120, HOST) },
    { key: 'site_url', label: 'Website', help: 'The public website.', audience: C, kind: 'text', validate: textValidator(300, URL_RE) },
    { key: 'app_host', label: 'Platform address', help: 'Where the platform and the chat widget are served from.', audience: S, kind: 'text', validate: textValidator(120, HOST) },
    { key: 'hours', label: 'Office hours', help: 'One line, as customers read it.', audience: C, kind: 'text', validate: textValidator(200) },
    { key: 'founding_year', label: 'Founded', help: 'The year we started. "Since" lines are built from it.', audience: C, kind: 'number', validate: intValidator(1900, 2100, 'Year') },
    { key: 'review_url', label: 'Google review link', help: 'The link we send for a review.', audience: C, kind: 'text', validate: textValidator(300, URL_RE) },
    { key: 'socials', label: 'Social profiles', help: 'Only profiles the owner has confirmed.', audience: C, kind: 'list', validate: listValidator({ items: 'url', min: 0, max: 20 }) },
  ]),
  ...section('brand', [
    { key: 'accent', label: 'Accent colour', help: 'Buttons and highlights.', audience: C, kind: 'color', validate: colorValidator },
    { key: 'accent_text', label: 'Accent as text', help: 'The accent when it is used for words on a dark background.', audience: C, kind: 'color', validate: colorValidator },
    { key: 'on_accent', label: 'Text on the accent', help: 'Words on top of an accent-coloured button.', audience: C, kind: 'color', validate: colorValidator },
    { key: 'ground', label: 'Page background', help: 'The darkest surface, around everything.', audience: C, kind: 'color', validate: colorValidator },
    { key: 'surface', label: 'Card background', help: 'Where content sits.', audience: C, kind: 'color', validate: colorValidator },
    { key: 'surface_raised', label: 'Raised panel', help: 'A panel inside a card.', audience: C, kind: 'color', validate: colorValidator },
    { key: 'border', label: 'Lines and edges', help: 'Hairlines and card edges.', audience: C, kind: 'color', validate: colorValidator },
    { key: 'text', label: 'Text colour', help: 'Headings and body copy.', audience: C, kind: 'color', validate: colorValidator },
    { key: 'text_muted', label: 'Quiet text colour', help: 'Captions and secondary copy.', audience: C, kind: 'color', validate: colorValidator },
    { key: 'logo_path', label: 'Logo', help: 'Where the logo file lives.', audience: C, kind: 'text', validate: textValidator(300, PATH) },
    { key: 'font_display', label: 'Heading font', help: 'The font stack for headings.', audience: C, kind: 'text', validate: textValidator(300) },
    { key: 'font_body', label: 'Body font', help: 'The font stack for body copy.', audience: C, kind: 'text', validate: textValidator(300) },
    { key: 'voice', label: 'Voice', help: 'How we sound when we write. Read by the assistants.', audience: S, kind: 'long_text', validate: PARA },
  ]),
  ...section('pricing', [
    { key: 'roofline_rates', label: 'Roofline rate rule', help: 'Cents per foot: low (one storey, low pitch), standard, high (steep and 3+ peaks).', audience: S, kind: 'rate_ladder', validate: rateLadderValidator({ labels: ROOFLINE_RUNGS, minCents: 100, maxCents: 10_000 }) },
    { key: 'designer_rates', label: 'Designer rate buttons', help: 'The per-foot rates offered as buttons in the designer, cheapest first.', audience: S, kind: 'rate_ladder', validate: rateLadderValidator({ minCents: 100, maxCents: 10_000 }) },
    { key: 'promo_rate', label: 'Promo rate per foot', help: 'The rung between the flat one-storey and the ordinary house.', audience: S, kind: 'money_cents', validate: centsValidator(10_000) },
    { key: 'garland_lit_per_foot', label: 'Garland with lights, per foot', help: 'Lit is the default.', audience: S, kind: 'money_cents', validate: centsValidator(100_000) },
    { key: 'garland_unlit_per_foot', label: 'Garland without lights, per foot', help: 'Only when the customer asks for unlit.', audience: S, kind: 'money_cents', validate: centsValidator(100_000) },
    { key: 'tree_strand', label: 'Tree trunk strand', help: 'Price of one strand on a trunk.', audience: S, kind: 'money_cents', validate: centsValidator(100_000) },
    { key: 'min_rate_per_foot', label: 'Lowest rate a foot', help: 'A typed rate below this is refused.', audience: S, kind: 'money_cents', validate: centsValidator(10_000) },
    { key: 'max_rate_per_foot', label: 'Highest rate a foot', help: 'A typed rate above this is refused.', audience: S, kind: 'money_cents', validate: centsValidator(100_000) },
    { key: 'windows_per_foot', label: 'Windows, per foot of outline', help: 'Windows are outlined and priced by the foot.', audience: S, kind: 'money_cents', validate: centsValidator(10_000) },
  ]),
  ...section('money_terms', [
    { key: 'project_minimum', label: 'Project minimum', help: 'The smallest job we take, in cents.', audience: C, kind: 'money_cents', validate: centsValidator() },
    { key: 'deposit_percent', label: 'Deposit', help: 'Percent of the total that reserves the date.', audience: C, kind: 'percent', validate: percentValidator },
    { key: 'balance_terms', label: 'Balance terms', help: 'When and how the balance is paid, as the customer reads it.', audience: C, kind: 'long_text', validate: PARA },
    { key: 'tax_pointer', label: 'Where tax is set', help: 'The tax rate lives in sales settings; this says where.', audience: S, kind: 'text', validate: LINE },
    { key: 'rebook_rule', label: 'Returning-client rule', help: 'What a returning client pays for the same design.', audience: S, kind: 'long_text', validate: PARA },
    { key: 'budget_bands', label: 'Budget question', help: 'The answers offered to "What is your project budget?", in order.', audience: C, kind: 'list', validate: listValidator({ items: 'text', max: 12, itemMax: 60 }) },
  ]),
  ...section('offer', [
    { key: 'light_colors', label: 'Light colours', help: 'The colours we name. The assistants name no other.', audience: C, kind: 'list', validate: listValidator({ items: 'text', max: 30, itemMax: 80 }) },
    { key: 'colors_note', label: 'More colours', help: 'The one sentence that says more is possible.', audience: C, kind: 'text', validate: LINE },
    { key: 'palette_line', label: 'Our palettes, in one sentence', help: 'How we describe the colours as a whole.', audience: C, kind: 'long_text', validate: PARA },
    { key: 'included', label: 'What is included', help: 'What every customer gets.', audience: C, kind: 'list', validate: listValidator({ items: 'text', max: 20 }) },
    { key: 'lease_statement', label: 'The lease', help: 'The lights are leased, said as care, never as ownership.', audience: C, kind: 'long_text', validate: PARA },
    { key: 'lease_intro', label: 'The lease, introduced', help: 'The opening line of the lease section.', audience: C, kind: 'long_text', validate: PARA },
    { key: 'lease_benefits', label: 'Lease benefits', help: 'Title and sentence for each benefit. Keep every condition.', audience: C, kind: 'json', validate: recordList([{ name: 'title', max: 80 }, { name: 'body', max: 400 }], 20) },
    { key: 'color_change', label: 'Free colour change every year', help: 'Keep the condition: the design itself stays the same.', audience: C, kind: 'long_text', validate: PARA },
  ]),
  ...section('promises', [
    { key: 'quote_turnaround', label: 'Quote turnaround', help: 'When the quote arrives.', audience: C, kind: 'text', validate: LINE },
    { key: 'reply_time', label: 'Reply time', help: 'When a person answers.', audience: C, kind: 'text', validate: LINE },
    { key: 'maintenance_window', label: 'Maintenance', help: 'How fast an outage is fixed in season.', audience: C, kind: 'text', validate: LINE },
    { key: 'removal', label: 'Removal', help: 'When takedown begins.', audience: C, kind: 'text', validate: LINE },
  ]),
  ...section('service_area', [
    { key: 'statement', label: 'Service area', help: 'The sentence that says where we work.', audience: C, kind: 'long_text', validate: PARA },
    { key: 'cities', label: 'Example cities', help: 'Examples of where we work, never the limit.', audience: C, kind: 'list', validate: listValidator({ items: 'text', max: 200, itemMax: 80 }) },
  ]),
  ...section('season', [
    { key: 'start_month', label: 'Season starts', help: SEASON_UNDECIDED, audience: S, kind: 'number', validate: intValidator(1, 12, 'Month'), nullable: true },
    { key: 'removal_date', label: 'Removal starts', help: 'Month and day removal begins after the holidays (MM-DD).', audience: C, kind: 'text', validate: textValidator(5, MONTH_DAY) },
  ]),
  ...section('sales_process', [
    { key: 'follow_up_hours', label: 'Follow-up timing', help: 'Hours after our last message when each follow-up goes out.', audience: S, kind: 'list', validate: listValidator({ items: 'number', max: 3, ascending: true }) },
    { key: 'response_clocks', label: 'Response clocks', help: 'How long each step may wait before its badge goes red.', audience: S, kind: 'json', validate: objectOfNumbers },
    { key: 'lost_reasons', label: 'Lost reasons', help: 'The one list of reasons a lead is lost.', audience: S, kind: 'json', validate: recordList([{ name: 'key', max: 40 }, { name: 'label', max: 80 }], 30) },
    { key: 'went_quiet_days', label: 'Went quiet after', help: 'Days of silence after a quote before a lead counts as lost.', audience: S, kind: 'number', validate: intValidator(1, 365, 'Days') },
  ]),
  ...section('ai_rules', [
    { key: 'staff_names', label: 'Names the assistants never use', help: 'Customers never hear a staff name from a bot.', audience: S, kind: 'list', validate: listValidator({ items: 'text', max: 50, itemMax: 60 }) },
    { key: 'average_home', label: 'The average home, in one sentence', help: 'The only sentence a bot may use about a typical price.', audience: S, kind: 'long_text', validate: PARA },
  ]),
  ...section('costs', [
    { key: 'labor_per_crew_hour', label: 'Labour per crew hour', help: 'What an hour of a crew costs us. Not recorded yet.', audience: S, kind: 'money_cents', validate: centsValidator(1_000_000), nullable: true },
    { key: 'material_per_foot', label: 'Material per foot', help: 'What a foot of lights costs us. Not recorded yet.', audience: S, kind: 'money_cents', validate: centsValidator(100_000), nullable: true },
  ]),
  ...section('definitions', [
    { key: 'lead', label: 'A lead', help: 'What counts as a real lead.', audience: S, kind: 'long_text', validate: PARA },
    { key: 'close', label: 'A close', help: "What counts as a won job, built from the app's won stages.", audience: S, kind: 'long_text', validate: PARA },
    { key: 'season', label: 'A season', help: SEASON_UNDECIDED, audience: S, kind: 'long_text', validate: PARA, nullable: true },
  ]),
  ...section(
    'sops',
    SOP_SLOTS.map((slot) => ({
      key: slot.key,
      label: slot.label,
      help: slot.written ? 'The steps, in order. Edit a step, add one, remove one or move it.' : SOP_NOT_WRITTEN,
      audience: S,
      kind: 'sop' as const,
      validate: sopValidator,
      nullable: true,
    })),
  ),
  ...section('lessons', [
    {
      key: 'log',
      label: 'Lessons',
      help: 'What happened, what it cost, and the rule that prevents it. No customer names, emails or phone numbers.',
      audience: S,
      kind: 'json',
      validate: noPersonalData(
        recordList(
          [
            { name: 'title', max: 200 },
            { name: 'what_happened', max: 2000 },
            { name: 'cost', max: 1000, optional: true },
            { name: 'rule', max: 2000 },
          ],
          500,
          0,
        ),
      ),
    },
  ]),
]

/** One entry by `section.key`, or null. */
export function entryById(id: string): RegistryEntry | null {
  return REGISTRY.find((e) => e.id === id) ?? null
}

/** One entry by section and key, or null. */
export function entryFor(sectionKey: string, key: string): RegistryEntry | null {
  return entryById(`${sectionKey}.${key}`)
}

/** Every entry in one section, in registry order. */
export function entriesIn(sectionKey: string): readonly RegistryEntry[] {
  return REGISTRY.filter((e) => e.section === sectionKey)
}
