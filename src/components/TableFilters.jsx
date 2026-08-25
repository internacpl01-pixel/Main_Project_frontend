/**
 * Sorting and the three filters, shared by Imported Rows and the Ledger.
 *
 * Both screens are server-paged, so neither can sort or filter in the browser:
 * it holds fifty rows and the answer is usually not among them. Everything here
 * therefore produces query params and nothing here touches `rows`.
 *
 * One file rather than two copies. The two tables show the same statement data
 * at two stages of its life, and a filter that behaved differently on one of
 * them would be read as the data changing when it was posted.
 */
import { useEffect, useRef, useState } from 'react'
import {
  Calendar, Hash, Building2, ChevronDown, ChevronUp, X, Check, Search,
} from 'lucide-react'

// What the API takes for "rows with nothing in this column" — the rows whose
// account matched no bank are exactly the ones worth finding, and an empty
// string cannot ask for them because an empty param means "no filter".
export const NO_VALUE = '__none__'

export const EMPTY_FILTERS = { date_from: '', date_to: '', account: '', company: '' }

/** Only the filters that are actually set, ready to spread into a request. */
export function filterParams(f) {
  const out = {}
  Object.entries(f || {}).forEach(([k, v]) => { if (v) out[k] = v })
  return out
}

export function activeCount(f) {
  // A date range is one filter however many of its two ends are filled in.
  const { date_from, date_to, ...rest } = f || {}
  return (date_from || date_to ? 1 : 0) + Object.values(rest).filter(Boolean).length
}

/**
 * The next sort state for a header click: asc -> desc -> off.
 *
 * Three states, not two. On Imported Rows the un-sorted order is the order the
 * statement was read in, which is a real and often wanted view — with only two
 * states there is no way back to it short of reloading the page.
 */
export function nextSort(sort, dir, field) {
  if (sort !== field) return { sort: field, dir: 'asc' }
  if (dir === 'asc') return { sort: field, dir: 'desc' }
  return { sort: null, dir: 'asc' }
}

/** A clickable table header carrying the sort arrow. */
export function SortHeader({ field, label, sort, dir, onSort, title,
                             align = 'left', className = '' }) {
  const on = sort === field
  return (
    <th
      title={title ? `${title} — click to sort` : 'Click to sort'}
      onClick={() => onSort(field)}
      className={`px-6 py-3 text-xs font-medium tracking-wide whitespace-nowrap
        cursor-pointer select-none hover:bg-slate-100 transition-colors
        ${on ? 'text-slate-900' : 'text-slate-500'} ${className}`}
    >
      <div className={`flex items-center gap-1 ${
        align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''
      }`}>
        {label}
        {on
          ? (dir === 'asc'
              ? <ChevronUp className="h-3.5 w-3.5 text-primary-600" />
              : <ChevronDown className="h-3.5 w-3.5 text-primary-600" />)
          : <ChevronUp className="h-3 w-3 opacity-25" />}
      </div>
    </th>
  )
}

/** A button plus the panel it opens, closing on outside click or Escape. */
function Popover({ icon, label, summary, active, disabled, disabledHint, children }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    if (!open) return
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    // mousedown, not click: a click listener fires after React has already
    // re-rendered the panel, which closes it again the moment you pick a value.
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        disabled={disabled}
        title={disabled ? disabledHint : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm
          font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed
          ${active
            ? 'border-primary-300 bg-primary-50 text-primary-700'
            : 'border-slate-200 bg-white text-slate-600 enabled:hover:bg-slate-50'}`}
      >
        {icon}
        {label}
        {/* The chosen value on the button itself. A filter you cannot see is
            one you forget is on, and then the table looks like it lost rows. */}
        {active && summary && (
          <span className="max-w-[10rem] truncate rounded bg-primary-100 px-1.5 py-0.5 text-xs">
            {summary}
          </span>
        )}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 z-20 mt-1 w-72 rounded-xl border border-slate-200
                        bg-white p-3 shadow-lg">
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  )
}

/** A scrollable, searchable list of distinct values with their row counts. */
function ValueList({ facet, value, onPick, close, unit }) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const shown = (facet.values || []).filter(
    (v) => !needle || String(v.value).toLowerCase().includes(needle)
  )

  const Row = ({ picked, onClick, children, count }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5
        text-left text-sm hover:bg-slate-50 ${picked ? 'bg-primary-50 text-primary-700' : 'text-slate-700'}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Check className={`h-3.5 w-3.5 shrink-0 ${picked ? '' : 'invisible'}`} />
        <span className="truncate font-mono text-xs">{children}</span>
      </span>
      {count !== undefined && <span className="shrink-0 text-xs text-slate-400">{count}</span>}
    </button>
  )

  return (
    <div>
      {(facet.values || []).length > 6 && (
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find..."
            className="w-full rounded-lg border border-slate-200 py-1.5 pl-7 pr-2 text-sm"
          />
        </div>
      )}

      <div className="max-h-64 space-y-0.5 overflow-y-auto">
        <Row picked={!value} onClick={() => { onPick(''); close() }}>
          <span className="font-sans italic text-slate-500">All {unit}</span>
        </Row>

        {/* Offered only when such rows exist, so it never promises an empty
            result. On staging this is the useful one: no company means no bank
            record carries that account number. */}
        {facet.blank > 0 && (
          <Row
            picked={value === NO_VALUE}
            count={facet.blank}
            onClick={() => { onPick(NO_VALUE); close() }}
          >
            <span className="font-sans italic text-slate-500">(not set)</span>
          </Row>
        )}

        {shown.map((v) => (
          <Row
            key={v.value}
            picked={value === v.value}
            count={v.count}
            onClick={() => { onPick(v.value); close() }}
          >
            {v.value}
          </Row>
        ))}

        {needle && shown.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-slate-400">Nothing matches "{q}"</p>
        )}
      </div>
    </div>
  )
}

/**
 * The three filter buttons.
 *
 * `options` is what GET .../filters returned. A null facet in it means this
 * company has no such column — company_001 has an account number field and no
 * Company field — so that button greys out and says why, instead of offering a
 * filter that could only ever return nothing.
 */
export function FilterBar({ options, value, onChange, loading = false, className = '' }) {
  const f = value || EMPTY_FILTERS
  const set = (patch) => onChange({ ...f, ...patch })
  const n = activeCount(f)

  const date = options?.date
  const account = options?.account
  const company = options?.company

  // While the options are still in flight every button is disabled, and the
  // "no such field" hints would be a lie for that second — a company that has
  // the field would be told it does not. Say what is actually true instead.
  const hint = (missing) => (loading ? 'Loading filter values...' : missing)

  const dateSummary = f.date_from && f.date_to
    ? `${f.date_from} → ${f.date_to}`
    : f.date_from ? `from ${f.date_from}` : f.date_to ? `up to ${f.date_to}` : ''

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <Popover
        icon={<Calendar className="h-3.5 w-3.5" />}
        label={date?.label || 'Date'}
        summary={dateSummary}
        active={!!(f.date_from || f.date_to)}
        disabled={loading || !date}
        disabledHint={hint('This company has no date field mapped.')}
      >
        {() => (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">From</label>
              <input
                type="date"
                value={f.date_from}
                // Bounded by the data. A range outside it can only return
                // nothing, and an empty table reads as a bug, not as an answer.
                min={date?.min || undefined}
                max={f.date_to || date?.max || undefined}
                onChange={(e) => set({ date_from: e.target.value })}
                className="input w-full"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">To</label>
              <input
                type="date"
                value={f.date_to}
                min={f.date_from || date?.min || undefined}
                max={date?.max || undefined}
                onChange={(e) => set({ date_to: e.target.value })}
                className="input w-full"
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-400">
                {date?.min ? `Data runs ${date.min} to ${date.max}` : 'No dated rows yet'}
              </span>
              <button
                type="button"
                onClick={() => set({ date_from: '', date_to: '' })}
                className="text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </Popover>

      <Popover
        icon={<Hash className="h-3.5 w-3.5" />}
        label={account?.label || 'Account Number'}
        summary={f.account === NO_VALUE ? '(not set)' : f.account}
        active={!!f.account}
        disabled={loading || !account}
        disabledHint={hint('This company has no account number field mapped.')}
      >
        {({ close }) => (
          <ValueList
            facet={account}
            value={f.account}
            unit="accounts"
            onPick={(v) => set({ account: v })}
            close={close}
          />
        )}
      </Popover>

      <Popover
        icon={<Building2 className="h-3.5 w-3.5" />}
        label={company?.label || 'Company'}
        summary={f.company === NO_VALUE ? '(not set)' : f.company}
        active={!!f.company}
        disabled={loading || !company}
        disabledHint={hint('This company has no Company field mapped. Add one on the Custom Fields page.')}
      >
        {({ close }) => (
          <ValueList
            facet={company}
            value={f.company}
            unit="companies"
            onPick={(v) => set({ company: v })}
            close={close}
          />
        )}
      </Popover>

      {n > 0 && (
        <button
          type="button"
          onClick={() => onChange({ ...EMPTY_FILTERS })}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm
                     font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
          Clear {n === 1 ? 'filter' : `${n} filters`}
        </button>
      )}
    </div>
  )
}
