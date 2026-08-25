import { useState, useEffect, useCallback } from 'react'
import {
  fetchTransactions, fetchTransactionFilters, deleteAllTransactions,
} from '../api/endpoints.js'
import {
  Spinner, EmptyState, ConfirmDialog, SearchInput, Pagination,
} from '../components/UI.jsx'
import {
  FilterBar, SortHeader, nextSort, EMPTY_FILTERS, filterParams, activeCount,
} from '../components/TableFilters.jsx'
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

  // Sorted and filtered in SQL, not here: the ledger is server-paged, so the
  // browser only ever holds one page and reordering it would leave every other
  // page alone. `sort` null is the default order — newest first.
  const [sort, setSort] = useState(null)
  const [dir, setDir] = useState('asc')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [filterOptions, setFilterOptions] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, limit, search, ...filterParams(filters) }
      if (sort) { params.sort = sort; params.dir = dir }
      const data = await fetchTransactions(params)
      setColumns(data.columns || [])
      setRows(data.rows || [])
      setTotal(data.total || 0)
      // Follow the sort the server says it applied — an unknown column falls
      // back rather than erroring, and the arrow should not claim otherwise.
      if ((data.sort ?? null) !== sort) setSort(data.sort ?? null)
    } catch (err) {
      toast.error(err.message)
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, limit, search, sort, dir, filters])

  useEffect(() => { load() }, [load])

  const loadFilterOptions = useCallback(async () => {
    try {
      setFilterOptions(await fetchTransactionFilters())
    } catch {
      setFilterOptions(null)
    }
  }, [])

  useEffect(() => { loadFilterOptions() }, [loadFilterOptions])

  // Back to page 1 on every change of sort or filter — page 7 of one ordering
  // is not page 7 of another, and landing past the end shows an empty table.
  const handleSort = (field) => {
    const n = nextSort(sort, dir, field)
    setSort(n.sort); setDir(n.dir); setPage(1)
  }

  const handleFilters = (next) => { setFilters(next); setPage(1) }

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
      // Nothing is left to filter by once the ledger is empty.
      loadFilterOptions()
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
            <button
              onClick={() => { load(); loadFilterOptions() }}
              disabled={loading}
              className="btn-secondary"
            >
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

      <div className="flex flex-wrap items-center gap-3">
        <FilterBar
          options={filterOptions}
          value={filters}
          onChange={handleFilters}
          loading={!filterOptions}
        />
        {activeCount(filters) > 0 && !loading && filterOptions && (
          <span className="text-xs text-slate-500">
            {total.toLocaleString('en-IN')} of{' '}
            {(filterOptions.total ?? 0).toLocaleString('en-IN')} posted{' '}
            {filterOptions.total === 1 ? 'row' : 'rows'}
          </span>
        )}
      </div>

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
                  <SortHeader
                    key={c.name}
                    field={c.name}
                    label={c.displayname || c.name}
                    title={c.name}
                    align={isNumeric(c) ? 'right' : 'left'}
                    sort={sort}
                    dir={dir}
                    onSort={handleSort}
                  />
                ))}
                {/* Sorted by the master's name, not by the id behind it: an id
                    orders by when the head was created, which is not an order
                    anyone asked for. The server resolves both from the same
                    join it already draws the cell from. */}
                {RESOLVED.map((r) => (
                  <SortHeader
                    key={r.key}
                    field={r.key}
                    label={r.label}
                    sort={sort}
                    dir={dir}
                    onSort={handleSort}
                  />
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
                    {/* A filter left on from earlier looks exactly like an
                        empty ledger, so it is named and offered a way out. */}
                    <EmptyState
                      title={
                        search || activeCount(filters)
                          ? 'No matching transactions'
                          : 'Nothing posted yet'
                      }
                      description={
                        activeCount(filters)
                          ? `${filterOptions?.total ?? 0} rows are posted, but none match the filters${search ? ' and search' : ''} you have set.`
                          : search
                            ? 'Try different search terms.'
                            : 'Classify rows under Imported Rows and finalize them to post them here.'
                      }
                      action={activeCount(filters) > 0 && (
                        <button
                          onClick={() => handleFilters({ ...EMPTY_FILTERS })}
                          className="btn-secondary text-sm"
                        >
                          Clear filters
                        </button>
                      )}
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
