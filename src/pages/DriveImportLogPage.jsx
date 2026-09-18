import { useEffect, useState, useCallback } from 'react'
import { fetchDriveImportLog, listDriveFolders } from '../api/endpoints.js'
import {
  EmptyState, Pagination, SearchInput, TableBusy, SkeletonRows,
} from '../components/UI.jsx'
import DriveCleanupPanel from '../components/DriveCleanupPanel.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import toast from 'react-hot-toast'
import {
  HardDrive, CheckCircle, XCircle, Lock, MinusCircle, Trash2, Calendar, X,
} from 'lucide-react'

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
  // than this many days. The panel itself (DriveCleanupPanel, shared with
  // the Settings page) owns the days figure and its own confirm step --
  // this only decides whether it is on screen.
  const [cleanupOpen, setCleanupOpen] = useState(false)
  // Only to offer the extra saved folders as cleanup targets; the log itself
  // is not per-folder.
  const [folders, setFolders] = useState([])

  useEffect(() => {
    if (!canWrite) return
    listDriveFolders().then((f) => setFolders(Array.isArray(f) ? f : [])).catch(() => {})
  }, [canWrite])

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

  return (
    <div>
      <PageHeader
        title="Drive Import Log"
        description="Every file the Gmail Apps Script has ever handed to Import from Drive — what happened to it and why, kept after the run itself is gone from screen."
        actions={canWrite && (
          <button onClick={() => setCleanupOpen((v) => !v)} className="btn-danger">
            <Trash2 className="h-4 w-4 mr-1.5" />Clean up old statements
          </button>
        )}
      />

      {cleanupOpen && (
        <div className="mb-4">
          <DriveCleanupPanel
            folders={folders}
            onCancel={() => setCleanupOpen(false)}
            onDone={() => { setCleanupOpen(false); load() }}
          />
        </div>
      )}

      <div className="card mb-4">
        <div className="card-body space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {STATUSES.map((s) => {
              const Icon = s === 'all' ? null : STATUS_ICON[s]
              return (
                <button
                  key={s}
                  onClick={() => { setStatus(s); setPage(1) }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    status === s
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-primary-50 hover:text-primary-700 hover:border-primary-200'
                  }`}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {s === 'all' ? 'All' : STATUS_LABEL[s]}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-100">
            <div className="flex items-center gap-2 pt-3">
              <Calendar className="h-4 w-4 text-primary-500 shrink-0" />
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
                className="input py-1.5 text-sm w-40"
                title="From date"
              />
              <span className="text-slate-400 text-sm">to</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
                className="input py-1.5 text-sm w-40"
                title="To date"
              />
            </div>

            <div className="w-full sm:w-64 pt-3 sm:pt-0">
              <SearchInput
                value={search}
                onChange={setSearch}
                onClear={() => setSearch('')}
                placeholder="Filter by filename..."
              />
            </div>

            {filtered && (
              <button
                onClick={clearAll}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-800 pt-3 sm:pt-0"
              >
                <X className="h-3.5 w-3.5" />Clear filters
              </button>
            )}
          </div>
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
