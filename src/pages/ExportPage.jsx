import { useEffect, useState } from 'react'
import { fetchTransactionSummary, fetchTransactionFilters, exportTransactions } from '../api/endpoints.js'
import { Spinner, EmptyState } from '../components/UI.jsx'
import { FilterBar, EMPTY_FILTERS, filterParams, activeCount } from '../components/TableFilters.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import toast from 'react-hot-toast'
import { Download } from 'lucide-react'

const FORMATS = [
  { value: 'csv', label: 'CSV (.csv)' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'pdf', label: 'PDF (.pdf)' },
]

export default function ExportPage() {
  const [format, setFormat] = useState('csv')
  // Same Date/Account Number/Company filter bar the Ledger page uses, reading
  // the same GET /transactions/filters options -- an account or company
  // chosen here means exactly what it means there, since both are matched by
  // the same digits-only/case-insensitive rules server-side.
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [filterOptions, setFilterOptions] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [summary, setSummary] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTransactionSummary()
      .then((d) => setSummary(d))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false))
    fetchTransactionFilters()
      .then((d) => setFilterOptions(d))
      .catch((err) => toast.error(err.message))
  }, [])

  const handleExport = async () => {
    setExporting(true)
    try {
      const params = filterParams(filters)
      const blob = await exportTransactions(format, params)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `transactions_${new Date().toISOString().slice(0, 10)}.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Export downloaded')
    } catch (err) {
      toast.error(err.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const fmt = (n) => {
    if (n === null || n === undefined) return '0'
    return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  return (
    <div>
      <PageHeader
        title="Export"
        description="Download your transaction data as CSV, Excel, or PDF."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="card">
            <div className="card-body space-y-5">
              <div>
                <label className="label">Format</label>
                <select value={format} onChange={(e) => setFormat(e.target.value)} className="input max-w-xs">
                  {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Filter</label>
                <FilterBar
                  options={filterOptions}
                  value={filters}
                  onChange={setFilters}
                  loading={!filterOptions}
                />
                {activeCount(filters) === 0 && (
                  <p className="mt-1.5 text-xs text-slate-400">
                    No filters set — every transaction you can see will be exported.
                  </p>
                )}
              </div>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="btn-primary"
              >
                {exporting ? (
                  <><Spinner size="sm" tone="white" className="mr-2" /> Exporting...</>
                ) : (
                  <><Download className="h-4 w-4 mr-2" /> Export Data</>
                )}
              </button>
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-header">
              <h2 className="text-sm font-semibold text-slate-900">Export Preview</h2>
            </div>
            <div className="card-body">
              {loading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">Summary by head:</p>
                  {summary.slice(0, 6).map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100 last:border-0">
                      <span className="text-slate-700 truncate flex-1">{s.head_name || 'Unclassified'}</span>
                      <span className="text-slate-500 font-mono text-xs ml-3">
                        {fmt(Number(s.total_cr || 0) - Number(s.total_dr || 0))}
                      </span>
                    </div>
                  ))}
                  {summary.length === 0 && (
                    <p className="text-xs text-slate-400 py-2">No data to export</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
