import { useEffect, useState, useCallback } from 'react'
import { fetchDriveImportLog, cleanupDriveDoneFiles } from '../api/endpoints.js'
import {
  EmptyState, Pagination, SearchInput, TableBusy, SkeletonRows, ConfirmDialog,
} from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import toast from 'react-hot-toast'
import { HardDrive, CheckCircle, XCircle, Lock, MinusCircle, Trash2 } from 'lucide-react'

// `all` is the absence of a filter, not a value the server knows.
const STATUSES = ['all', 'done', 'failed', 'password_required', 'skipped']

const STATUS_STYLE = {
  done: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  failed: 'bg-red-50 text-red-700 border-red-100',
  password_required: 'bg-amber-50 text-amber-700 border-amber-100',
  skipped: 'bg-slate-50 text-slate-500 border-slate-200',
}

const STATUS_ICON = {
  done: CheckCircle,
  failed: XCircle,
  password_required: Lock,
  skipped: MinusCircle,
}

const STATUS_LABEL = {
  done: 'Done',
  failed: 'Failed',
  password_required: 'Needs password',
  skipped: 'Skipped',
}

function when(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function DriveImportLogPage() {
  const { canWrite } = useAuth()
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)

  // Cleanup: trashes "_done" Drive files whose own statement date is older
  // than this many days. cleanupOpen just shows the days input; confirmOpen
  // is the separate "are you sure" step -- this changes real Drive state
  // (even if Trash keeps it recoverable for a while), so it gets the same
  // two-step confirm as discarding a batch elsewhere in this app.
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleanupDays, setCleanupDays] = useState('90')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cleaningUp, setCleaningUp] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => { setQuery(search); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { limit, offset: (page - 1) * limit }
      if (status !== 'all') params.status = status
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const data = await fetchDriveImportLog(params)
      setRows(data.rows || [])
      setTotal(data.total ?? 0)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [status, dateFrom, dateTo, page, limit])

  useEffect(() => { load() }, [load])

  // Filename search is client-side only -- the backend has no text filter for
  // this log and a company's Drive volume doesn't warrant adding one yet.
  const visible = query.trim()
    ? rows.filter((r) => r.file_name.toLowerCase().includes(query.trim().toLowerCase()))
    : rows
  const filtered = status !== 'all' || query.trim() || dateFrom || dateTo

  const clearAll = () => {
    setStatus('all'); setSearch(''); setDateFrom(''); setDateTo(''); setPage(1)
  }

  const daysValid = /^\d+$/.test(cleanupDays) && Number(cleanupDays) >= 1

  const runCleanup = async () => {
    setCleaningUp(true)
    try {
      const res = await cleanupDriveDoneFiles(Number(cleanupDays))
      setConfirmOpen(false)
      setCleanupOpen(false)
      toast.success(res.count > 0
        ? `Moved ${res.count} old statement${res.count === 1 ? '' : 's'} to Drive's Trash`
        : `Nothing older than ${cleanupDays} days to clean up`)
      load()
    } catch (err) {
      toast.error(err.message || 'Could not clean up the Drive folder')
    } finally {
      setCleaningUp(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Drive Import Log"
        description="Every file the Gmail Apps Script has ever handed to Import from Drive — what happened to it and why, kept after the run itself is gone from screen."
        actions={canWrite && (
          <button onClick={() => setCleanupOpen((v) => !v)} className="btn-secondary">
            <Trash2 className="h-4 w-4 mr-1.5" />Clean up old statements
          </button>
        )}
      />

      {cleanupOpen && (
        <div className="card mb-4">
          <div className="card-body flex flex-wrap items-end gap-3">
            <div>
              <label className="label">
                Move "Done" statements older than
              </label>
              <div className="flex items-center gap-2">
                <input
                  value={cleanupDays}
                  onChange={(e) => setCleanupDays(e.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  autoComplete="off"
                  className={`input w-24 ${!daysValid ? 'border-red-300 focus:ring-red-200' : ''}`}
                />
                <span className="text-sm text-slate-600">days (by the statement's own date) to Trash</span>
              </div>
            </div>
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={!daysValid}
              className="btn-primary"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />Clean up
            </button>
            <button onClick={() => setCleanupOpen(false)} className="btn-secondary">
              Cancel
            </button>
          </div>
          <div className="px-6 pb-4 -mt-1">
            <p className="text-xs text-slate-400">
              Only files already marked "_done" are touched — a failed or
              password-waiting file is left alone no matter how old it is.
              Moved to Drive's own Trash, recoverable there for about 30 days,
              not deleted outright.
            </p>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={runCleanup}
        title="Clean up old Drive statements?"
        message={`Every "_done" file whose own statement date is more than ${cleanupDays} days old will be moved to Drive's Trash. This can't be undone from here — recovery would be through Drive's own Trash directly.`}
        confirmText="Move to Trash"
        danger
        busy={cleaningUp}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                status === s
                  ? 'bg-primary-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s === 'all' ? 'All' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
            className="input py-1.5 text-sm"
            title="From date"
          />
          <span className="text-slate-400 text-sm">to</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
            className="input py-1.5 text-sm"
            title="To date"
          />
          <div className="w-full sm:w-64">
            <SearchInput
              value={search}
              onChange={setSearch}
              onClear={() => setSearch('')}
              placeholder="Filter by filename..."
            />
          </div>
          {filtered && (
            <button onClick={clearAll} className="text-xs font-medium text-slate-500 hover:text-slate-700">
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="relative">
          {loading && rows.length > 0 && <TableBusy />}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 tracking-wide whitespace-nowrap">When</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 tracking-wide">File</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 tracking-wide">Status</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 tracking-wide">Bank</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 tracking-wide">Rows</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 tracking-wide">Detail</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 tracking-wide">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && rows.length === 0 ? (
                  <SkeletonRows cols={7} />
                ) : visible.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        icon={<HardDrive className="h-10 w-10" />}
                        title={filtered ? 'No matching entries' : 'No Drive imports recorded yet'}
                        description={
                          filtered
                            ? 'Nothing in the log matches these filters.'
                            : 'Every file Import from Drive touches — done, failed, or waiting on a password — is recorded here from now on.'
                        }
                        action={filtered
                          ? <button onClick={clearAll} className="btn-secondary text-sm">Clear filters</button>
                          : undefined}
                      />
                    </td>
                  </tr>
                ) : (
                  visible.map((r) => {
                    const Icon = STATUS_ICON[r.status] || MinusCircle
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/70 transition-colors align-top">
                        <td className="px-6 py-3 whitespace-nowrap text-xs text-slate-500">{when(r.created_at)}</td>
                        <td className="px-6 py-3 font-mono text-xs text-slate-700 max-w-xs truncate" title={r.file_name}>
                          {r.file_name}
                        </td>
                        <td className="px-6 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                            STATUS_STYLE[r.status] || 'bg-slate-50 text-slate-600 border-slate-200'
                          }`}>
                            <Icon className="h-3 w-3" />{STATUS_LABEL[r.status] || r.status}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-xs text-slate-600 whitespace-nowrap">
                          {r.bank_name || <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-6 py-3 text-xs text-slate-600 tabular-nums">
                          {r.row_count ?? <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-6 py-3 text-xs text-slate-600 max-w-md">
                          {r.error || <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-6 py-3 text-xs text-slate-600 whitespace-nowrap">
                          {r.imported_by || <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <Pagination
          page={page}
          limit={limit}
          total={total}
          onPage={setPage}
          onLimit={(n) => { setLimit(n); setPage(1) }}
        />
      </div>
    </div>
  )
}
