import { useEffect, useState, useCallback } from 'react'
import {
  fetchFieldMappings, createFieldMapping, updateFieldMapping, deleteFieldMapping,
} from '../api/endpoints.js'
import { Modal, Spinner, EmptyState, ConfirmDialog, SearchInput, MethodInput, MethodBadge } from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, GripVertical, ChevronRight, RefreshCw } from 'lucide-react'

// is_active is part of the form because the importer only ever reads rows where
// it is true (services/fieldmap.py). Turning a mapping off is how you retire a
// bank's spelling without deleting it and losing the alias list.
const EMPTY_FORM = { fieldname: '', displayname: '', mapfields: '', data_type: 'text', method: '', is_active: true }

export default function FieldMappingPage() {
  // Staff read this page but cannot change it — the API enforces the same
  // rule, this just spares them buttons that would 403.
  const { canWrite } = useAuth()
  const [mappings, setMappings] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setMappings(await fetchFieldMappings())
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setModalOpen(true) }
  const openEdit = (m) => {
    setEditing(m.id)
    setForm({
      fieldname: m.fieldname,
      displayname: m.displayname,
      mapfields: m.mapfields,
      data_type: m.data_type,
      method: m.method || '',
      is_active: m.is_active ?? true,
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!form.fieldname.trim() || !form.displayname.trim()) {
      toast.error('Field name and display name are required.')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await updateFieldMapping(editing, form)
        toast.success('Mapping updated')
      } else {
        await createFieldMapping(form)
        toast.success('Mapping created')
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
    if (!deleteTarget) return
    setSaving(true)
    try {
      await deleteFieldMapping(deleteTarget.id)
      toast.success('Mapping deleted')
      setDeleteTarget(null)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const filtered = mappings.filter((m) =>
    !search.trim() ||
    m.fieldname.toLowerCase().includes(search.toLowerCase()) ||
    m.displayname.toLowerCase().includes(search.toLowerCase()) ||
    (m.mapfields || '').toLowerCase().includes(search.toLowerCase()) ||
    (m.method || '').toLowerCase().includes(search.toLowerCase())
  )

  const DATA_TYPES = [
    { value: 'text', label: 'Text' },
    { value: 'date', label: 'Date' },
    { value: 'numeric', label: 'Numeric' },
  ]

  return (
    <div>
      <PageHeader
        title="Field Mapping"
        description="Map bank statement column headers to canonical fields so the importer can recognize them."
        actions={
          canWrite && (
            <button onClick={openCreate} className="btn-primary">
              <Plus className="h-4 w-4 mr-1.5" />
              Add Mapping
            </button>
          )
        }
      />

      <div className="card">
        <div className="px-6 py-4 border-b border-slate-200">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search mappings..."
            onClear={() => setSearch('')}
          />
        </div>

        {loading ? (
          <div className="px-6 py-16"><Spinner size="lg" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<GripVertical className="h-10 w-10" />}
            title="No mappings found"
            description={search ? 'Try adjusting your search.' : 'Create your first field mapping to enable bank statement parsing.'}
            action={!search && canWrite && (
              <button onClick={openCreate} className="btn-primary text-sm">
                <Plus className="h-4 w-4 mr-1.5" />
                Add Mapping
              </button>
            )}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide w-8" />
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Canonical Field</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Display Name</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Aliases (mapfields)</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Type</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Method</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-2 py-3 text-slate-400">
                      <GripVertical className="h-4 w-4" />
                    </td>
                    <td className="px-6 py-3">
                      <code className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono">
                        {m.fieldname}
                      </code>
                    </td>
                    <td className="px-6 py-3 text-sm font-medium text-slate-900">{m.displayname}</td>
                    <td className="px-6 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(m.mapfields || '').split(',').filter(Boolean).slice(0, 5).map((a, i) => (
                          <span key={i} className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full border border-primary-100">
                            {a.trim()}
                          </span>
                        ))}
                        {(m.mapfields || '').split(',').filter(Boolean).length > 5 && (
                          <span className="text-xs text-slate-400">+{(m.mapfields || '').split(',').filter(Boolean).length - 5} more</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        m.data_type === 'date' ? 'bg-blue-100 text-blue-700' :
                        m.data_type === 'numeric' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {m.data_type}
                      </span>
                    </td>
                    <td className="px-6 py-3"><MethodBadge value={m.method} /></td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        m.is_active === false
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {m.is_active === false ? 'Inactive' : 'Active'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canWrite ? (
                          <>
                            <button
                              onClick={() => openEdit(m)}
                              className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-primary-600"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(m)}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Mapping' : 'New Field Mapping'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Canonical Field Name *</label>
              <input
                value={form.fieldname}
                onChange={(e) => setForm({ ...form, fieldname: e.target.value })}
                className="input font-mono text-sm"
                placeholder="e.g. withdrawal"
              />
              <p className="text-xs text-slate-400 mt-1">This becomes the column name in temp_trans. Cannot be changed after rows are staged.</p>
            </div>
            <div>
              <label className="label">Display Name *</label>
              <input
                value={form.displayname}
                onChange={(e) => setForm({ ...form, displayname: e.target.value })}
                className="input"
                placeholder="e.g. Withdrawal Amount"
              />
            </div>
          </div>
          <div className="flex items-end gap-6">
            <div>
              <label className="label">Data Type</label>
              <select value={form.data_type} onChange={(e) => setForm({ ...form, data_type: e.target.value })} className="input max-w-xs">
                {DATA_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              Active
            </label>
          </div>
          <MethodInput
            value={form.method}
            onChange={(v) => setForm({ ...form, method: v })}
            id="fm-methods"
          />
          <div>
            <label className="label">Aliases (comma-separated)</label>
            <textarea
              value={form.mapfields}
              onChange={(e) => setForm({ ...form, mapfields: e.target.value })}
              className="input"
              rows={3}
              placeholder="e.g. withdrawal,withdrawal amt,debit,dr,amount out"
            />
            <p className="text-xs text-slate-400 mt-1">Bank-specific column headers that map to this field. The parser matches these against the PDF/Excel header row.</p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
              {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Mapping"
        message={`Delete "${deleteTarget?.displayname}"? Existing staged rows keep their values, but new imports won't recognize this header.`}
        confirmText="Delete"
        danger
      />
    </div>
  )
}