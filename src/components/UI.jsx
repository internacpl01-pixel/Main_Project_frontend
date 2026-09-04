import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

// `tone` and not a colour in `className`: Tailwind emits its utilities in its
// own order, so a text-white passed by a caller does not reliably beat the
// text-primary-600 written here — which is why the spinners on the Sign In and
// Export buttons were a blue circle on a blue button, i.e. no spinner at all.
// The colour is chosen here, from a fixed set, so it always wins.
const SPINNER_TONES = {
  primary: 'text-primary-600',
  white: 'text-white',
  slate: 'text-slate-400',
  // Follows whatever the surrounding text colour is.
  current: 'text-current',
}

export function Spinner({ size = 'md', tone = 'primary', className = '' }) {
  const sizeClasses = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' }
  return (
    <svg
      // Always spinning, slower when the system asks for less motion. A
      // stopped spinner is indistinguishable from a frozen screen, which is
      // the one thing this is here to rule out — so it is dampened rather than
      // switched off. It is small, it turns in place, and it is only on screen
      // while something is genuinely running.
      className={`animate-spin motion-reduce:[animation-duration:2s] ${SPINNER_TONES[tone] || SPINNER_TONES.primary} ${sizeClasses[size]} ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      role="status"
      aria-label="Loading"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

/**
 * Does this person want less movement on screen?
 *
 * Lives here rather than in the one page that first needed it, because the
 * global progress indicator asks the same question and two copies of a media
 * query is two things to keep in step.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const onChange = (e) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/**
 * The "these rows are being replaced" veil.
 *
 * Every table on this app is server-paged, so changing the page, the sort, a
 * filter or the search is a round trip. Blanking the table for it makes the
 * layout collapse and snap back; leaving it untouched makes a slow query look
 * like a click that did nothing. This does neither: the rows you were reading
 * stay exactly where they are, faded, with a spinner over them.
 *
 * Wrap the table's scroll container in a `relative` div and put this beside it
 * — not inside the scroller, whose box is as wide as the widest row, which
 * would centre the spinner somewhere off to the right.
 *
 * Pointer events are deliberately NOT disabled: for the moment a row is being
 * replaced, it should not be possible to open the editor on the version that
 * is about to disappear.
 */
export function TableBusy({ label = 'Loading rows...' }) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-start justify-center
                 bg-white/65 backdrop-blur-[1px] pt-16"
      aria-hidden="true"
    >
      <div className="flex items-center gap-2 rounded-full border border-slate-200
                      bg-white px-3 py-1.5 shadow-sm">
        <Spinner size="sm" />
        <span className="text-xs font-medium text-slate-500">{label}</span>
      </div>
    </div>
  )
}

/**
 * Grey bars in the shape of the table, for the first load — when there are no
 * rows yet to keep and fade.
 *
 * Skeletons rather than one spinner in an empty table: the rows keep their
 * height, so the page does not jump when the data arrives. Same treatment the
 * super admin console already gives its stat tiles.
 *
 * The widths repeat on a short cycle so the block reads as a table rather than
 * as a grid of identical blocks.
 */
const SKELETON_WIDTHS = ['w-24', 'w-16', 'w-32', 'w-20', 'w-28', 'w-12']

export function SkeletonRows({ cols = 4, rows = 8 }) {
  return Array.from({ length: rows }, (_, r) => (
    <tr key={r} className="animate-pulse">
      {Array.from({ length: Math.max(1, cols) }, (_, c) => (
        <td key={c} className="px-6 py-3.5">
          <div className={`h-3 rounded bg-slate-100 ${SKELETON_WIDTHS[(r + c) % SKELETON_WIDTHS.length]}`} />
        </td>
      ))}
    </tr>
  ))
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="text-center py-16">
      {icon && <div className="mx-auto mb-4 text-slate-400">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/**
 * `busy` is what this dialog confirms is actually happening.
 *
 * Everything it asks about is a delete, and the slow ones are the big ones —
 * emptying a ledger, clearing staging, dropping a column off temp_trans. While
 * that request was in flight this dialog used to sit completely unchanged with
 * both buttons live, so a second click sent a second DELETE and there was no
 * way to tell a slow delete from one that had not registered.
 *
 * While busy: the confirm button spins, both buttons are disabled, and the
 * backdrop stops closing the dialog — dismissing it would not stop the request,
 * it would only hide the fact that one is running.
 */
export function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, confirmText = 'Confirm', danger = false, busy = false }) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
      />
      <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button onClick={onClose} disabled={busy} className="btn-secondary text-sm">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={danger ? 'btn-danger text-sm' : 'btn-primary text-sm'}
          >
            {busy && <Spinner size="sm" tone="white" className="mr-2" />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  if (!isOpen) return null
  // '2xl' exists for the Check Rules dialog, which shows a table whose columns
  // the user chooses — at max-w-4xl a narration plus two picked columns had
  // nowhere to go.
  const sizes = {
    sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl',
    xl: 'max-w-4xl', '2xl': 'max-w-6xl',
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-xl shadow-xl w-full ${sizes[size]} max-h-[85vh] flex flex-col`}>
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="overflow-y-auto px-6 py-4 flex-1">{children}</div>
      </div>
    </div>
  )
}

// Known values are offered as a datalist, not a <select> — `method` is free
// text on purpose, so anything can be typed and the list is only a shortcut.
const METHOD_SUGGESTIONS = ['import', 'selection', 'rule']

export function MethodInput({ value, onChange, id = 'method-options' }) {
  return (
    <div>
      <label className="label">Method</label>
      <input
        list={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input max-w-xs"
        placeholder="e.g. import"
      />
      <datalist id={id}>
        {METHOD_SUGGESTIONS.map((m) => <option key={m} value={m} />)}
      </datalist>
      <p className="text-xs text-slate-400 mt-1">
        What this field is for — read off the statement (import), chosen during
        review (selection), tested by a classification rule (rule), or anything
        else you type.
      </p>
    </div>
  )
}

export function MethodBadge({ value }) {
  if (!value) return <span className="text-xs text-slate-300">—</span>
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-100">
      {value}
    </span>
  )
}

/**
 * Server-side pager. `total` is the unpaged row count from the API, never
 * rows.length — the whole point is that the client holds one page and cannot
 * count the rest.
 *
 * Renders nothing when everything fits on one page, so a page with six rows
 * does not grow a pagination bar reading "1".
 */
export function Pagination({ page, limit, total, onPage, onLimit }) {
  const pages = Math.max(1, Math.ceil((total || 0) / (limit || 50)))
  if (pages <= 1 && !onLimit) return null

  // A window around the current page rather than every page button. At 400
  // pages the full list wraps over the table and stops being clickable.
  const WINDOW = 5
  let start = Math.max(1, page - Math.floor(WINDOW / 2))
  const end = Math.min(pages, start + WINDOW - 1)
  start = Math.max(1, end - WINDOW + 1)
  const window = []
  for (let p = start; p <= end; p++) window.push(p)

  const first = total === 0 ? 0 : (page - 1) * limit + 1
  const last = Math.min(page * limit, total)

  const navBtn = 'px-2.5 py-1.5 rounded-lg text-sm border border-slate-200 bg-white text-slate-600 enabled:hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-t border-slate-200">
      <div className="text-xs text-slate-500">
        {total === 0
          ? 'No rows'
          : <>Showing <span className="font-medium text-slate-700">{first.toLocaleString('en-IN')}</span>–<span className="font-medium text-slate-700">{last.toLocaleString('en-IN')}</span> of <span className="font-medium text-slate-700">{total.toLocaleString('en-IN')}</span></>}
      </div>

      <div className="flex items-center gap-1.5">
        {onLimit && (
          <select
            value={limit}
            onChange={(e) => onLimit(Number(e.target.value))}
            className="mr-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600"
            title="Rows per page"
          >
            {[25, 50, 100, 250, 500].map((n) => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>
        )}

        <button onClick={() => onPage(1)} disabled={page <= 1} className={navBtn} title="First page">«</button>
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} className={navBtn}>Prev</button>

        {window.map((p) => (
          <button
            key={p}
            onClick={() => onPage(p)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              p === page
                ? 'bg-primary-600 text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {p}
          </button>
        ))}

        <button onClick={() => onPage(page + 1)} disabled={page >= pages} className={navBtn}>Next</button>
        <button onClick={() => onPage(pages)} disabled={page >= pages} className={navBtn} title="Last page">»</button>
      </div>
    </div>
  )
}

// `list` is optional and wires the input to a <datalist> the caller renders,
// for the cases where the search term is one of a known set rather than free
// text.
// A password field that can be read back.
//
// Every password on this app is one someone is typing for the first time — a
// new user's, a reset, a bank's PDF password read off an SMS. There is nothing
// remembered to fall back on when the dots do not match what was meant, so the
// choice is between checking it and finding out at the next screen.
//
// Visibility is this component's own state, and it snaps back to hidden the
// moment the field is emptied. That covers both a form being reset and the user
// clearing it by hand, so a revealed password never carries over into the next
// thing typed here. The button only exists once there is something to reveal.
export function PasswordInput({
  value, onChange, placeholder, autoComplete = 'new-password', autoFocus,
  onKeyDown, icon, invalid, required, className = '',
}) {
  const [show, setShow] = useState(false)
  useEffect(() => { if (!value) setShow(false) }, [value])

  return (
    <div className="relative">
      {icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          {icon}
        </span>
      )}
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        // Native form validation, for the one place this sits inside a <form>
        // and submit is expected to stop on an empty field.
        required={required}
        placeholder={placeholder}
        className={`input ${icon ? 'pl-9' : ''} pr-10 ${
          invalid ? 'border-red-300 focus:ring-red-200' : ''
        } ${className}`}
      />
      {value && (
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          // Out of the tab order: tabbing off a password field goes to the next
          // field, not to a button that shows what was just typed.
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
          title={show ? 'Hide password' : 'Show password'}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      )}
    </div>
  )
}

// Mark up every occurrence of `terms` inside `text`.
//
// The terms come from the server, which is what decided the row matched in the
// first place — re-deriving them from the query string here would give two
// implementations of "what counts as a match" and they would disagree the first
// time either side changed.
//
// Longest first: with "1500" and "150" both live, splitting on the shorter one
// first would cut the longer match in half and mark only part of it.
export function Highlight({ text, terms }) {
  const s = text === null || text === undefined ? '' : String(text)
  if (!s) return s
  const list = (terms || []).filter(Boolean)
  if (!list.length) return s

  const pattern = list
    .map(String)
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')

  // One capture group, so split() puts the matches at the odd indices.
  const parts = s.split(new RegExp(`(${pattern})`, 'gi'))
  if (parts.length === 1) return s
  return parts.map((part, i) =>
    i % 2 === 1
      ? <mark key={i} className="rounded-sm bg-amber-200 px-0.5 text-inherit">{part}</mark>
      : part
  )
}

// Does `value` contain one of the terms once digit grouping is out of the way?
//
// A number is printed with separators (1,50,000.00) and stored without them, so
// a term will never line up character-for-character with what is on screen —
// this is the one place the displayed text and the searched text differ. Both
// sides lose their commas before comparing, and the caller marks the whole
// figure rather than part of it: half a number highlighted reads as a typo.
export function matchesNumber(value, terms) {
  const plain = String(value).replace(/,/g, '').toLowerCase()
  return (terms || []).some((t) => {
    const q = String(t).replace(/,/g, '').toLowerCase()
    return q && plain.includes(q)
  })
}

export function SearchInput({ value, onChange, placeholder, onClear, list }) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
        <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <input
        type="text"
        list={list}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Search...'}
        className="input pl-9 pr-9"
      />
      {value && (
        <button
          onClick={onClear}
          className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 cursor-pointer"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
