import { useState, useEffect, useCallback } from 'react'
import { fetchTransactions, deleteAllTransactions } from '../api/endpoints.js'
import {
  Spinner, EmptyState, ConfirmDialog, SearchInput, Pagination,
} from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import toast from 'react-hot-toast'
import { RefreshCw, Trash2 } from 'lucide-react'

// Which column types are printed right-aligned with thousands separators. Taken
// from the column's declared type rather than its name, so a company that calls
// its amount column something unexpected still gets numbers formatted as numbers.
const NUMERIC_TYPES = ['numeric', 'number', 'integer', 'decimal', 'float']

// The classification columns the ledger resolves through joins. They are not in
// `columns` — that describes the statement's own data — so they are appended
// here, in the order someone reads a ledger row: what it was, then whose.
const RESOLVED = [
  { key: 'head_name', label: 'Head' },
  { key: 'project_name', label: 'Project' },
  { key: 'bank_name', label: 'Bank' },
]

export default function LedgerPage() {
  // Emptying the ledger is company admin, not manager: clearing staging throws
  // away unposted work, this throws away the posted record.
  const { canAdmin } = useAuth()
  const [columns, setColumns] = useState([])
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [clearOpen, setClearOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchTransactions({ page, limit, search })
      setColumns(data.columns || [])
      setRows(data.rows || [])
      setTotal(data.total || 0)
    } catch (err) {
      toast.error(err.message)
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, limit, search])

  useEffect(() => { load() }, [load])

  const runClearAll = async () => {
    setClearOpen(false)
    try {
      const r = await deleteAllTransactions()
      toast.success(
        `${r.deleted} posted rows removed` +
        (r.rows_postable_again
          ? `, ${r.rows_postable_again} back in Imported Rows to post again`
          : '')
      )
      setPage(1)
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const isNumeric = (c) => NUMERIC_TYPES.includes((c.type || '').toLowerCase())

  const cell = (row, col) => {
    const value = row[col.name]
    if (value === null || value === undefined || value === '') {
      return <span className="text-slate-300">—</span>
    }
    if (isNumeric(col)) {
      const n = Number(value)
      return Number.isNaN(n)
        ? String(value)
        : n.toLocaleString('en-IN', { minimumFractionDigits: 2,
                                      maximumFractionDigits: 2 })
    }
    return String(value)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ledger"
        description="Posted transactions. Rows reach here from Imported Rows once they are classified and finalized."
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className="btn-secondary">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {/* Hidden when the ledger is already empty — a destructive button
                that would do nothing is only there to be pressed by mistake. */}
            {canAdmin && total > 0 && (
              <button onClick={() => setClearOpen(true)} className="btn-danger">
                <Trash2 className="h-4 w-4 mr-1.5" />
                Delete All ({total})
              </button>
            )}
          </div>
        }
      />

      <SearchInput
        value={search}
        onChange={(v) => { setSearch(v); setPage(1) }}
        placeholder="Search every column, every page..."
      />

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                {/* Not CSS-uppercased: these are the user's own display names
                    from the fieldmap, and forcing case makes every spelling
                    render identically — renaming a field then looks like the
                    edit never saved. */}
                {columns.map((c) => (
                  <th
                    key={c.name}
                    title={c.name}
                    className={`px-6 py-3 text-xs font-medium text-slate-500 tracking-wide whitespace-nowrap ${
                      isNumeric(c) ? 'text-right' : 'text-left'
                    }`}
                  >
                    {c.displayname || c.name}
                  </th>
                ))}
                {RESOLVED.map((r) => (
                  <th key={r.key}
                      className="px-6 py-3 text-left text-xs font-medium text-slate-500 tracking-wide whitespace-nowrap">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + RESOLVED.length}
                      className="px-6 py-16">
                    <div className="flex justify-center"><Spinner size="lg" /></div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + RESOLVED.length} className="px-6 py-16">
                    <EmptyState
                      title={search ? 'No matching transactions' : 'Nothing posted yet'}
                      description={
                        search
                          ? 'Try different search terms.'
                          : 'Classify rows under Imported Rows and finalize them to post them here.'
                      }
                    />
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                    {columns.map((c) => (
                      <td key={c.name}
                          className={`px-6 py-3 whitespace-nowrap ${
                            isNumeric(c) ? 'text-right tabular-nums' : ''
                          }`}>
                        {cell(row, c)}
                      </td>
                    ))}
                    {RESOLVED.map((r) => (
                      <td key={r.key} className="px-6 py-3 whitespace-nowrap">
                        {row[r.key] || <span className="text-slate-300">—</span>}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          limit={limit}
          total={total}
          onPage={setPage}
          onLimit={(n) => { setLimit(n); setPage(1) }}
        />
      </div>

      <ConfirmDialog
        isOpen={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={runClearAll}
        danger
        title={`Delete all ${total} posted transactions?`}
        message={
          'This empties the ledger. The rows are not lost: each one stays in ' +
          'Imported Rows with its classification, and can be posted again — ' +
          'posting is what this undoes. Export first if you need a record of ' +
          'the ledger as it stands.'
        }
        confirmText="Delete all"
      />
    </div>
  )
}
