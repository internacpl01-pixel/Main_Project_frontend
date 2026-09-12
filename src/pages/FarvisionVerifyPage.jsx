import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { fetchFarvisionVerifyRows, resolveFarvisionVerifyRow, exportFarvision } from '../api/endpoints.js'
import { Spinner, EmptyState } from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import toast from 'react-hot-toast'
import { Download, ArrowLeft, CheckCircle2 } from 'lucide-react'

// Filters come from the Imported Rows page's own "Export Farvision" button, so
// this review step looks at exactly the same rows that button used to export
// directly -- confirmed with the user. Landing on this page with no filters
// (e.g. a bookmarked URL) just reviews every ambiguous row across every batch,
// the same way export-farvision itself falls back to no filter.
export default function FarvisionVerifyPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const filters = location.state?.filters || {}

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [resolvingId, setResolvingId] = useState(null)
  const [exporting, setExporting] = useState(false)

  const load = () => {
    setLoading(true)
    fetchFarvisionVerifyRows(filters)
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const handleResolve = async (row, accountHead) => {
    if (!accountHead) return
    setResolvingId(row.id)
    try {
      await resolveFarvisionVerifyRow(row.id, accountHead)
      // Resolved for good on the server -- it will not come back as
      // ambiguous, so it drops off this review list rather than staying
      // here showing its new value.
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      toast.success('Account Head resolved')
    } catch (err) {
      toast.error(err.message || 'Could not save that choice')
    } finally {
      setResolvingId(null)
    }
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

  return (
    <div>
      <PageHeader
        title="Farvision Verify"
        description="Rows whose Account Head is still ambiguous — pick the right one before the final export. Unresolved rows still export, just with Account Head blank."
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

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing to review"
            description="No ambiguous Account Heads in this set — you're ready for the final export."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 uppercase">
                <th className="px-4 py-3">Narration</th>
                <th className="px-4 py-3 w-96">Account Head</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 text-slate-700">{row.narration}</td>
                  <td className="px-4 py-3">
                    <select
                      className="input"
                      value=""
                      disabled={resolvingId === row.id}
                      onChange={(e) => handleResolve(row, e.target.value)}
                    >
                      <option value="" disabled>
                        {resolvingId === row.id ? 'Saving...' : 'Choose Account Head...'}
                      </option>
                      {row.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
