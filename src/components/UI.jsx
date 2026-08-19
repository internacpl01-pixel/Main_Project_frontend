import { useState } from 'react'

export function Spinner({ size = 'md', className = '' }) {
  const sizeClasses = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' }
  return (
    <svg
      className={`animate-spin text-primary-600 ${sizeClasses[size]} ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
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

export function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, confirmText = 'Confirm', danger = false }) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn-secondary text-sm">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={danger ? 'btn-danger text-sm' : 'btn-primary text-sm'}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  if (!isOpen) return null
  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }
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
