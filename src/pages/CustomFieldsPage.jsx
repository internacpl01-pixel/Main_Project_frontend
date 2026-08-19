import { useEffect, useState, useCallback } from 'react'
import {
  fetchCustomFields, createCustomField, deleteCustomFieldById, deleteCustomField,
  updateFieldMapEntry,
} from '../api/endpoints.js'
import { Modal, Spinner, EmptyState, ConfirmDialog, MethodInput, MethodBadge } from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, RefreshCw, Columns3, AlertTriangle } from 'lucide-react'

// Mirrors TYPE_MAP in services/custom_fields.py. The keys are what the API
// accepts; the SQL column type is chosen server-side from the same table.
const FIELD_TYPES = [
  { value: 'text', label: 'Text', sql: 'TEXT', hint: 'Names, references, any free text' },
  { value: 'num', label: 'Number', sql: 'NUMERIC(18,2)', hint: 'Amounts and quantities' },
  { value: 'date', label: 'Date', sql: 'DATE', hint: 'Value date, cheque date' },
]

const EMPTY_FORM = { type: 'text', displayname: '', mapfields: '', method: '' }

export default function CustomFieldsPage() {
  // Staff read this page but cannot change the table — the API enforces the
  // same rule, this just spares them buttons that would 403.
  const { canWrite } = useAuth()
  const [fields, setFields] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({ displayname: '', mapfields: '', data_type: 'text', method: '', is_active: true })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setFields(await fetchCustomFields())
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    setSaving(true)
    try {
      const res = await createCustomField(form.type, form.displayname, form.mapfields, form.method)
      toast.success(`Column ${res.column} (${res.type}) added`)
      setModalOpen(false)
      setForm(EMPTY_FORM)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (f) => {
    setEditing(f)
    setEditForm({
      displayname: f.displayname || '',
      mapfields: f.mapfields || '',
      data_type: f.data_type || 'text',
      method: f.method || '',
      is_active: f.is_active ?? true,
    })
  }

  // Edits go to PATCH /fieldmap/{id}: they change how a column is recognised,
  // never the column itself. Renaming the SQL identifier is deliberately not
  // offered — the column name is generated so it can be safely interpolated,
  // and the display name is what anyone actually reads.
  const handleEdit = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await updateFieldMapEntry(editing.id, editForm)
      toast.success('Field updated')
      setEditing(null)
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
      // Every row on this page comes from the fieldmap and therefore has an id.
      // Falling back to the name covers an orphaned column with no mapping row.
      if (deleteTarget.id) await deleteCustomFieldById(deleteTarget.id)
      else await deleteCustomField(deleteTarget.fieldname)
      toast.success(`Field '${deleteTarget.fieldname}' deleted`)
      setDeleteTarget(null)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const lockedCount = fields.filter((f) => !f.deletable).length

  return (
    <div>
      <PageHeader
        title="Custom Fields"
        description="Add your own columns to the staging table. A custom field becomes a real column on temp_trans plus a fieldmap entry, so the importer can recognise it in a statement and store what it finds."
        actions={
          canWrite && (
            <div className="flex items-center gap-2">
              <button onClick={load} className="btn-secondary" title="Refresh">
                <RefreshCw className="h-4 w-4" />
              </button>
              <button onClick={() => { setForm(EMPTY_FORM); setModalOpen(true) }} className="btn-primary">
                <Plus className="h-4 w-4 mr-1.5" />
                Add Field
              </button>
            </div>
          )
        }
      />

      <div className="card">
        <div className="px-6 py-3 border-b border-slate-200 text-xs text-slate-500">
          {fields.length} {fields.length === 1 ? 'field' : 'fields'}
          {lockedCount > 0 && ` · ${lockedCount} held by the database`}
        </div>

        {loading ? (
          <div className="px-6 py-16"><Spinner size="lg" /></div>
        ) : fields.length === 0 ? (
          <EmptyState
            icon={<Columns3 className="h-10 w-10" />}
            title="No fields defined yet"
            description="Add a custom field to capture something this bank prints that the standard columns don't cover."
            action={canWrite && (
              <button onClick={() => setModalOpen(true)} className="btn-primary text-sm">
                <Plus className="h-4 w-4 mr-1.5" />Add Field
              </button>
            )}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Display Name</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Field</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Column</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Method</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fields.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-6 py-3 text-sm font-medium text-slate-900">
                      {f.displayname || f.fieldname}
                    </td>
                    <td className="px-6 py-3">
                      <code className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono">
                        {f.fieldname}
                      </code>
                    </td>
                    <td className="px-6 py-3 text-xs">
                      {f.has_column ? (
                        <span className="text-slate-600 font-mono">{f.column_type}</span>
                      ) : f.is_custom ? (
                        // A custom field whose column was dropped straight from
                        // Postgres. Shown, not hidden, so it can be cleaned up.
                        <span className="inline-flex items-center gap-1 text-red-600" title="The column is gone but the mapping remains. Delete to clean up.">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          no column
                        </span>
                      ) : (
                        // withdrawal / deposits / reference_no have no column by
                        // design — the first two collapse into amount plus
                        // credit_debit, and the parser keeps all three in
                        // raw_data. Not drift, so not an error.
                        <span className="text-slate-400" title="Read during import but not stored in its own column">
                          in raw_data
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3"><MethodBadge value={f.method} /></td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        f.is_active === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {f.is_active === false ? 'Inactive' : 'Active'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canWrite ? (
                          <>
                            <button
                              onClick={() => openEdit(f)}
                              className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-primary-600"
                              title="Edit field"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(f)}
                              disabled={!f.deletable}
                              title={f.deletable ? 'Delete field' : `Cannot delete: ${f.locked_reason}`}
                              className="p-1.5 rounded text-slate-500 enabled:hover:bg-red-50 enabled:hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
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

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Add Custom Field" size="lg">
        <div className="space-y-4">
          <div>
            <label className="label">Field Type *</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {FIELD_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setForm({ ...form, type: t.value })}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                    form.type === t.value
                      ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-200'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="text-sm font-medium text-slate-900">{t.label}</div>
                  <div className="text-xs text-slate-400 font-mono">{t.sql}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{t.hint}</div>
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              Decides the column type and how the parser coerces whatever it finds.
            </p>
          </div>

          <div>
            <label className="label">Display Name</label>
            <input
              value={form.displayname}
              onChange={(e) => setForm({ ...form, displayname: e.target.value })}
              className="input"
              placeholder="e.g. Value Date"
            />
            <p className="text-xs text-slate-400 mt-1">
              The label shown everywhere. Leave blank to use the generated column name.
            </p>
          </div>

          <MethodInput
            value={form.method}
            onChange={(v) => setForm({ ...form, method: v })}
            id="cf-create-methods"
          />

          <div>
            <label className="label">Header Aliases (comma-separated)</label>
            <textarea
              value={form.mapfields}
              onChange={(e) => setForm({ ...form, mapfields: e.target.value })}
              className="input"
              rows={2}
              placeholder="e.g. value date,val dt,effective date"
            />
            <p className="text-xs text-slate-400 mt-1">
              What this column is called on the bank's statement. Without at least one
              alias the field exists but no statement header will ever match it. You can
              add these later under Field Mapping.
            </p>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-500">
            The column name is generated for you — <code className="font-mono">field_text_1</code>,{' '}
            <code className="font-mono">field_num_2</code> and so on. It goes straight into an
            <code className="font-mono"> ALTER TABLE</code>, so it is never free text.
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleCreate} disabled={saving} className="btn-primary text-sm">
              {saving ? 'Adding...' : 'Add Field'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.displayname || editing?.fieldname || ''}`}
        size="lg"
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-500">
            Column <code className="font-mono">{editing?.fieldname}</code>
            {editing?.has_column
              ? <> · <span className="font-mono">{editing?.column_type}</span></>
              : <> · not stored in its own column</>}
          </div>

          <div>
            <label className="label">Display Name</label>
            <input
              value={editForm.displayname}
              onChange={(e) => setEditForm({ ...editForm, displayname: e.target.value })}
              className="input"
            />
            <p className="text-xs text-slate-400 mt-1">
              Used as the column header in exports.
            </p>
          </div>

          <div className="flex items-end gap-6">
            <div>
              <label className="label">Data Type</label>
              <select
                value={editForm.data_type}
                onChange={(e) => setEditForm({ ...editForm, data_type: e.target.value })}
                className="input max-w-xs"
              >
                <option value="text">Text</option>
                <option value="date">Date</option>
                <option value="numeric">Numeric</option>
              </select>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={editForm.is_active}
                onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              Active
            </label>
          </div>
          <p className="-mt-2 text-xs text-slate-400">
            Data type drives how the parser coerces the value. Inactive fields are
            skipped entirely during import.
          </p>

          <MethodInput
            value={editForm.method}
            onChange={(v) => setEditForm({ ...editForm, method: v })}
            id="cf-edit-methods"
          />

          <div>
            <label className="label">Header Aliases (comma-separated)</label>
            <textarea
              value={editForm.mapfields}
              onChange={(e) => setEditForm({ ...editForm, mapfields: e.target.value })}
              className="input"
              rows={3}
            />
            <p className="text-xs text-slate-400 mt-1">
              What this field is called on the statement. Matching is case- and
              punctuation-insensitive.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setEditing(null)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleEdit} disabled={saving} className="btn-primary text-sm">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Field"
        message={
          `Delete "${deleteTarget?.displayname || deleteTarget?.fieldname}" (${deleteTarget?.fieldname})? ` +
          (deleteTarget?.has_column
            ? 'The column and every value stored in it will be dropped from temp_trans, including on rows already staged. '
            : 'The mapping will be removed. No column exists behind it, so no stored data is lost. ') +
          'Statements will stop recording this field until you add it back. This cannot be undone.'
        }
        confirmText="Delete Field"
        danger
      />
    </div>
  )
}
