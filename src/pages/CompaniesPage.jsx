import { useEffect, useState } from 'react'
import { fetchCompanies, registerCompany, updateCompany } from '../api/endpoints.js'
import { Modal, Spinner, EmptyState, ConfirmDialog } from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import toast from 'react-hot-toast'
import { Plus, Power, PowerOff, Pencil, LogIn } from 'lucide-react'

const emptyForm = { name: '', admin_username: '', admin_password: '' }

/**
 * The company registry — every tenant registered on this install, who
 * registered it, and how many accounts it holds. Super admins only.
 *
 * Registering here does the same work as `python -m db.migrate new-company`:
 * allocates company_NNN, creates the schema, and applies every company
 * migration to it. Seeding the first Company Admin is optional but saves a
 * step, since a company with no accounts can only be reached by a super admin
 * switching into it.
 */
export default function CompaniesPage() {
  const { user, switchToCompany } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [renaming, setRenaming] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [statusConfirm, setStatusConfirm] = useState(null)

  useEffect(() => {
    load()
  }, [showInactive])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await fetchCompanies(showInactive))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    if (!form.name.trim()) {
      toast.error('Company name is required')
      return
    }
    const wantsAdmin = form.admin_username.trim() || form.admin_password
    if (wantsAdmin && !(form.admin_username.trim() && form.admin_password)) {
      toast.error('Give both an admin username and password, or leave both empty')
      return
    }

    setSaving(true)
    try {
      const payload = { name: form.name.trim() }
      if (wantsAdmin) {
        payload.admin_username = form.admin_username.trim()
        payload.admin_password = form.admin_password
      }
      const { company, admin } = await registerCompany(payload)
      toast.success(
        admin
          ? `${company.name} registered as ${company.schema_name}, admin '${admin.username}' created`
          : `${company.name} registered as ${company.schema_name}`
      )
      setModalOpen(false)
      setForm(emptyForm)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleRename = async () => {
    if (!renaming) return
    setSaving(true)
    try {
      await updateCompany(renaming.id, { name: renameValue.trim() })
      toast.success('Company renamed')
      setRenaming(null)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleStatus = async () => {
    if (!statusConfirm) return
    const next = !statusConfirm.is_active
    setSaving(true)
    try {
      await updateCompany(statusConfirm.id, { is_active: next })
      toast.success(next ? 'Company activated' : 'Company deactivated')
      setStatusConfirm(null)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSwitch = async (company) => {
    try {
      await switchToCompany(company.schema_name)
      toast.success(`Switched to ${company.name}`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <div>
      <PageHeader
        title="Companies"
        description="Every company registered on this install."
        actions={
          <button onClick={() => { setForm(emptyForm); setModalOpen(true) }} className="btn-primary">
            <Plus className="h-4 w-4 mr-1.5" />
            Register Company
          </button>
        }
      />

      <label className="mb-3 inline-flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
          className="rounded border-slate-300"
        />
        Show deactivated companies
      </label>

      {error && <EmptyState title="Error" description={error} />}

      {!error && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Company</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Schema</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Users</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Registered By</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Registered</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan="7" className="px-6 py-12"><Spinner /></td></tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan="7">
                      <EmptyState
                        title="No companies"
                        description="Register a company to give it its own isolated ledger."
                        action={
                          <button onClick={() => { setForm(emptyForm); setModalOpen(true) }} className="btn-primary text-sm">
                            <Plus className="h-4 w-4 mr-1.5" />
                            Register Company
                          </button>
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  items.map((c) => {
                    const isCurrent = c.schema_name === user?.schema
                    return (
                      <tr key={c.id} className={`transition-colors ${isCurrent ? 'bg-primary-50/40' : 'hover:bg-slate-50/70'}`}>
                        <td className="px-6 py-3 font-medium text-slate-900">
                          {c.name}
                          {isCurrent && <span className="ml-2 text-xs font-normal text-primary-600">(current)</span>}
                        </td>
                        <td className="px-6 py-3 text-xs text-slate-600 font-mono">{c.schema_name}</td>
                        <td className="px-6 py-3 text-slate-600">{c.user_count}</td>
                        <td className="px-6 py-3 text-slate-600">{c.created_by_username || '—'}</td>
                        <td className="px-6 py-3 text-xs text-slate-500">
                          {c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-6 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            c.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {c.is_active ? 'Active' : 'Deactivated'}
                          </span>
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {c.is_active && !isCurrent && (
                              <button
                                onClick={() => handleSwitch(c)}
                                title="Switch to this company"
                                className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-primary-600"
                              >
                                <LogIn className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => { setRenaming(c); setRenameValue(c.name) }}
                              title="Rename"
                              className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-primary-600"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setStatusConfirm(c)}
                              title={c.is_active ? 'Deactivate' : 'Activate'}
                              className={`p-1.5 rounded ${
                                c.is_active
                                  ? 'hover:bg-red-50 text-slate-500 hover:text-red-600'
                                  : 'hover:bg-emerald-50 text-slate-500 hover:text-emerald-600'
                              }`}
                            >
                              {c.is_active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Register Company">
        <div className="space-y-4">
          <div>
            <label className="label">Company Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
              placeholder="e.g. DPL Homes"
            />
            <p className="mt-1 text-xs text-slate-500">
              Creates an isolated schema and applies every company migration to it.
            </p>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <p className="text-sm font-medium text-slate-700">First Company Admin</p>
            <p className="mt-0.5 mb-3 text-xs text-slate-500">
              Optional. Leave blank and the company starts with no accounts — only a
              super admin can reach it until you add one.
            </p>
            <div className="space-y-3">
              <div>
                <label className="label">Username</label>
                <input
                  value={form.admin_username}
                  onChange={(e) => setForm({ ...form, admin_username: e.target.value })}
                  className="input"
                  placeholder="At least 3 characters"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="label">Password</label>
                <input
                  type="password"
                  value={form.admin_password}
                  onChange={(e) => setForm({ ...form, admin_password: e.target.value })}
                  className="input"
                  placeholder="At least 4 characters"
                  autoComplete="new-password"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleRegister} disabled={saving} className="btn-primary text-sm">
              {saving ? 'Registering...' : 'Register'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!renaming} onClose={() => setRenaming(null)} title="Rename Company">
        <div className="space-y-4">
          <div>
            <label className="label">Company Name</label>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="input"
            />
            <p className="mt-1 text-xs text-slate-500">
              The schema name ({renaming?.schema_name}) never changes — data stays where it is.
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setRenaming(null)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleRename} disabled={saving} className="btn-primary text-sm">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!statusConfirm}
        onClose={() => setStatusConfirm(null)}
        onConfirm={handleToggleStatus}
        title={statusConfirm?.is_active ? 'Deactivate Company' : 'Activate Company'}
        message={
          statusConfirm?.is_active
            ? `Deactivate "${statusConfirm?.name}"? Nobody will be able to switch into it. No data is deleted — reactivate any time.`
            : `Activate "${statusConfirm?.name}"? It becomes available to switch into again.`
        }
        confirmText={statusConfirm?.is_active ? 'Deactivate' : 'Activate'}
        danger={statusConfirm?.is_active}
      />
    </div>
  )
}
