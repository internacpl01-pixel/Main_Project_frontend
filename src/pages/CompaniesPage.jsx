import { useEffect, useState } from 'react'
import {
  fetchCompanies, registerCompany, updateCompany, fetchClonePreview,
  fetchDeleteCheck, deleteCompany, addCompanyAdmin,
} from '../api/endpoints.js'
import { Modal, Spinner, EmptyState, ConfirmDialog } from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import toast from 'react-hot-toast'
import { Plus, Power, PowerOff, Pencil, Trash2, UserPlus } from 'lucide-react'

const emptyForm = {
  name: '',
  code: '',
  source: 'blank',      // 'blank' | 'copy'
  copy_from_id: '',
  // null until a preview arrives and fills it in. null and [] mean different
  // things on the wire: null omits copy_parts and the server copies everything,
  // [] is an explicit "nothing". Never collapse the two.
  copy_parts: null,
  admin_username: '',
  admin_password: '',
}

/**
 * The company registry — every tenant registered on this install, who
 * registered it, and how many accounts it holds. Super admins only.
 *
 * Registering here does the same work as `python -m db.migrate new-company`:
 * allocates company_NNN, creates the schema, and applies every company
 * migration to it. The company's code is set here and never changes: every
 * username inside the company begins with it.
 *
 * This is the whole of a super admin's app. They cannot enter a company, so
 * seeding the first Company Admin is how anyone gets in — either at
 * registration or later, with Add admin.
 */
export default function CompaniesPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  // The register modal is two screens: name, then how it should start. The name
  // is checked on Next rather than on Create, so a clash surfaces before the
  // user has configured anything else.
  const [step, setStep] = useState(1)
  const [form, setForm] = useState(emptyForm)
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [renaming, setRenaming] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [statusConfirm, setStatusConfirm] = useState(null)
  const [deleting, setDeleting] = useState(null)      // { company, check } | null
  const [deleteTyped, setDeleteTyped] = useState('')
  const [addingAdmin, setAddingAdmin] = useState(null)
  const [adminForm, setAdminForm] = useState({ username: '', password: '' })
  const [codeTarget, setCodeTarget] = useState(null)
  const [codeValue, setCodeValue] = useState('')

  // Only active companies can be copied from — a deactivated company is a
  // retired one, and its heads and beneficiaries are exactly the stale data a
  // new company should not inherit. The server refuses these too.
  const copyable = items.filter((c) => c.is_active)
  const copySource = copyable.find((c) => String(c.id) === String(form.copy_from_id))

  // The checkbox list is whatever the server said is copyable, never a list
  // kept here — a master table added on the backend shows up on its own.
  // Something the source has none of is shown greyed rather than hidden, so
  // "no banks were copied" reads as a fact about the source instead of a
  // missing option.
  const selectedParts = form.copy_parts || []
  const selectable = (preview?.parts || []).filter((p) => p.count > 0).map((p) => p.key)
  const allSelected = selectable.length > 0 && selectable.every((k) => selectedParts.includes(k))

  const togglePart = (key) =>
    setForm((f) => {
      const cur = f.copy_parts || []
      return {
        ...f,
        copy_parts: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
      }
    })

  const toggleAllParts = () =>
    setForm((f) => ({ ...f, copy_parts: allSelected ? [] : selectable }))

  useEffect(() => {
    load()
  }, [showInactive])

  // What the chosen company would actually bring across. Counted by the server
  // rather than described in the UI, so the sentence the user agrees to is the
  // one that happens.
  useEffect(() => {
    if (form.source !== 'copy' || !form.copy_from_id) {
      setPreview(null)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    fetchClonePreview(form.copy_from_id)
      .then((p) => {
        if (cancelled) return
        setPreview(p)
        // Everything the source actually has, ticked. Copying all of it is what
        // someone picking "copy an existing company" asked for; the checkboxes
        // are there to take things away, not to make them opt in one at a time.
        setForm((f) => ({
          ...f,
          copy_parts: p.parts.filter((x) => x.count > 0).map((x) => x.key),
        }))
      })
      .catch(() => { if (!cancelled) setPreview(null) })
      .finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [form.source, form.copy_from_id])

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

  const openRegister = () => {
    setForm(emptyForm)
    setPreview(null)
    setStep(1)
    setModalOpen(true)
  }

  const handleNext = () => {
    const name = form.name.trim()
    if (name.length < 2) {
      toast.error('Company name must be at least 2 characters')
      return
    }
    // Checked against the list already on screen. The server is still the
    // authority — it also sees companies this page is not showing — but
    // catching it here means the user is not asked to fill in a second screen
    // for a name that was never going to be accepted.
    if (items.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) {
      toast.error(`A company named "${name}" already exists`)
      return
    }
    const code = form.code.trim().toLowerCase()
    if (!/^[a-z]{3}$/.test(code)) {
      toast.error('Company code must be exactly three letters (a-z)')
      return
    }
    if (items.some((c) => (c.code || '').toLowerCase() === code)) {
      toast.error(`Code "${code}" is already used by another company`)
      return
    }
    setForm((f) => ({ ...f, code }))
    setStep(2)
  }

  const handleRegister = async () => {
    const wantsCopy = form.source === 'copy'
    if (wantsCopy && !form.copy_from_id) {
      toast.error('Pick the company to copy from')
      return
    }
    const wantsAdmin = form.admin_username.trim() || form.admin_password
    if (wantsAdmin && !(form.admin_username.trim() && form.admin_password)) {
      toast.error('Give both an admin username and password, or leave both empty')
      return
    }

    setSaving(true)
    try {
      const payload = { name: form.name.trim(), code: form.code.trim().toLowerCase() }
      if (wantsCopy) {
        payload.copy_from_id = Number(form.copy_from_id)
        // Only when the user has actually seen the choices. If the preview
        // never loaded, copy_parts stays null and is left out, so the server
        // copies everything — which is what "copy this company" means before
        // anyone narrows it.
        if (form.copy_parts !== null) payload.copy_parts = form.copy_parts
      }
      if (wantsAdmin) {
        payload.admin_username = form.admin_username.trim()
        payload.admin_password = form.admin_password
      }
      const { company, admin, copied } = await registerCompany(payload)
      // Report what actually happened rather than "done" — a copy is the kind
      // of operation people want to see confirmed in numbers.
      const parts = [`${company.name} registered as ${company.schema_name}`]
      if (copied) {
        const bits = []
        if (copied.fields) bits.push(`${copied.fields} fields`)
        const records = copied.projects + copied.masters
        if (records) bits.push(`${records} records`)
        parts.push(
          bits.length
            ? `copied ${bits.join(' and ')} from ${copied.source_name}`
            : `nothing copied from ${copied.source_name}`
        )
      }
      if (admin) parts.push(`admin '${admin.username}' created`)
      toast.success(parts.join(' — '))
      setModalOpen(false)
      setForm(emptyForm)
      setPreview(null)
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

  const openDelete = async (company) => {
    // Ask the server what is in the way BEFORE offering the button, so the
    // refusal is read as part of the decision rather than after making it.
    try {
      setDeleting({ company, check: null })
      setDeleteTyped('')
      setDeleting({ company, check: await fetchDeleteCheck(company.id) })
    } catch (err) {
      toast.error(err.message)
      setDeleting(null)
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    setSaving(true)
    try {
      const res = await deleteCompany(deleting.company.id, deleteTyped.trim())
      toast.success(
        `${res.name} deleted — schema ${res.schema_name} dropped` +
        (res.users_removed ? `, ${res.users_removed} account(s) removed` : '')
      )
      setDeleting(null)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleAddAdmin = async () => {
    if (!addingAdmin) return
    setSaving(true)
    try {
      const { admin } = await addCompanyAdmin(
        addingAdmin.id, adminForm.username.trim(), adminForm.password
      )
      toast.success(`'${admin.username}' created as company admin`)
      setAddingAdmin(null)
      setAdminForm({ username: '', password: '' })
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSetCode = async () => {
    if (!codeTarget) return
    setSaving(true)
    try {
      await updateCompany(codeTarget.id, { code: codeValue.trim().toLowerCase() })
      toast.success(`Code set to '${codeValue.trim().toLowerCase()}'`)
      setCodeTarget(null)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Companies"
        description="Every company registered on this install."
        actions={
          <button onClick={openRegister} className="btn-primary">
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
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Code</th>
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
                  <tr><td colSpan="8" className="px-6 py-12"><Spinner /></td></tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan="8">
                      <EmptyState
                        title="No companies"
                        description="Register a company to give it its own isolated ledger."
                        action={
                          <button onClick={openRegister} className="btn-primary text-sm">
                            <Plus className="h-4 w-4 mr-1.5" />
                            Register Company
                          </button>
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  items.map((c) => (
                      <tr key={c.id} className="transition-colors hover:bg-slate-50/70">
                        <td className="px-6 py-3 font-medium text-slate-900">{c.name}</td>
                        <td className="px-6 py-3">
                          {c.code ? (
                            <span className="inline-flex px-2 py-0.5 rounded bg-slate-100 text-xs font-mono font-medium text-slate-700">
                              {c.code}
                            </span>
                          ) : (
                            // Registered before codes existed. Offered here rather
                            // than left blank, because until it has one its users
                            // cannot be held to the naming rule.
                            <button
                              onClick={() => { setCodeTarget(c); setCodeValue('') }}
                              className="text-xs text-amber-700 hover:underline"
                            >
                              Set code
                            </button>
                          )}
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
                            {c.is_active && (
                              <button
                                onClick={() => { setAddingAdmin(c); setAdminForm({ username: '', password: '' }) }}
                                title="Add a company admin"
                                className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-primary-600"
                              >
                                <UserPlus className="h-3.5 w-3.5" />
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
                            <button
                              onClick={() => openDelete(c)}
                              title="Delete permanently"
                              className="p-1.5 rounded hover:bg-red-50 text-slate-500 hover:text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={step === 1 ? 'Register Company' : `How should ${form.name.trim()} start?`}
      >
        {step === 1 ? (
          <div className="space-y-4">
            <div>
              <label className="label">Company Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleNext()}
                className="input"
                placeholder="e.g. DPL Homes"
                autoFocus
              />
              <p className="mt-1 text-xs text-slate-500">
                Creates an isolated schema and applies every company migration to it.
              </p>
            </div>

            <div>
              <label className="label">Company Code</label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase().slice(0, 3) })}
                onKeyDown={(e) => e.key === 'Enter' && handleNext()}
                className="input font-mono w-28 tracking-widest"
                placeholder="abc"
                maxLength={3}
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-slate-500">
                Exactly three letters. Every username in this company begins with
                it, so code <span className="font-mono">{form.code || 'abc'}</span> means
                accounts named <span className="font-mono">{(form.code || 'abc')}-ravi</span>.{' '}
                <span className="text-slate-700 font-medium">It cannot be changed later.</span>
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={handleNext} className="btn-primary text-sm">Next</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Blank or copied. The copy option spells out what does and does
                not come across: "copy a company" reads to most people as "copy
                everything", and the one thing it never copies is the ledger. */}
            <div className="space-y-2">
              <label
                className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  form.source === 'blank'
                    ? 'border-primary-300 bg-primary-50/50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={form.source === 'blank'}
                  onChange={() => setForm({ ...form, source: 'blank', copy_from_id: '' })}
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">Blank company</p>
                  <p className="text-xs text-slate-500">
                    Starts with the default field setup and nothing in it.
                  </p>
                </div>
              </label>

              <label
                className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  form.source === 'copy'
                    ? 'border-primary-300 bg-primary-50/50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={form.source === 'copy'}
                  onChange={() => setForm({ ...form, source: 'copy' })}
                  disabled={copyable.length === 0}
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">Copy an existing company</p>
                  <p className="text-xs text-slate-500">
                    Copies field structure, labels and master data — you pick which.{' '}
                    <span className="text-slate-700 font-medium">
                      Does not copy transactions, imports or users.
                    </span>
                  </p>
                  {copyable.length === 0 && (
                    <p className="mt-1 text-xs text-slate-400">
                      No active company to copy from yet.
                    </p>
                  )}
                </div>
              </label>
            </div>

            {form.source === 'copy' && (
              <div className="pl-1">
                <label className="label">Copy from</label>
                <select
                  value={form.copy_from_id}
                  onChange={(e) => setForm({ ...form, copy_from_id: e.target.value })}
                  className="input"
                >
                  <option value="">Select a company...</option>
                  {copyable.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>

                {previewLoading && (
                  <p className="mt-2 text-xs text-slate-400">Checking what would be copied...</p>
                )}

                {preview && !previewLoading && (
                  <div className="mt-2 rounded-lg border border-slate-200 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
                      <span className="text-xs font-medium text-slate-700">What to copy</span>
                      <button
                        type="button"
                        onClick={toggleAllParts}
                        disabled={selectable.length === 0}
                        className="text-xs text-primary-600 hover:underline disabled:text-slate-300 disabled:no-underline"
                      >
                        {allSelected ? 'Clear all' : 'Select all'}
                      </button>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {preview.parts.map((p) => (
                        <label
                          key={p.key}
                          className={`flex items-center gap-2.5 px-3 py-2 ${
                            p.count === 0
                              ? 'opacity-50'
                              : 'cursor-pointer hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="rounded border-slate-300"
                            disabled={p.count === 0}
                            checked={selectedParts.includes(p.key)}
                            onChange={() => togglePart(p.key)}
                          />
                          <span className="flex-1 text-sm text-slate-700">
                            {p.label}
                            {p.key === 'fields' && preview.custom_columns > 0 && (
                              <span className="ml-1 text-xs text-slate-400">
                                ({preview.custom_columns} custom)
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-slate-400 tabular-nums">
                            {p.count === 0 ? 'none' : p.count}
                          </span>
                        </label>
                      ))}
                    </div>

                    <p className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
                      No transactions, imports or accounts are copied. A copy is a
                      snapshot — changing {copySource?.name || 'the source'} later will
                      not change this company.
                    </p>
                  </div>
                )}

                {preview && !previewLoading && selectedParts.length === 0 && (
                  <p className="mt-2 text-xs text-amber-700">
                    Nothing ticked — this creates a blank company.
                  </p>
                )}
              </div>
            )}

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
                    className="input font-mono"
                    placeholder={(form.code || 'abc') + '-admin'}
                    autoComplete="off"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Must start with <span className="font-mono">{(form.code || 'abc')}-</span>.
                  </p>
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

            <div className="flex justify-between gap-3 pt-2">
              {/* Back keeps the name — the whole point of splitting the screens
                  is that changing your mind here is free. */}
              <button onClick={() => setStep(1)} className="btn-secondary text-sm">Back</button>
              <div className="flex gap-3">
                <button onClick={() => setModalOpen(false)} className="btn-secondary text-sm">Cancel</button>
                <button onClick={handleRegister} disabled={saving} className="btn-primary text-sm">
                  {saving
                    ? (form.source === 'copy' ? 'Copying...' : 'Registering...')
                    : (form.source === 'copy' ? 'Create Copy' : 'Register')}
                </button>
              </div>
            </div>
          </div>
        )}
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

      {/* Add an admin to an existing company. A super admin cannot go in, so
          this is the only way to put someone inside one after registration —
          without it, a company whose last admin was deleted is unreachable. */}
      <Modal
        isOpen={!!addingAdmin}
        onClose={() => setAddingAdmin(null)}
        title={'Add admin to ' + (addingAdmin ? addingAdmin.name : '')}
      >
        <div className="space-y-4">
          {addingAdmin && !addingAdmin.code && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              This company has no code yet, so no prefix is required. Set one from
              the Code column to apply the naming rule to future accounts.
            </p>
          )}
          <div>
            <label className="label">Username</label>
            <input
              value={adminForm.username}
              onChange={(e) => setAdminForm({ ...adminForm, username: e.target.value })}
              className="input font-mono"
              placeholder={addingAdmin && addingAdmin.code ? addingAdmin.code + '-admin' : 'At least 3 characters'}
              autoComplete="off"
            />
            {addingAdmin && addingAdmin.code && (
              <p className="mt-1 text-xs text-slate-500">
                Must start with <span className="font-mono">{addingAdmin.code}-</span>.
              </p>
            )}
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              value={adminForm.password}
              onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
              className="input"
              placeholder="At least 4 characters"
              autoComplete="new-password"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setAddingAdmin(null)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleAddAdmin} disabled={saving} className="btn-primary text-sm">
              {saving ? 'Creating...' : 'Create Admin'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Backfill a code onto a company registered before codes existed. */}
      <Modal
        isOpen={!!codeTarget}
        onClose={() => setCodeTarget(null)}
        title={'Set code for ' + (codeTarget ? codeTarget.name : '')}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Company Code</label>
            <input
              value={codeValue}
              onChange={(e) => setCodeValue(e.target.value.toLowerCase().slice(0, 3))}
              className="input font-mono w-28 tracking-widest"
              placeholder="abc"
              maxLength={3}
              autoFocus
            />
            <p className="mt-1 text-xs text-slate-500">
              Three letters, set once. New accounts here will have to start with it.
              The {codeTarget ? codeTarget.user_count : 0} existing account(s) keep
              their names and keep working.
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setCodeTarget(null)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleSetCode} disabled={saving} className="btn-primary text-sm">
              {saving ? 'Saving...' : 'Set Code'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Permanent delete. The server refuses any company holding data; this
          asks it first, so the refusal is read before the decision rather
          than after it. */}
      <Modal
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        title={'Delete ' + (deleting ? deleting.company.name : '')}
      >
        {!deleting || !deleting.check ? (
          <Spinner />
        ) : !deleting.check.can_delete ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">{deleting.check.reason}</p>
            <p className="text-xs text-slate-500">
              Deleting is for throwing away a company created by mistake. Anything
              with a ledger gets deactivated instead — it disappears from the list
              and nobody can sign in, but nothing is destroyed.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setDeleting(null)} className="btn-secondary text-sm">Close</button>
              <button
                onClick={() => { setStatusConfirm(deleting.company); setDeleting(null) }}
                className="btn-primary text-sm"
              >
                Deactivate instead
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              This drops the schema{' '}
              <span className="font-mono">{deleting.company.schema_name}</span>
              {deleting.check.users > 0 && <> and removes {deleting.check.users} account(s)</>}.
              It holds no transactions, staged rows or imports.
            </p>
            {/* No ledger is not the same as nothing of value. A company can hold
                a field setup someone spent an afternoon on and still have never
                taken a statement — that is exactly the case the transaction
                count does not catch. */}
            {deleting.check.holds &&
              (deleting.check.holds.fields || deleting.check.holds.projects || deleting.check.holds.masters) && (
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Its setup goes too: <strong>{deleting.check.holds.fields}</strong> fields,{' '}
                <strong>{deleting.check.holds.projects}</strong> projects and{' '}
                <strong>{deleting.check.holds.masters}</strong> master records. If you
                want to keep that, register a copy of this company first.
              </p>
            )}
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              Permanent. There is no undo and no backup.
            </p>
            <div>
              <label className="label">
                Type <span className="font-medium">{deleting.company.name}</span> to confirm
              </label>
              <input
                value={deleteTyped}
                onChange={(e) => setDeleteTyped(e.target.value)}
                className="input"
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setDeleting(null)} className="btn-secondary text-sm">Cancel</button>
              <button
                onClick={handleDelete}
                disabled={saving || deleteTyped.trim() !== deleting.company.name}
                className="btn-primary text-sm bg-red-600 hover:bg-red-700 disabled:bg-red-300"
              >
                {saving ? 'Deleting...' : 'Delete permanently'}
              </button>
            </div>
          </div>
        )}
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
