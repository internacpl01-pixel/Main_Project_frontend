import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  fetchMasterSchema, fetchMasterData, createMasterEntry, updateMasterEntry, deleteMasterEntry,
} from '../api/endpoints.js'
import { Modal, Spinner, EmptyState, ConfirmDialog, SearchInput } from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, RefreshCw, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

// The tab list, the table columns and the add/edit form all come from
// GET /master/_schema. This page used to carry its own copy of the backend's
// table config; adding a column server-side then left the UI showing the old
// set until someone remembered to edit it here too.
const PAGE_SIZE = 25

const blankForm = (config) =>
  Object.fromEntries((config?.fields || []).map((f) => [f.key, '']))

export default function MasterDataPage() {
  // Staff read this page but cannot change it — the API enforces the same
  // rule, this just spares them buttons that would 403.
  const { canWrite } = useAuth()
  const [schema, setSchema] = useState([])
  const [schemaError, setSchemaError] = useState(null)
  const [masterType, setMasterType] = useState(null)
  const [allItems, setAllItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const config = schema.find((s) => s.key === masterType) || null

  useEffect(() => {
    fetchMasterSchema()
      .then((s) => {
        setSchema(s)
        // Open on the first tab the server lists rather than a name written
        // in here, so reordering _TABLES reorders the page.
        if (s.length > 0) {
          setMasterType(s[0].key)
          setSortBy(s[0].label_field)
        } else {
          setLoading(false)
        }
      })
      .catch((err) => { setSchemaError(err.message); setLoading(false) })
  }, [])

  const load = useCallback(async () => {
    if (!masterType) return
    setLoading(true)
    try {
      const data = await fetchMasterData(masterType)
      setAllItems(Array.isArray(data) ? data : [])
    } catch (err) {
      toast.error(err.message)
      setAllItems([])
    } finally {
      setLoading(false)
    }
  }, [masterType])

  useEffect(() => { load() }, [load])

  // Client-side filtering, sorting, and pagination
  const { pageItems, totalItems, totalPages } = useMemo(() => {
    if (!config) return { pageItems: [], totalItems: 0, totalPages: 1 }
    let filtered = allItems
    if (search.trim()) {
      const q = search.toLowerCase()
      filtered = allItems.filter((item) =>
        config.fields.some((f) => String(item[f.key] || '').toLowerCase().includes(q))
      )
    }

    filtered = [...filtered].sort((a, b) => {
      const aVal = a[sortBy] || ''
      const bVal = b[sortBy] || ''
      const cmp = String(aVal).localeCompare(String(bVal))
      return sortDir === 'asc' ? cmp : -cmp
    })

    const total = filtered.length
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    // Clamp page
    const safePage = Math.min(page, pages)
    const start = (safePage - 1) * PAGE_SIZE
    const items = filtered.slice(start, start + PAGE_SIZE)

    return { pageItems: items, totalItems: total, totalPages: pages }
  }, [allItems, search, sortBy, sortDir, page, config])

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir('asc')
    }
    setPage(1)
  }

  const handleSearch = (value) => {
    setSearch(value)
    setPage(1)
  }

  const handleTypeChange = (type) => {
    setMasterType(type)
    setSearch('')
    // Sort by whichever column identifies a row in the table being opened —
    // bank_master has no `name`, so a fixed 'name' here sorted by nothing.
    setSortBy(schema.find((s) => s.key === type)?.label_field || null)
    setSortDir('asc')
    setPage(1)
  }

  const openCreate = () => {
    setEditing(null)
    setForm(blankForm(config))
    setModalOpen(true)
  }

  const openEdit = (item) => {
    setEditing(item.id)
    const entry = {}
    config.fields.forEach(f => { entry[f.key] = item[f.key] || '' })
    setForm(entry)
    setModalOpen(true)
  }

  const handleSave = async () => {
    const missing = config.fields.filter(f => f.required && !form[f.key]?.trim())
    if (missing.length > 0) {
      toast.error(`${missing.map(f => f.label).join(', ')} is required.`)
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await updateMasterEntry(masterType, editing, form)
        toast.success(`${config.label} updated`)
      } else {
        await createMasterEntry(masterType, form)
        toast.success(`${config.label} created`)
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
      await deleteMasterEntry(masterType, deleteTarget.id)
      toast.success(`${config.label} deleted`)
      setDeleteTarget(null)
      if (pageItems.length <= 1 && page > 1) {
        setPage(p => p - 1)
      } else {
        load()
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Generate page numbers for pagination
  const pageNumbers = useMemo(() => {
    const pages = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (page > 3) pages.push('...')
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
        pages.push(i)
      }
      if (page < totalPages - 2) pages.push('...')
      pages.push(totalPages)
    }
    return pages
  }, [page, totalPages])

  if (schemaError) {
    return (
      <div>
        <PageHeader title="Master Data" />
        <div className="card">
          <EmptyState
            title="Could not load the master tables"
            description={schemaError}
            action={
              <button onClick={() => window.location.reload()} className="btn-secondary text-sm">
                Retry
              </button>
            }
          />
        </div>
      </div>
    )
  }

  if (!config) {
    return (
      <div>
        <PageHeader title="Master Data" />
        <div className="card"><div className="px-6 py-16 flex justify-center"><Spinner size="lg" /></div></div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Master Data"
        description="These lists fill every dropdown in the app. Each company keeps its own copy."
      />

      {/* Master Type Tabs — one per table the API reports. */}
      <div className="flex items-center gap-1 mb-4 p-1 bg-slate-100 rounded-lg w-fit flex-wrap">
        {schema.map((cfg) => (
          <button
            key={cfg.key}
            onClick={() => handleTypeChange(cfg.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              masterType === cfg.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {cfg.label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <SearchInput
          value={search}
          onChange={handleSearch}
          placeholder={`Search ${config.label.toLowerCase()}...`}
          onClear={() => handleSearch('')}
        />
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="btn-secondary">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canWrite && (
            <button onClick={openCreate} className="btn-primary">
              <Plus className="h-4 w-4 mr-1.5" />
              Add {config.label}
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card">
        {loading && allItems.length === 0 ? (
          <div className="px-6 py-16 flex justify-center"><Spinner size="lg" /></div>
        ) : totalItems === 0 ? (
          <EmptyState
            title={search ? 'No matching results' : `No ${config.label.toLowerCase()}s yet`}
            description={search ? 'Try adjusting your search terms.' : `Create your first ${config.label.toLowerCase()} entry to get started.`}
            action={!search && canWrite && (
              <button onClick={openCreate} className="btn-primary text-sm">
                <Plus className="h-4 w-4 mr-1.5" />
                Add {config.label}
              </button>
            )}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50">
                    <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide w-12">#</th>
                    {config.fields.map((field) => (
                      <th
                        key={field.key}
                        onClick={() => handleSort(field.key)}
                        className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide cursor-pointer hover:bg-slate-100 select-none"
                      >
                        <div className="flex items-center gap-1">
                          {field.label}
                          {sortBy === field.key ? (
                            sortDir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronUp className="h-3 w-3 opacity-30" />
                          )}
                        </div>
                      </th>
                    ))}
                    <th className="text-center px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="text-right px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide w-20">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageItems.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-6 py-3 text-xs text-slate-400 font-mono">
                        {(page - 1) * PAGE_SIZE + idx + 1}
                      </td>
                      {config.fields.map((field) => (
                        <td key={field.key} className="px-6 py-3 text-sm text-slate-700 max-w-xs truncate">
                          {item[field.key] || '—'}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          item.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {item.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canWrite ? (
                            <>
                              <button
                                onClick={() => openEdit(item)}
                                className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-primary-600"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteTarget(item)}
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

            {/* Pagination */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200">
              <p className="text-xs text-slate-500">
                {totalItems > 0 ? (
                  <>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalItems)} of {totalItems}</>
                ) : (
                  'No entries'
                )}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {pageNumbers.map((pNum, i) =>
                  pNum === '...' ? (
                    <span key={`e${i}`} className="h-8 w-8 flex items-center justify-center text-xs text-slate-400">...</span>
                  ) : (
                    <button
                      key={pNum}
                      onClick={() => setPage(pNum)}
                      className={`h-8 w-8 rounded-md text-xs font-medium ${
                        page === pNum
                          ? 'bg-primary-600 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {pNum}
                    </button>
                  )
                )}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${config.label}` : `New ${config.label}`}
        size="lg"
      >
        <div className="space-y-4">
          {config.fields.map((field) => (
            <div key={field.key}>
              <label className="label">
                {field.label}
                {field.required && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              {field.type === 'select' ? (
                <select
                  value={form[field.key] || ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  className="input max-w-xs"
                >
                  <option value="">Select...</option>
                  {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : (
                <input
                  value={form[field.key] || ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  className="input"
                  placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                />
              )}
            </div>
          ))}
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
              {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={`Delete ${config.label}`}
        message={
          `Delete "${deleteTarget?.[config.fields[0]?.key] || 'this entry'}"? ` +
          'This cannot be undone.'
        }
        confirmText="Delete"
        danger
      />
    </div>
  )
}
