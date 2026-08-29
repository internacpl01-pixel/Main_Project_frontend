import { useEffect, useState } from 'react'
import { fetchProjects, createProject, updateProject, deleteProject } from '../api/endpoints.js'
import {
  Modal, Spinner, EmptyState, ConfirmDialog, TableBusy, SkeletonRows,
} from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react'

const emptyForm = { name: '', code: '', address: '' }

export default function ProjectsPage() {
  // Staff read projects but cannot reshape them — the API enforces the same
  // rule, this just spares them buttons that would 403.
  const { canWrite } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [confirmPerm, setConfirmPerm] = useState(false)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchProjects()
      setItems(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  const openEdit = (p) => {
    setEditing(p.id)
    setForm({ name: p.name, code: p.code || '', address: p.address || '' })
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Project name is required')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await updateProject(editing, form)
        toast.success('Project updated')
      } else {
        await createProject(form)
        toast.success('Project created')
      }
      setModalOpen(false)
      load()
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
      await deleteProject(deleteConfirm.id)
      toast.success('Project deleted')
      setDeleteConfirm(null)
      setConfirmPerm(false)
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
        title="Projects"
        description="Manage your projects."
        actions={
          canWrite && (
            <button onClick={openCreate} className="btn-primary">
              <Plus className="h-4 w-4 mr-1.5" />
              New Project
            </button>
          )
        }
      />

      {error && <EmptyState title="Error" description={error} />}

      {!error && (
        <div className="card">
          {/* The wrapper holds the overlay, not the scroller: a scroller is as
              wide as its widest row, so a spinner centred in it can land
              off-screen. */}
          <div className="relative">
          {loading && items.length > 0 && <TableBusy />}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Code</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Address</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && items.length === 0 ? (
                  // Skeletons on the first load, so the card keeps its height;
                  // a reload keeps the rows and dims them instead.
                  <SkeletonRows cols={5} rows={5} />
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan="5">
                      <EmptyState
                        title="No projects"
                        description={
                          canWrite
                            ? 'Create your first project to start organizing transactions.'
                            : 'No projects yet. Ask a manager to create one.'
                        }
                        action={
                          canWrite && (
                            <button onClick={openCreate} className="btn-primary text-sm">
                              <Plus className="h-4 w-4 mr-1.5" />
                              New Project
                            </button>
                          )
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  items.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-6 py-3 font-medium text-slate-900">{p.name}</td>
                      <td className="px-6 py-3 text-xs text-slate-600 font-mono">{p.code || '—'}</td>
                      <td className="px-6 py-3 text-xs text-slate-600 max-w-xs truncate">{p.address || '—'}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          p.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {p.is_active ? 'Active' : 'Archived'}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canWrite ? (
                            <>
                              <button onClick={() => openEdit(p)} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-primary-600">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => { setDeleteConfirm(p); setConfirmPerm(false) }}
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
                  ))
                )}
              </tbody>
            </table>
          </div>
          </div>
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Project' : 'New Project'}>
        <div className="space-y-4">
          <div>
            <label className="label">Project Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
              placeholder="e.g. Dwarkadhis Sky Heights"
            />
          </div>
          <div>
            <label className="label">Code</label>
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="input"
              placeholder="e.g. SKY-001"
            />
          </div>
          <div>
            <label className="label">Address</label>
            <textarea
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="input"
              rows={2}
              placeholder="Project address"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
              {saving && <Spinner size="sm" tone="white" className="mr-2" />}
              {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => { setDeleteConfirm(null); setConfirmPerm(false) }}
        onConfirm={handleDelete}
        title="Delete Project"
        message={`Delete "${deleteConfirm?.name}"? This cannot be undone.`}
        confirmText={saving ? 'Deleting...' : 'Delete'}
        busy={saving}
        danger
      />
    </div>
  )
}