import { useEffect, useState } from 'react'
import { fetchTransactionSummary, exportTransactions } from '../api/endpoints.js'
import { Spinner, EmptyState } from '../components/UI.jsx'
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
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exporting, setExporting] = useState(false)
  const [summary, setSummary] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTransactionSummary()
      .then((d) => setSummary(d))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [])

  const handleExport = async () => {
    setExporting(true)
    try {
      const params = {}
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Date From</label>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label">Date To</label>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input" />
                </div>
              </div>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="btn-primary"
              >
                {exporting ? (
                  <><Spinner size="sm" className="mr-2" /> Exporting...</>
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
