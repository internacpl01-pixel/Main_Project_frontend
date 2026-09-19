import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  fetchFarvisionVerifyRowsViaJob, fetchFarvisionVerifyCandidates,
  resolveFarvisionVerifyRow, resolveFarvisionVerifyDescription,
  resolveFarvisionVerifyTdsRate, exportFarvisionViaJob,
} from '../api/endpoints.js'
import { Spinner, EmptyState, SearchableSelect, Pagination } from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import toast from 'react-hot-toast'
import { Download, ArrowLeft, CheckCircle2, Check, Info } from 'lucide-react'

const ACCOUNT_HEAD_COLUMN = 'Account Head'
// A Farvision Verify-only column, not one of farvision.py's COLUMNS -- never
// exported, confirmed with the user. Injected into the rendered header/row
// right after Description (see displayColumns below) since it isn't part of
// the server's own column list.
const TDS_RATE_COLUMN = 'TDS Rate'
const TDS_RATE_PRESETS = ['1%', '2%', '10%']

// Dates arrive ISO, numbers as numbers, everything else as the bank wrote
// it. Only null/undefined become a dash -- 0 is a value the row actually has.
const showValue = (v) => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10)
  return String(v)
}

// Filters come from the Imported Rows page's own "Export Farvision" button, so
// this review step looks at exactly the same rows that button used to export
// directly -- confirmed with the user. Landing on this page with no filters
// (e.g. a bookmarked URL) just reviews every row across every batch, the same
// way export-farvision itself falls back to no filter -- a page at a time
// here, though: matching every row against the Account Head master is real
// work, so this page fetches 50 at a time (see load/page below) rather than
// the whole filtered set in one request the way the export itself still does.
//
// Every Farvision export column is shown, not just Narration/Account Head --
// confirmed with the user: this reviews the row the export will actually
// write, not a narrow summary of it. Every row is shown too, matched or not
// -- the same shape as the Check Rules dialog: a confident match is plain
// text with a "Not correct?" override, a row with no confident match (blank,
// or a genuine conflict between candidates) shows its dropdown immediately,
// and "Skip for now" is always there to move on without deciding. Skipping
// only hides a row's controls for this open page -- nothing is written, so
// it comes back next visit exactly as it was.
export default function FarvisionVerifyPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const filters = location.state?.filters || {}

  const [columns, setColumns] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  // Server-paginated (services/farvision.py matches each row against a
  // ~7,900-row Account Head master -- doing that for a whole batch just to
  // show one screen of it was measured at 10+ seconds and several megabytes
  // for a 253-row batch). page is 1-based to match the API; total/pageSize
  // come back with each response, since page 1 always knows both.
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  // The full Account Head / Bank Name pools, fetched once (cached across
  // pages and re-visits -- see fetchFarvisionVerifyCandidates) rather than
  // repeated on every row: a row whose own "options" comes back null falls
  // back to this instead.
  const [candidates, setCandidates] = useState({ bank_names: [], account_heads: {}, descriptions: [] })
  // The loading job's own reading (services/jobs.py) -- {percent, message} --
  // real progress, ticked once per row actually matched (see
  // services/farvision.py's fetch_rows on_row), not a number invented to
  // fill the wait while the page loads.
  const [loadProgress, setLoadProgress] = useState(null)
  // null, or which kind is currently downloading -- so each button shows its
  // own spinner instead of both greying out for one export.
  const [exporting, setExporting] = useState(null)
  // The running job's own status line and percent (services/jobs.py), shown
  // beside the spinner instead of a bare "Exporting..." that says nothing for
  // however long the job takes. Real, not simulated -- ticked once per row
  // actually matched (see _build_farvision_export's job_id/on_row), the same
  // as the Farvision Verify listing's own loading spinner above.
  const [exportMessage, setExportMessage] = useState('')
  const [exportPercent, setExportPercent] = useState(null)

  // Per-row id: 'saving' | 'saved' | an error message. Drives the small
  // status shown beside that row's dropdown once it's been touched.
  const [rowState, setRowState] = useState({})
  // Same shape as rowState, but for the Description override -- kept
  // separate so saving one doesn't show a stray status next to the other.
  const [descState, setDescState] = useState({})
  // Same shape again, for the TDS Rate field.
  const [tdsRateState, setTdsRateState] = useState({})
  // Ids currently showing their override dropdown -- only ever matched rows;
  // an unmatched row's dropdown is always shown, so it never needs this.
  const [overriding, setOverriding] = useState(() => new Set())
  // Ids marked "skip for now" -- client-only, undoable, never sent to the
  // server.
  const [skipped, setSkipped] = useState(() => new Set())
  // Ids currently showing the raw bank Description under Narration -- purely
  // a client-side convenience toggle for picking an Account Head, never part
  // of what gets exported (confirmed with the user).
  const [showDesc, setShowDesc] = useState(() => new Set())
  // Ids currently showing the Description override dropdown -- lets any row
  // change its auto-computed Description/Deduction Type (e.g. to "TDS
  // PAYABLE (NIL)"), confirmed with the user, not just rows that came back
  // blank.
  const [editingDescription, setEditingDescription] = useState(() => new Set())

  const load = (targetPage = page, targetPageSize = pageSize) => {
    setLoading(true)
    setLoadProgress(null)
    fetchFarvisionVerifyRowsViaJob(
      { ...filters, page: targetPage, page_size: targetPageSize },
      (job) => setLoadProgress({ percent: job.percent, message: job.message }),
    )
      .then((data) => {
        setColumns(Array.isArray(data?.columns) ? data.columns : [])
        setRows(Array.isArray(data?.rows) ? data.rows : [])
        setTotal(Number.isFinite(data?.total) ? data.total : 0)
        setPageSize(Number.isFinite(data?.page_size) ? data.page_size : targetPageSize)
        setPage(targetPage)
        // A row's own overrides/skips are page-local -- landing on a new
        // page starts clean rather than carrying stale state for ids that
        // are no longer even on screen.
        setRowState({})
        setOverriding(new Set())
        setSkipped(new Set())
        setDescState({})
        setEditingDescription(new Set())
        setTdsRateState({})
      })
      .catch((err) => toast.error(err.message))
      .finally(() => { setLoading(false); setLoadProgress(null) })
  }

  const handlePage = (p) => load(p, pageSize)
  const handlePageSize = (n) => load(1, n)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load(1, pageSize)
    fetchFarvisionVerifyCandidates()
      .then((data) => setCandidates({
        bank_names: Array.isArray(data?.bank_names) ? data.bank_names : [],
        account_heads: data?.account_heads && typeof data.account_heads === 'object'
          ? data.account_heads : {},
        descriptions: Array.isArray(data?.descriptions) ? data.descriptions : [],
      }))
      .catch((err) => toast.error(err.message))
  }, [])

  // A row's own "options" (services/farvision.py's fetch_rows) is null when
  // it had nothing more specific to offer -- the shared pool fetched once
  // above is what a dropdown falls back to then, keyed by whether this is an
  // Internal-transfer row (Bank Names) or a normal one (this row's own
  // company's Account Heads).
  // TDS Rate is display-only (see TDS_RATE_COLUMN above) -- not one of the
  // server's own `columns` (farvision.py's real export COLUMNS), so it's
  // injected here purely for rendering, right after Description.
  const displayColumns = columns.flatMap((col) => (
    col === 'Description' ? [col, TDS_RATE_COLUMN] : [col]
  ))

  const optionsFor = (row) => {
    if (Array.isArray(row.options)) return row.options
    if (row.internal) return candidates.bank_names
    return candidates.account_heads[row.company] || []
  }

  // The full pool a row could ever match against -- always the whole
  // company's Account Head master (or every Bank Name for an Internal
  // row), regardless of how short row.options is. Passed as
  // SearchableSelect's searchPool so a manual search always reaches every
  // real entry even when the row's own suggested list guessed wrong or
  // only offered a few candidates -- confirmed with the user as the actual
  // problem: the suggestions are fine, but typing was stuck searching only
  // that short list instead of the master itself.
  const fullPoolFor = (row) => (row.internal ? candidates.bank_names : candidates.account_heads[row.company] || [])

  const handleResolve = async (row, accountHead) => {
    if (!accountHead) return
    setRowState((prev) => ({ ...prev, [row.id]: 'saving' }))
    try {
      // The server already looks up Parent Account Head from master data for
      // whichever Account Head was just picked (see the resolve endpoint) --
      // read it back from the response rather than leaving this row's old
      // Parent Account Head on screen until the next reload, confirmed with
      // the user as the actual bug: the lookup was already happening, only
      // the table wasn't being told about it.
      const result = await resolveFarvisionVerifyRow(row.id, accountHead)
      setRows((prev) => prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              [ACCOUNT_HEAD_COLUMN]: accountHead,
              'Parent Account Head': result.parent_account_head,
              // farvision.py's _build_row always sets Payee Name equal to
              // whatever Account Head a row resolved to (override included)
              // -- kept in sync here the same way, confirmed with the user.
              'Payee Name': accountHead,
              matched: true,
            }
          : r))
      setOverriding((prev) => {
        const next = new Set(prev)
        next.delete(row.id)
        return next
      })
      setRowState((prev) => ({ ...prev, [row.id]: 'saved' }))
    } catch (err) {
      setRowState((prev) => ({ ...prev, [row.id]: err.message || 'Could not save' }))
    }
  }

  const toggleEditDescription = (id) => {
    setEditingDescription((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleResolveDescription = async (row, description) => {
    if (!description) return
    setDescState((prev) => ({ ...prev, [row.id]: 'saving' }))
    try {
      await resolveFarvisionVerifyDescription(row.id, description)
      // Deduction Type is never stored on its own -- the export always
      // derives it from whether Description ends up set, so it flips to
      // "Tax deducted at source" here the same way farvision.py would.
      setRows((prev) => prev.map((r) =>
        r.id === row.id ? { ...r, Description: description, 'Deduction Type': 'Tax deducted at source' } : r))
      setEditingDescription((prev) => {
        const next = new Set(prev)
        next.delete(row.id)
        return next
      })
      setDescState((prev) => ({ ...prev, [row.id]: 'saved' }))
    } catch (err) {
      setDescState((prev) => ({ ...prev, [row.id]: err.message || 'Could not save' }))
    }
  }

  const handleResolveTdsRate = async (row, rawValue) => {
    const value = rawValue.trim()
    if (value === (row.tds_rate || '')) return
    setTdsRateState((prev) => ({ ...prev, [row.id]: 'saving' }))
    try {
      // The server reverse-calculates Debit Amount/Adjustment Amount from
      // the rate (gross-up net -> gross, Credit Amount untouched) and
      // returns the real recomputed values -- read back here the same way
      // the Account Head resolve's Parent Account Head is, rather than
      // guessing the formula again client-side.
      const result = await resolveFarvisionVerifyTdsRate(row.id, value)
      setRows((prev) => prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              tds_rate: value,
              'Debit Amount': result.debit_amount,
              'Adjustment Amount': result.adjustment_amount,
            }
          : r))
      setTdsRateState((prev) => ({ ...prev, [row.id]: 'saved' }))
    } catch (err) {
      setTdsRateState((prev) => ({ ...prev, [row.id]: err.message || 'Could not save' }))
    }
  }

  const handleSkip = (id) => {
    setSkipped((prev) => new Set(prev).add(id))
  }

  const handleUnskip = (id) => {
    setSkipped((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const toggleDesc = (id) => {
    setShowDesc((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const revealOverride = (id) => {
    setOverriding((prev) => new Set(prev).add(id))
  }

  const cancelOverride = (id) => {
    setOverriding((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  // Two separate workbooks over the same reviewed set, confirmed with the
  // user: Receipt Payment (Document Type "Payment/Reciept") and Deposit
  // Withdrawal (Document Type "Deposit/withdrawal") never share a file.
  //
  // Runs as a background job (services/jobs.py) rather than holding one
  // request open for the whole build -- the same mechanism PDF import
  // already uses, so a large batch no longer ties up a connection/worker for
  // however long matching every row takes. The button's own experience is
  // unchanged: still one click, still a spinner, still an automatic
  // download when it's ready -- only the label under the spinner now
  // reflects the job's own status instead of a bare "Exporting...".
  const handleFinalExport = async (kind, label) => {
    setExporting(kind)
    setExportMessage('Starting...')
    setExportPercent(null)
    try {
      const { blob, filename } = await exportFarvisionViaJob(kind, filters, (job) => {
        setExportMessage(job.message || 'Working...')
        setExportPercent(Number.isFinite(job.percent) ? job.percent : null)
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename || `farvision_${kind}_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`${label} export downloaded`)
    } catch (err) {
      toast.error(err.message || 'Export failed')
    } finally {
      setExporting(null)
      setExportMessage('')
      setExportPercent(null)
    }
  }

  // Page-local -- this page no longer loads every row up front, so this can
  // only speak for what's on screen, not the whole filtered batch. "total"
  // (from the server, a plain count -- no matching needed) covers the batch.
  const needsReviewOnPage = rows.filter((r) => !r.matched).length

  return (
    <div>
      <PageHeader
        title="Farvision Verify"
        description="Every column and row bound for the export. Review a matched Account Head, fix a blank or conflicting one, or skip for now — unresolved rows still export, just with Account Head blank."
      />

      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate('/staging')} className="btn-secondary">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to Imported Rows
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleFinalExport('receipt_payment', 'Receipt Payment')}
            disabled={!!exporting}
            className="btn-primary"
          >
            {exporting === 'receipt_payment' ? (
              <>
                <Spinner size="sm" tone="white" className="mr-2" />
                {exportMessage || 'Exporting...'}
                {exportPercent !== null && ` ${exportPercent}%`}
              </>
            ) : (
              <><Download className="h-4 w-4 mr-2" /> Export Receipt Payment</>
            )}
          </button>
          <button
            onClick={() => handleFinalExport('deposit_withdrawal', 'Deposit Withdrawal')}
            disabled={!!exporting}
            className="btn-primary"
          >
            {exporting === 'deposit_withdrawal' ? (
              <>
                <Spinner size="sm" tone="white" className="mr-2" />
                {exportMessage || 'Exporting...'}
                {exportPercent !== null && ` ${exportPercent}%`}
              </>
            ) : (
              <><Download className="h-4 w-4 mr-2" /> Export Deposit Withdrawal</>
            )}
          </button>
        </div>
      </div>

      {!loading && rows.length > 0 && (
        <p className="text-sm text-slate-500 mb-3">
          {needsReviewOnPage === 0
            ? 'All rows on this page have an Account Head.'
            : `${needsReviewOnPage} of ${rows.length} on this page need a decision (blank or conflicting).`}
        </p>
      )}

      <div className="card">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <Spinner size="lg" />
            {/* Real, not simulated: percent comes from services/jobs.py,
                ticked once per row actually matched against the Account Head
                master (services/farvision.py's fetch_rows on_row) -- the
                same "every step is real" rule ImportProgressOverlay follows,
                just without that component's own multi-minute step list,
                which this page's few-second load doesn't need. */}
            <p className="text-sm font-medium text-slate-600 tabular-nums">
              {loadProgress ? `${loadProgress.message || 'Working...'} ${loadProgress.percent}%` : 'Loading...'}
            </p>
            {loadProgress && (
              <div className="h-1.5 w-56 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-primary-500 transition-all duration-300 ease-out"
                  style={{ width: `${loadProgress.percent}%` }}
                />
              </div>
            )}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing to export"
            description="This filter has no staged rows."
          />
        ) : (
          <div className="overflow-x-auto">
            <datalist id="tds-rate-presets">
              {TDS_RATE_PRESETS.map((p) => <option key={p} value={p} />)}
            </datalist>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 uppercase">
                  {displayColumns.map((col) => (
                    <th
                      key={col}
                      className={`px-4 py-3 whitespace-nowrap ${col === ACCOUNT_HEAD_COLUMN ? 'min-w-[22rem]' : ''}`}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const state = rowState[row.id]
                  const isSkipped = skipped.has(row.id)
                  const isOverriding = overriding.has(row.id)
                  const showDropdown = !row.matched || isOverriding

                  return (
                    <tr key={row.id} className={!row.matched && !isSkipped ? 'bg-amber-50' : ''}>
                      {displayColumns.map((col) => {
                        if (col === TDS_RATE_COLUMN) {
                          const tState = tdsRateState[row.id]
                          return (
                            <td key={col} className="px-4 py-3 align-top text-slate-700">
                              <div className="flex items-center gap-2">
                                <input
                                  key={`${row.id}-${row.tds_rate || ''}`}
                                  type="text"
                                  list="tds-rate-presets"
                                  defaultValue={row.tds_rate || ''}
                                  placeholder="—"
                                  disabled={tState === 'saving'}
                                  onBlur={(e) => handleResolveTdsRate(row, e.target.value)}
                                  className="input py-1 text-xs w-20"
                                />
                                {tState === 'saving' && <Spinner size="sm" />}
                                {tState === 'saved' && (
                                  <span className="inline-flex shrink-0 items-center text-green-700">
                                    <Check className="h-3.5 w-3.5" />
                                  </span>
                                )}
                                {typeof tState === 'string' && tState !== 'saving' && tState !== 'saved' && (
                                  <span className="shrink-0 text-xs font-medium text-red-700" title={tState}>
                                    not saved
                                  </span>
                                )}
                              </div>
                            </td>
                          )
                        }
                        if (col === 'Narration') {
                          const descOpen = showDesc.has(row.id)
                          return (
                            <td key={col} className="px-4 py-3 align-top text-slate-700 max-w-xs">
                              <div className="flex items-start gap-1">
                                <div className="break-words">{showValue(row[col])}</div>
                                <button
                                  type="button"
                                  onClick={() => toggleDesc(row.id)}
                                  title="Show this row's raw bank Description"
                                  className="shrink-0 text-slate-400 hover:text-primary-600"
                                >
                                  <Info className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              {descOpen && (
                                <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 break-words">
                                  {showValue(row.desc)}
                                </div>
                              )}
                            </td>
                          )
                        }
                        if (col === 'Description') {
                          const isEditingDesc = editingDescription.has(row.id)
                          const dState = descState[row.id]
                          return (
                            <td key={col} className="px-4 py-3 align-top text-slate-700 max-w-xs">
                              {isEditingDesc ? (
                                <div className="flex items-center gap-2">
                                  <select
                                    className="input py-1 text-xs"
                                    defaultValue=""
                                    disabled={dState === 'saving'}
                                    onChange={(e) => handleResolveDescription(row, e.target.value)}
                                  >
                                    <option value="" disabled>Choose Description...</option>
                                    {candidates.descriptions.map((opt) => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                  {dState === 'saving' && <Spinner size="sm" />}
                                  <button
                                    type="button"
                                    onClick={() => toggleEditDescription(row.id)}
                                    className="shrink-0 text-xs text-slate-400 hover:text-slate-600 hover:underline"
                                  >
                                    cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <div className="break-words">{showValue(row[col])}</div>
                                  <button
                                    type="button"
                                    onClick={() => toggleEditDescription(row.id)}
                                    title="Change this row's Description"
                                    className="shrink-0 text-xs text-slate-400 hover:text-slate-600 hover:underline"
                                  >
                                    change
                                  </button>
                                  {dState === 'saved' && (
                                    <span className="inline-flex shrink-0 items-center text-green-700">
                                      <Check className="h-3.5 w-3.5" />
                                    </span>
                                  )}
                                  {typeof dState === 'string' && dState !== 'saving' && dState !== 'saved' && (
                                    <span className="shrink-0 text-xs font-medium text-red-700" title={dState}>
                                      not saved
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                          )
                        }
                        if (col !== ACCOUNT_HEAD_COLUMN) {
                          return (
                            <td key={col} className="px-4 py-3 align-top text-slate-700 max-w-xs">
                              <div className="break-words">{showValue(row[col])}</div>
                            </td>
                          )
                        }
                        return (
                          <td key={col} className="px-4 py-3 align-top">
                            {isSkipped ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-400">skipped for now</span>
                                <button
                                  onClick={() => handleUnskip(row.id)}
                                  className="text-xs text-primary-600 hover:underline"
                                >
                                  undo
                                </button>
                              </div>
                            ) : showDropdown ? (
                              <div className="flex items-center gap-2">
                                <SearchableSelect
                                  options={optionsFor(row)}
                                  searchPool={fullPoolFor(row)}
                                  value=""
                                  onChange={(opt) => handleResolve(row, opt)}
                                  disabled={state === 'saving'}
                                  placeholder={state === 'saving' ? 'Saving...' : 'Search Account Head...'}
                                />
                                {state === 'saving' && <Spinner size="sm" />}
                                {typeof state === 'string' && state !== 'saving' && state !== 'saved' && (
                                  <span className="shrink-0 text-xs font-medium text-red-700" title={state}>
                                    not saved
                                  </span>
                                )}
                                {isOverriding && (
                                  <button
                                    onClick={() => cancelOverride(row.id)}
                                    className="shrink-0 text-xs text-slate-400 hover:text-slate-600 hover:underline"
                                  >
                                    cancel
                                  </button>
                                )}
                                {!isOverriding && (
                                  <button
                                    onClick={() => handleSkip(row.id)}
                                    title="Leave this row exactly as it is for now"
                                    className="shrink-0 text-xs text-slate-400 hover:text-slate-600 hover:underline"
                                  >
                                    skip for now
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="text-green-700">{row[ACCOUNT_HEAD_COLUMN]}</span>
                                {state === 'saved' && (
                                  <span className="inline-flex shrink-0 items-center text-xs font-medium text-green-700">
                                    <Check className="h-3.5 w-3.5 mr-0.5" /> saved
                                  </span>
                                )}
                                <button
                                  onClick={() => revealOverride(row.id)}
                                  title="Pick a different Account Head for this row"
                                  className="shrink-0 text-xs text-slate-400 hover:text-slate-600 hover:underline"
                                >
                                  Not correct?
                                </button>
                                <button
                                  onClick={() => handleSkip(row.id)}
                                  title="Leave this row exactly as it is for now"
                                  className="shrink-0 text-xs text-slate-400 hover:text-slate-600 hover:underline"
                                >
                                  skip for now
                                </button>
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          limit={pageSize}
          total={total}
          onPage={handlePage}
          onLimit={handlePageSize}
        />
      </div>
    </div>
  )
}
