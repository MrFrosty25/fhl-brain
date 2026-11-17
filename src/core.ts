// THE BRAIN'S CORE — resolving, reading, drafting, publishing, history.
//
// Owner, 2026-11-16: "we should have both abilities: to change the full
// OPERATING SYSTEM, or to pick and choose what changes."
//
// ─── THE MODEL, IN ONE PARAGRAPH ─────────────────────────────────────────────
//
// Every entry in `registry.ts` has a built-in DEFAULT (today's reviewed value,
// passed in by the platform). The database holds at most one row per entry
// per company: the PUBLISHED value every tool reads, and optionally a DRAFT
// waiting to go live. An edit only ever writes a draft. Publishing — all of
// them, or the ones picked — moves each draft to published and appends one
// row to the history. Revert puts an old version back as a draft. Import
// creates drafts only. So nothing reaches a tool without somebody pressing
// Publish.
//
// ─── STORAGE SHAPE ───────────────────────────────────────────────────────────
//
// `brain_entries.value` and `draft_value` are jsonb and `value` is NOT NULL,
// so every value is stored in an envelope, `{ "v": <value> }`. That lets an
// entry legitimately hold null ("not recorded yet") and keeps a JSON null from
// ever being sent as SQL NULL. A row at `version` 0 has never been published:
// it exists only to carry a draft, and its `value` is ignored.
//
// ─── IT NEVER THROWS AT A TOOL ───────────────────────────────────────────────
//
// `readBrain` is what every tool calls. If the database cannot be read, it
// returns the defaults with `unreadable: true` — a tool keeps working on
// today's reviewed values and can say so. A stored value that no longer passes
// its validator is ignored the same way, and named in `problems`.
//
// Pure: no I/O except through the injected `db`. No imports outside this folder.

import { REGISTRY, entryById, validationContextFrom, type Audience, type Kind, type RegistryEntry, type ValidationContext } from './registry.ts'

// ─── Types ──────────────────────────────────────────────────────────────────

export type Source = 'brain' | 'default'

/** `section.key` → the built-in value. Every registry entry must have one. */
export type BrainDefaults = Readonly<Record<string, unknown>>

/** What a value is stored as. See "STORAGE SHAPE" above. */
export interface Envelope {
  readonly v: unknown
}

/** A `brain_entries` row, as the database returns it. */
export interface BrainRow {
  readonly id: string
  readonly org_id: string
  readonly section: string
  readonly key: string
  readonly value: unknown
  readonly audience?: string | null
  readonly version: number
  readonly draft_value?: unknown
  readonly draft_by?: string | null
  readonly draft_at?: string | null
  readonly published_by?: string | null
  readonly published_at?: string | null
}

/** A `brain_entry_versions` row. */
export interface BrainVersionRow {
  readonly id?: string
  readonly entry_id: string
  readonly org_id: string
  readonly section: string
  readonly key: string
  readonly value: unknown
  readonly version: number
  readonly published_by?: string | null
  readonly published_at?: string | null
  readonly note?: string | null
}

export interface ResolvedEntry {
  readonly id: string
  readonly section: string
  readonly key: string
  readonly label: string
  readonly help: string
  readonly audience: Audience
  readonly kind: Kind
  readonly nullable: boolean
  /** The value tools use. */
  readonly value: unknown
  readonly source: Source
  /** The built-in value, so a screen can show what "Built-in" means. */
  readonly defaultValue: unknown
  /** 0 when never published. */
  readonly version: number
  readonly publishedAt: string | null
  readonly publishedBy: string | null
  /** A change waiting to be published, or null. Dropped for customer reads. */
  readonly draft: { readonly value: unknown; readonly at: string | null; readonly by: string | null } | null
}

export interface Brain {
  readonly entries: readonly ResolvedEntry[]
  /** `section.key` → effective value. */
  readonly values: Readonly<Record<string, unknown>>
  /** True when the database could not be read and these are the defaults. */
  readonly unreadable: boolean
  /** Anything ignored on the way, in plain words. Never a customer's data. */
  readonly problems: readonly string[]
  /**
   * Entries whose stored value failed (or broke) its validator. Each one alone
   * falls back to its built-in value; the rest of the Brain is unaffected.
   */
  readonly invalid: readonly string[]
}

export interface ReadOptions {
  /** Only these sections. */
  readonly sections?: readonly string[]
  /** 'customer' drops every staff entry and every draft. */
  readonly audience?: Audience
}

/** The injected database: a Supabase client, or anything shaped like one. */
export interface BrainDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any
}

export const ENTRIES_TABLE = 'brain_entries'
export const VERSIONS_TABLE = 'brain_entry_versions'

// ─── Small helpers ──────────────────────────────────────────────────────────

export function wrap(value: unknown): Envelope {
  return { v: value === undefined ? null : value }
}

/** The value inside an envelope, or `undefined` when it is not one. */
export function unwrap(stored: unknown): unknown {
  if (typeof stored === 'object' && stored !== null && !Array.isArray(stored) && 'v' in stored) {
    return (stored as Envelope).v
  }
  return undefined
}

export function hasDraft(row: Pick<BrainRow, 'draft_value'>): boolean {
  return unwrap(row.draft_value) !== undefined
}

/** Deep equality for JSON values. */
export function sameValue(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  )
}

function rowId(row: Pick<BrainRow, 'section' | 'key'>): string {
  return `${row.section}.${row.key}`
}

/** Every registry entry with no default, or a default its own validator refuses. */
/** Run a validator without letting it throw. */
export function safeValidate(entry: RegistryEntry, value: unknown, ctx?: ValidationContext): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return entry.validate(value, ctx)
  } catch (err) {
    return { ok: false, error: `validator failed (${err instanceof Error ? err.message : 'unknown'})` }
  }
}

export function checkDefaults(defaults: BrainDefaults): readonly string[] {
  const out: string[] = []
  if (!defaults) return ['no defaults given']
  const ctx = validationContextFrom(defaults)
  for (const e of REGISTRY) {
    if (!(e.id in defaults)) {
      out.push(`${e.id}: no default`)
      continue
    }
    const r = safeValidate(e, defaults[e.id], ctx)
    if (!r.ok) out.push(`${e.id}: default refused (${r.error})`)
  }
  for (const id of Object.keys(defaults)) if (!entryById(id)) out.push(`${id}: not in the registry`)
  return out
}

// ─── Resolve ────────────────────────────────────────────────────────────────

/**
 * The effective Brain: for every registry entry, the published value if there
 * is a good one, else the default. Rows for unknown keys are ignored.
 */
export function resolveBrain(rows: readonly BrainRow[], given: BrainDefaults | null | undefined): Brain {
  const defaults: BrainDefaults = given ?? {}
  const problems: string[] = []
  const invalid: string[] = []
  if (!given) problems.push('No built-in values were given; unset entries are null.')
  const ctx = validationContextFrom(defaults)
  const byId = new Map<string, BrainRow>()
  for (const row of rows ?? []) {
    if (!row || typeof row.section !== 'string' || typeof row.key !== 'string') {
      problems.push('a row with no section or key was ignored')
      continue
    }
    const id = rowId(row)
    if (!entryById(id)) {
      problems.push(`${id}: not in the registry, ignored`)
      continue
    }
    byId.set(id, row)
  }

  const entries: ResolvedEntry[] = REGISTRY.map((e) => {
    const fallback = defaults[e.id] === undefined ? null : defaults[e.id]
    const row = byId.get(e.id)
    let value: unknown = fallback
    let source: Source = 'default'
    if (row && row.version >= 1) {
      const stored = unwrap(row.value)
      const check = stored === undefined ? null : safeValidate(e, stored, ctx)
      if (check && check.ok) {
        value = check.value
        source = 'brain'
      } else {
        invalid.push(e.id)
        problems.push(`${e.id}: published value is not valid, using the built-in value`)
      }
    }
    const draftValue = row ? unwrap(row.draft_value) : undefined
    return {
      id: e.id,
      section: e.section,
      key: e.key,
      label: e.label,
      help: e.help,
      audience: e.audience,
      kind: e.kind,
      nullable: e.nullable,
      value,
      source,
      defaultValue: fallback,
      version: row && row.version >= 1 ? row.version : 0,
      publishedAt: row && row.version >= 1 ? (row.published_at ?? null) : null,
      publishedBy: row && row.version >= 1 ? (row.published_by ?? null) : null,
      draft: draftValue === undefined ? null : { value: draftValue, at: row?.draft_at ?? null, by: row?.draft_by ?? null },
    }
  })

  return { entries, values: valuesOf(entries), unreadable: false, problems, invalid }
}

function valuesOf(entries: readonly ResolvedEntry[]): Record<string, unknown> {
  return Object.fromEntries(entries.map((e) => [e.id, e.value]))
}

/** Narrow a Brain to some sections and/or an audience. */
export function filterBrain(brain: Brain, opts: ReadOptions = {}): Brain {
  let entries = brain.entries
  if (opts.sections) {
    const keep = new Set(opts.sections)
    entries = entries.filter((e) => keep.has(e.section))
  }
  if (opts.audience === 'customer') {
    entries = entries.filter((e) => e.audience === 'customer').map((e) => ({ ...e, draft: null }))
  }
  const keep = new Set(entries.map((e) => e.id))
  return { ...brain, entries, values: valuesOf(entries), invalid: brain.invalid.filter((id) => keep.has(id)) }
}

/** The defaults alone, as a Brain. */
export function defaultBrain(defaults: BrainDefaults | null | undefined, opts: ReadOptions = {}): Brain {
  return filterBrain(resolveBrain([], defaults), opts)
}

/**
 * THE CONNECTOR. What every tool calls. NEVER THROWS: on any failure it
 * returns the defaults with `unreadable: true`.
 */
export async function readBrain(
  db: BrainDb,
  orgId: string,
  defaults: BrainDefaults | null | undefined,
  opts: ReadOptions = {},
): Promise<Brain> {
  try {
    let query = db.from(ENTRIES_TABLE).select('*').eq('org_id', orgId)
    if (opts.sections && opts.sections.length > 0 && typeof query.in === 'function') {
      query = query.in('section', opts.sections as string[])
    }
    const { data, error } = await query
    if (error) throw new Error(typeof error.message === 'string' ? error.message : 'read failed')
    if (!Array.isArray(data)) throw new Error('no rows returned')
    return filterBrain(resolveBrain(data as BrainRow[], defaults), opts)
  } catch (err) {
    const base = defaultBrain(defaults, opts)
    const why = err instanceof Error ? err.message : 'unknown error'
    return { ...base, unreadable: true, problems: [`The Brain could not be read (${why}); using built-in values.`] }
  }
}

/** One value from a Brain, typed by the caller. */
export function brainValue<T>(brain: Brain, id: string): T {
  return brain.values[id] as T
}

// ─── Draft ──────────────────────────────────────────────────────────────────

export type DraftPlan =
  | {
      readonly ok: true
      readonly id: string
      readonly section: string
      readonly key: string
      readonly audience: Audience
      /** The draft to store, already wrapped. Null means "clear the draft": the value equals what is live. */
      readonly draftValue: Envelope | null
    }
  | { readonly ok: false; readonly error: string }

/**
 * Validate a proposed value and say what to store. `current` is the value
 * live now: a draft equal to it clears the draft rather than storing a
 * change that changes nothing.
 */
export function planDraft(id: string, value: unknown, current?: unknown, ctx?: ValidationContext): DraftPlan {
  const entry: RegistryEntry | null = entryById(id)
  if (!entry) return { ok: false, error: `Unknown entry "${id}".` }
  const check = safeValidate(entry, value, ctx)
  if (!check.ok) return { ok: false, error: `${entry.label}: ${check.error}` }
  const unchanged = current !== undefined && sameValue(check.value, current)
  return {
    ok: true,
    id,
    section: entry.section,
    key: entry.key,
    audience: entry.audience,
    draftValue: unchanged ? null : wrap(check.value),
  }
}

// ─── Publish ────────────────────────────────────────────────────────────────

export interface PublishUpdate {
  readonly rowId: string
  /** Only update when the row is still at this version (optimistic lock). */
  readonly expectVersion: number
  /**
   * ...and still carries the draft that was read (its `draft_at`). A newer
   * draft saved while publishing must neither go live unseen nor be wiped.
   */
  readonly expectDraftAt: string | null
  readonly set: {
    readonly value: Envelope
    readonly version: number
    readonly draft_value: null
    readonly draft_by: null
    readonly draft_at: null
    readonly published_by: string | null
    readonly published_at: string
  }
}

/**
 * `updates[i]` and `versions[i]` are one entry. THE ORDER TO CARRY IT OUT:
 * insert `versions[i]` first (so a live value never lacks its history — and
 * the unique (entry_id, version) stops two publishes of one entry), then the
 * update, locked on version AND draft_at. If the update finds nothing, delete
 * that history row again: it was never live.
 */
export interface PublishPlan {
  readonly updates: readonly PublishUpdate[]
  readonly versions: readonly BrainVersionRow[]
  /** Asked for but nothing to publish. */
  readonly skipped: readonly string[]
  /** Drafts that no longer pass their validator; left as drafts. */
  readonly refused: readonly { readonly id: string; readonly error: string }[]
}

export function planPublish(
  rows: readonly BrainRow[],
  keys: readonly string[] | 'all',
  meta: { readonly by: string | null; readonly note?: string | null; readonly now: string; readonly ctx?: ValidationContext },
): PublishPlan {
  const want = keys === 'all' ? null : new Set(keys)
  const updates: PublishUpdate[] = []
  const versions: BrainVersionRow[] = []
  const refused: { id: string; error: string }[] = []
  const note = meta.note?.trim() ? meta.note.trim().slice(0, 500) : null

  for (const row of rows) {
    const id = rowId(row)
    if (want && !want.has(id)) continue
    const draft = unwrap(row.draft_value)
    if (draft === undefined) continue
    const entry = entryById(id)
    if (!entry) {
      refused.push({ id, error: 'not in the registry' })
      continue
    }
    const check = safeValidate(entry, draft, meta.ctx)
    if (!check.ok) {
      refused.push({ id, error: check.error })
      continue
    }
    const version = Math.max(0, row.version) + 1
    const value = wrap(check.value)
    updates.push({
      rowId: row.id,
      expectVersion: row.version,
      expectDraftAt: row.draft_at ?? null,
      set: {
        value,
        version,
        draft_value: null,
        draft_by: null,
        draft_at: null,
        published_by: meta.by,
        published_at: meta.now,
      },
    })
    versions.push({
      entry_id: row.id,
      org_id: row.org_id,
      section: row.section,
      key: row.key,
      value,
      version,
      published_by: meta.by,
      published_at: meta.now,
      note,
    })
  }

  const published = new Set(versions.map((v) => `${v.section}.${v.key}`))
  const refusedIds = new Set(refused.map((r) => r.id))
  const skipped = want
    ? [...want].filter((id) => !published.has(id) && !refusedIds.has(id))
    : []
  return { updates, versions, skipped, refused }
}

// ─── Discard ────────────────────────────────────────────────────────────────

export interface DiscardPlan {
  /** Rows to clear the draft on. */
  readonly clear: readonly string[]
  /** Rows that existed only to carry a draft (never published): delete them. */
  readonly remove: readonly string[]
}

export function planDiscard(rows: readonly BrainRow[], keys: readonly string[] | 'all'): DiscardPlan {
  const want = keys === 'all' ? null : new Set(keys)
  const clear: string[] = []
  const remove: string[] = []
  for (const row of rows) {
    if (want && !want.has(rowId(row))) continue
    if (!hasDraft(row)) continue
    if (row.version < 1) remove.push(row.id)
    else clear.push(row.id)
  }
  return { clear, remove }
}

// ─── Revert ─────────────────────────────────────────────────────────────────

/**
 * Put an old published version back — AS A DRAFT. It goes live when it is
 * published, like every other change, so a revert can be checked first.
 */
export function planRevert(version: Pick<BrainVersionRow, 'section' | 'key' | 'value'>, current?: unknown, ctx?: ValidationContext): DraftPlan {
  const value = unwrap(version.value)
  if (value === undefined) return { ok: false, error: 'That version has no value.' }
  return planDraft(`${version.section}.${version.key}`, value, current, ctx)
}

// ─── Export and import ──────────────────────────────────────────────────────

export const EXPORT_FORMAT = 'fhl-brain'
export const EXPORT_FORMAT_VERSION = 1

export interface BrainExport {
  readonly format: typeof EXPORT_FORMAT
  readonly formatVersion: number
  readonly exportedAt: string
  /** `section.key` → { value, source, version }. */
  readonly entries: Readonly<Record<string, { readonly value: unknown; readonly source: Source; readonly version: number }>>
}

/** The whole Brain as one JSON document: the values tools use today. */
export function exportBrain(brain: Brain, now: string): BrainExport {
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: now,
    entries: Object.fromEntries(
      brain.entries.map((e) => [e.id, { value: e.value, source: e.source, version: e.version }]),
    ),
  }
}

export interface ImportPlan {
  readonly ok: boolean
  /** Changes to store as drafts. Nothing is published by an import. */
  readonly drafts: readonly { readonly id: string; readonly value: unknown }[]
  readonly unchanged: number
  readonly unknown: readonly string[]
  readonly errors: readonly { readonly id: string; readonly error: string }[]
  /** Set when the document itself is not a Brain export. */
  readonly error?: string
}

/**
 * Read an exported document and work out which entries differ from the Brain
 * now. ONLY EVER DRAFTS: the owner reviews them and publishes the ones wanted.
 * Accepts `{ entries: { id: { value } } }` or `{ entries: { id: value } }`.
 */
export function importAsDrafts(doc: unknown, current: Brain): ImportPlan {
  const empty = { drafts: [], unchanged: 0, unknown: [], errors: [] }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { ok: false, ...empty, error: 'Not a Brain export.' }
  }
  const d = doc as Record<string, unknown>
  if (d.format !== undefined && d.format !== EXPORT_FORMAT) return { ok: false, ...empty, error: 'Not a Brain export.' }
  const raw = d.entries
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, ...empty, error: 'The export has no entries.' }
  }
  const now = new Map(current.entries.map((e) => [e.id, e.value]))
  const drafts: { id: string; value: unknown }[] = []
  const unknown: string[] = []
  const errors: { id: string; error: string }[] = []
  let unchanged = 0
  const ctx = validationContextFrom(current.values)
  for (const [id, item] of Object.entries(raw as Record<string, unknown>)) {
    const entry = entryById(id)
    if (!entry) {
      unknown.push(id)
      continue
    }
    const value =
      typeof item === 'object' && item !== null && !Array.isArray(item) && 'value' in item
        ? (item as { value: unknown }).value
        : item
    const plan = planDraft(id, value, now.get(id), ctx)
    if (!plan.ok) {
      errors.push({ id, error: plan.error })
      continue
    }
    if (plan.draftValue === null) {
      unchanged++
      continue
    }
    drafts.push({ id, value: plan.draftValue.v })
  }
  return { ok: true, drafts, unchanged, unknown, errors }
}
