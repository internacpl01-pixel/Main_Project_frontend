import { useEffect, useState } from 'react'
import {
  fetchUsers, createUser, updateUser, updateUserRole, deleteUser,
  fetchUserProjects, setUserProjects,
} from '../api/endpoints.js'
import { Modal, Spinner, EmptyState, ConfirmDialog } from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { useAuth, LEVELS, ROLE_LABELS, COMPANY_ADMIN } from '../context/AuthContext.jsx'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, ShieldCheck, FolderCog } from 'lucide-react'

// Mirrors LEVEL_CAN_CREATE / LEVEL_CAN_EDIT in backend/permissions.py, keyed
// by the same levels: -1 super admin, 0 company admin, 1 manager, 2 staff.
// A company admin may create a peer admin — so a company is never left with
// nobody able to administer it — but may not edit or delete one.
const CAN_CREATE = { 2: [], 1: [2], 0: [2, 1, 0], '-1': [2, 1, 0, -1] }
const CAN_EDIT = { 2: [], 1: [2], 0: [2, 1], '-1': [2, 1, 0] }

// Roles that live inside a company. super_admin is deliberately absent: it has
// no company, so it cannot be created or assigned from this page.
const COMPANY_ROLES = ['company_admin', 'manager', 'staff']

const ROLE_BADGES = {
  super_admin: 'bg-purple-100 text-purple-700',
  company_admin: 'bg-primary-100 text-primary-700',
  manager: 'bg-amber-100 text-amber-700',
  staff: 'bg-slate-100 text-slate-600',
}

// Same direction rule as AuthContext.hasLevel, applied to a table row's
// level rather than the signed-in user's.
const hasLevelValue = (level, required) => level <= required

const emptyForm = { username: '', password: '', role: 'staff' }

export default function UsersPage() {
  const { user, level, hasLevel } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({ username: '', password: '' })
  const [roleTarget, setRoleTarget] = useState(null)
  const [roleValue, setRoleValue] = useState('staff')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [saving, setSaving] = useState(false)

  // Project assignment
  const [projectTarget, setProjectTarget] = useState(null)
  const [projectRows, setProjectRows] = useState([])
  const [projectPicks, setProjectPicks] = useState(new Set())
  const [projectsLoading, setProjectsLoading] = useState(false)

  const creatableRoles = COMPANY_ROLES.filter((r) => (CAN_CREATE[level] || []).includes(LEVELS[r]))
  const canEditTarget = (targetLevel) => (CAN_EDIT[level] || []).includes(targetLevel)
  const canChangeRoles = hasLevel(COMPANY_ADMIN)
  // Only admins assign work, and only non-admins need assigning — an admin
  // already reaches every project without an assignment row.
  const canAssignProjects = hasLevel(COMPANY_ADMIN)
  const needsAssignment = (u) => !hasLevelValue(u.level, COMPANY_ADMIN)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await fetchUsers())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // With a company code the prefix is furniture, not something to type: it is
  // the same for every account here and getting it wrong is the one way this
  // form can be refused. So the box holds only the part after it, and these two
  // put the whole name back together.
  //
  // A company registered before codes existed has none, and its accounts are
  // not held to the rule — there the whole username is typed, as before.
  const codePrefix = user?.companyCode ? `${user.companyCode}-` : ''

  const composeUsername = (typed) =>
    codePrefix ? `${codePrefix}${typed.trim()}` : typed.trim()

  // Someone who pastes or types the full name should not end up with
  // "amb-amb-ravi" — the prefix is already on screen, so a leading copy of it
  // is a duplicate rather than part of the name.
  const stripPrefix = (raw) =>
    codePrefix && raw.toLowerCase().startsWith(codePrefix.toLowerCase())
      ? raw.slice(codePrefix.length)
      : raw

  const openCreate = () => {
    setForm({ ...emptyForm, role: creatableRoles[creatableRoles.length - 1] || 'staff' })
    setModalOpen(true)
  }

  const handleCreate = async () => {
    const newUsername = composeUsername(form.username)
    if (!form.username.trim() || !form.password) {
      toast.error('Username and password are required')
      return
    }
    setSaving(true)
    try {
      await createUser({
        username: newUsername,
        password: form.password,
        role: form.role,
      })
      toast.success(`${ROLE_LABELS[form.role]} '${newUsername}' created`)
      setModalOpen(false)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = async () => {
    if (!editing) return
    const payload = {}
    if (editForm.username.trim() && editForm.username.trim() !== editing.username) {
      payload.username = editForm.username.trim()
    }
    if (editForm.password) payload.password = editForm.password

    if (!Object.keys(payload).length) {
      toast.error('Change the username or set a new password first')
      return
    }

    setSaving(true)
    try {
      await updateUser(editing.id, payload)
      toast.success(`'${editing.username}' updated`)
      setEditing(null)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleRoleChange = async () => {
    if (!roleTarget) return
    if (roleValue === roleTarget.role) {
      setRoleTarget(null)
      return
    }
    setSaving(true)
    try {
      await updateUserRole(roleTarget.id, roleValue)
      toast.success(`'${roleTarget.username}' is now ${ROLE_LABELS[roleValue]}`)
      setRoleTarget(null)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const openProjects = async (u) => {
    setProjectTarget(u)
    setProjectsLoading(true)
    try {
      const data = await fetchUserProjects(u.id)
      setProjectRows(data.projects)
      setProjectPicks(new Set(data.projects.filter((p) => p.assigned).map((p) => p.id)))
    } catch (err) {
      toast.error(err.message)
      setProjectTarget(null)
    } finally {
      setProjectsLoading(false)
    }
  }

  const togglePick = (projectId) => {
    setProjectPicks((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const handleSaveProjects = async () => {
    if (!projectTarget) return
    setSaving(true)
    try {
      const { projects } = await setUserProjects(projectTarget.id, [...projectPicks])
      toast.success(
        projects.length
          ? `'${projectTarget.username}' assigned to ${projects.length} project${projects.length > 1 ? 's' : ''}`
          : `'${projectTarget.username}' removed from all projects`
      )
      setProjectTarget(null)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    setSaving(true)
    try {
      await deleteUser(deleteConfirm.id)
      toast.success(`'${deleteConfirm.username}' deleted`)
      setDeleteConfirm(null)
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
        title="Users"
        description={`Accounts for ${user?.schema || 'this company'}. You can manage anyone below your own level.`}
        actions={
          creatableRoles.length > 0 && (
            <button onClick={openCreate} className="btn-primary">
              <Plus className="h-4 w-4 mr-1.5" />
              Add User
            </button>
          )
        }
      />

      {error && <EmptyState title="Error" description={error} />}

      {!error && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Username</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Role</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Created</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan="4" className="px-6 py-12"><Spinner /></td></tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan="4">
                      <EmptyState
                        title="No users"
                        description="This company has no accounts yet."
                        action={
                          creatableRoles.length > 0 && (
                            <button onClick={openCreate} className="btn-primary text-sm">
                              <Plus className="h-4 w-4 mr-1.5" />
                              Add User
                            </button>
                          )
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  items.map((u) => {
                    const actionable = !u.is_self && canEditTarget(u.level)
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-6 py-3 font-medium text-slate-900">
                          {u.username}
                          {u.is_self && <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>}
                        </td>
                        <td className="px-6 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGES[u.role] || ROLE_BADGES.staff}`}>
                            {u.role_label}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-xs text-slate-500">
                          {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {actionable ? (
                              <>
                                <button
                                  onClick={() => { setEditing(u); setEditForm({ username: u.username, password: '' }) }}
                                  title="Edit username or password"
                                  className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-primary-600"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                {canAssignProjects && needsAssignment(u) && (
                                  <button
                                    onClick={() => openProjects(u)}
                                    title="Assign projects"
                                    className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-primary-600"
                                  >
                                    <FolderCog className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {canChangeRoles && (
                                  <button
                                    onClick={() => { setRoleTarget(u); setRoleValue(u.role) }}
                                    title="Change role"
                                    className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-primary-600"
                                  >
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={() => setDeleteConfirm(u)}
                                  title="Delete"
                                  className="p-1.5 rounded hover:bg-red-50 text-slate-500 hover:text-red-600"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
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

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Add User">
        <div className="space-y-4">
          <div>
            <label className="label">Username</label>
            {codePrefix ? (
              /* The prefix is shown as part of the field rather than typed into
                 it. The wrapper carries the border and the focus ring so the
                 two elements read as one input; the inner box is borderless. */
              <div className="flex w-full rounded-lg border border-slate-300 shadow-sm transition-colors focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500 overflow-hidden">
                <span className="flex items-center pl-3 pr-2 bg-slate-50 border-r border-slate-200 text-sm font-mono text-slate-500 select-none">
                  {codePrefix}
                </span>
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: stripPrefix(e.target.value) })}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !saving) handleCreate() }}
                  className="flex-1 min-w-0 px-3 py-2 text-sm font-mono placeholder-slate-400 focus:outline-none"
                  placeholder="ravi"
                  autoComplete="off"
                  autoFocus
                />
              </div>
            ) : (
              <input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="input"
                placeholder="At least 3 characters"
                autoComplete="off"
              />
            )}
            {/* The rule is enforced server-side in services/accounts.py. Showing
                the finished name is what makes the split field honest — what is
                created is one username, not two halves. */}
            {codePrefix && (
              <p className="mt-1 text-xs text-slate-500">
                Will be created as{' '}
                <span className="font-mono text-slate-700">
                  {composeUsername(form.username) || codePrefix}
                </span>
                {' — '}
                <span className="font-mono">{user.companyCode}</span> is the code for{' '}
                {user.companyName || 'this company'}.
              </p>
            )}
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="input"
              placeholder="At least 4 characters"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">Role</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="input"
            >
              {creatableRoles.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Staff read and enter data. Managers also manage projects, master data and
              mappings. Company Admins also manage users.
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleCreate} disabled={saving} className="btn-primary text-sm">
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={`Edit ${editing?.username || ''}`}>
        <div className="space-y-4">
          <div>
            <label className="label">Username</label>
            <input
              value={editForm.username}
              onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
              className="input"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label">New Password</label>
            <input
              type="password"
              value={editForm.password}
              onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
              className="input"
              placeholder="Leave blank to keep the current one"
              autoComplete="new-password"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setEditing(null)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleEdit} disabled={saving} className="btn-primary text-sm">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!roleTarget} onClose={() => setRoleTarget(null)} title={`Change role — ${roleTarget?.username || ''}`}>
        <div className="space-y-4">
          <div>
            <label className="label">Role</label>
            <select value={roleValue} onChange={(e) => setRoleValue(e.target.value)} className="input">
              {creatableRoles.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              You can only assign roles you are allowed to create.
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setRoleTarget(null)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleRoleChange} disabled={saving} className="btn-primary text-sm">
              {saving ? 'Saving...' : 'Update Role'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!projectTarget}
        onClose={() => setProjectTarget(null)}
        title={`Projects — ${projectTarget?.username || ''}`}
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            {projectTarget?.role_label} accounts see only the projects ticked here —
            their ledger, staging rows, dashboard totals and exports are all limited
            to them. Someone with nothing ticked sees no project data at all.
          </p>

          {projectsLoading ? (
            <div className="py-6"><Spinner /></div>
          ) : projectRows.length === 0 ? (
            <p className="text-sm text-slate-500">
              This company has no active projects yet. Create one first.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto space-y-1 border border-slate-200 rounded-lg p-2">
              {projectRows.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={projectPicks.has(p.id)}
                    onChange={() => togglePick(p.id)}
                    className="rounded border-slate-300"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-700 truncate">{p.name}</span>
                    {p.code && <span className="block text-xs text-slate-400 font-mono">{p.code}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-slate-500">
              {projectPicks.size} of {projectRows.length} selected
            </span>
            <div className="flex gap-3">
              <button onClick={() => setProjectTarget(null)} className="btn-secondary text-sm">Cancel</button>
              <button
                onClick={handleSaveProjects}
                disabled={saving || projectsLoading}
                className="btn-primary text-sm"
              >
                {saving ? 'Saving...' : 'Save Assignment'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDelete}
        title="Delete User"
        message={`Delete "${deleteConfirm?.username}"? This cannot be undone.`}
        confirmText="Delete"
        danger
      />
    </div>
  )
}
