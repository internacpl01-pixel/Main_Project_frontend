import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Check, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext.jsx'
import { fetchCompanies } from '../api/endpoints.js'
import { Spinner } from './UI.jsx'

/**
 * Company picker for super-admins.
 *
 * A super-admin logs in with schema 'admin', which holds only companies/users —
 * no projects, no transactions. Every page therefore failed with
 * 'relation "projects" does not exist' until the token was re-bound to a
 * company schema. This is the UI for /auth/switch-company that does that.
 *
 * variant="panel" — full card, used as the gate when no company is selected yet.
 * variant="menu"  — compact header dropdown, used once a company is active.
 */
export default function CompanySwitcher({ variant = 'menu' }) {
  const { user, switchToCompany } = useAuth()
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(null) // schema_name of the in-flight switch

  useEffect(() => {
    let cancelled = false
    fetchCompanies()
      .then((data) => {
        if (cancelled) return
        setCompanies(data)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const current = companies.find((c) => c.schema_name === user?.schema)

  const handleSelect = async (company) => {
    if (company.schema_name === user?.schema) {
      setOpen(false)
      return
    }
    setSwitching(company.schema_name)
    try {
      await switchToCompany(company.schema_name)
      setOpen(false)
      toast.success(`Switched to ${company.name}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSwitching(null)
    }
  }

  // Shared list body — same rows in both variants.
  const rows = companies.map((company) => {
    const isCurrent = company.schema_name === user?.schema
    return (
      <button
        key={company.id}
        onClick={() => handleSelect(company)}
        disabled={switching !== null}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
          isCurrent ? 'bg-primary-50' : 'hover:bg-slate-50'
        }`}
      >
        <span className="min-w-0">
          <span className={`block text-sm truncate ${isCurrent ? 'font-medium text-primary-700' : 'text-slate-700'}`}>
            {company.name}
          </span>
          <span className="block text-xs text-slate-400 truncate">{company.schema_name}</span>
        </span>
        {switching === company.schema_name ? (
          <Spinner size="sm" className="shrink-0" />
        ) : isCurrent ? (
          <Check className="h-4 w-4 text-primary-600 shrink-0" />
        ) : null}
      </button>
    )
  })

  const emptyOrError = error ? (
    <p className="px-3 py-2 text-sm text-red-600">{error}</p>
  ) : companies.length === 0 ? (
    <p className="px-3 py-2 text-sm text-slate-500">
      No companies yet.{' '}
      <Link to="/companies" className="text-primary-600 hover:underline">
        Register your first one
      </Link>
      .
    </p>
  ) : null

  // ── Panel: shown in place of the page when no company is selected ──────────
  if (variant === 'panel') {
    return (
      <div className="mx-auto max-w-md">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center shrink-0">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Select a company</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Super-admin accounts are not tied to a company. Pick one to load its ledger.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-1">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500">
                <Spinner size="sm" />
                Loading companies...
              </div>
            ) : (
              emptyOrError || rows
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Menu: compact dropdown in the header ───────────────────────────────────
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors max-w-[13rem]"
      >
        <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="text-sm font-medium text-slate-700 truncate">
          {current?.name || user?.schema}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg p-1 z-50">
            <p className="px-3 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              Switch company
            </p>
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500">
                <Spinner size="sm" />
                Loading...
              </div>
            ) : (
              emptyOrError || rows
            )}
          </div>
        </>
      )}
    </div>
  )
}
