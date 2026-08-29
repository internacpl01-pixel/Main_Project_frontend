import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchTransactions, fetchSummary, fetchBatches, fetchProjects, fetchTempImport } from '../api/endpoints.js'
import { EmptyState } from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { Receipt, FolderKanban, Upload, ArrowUpRight, ArrowDownRight, Activity, FileSpreadsheet, Download } from 'lucide-react'

function StatCard({ label, value, hint, icon: Icon, accent }) {
  return (
    <div className="card">
      <div className="card-body">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${accent}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl font-semibold text-slate-900">{value}</div>
          {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
        </div>
      </div>
    </div>
  )
}

function fmt(n) {
  if (n === null || n === undefined) return '0'
  const v = Number(n)
  if (Number.isNaN(v)) return '0'
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

// First column of one of the given Postgres types, or undefined. Which column
// holds the date and which holds the narration is the fieldmap's answer, so it
// is asked of the column list the API sends rather than assumed — this list
// used to read t.txn_date and t.description by name, and both of those columns
// stopped existing.
const firstOfType = (columns, types) =>
  columns.find((c) => types.includes((c.type || '').toLowerCase()))

const DATE_TYPES = ['date', 'timestamp with time zone', 'timestamp without time zone']
const TEXT_TYPES = ['text', 'character varying', 'character']

export default function DashboardPage() {
  const [txns, setTxns] = useState([])
  const [columns, setColumns] = useState([])
  const [txnTotal, setTxnTotal] = useState(0)
  const [projects, setProjects] = useState([])
  const [stagingCount, setStagingCount] = useState(0)
  const [batches, setBatches] = useState([])
  const [summary, setSummary] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const results = await Promise.allSettled([
          // Six is all this card draws. Asking for the whole ledger to render
          // six rows is what pagination was added to stop.
          fetchTransactions({ limit: 6 }),
          fetchProjects(),
          fetchTempImport({ classified: false, limit: 1 }),
          fetchSummary({}),
          fetchBatches(),
        ])
        if (results[0].status === 'fulfilled') {
          setTxns(results[0].value.rows || [])
          setColumns(results[0].value.columns || [])
          setTxnTotal(results[0].value.total ?? 0)
        }
        if (results[1].status === 'fulfilled') setProjects(results[1].value)
        // summary.staged_total, not rows.length. /temp-trans returns an object,
        // so the old `.length` was undefined and this stat read 0 no matter how
        // many rows were waiting.
        if (results[2].status === 'fulfilled') {
          setStagingCount(results[2].value.summary?.staged_total ?? 0)
        }
        if (results[3].status === 'fulfilled') setSummary(results[3].value)
        if (results[4].status === 'fulfilled') setBatches(results[4].value)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Totalled from /transactions/summary, which aggregates in SQL across the
  // whole ledger. Summing the rows on this page would total one page of six.
  const totalCredits = summary.reduce((s, r) => s + Number(r.total_cr || 0), 0)
  const totalDebits = summary.reduce((s, r) => s + Number(r.total_dr || 0), 0)

  const dateCol = firstOfType(columns, DATE_TYPES)
  const textCol = firstOfType(columns, TEXT_TYPES)

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Overview of your ledger activity and recent transactions."
      />

      {loading ? (
        // The dashboard fires five requests at once and waits for all of them,
        // so this is the longest first paint in the app. It used to be a bare
        // spinner against an empty page, and the whole layout then snapped in
        // at once. Grey blocks in the shape of what is coming instead: the
        // page is already the right size when the numbers arrive.
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card animate-pulse">
                <div className="card-body">
                  <div className="flex items-center justify-between">
                    <div className="h-3 w-24 rounded bg-slate-100" />
                    <div className="h-9 w-9 rounded-lg bg-slate-100" />
                  </div>
                  <div className="mt-3 h-7 w-28 rounded bg-slate-100" />
                  <div className="mt-2 h-3 w-20 rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 card animate-pulse">
              <div className="card-header"><div className="h-3.5 w-40 rounded bg-slate-100" /></div>
              <div className="divide-y divide-slate-100">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center justify-between px-6 py-3.5">
                    <div className="space-y-2">
                      <div className="h-3 w-56 rounded bg-slate-100" />
                      <div className="h-2.5 w-36 rounded bg-slate-100" />
                    </div>
                    <div className="h-3 w-20 rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            </div>
            <div className="card animate-pulse">
              <div className="card-header"><div className="h-3.5 w-28 rounded bg-slate-100" /></div>
              <div className="card-body space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-4 w-full rounded bg-slate-100" />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Total Transactions"
              value={fmt(txnTotal)}
              hint="In the ledger"
              icon={Receipt}
              accent="bg-primary-100 text-primary-700"
            />
            <StatCard
              label="Total Credits"
              value={`INR ${fmt(totalCredits)}`}
              hint="Sum of all credits"
              icon={ArrowUpRight}
              accent="bg-emerald-100 text-emerald-700"
            />
            <StatCard
              label="Total Debits"
              value={`INR ${fmt(totalDebits)}`}
              hint="Sum of all debits"
              icon={ArrowDownRight}
              accent="bg-red-100 text-red-700"
            />
            <StatCard
              label="Pending Classification"
              value={fmt(stagingCount)}
              hint="Staged rows"
              icon={FileSpreadsheet}
              accent="bg-amber-100 text-amber-700"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 card">
              <div className="card-header flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Recent Transactions</h2>
                <Link to="/master-data" className="text-xs text-primary-600 hover:text-primary-700">View all →</Link>
              </div>
              <div className="divide-y divide-slate-100">
                {txns.map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-6 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {(textCol && t[textCol.name]) || '—'}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {[
                          dateCol && t[dateCol.name],
                          t.project_name || 'No project',
                          t.head_name || 'Unclassified',
                        ].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className={`ml-4 font-mono text-sm font-semibold ${
                      t.credit_debit === 'CR' ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {t.credit_debit === 'CR' ? '+' : '−'} INR {fmt(t.amount)}
                    </div>
                  </div>
                ))}
                {txns.length === 0 && (
                  <div className="px-6 py-8">
                    <EmptyState
                      icon={<Activity className="h-10 w-10" />}
                      title="No transactions yet"
                      description="Upload a bank statement to get started."
                      action={<Link to="/import" className="btn-primary text-sm"><Upload className="h-4 w-4 mr-1.5" />Import Statement</Link>}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-6">
              <div className="card">
                <div className="card-header"><h2 className="text-sm font-semibold text-slate-900">Quick Actions</h2></div>
                <div className="card-body space-y-1.5">
                  <Link to="/import" className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition">
                    <Upload className="h-4 w-4 text-primary-600" /><span className="text-sm text-slate-700">Import Statement</span>
                  </Link>
                  <Link to="/staging" className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition">
                    <FileSpreadsheet className="h-4 w-4 text-amber-600" /><span className="text-sm text-slate-700">Review Staging</span>
                  </Link>
                  <Link to="/export" className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition">
                    <Download className="h-4 w-4 text-emerald-600" /><span className="text-sm text-slate-700">Export Data</span>
                  </Link>
                  <Link to="/projects" className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition">
                    <FolderKanban className="h-4 w-4 text-violet-600" /><span className="text-sm text-slate-700">Manage Projects</span>
                  </Link>
                </div>
              </div>

              <div className="card">
                <div className="card-header"><h2 className="text-sm font-semibold text-slate-900">Recent Batches</h2></div>
                <div className="divide-y divide-slate-100">
                  {batches.slice(0, 4).map((b) => (
                    <Link key={b.id} to="/staging" className="block px-6 py-3 hover:bg-slate-50">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-slate-900 truncate max-w-[180px]">{b.filename}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {new Date(b.uploaded_at).toLocaleDateString()} · {b.row_count} rows
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          b.status === 'finalized' ? 'bg-emerald-100 text-emerald-700' :
                          b.status === 'uploaded' ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>{b.status}</span>
                      </div>
                    </Link>
                  ))}
                  {batches.length === 0 && (
                    <div className="px-6 py-4 text-xs text-slate-500 text-center">No batches yet</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 card">
            <div className="card-header"><h2 className="text-sm font-semibold text-slate-900">Summary by Head</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50">
                    <th className="text-left px-6 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Head</th>
                    <th className="text-right px-6 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Credits</th>
                    <th className="text-right px-6 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Debits</th>
                    <th className="text-right px-6 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.map((s, i) => (
                    <tr key={i} className="hover:bg-slate-50/70">
                      <td className="px-6 py-2.5 text-sm text-slate-700">{s.head_name || 'Unclassified'}</td>
                      <td className="px-6 py-2.5 text-right text-sm font-mono text-emerald-600">{fmt(s.total_cr)}</td>
                      <td className="px-6 py-2.5 text-right text-sm font-mono text-red-600">{fmt(s.total_dr)}</td>
                      <td className="px-6 py-2.5 text-right text-sm font-mono font-medium">{fmt(Number(s.total_cr) - Number(s.total_dr))}</td>
                    </tr>
                  ))}
                  {summary.length === 0 && (
                    <tr><td colSpan="4" className="px-6 py-6 text-xs text-slate-500 text-center">No classified transactions yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}