import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { fetchFarvisionVerifyRows, resolveFarvisionVerifyRow, exportFarvision } from '../api/endpoints.js'
import { Spinner, EmptyState } from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import toast from 'react-hot-toast'
import { Download, ArrowLeft, CheckCircle2, Check } from 'lucide-react'

const ACCOUNT_HEAD_COLUMN = 'Account Head'

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
// way export-farvision itself falls back to no filter.
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
  const [exporting, setExporting] = useState(false)

  // Per-row id: 'saving' | 'saved' | an error message. Drives the small
  // status shown beside that row's dropdown once it's been touched.
  const [rowState, setRowState] = useState({})
  // Ids currently showing their override dropdown -- only ever matched rows;
  // an unmatched row's dropdown is always shown, so it never needs this.
  const [overriding, setOverriding] = useState(() => new Set())
  // Ids marked "skip for now" -- client-only, undoable, never sent to the
  // server.
  const [skipped, setSkipped] = useState(() => new Set())

  const load = () => {
    setLoading(true)
    fetchFarvisionVerifyRows(filters)
      .then((data) => {
        setColumns(Array.isArray(data?.columns) ? data.columns : [])
        setRows(Array.isArray(data?.rows) ? data.rows : [])
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const handleResolve = async (row, accountHead) => {
    if (!accountHead) return
    setRowState((prev) => ({ ...prev, [row.id]: 'saving' }))
    try {
      await resolveFarvisionVerifyRow(row.id, accountHead)
      // Written for good on the server -- reflected here too, so the row
      // now reads as a plain matched row instead of staying in review mode.
      setRows((prev) => prev.map((r) =>
        r.id === row.id ? { ...r, [ACCOUNT_HEAD_COLUMN]: accountHead, matched: true } : r))
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

  const handleFinalExport = async () => {
    setExporting(true)
    try {
      const blob = await exportFarvision(filters)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `farvision_export_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Farvision export downloaded')
    } catch (err) {
      toast.error(err.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const needsReview = rows.filter((r) => !r.matched).length

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
        <button onClick={handleFinalExport} disabled={exporting} className="btn-primary">
          {exporting ? (
            <><Spinner size="sm" tone="white" className="mr-2" /> Exporting...</>
          ) : (
            <><Download className="h-4 w-4 mr-2" /> Final Export Farvision</>
          )}
        </button>
      </div>

      {!loading && rows.length > 0 && (
        <p className="text-sm text-slate-500 mb-3">
          {needsReview === 0
            ? `All ${rows.length} rows have an Account Head.`
            : `${needsReview} of ${rows.length} rows need a decision (blank or conflicting).`}
        </p>
      )}

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing to export"
            description="This filter has no staged rows."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 uppercase">
                  {columns.map((col) => (
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
                      {columns.map((col) => {
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
                                <select
                                  className="input py-1 text-xs"
                                  value=""
                                  disabled={state === 'saving'}
                                  onChange={(e) => handleResolve(row, e.target.value)}
                                >
                                  <option value="" disabled>
                                    {state === 'saving' ? 'Saving...' : 'Choose Account Head...'}
                                  </option>
                                  {row.options.map((opt) => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
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
      </div>
    </div>
  )
}
