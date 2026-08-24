import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  fetchMasterSchema, fetchMasterData, createMasterEntry, updateMasterEntry, deleteMasterEntry,
  importBeneficiaries, deleteAllBeneficiaries,
} from '../api/endpoints.js'
import { Modal, Spinner, EmptyState, ConfirmDialog, SearchInput } from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, RefreshCw, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Upload, AlertTriangle } from 'lucide-react'

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

  // Rows of every master type some field on this tab draws its options from,
  // keyed by that type. Beneficiary's nine head fields are the only user today.
  const [optionSets, setOptionSets] = useState({})

  // Sheet import. `preview` is the server's dry run: it holds the counts the
  // duplicate choice is made from, so the Import button stays disabled until it
  // has arrived.
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [onDuplicate, setOnDuplicate] = useState('skip')
  // Same account under a different company. Defaults to adding: a payee really
  // can be recorded once per group company, so that is the common case.
  const [onCrossCompany, setOnCrossCompany] = useState('add')
  const [importBusy, setImportBusy] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)

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

  // Load the lists behind this tab's dropdowns. Runs on the tab, not on the
  // modal, so opening the form does not sit there empty while three requests
  // go out — and a head added on another tab is picked up by switching back.
  useEffect(() => {
    if (!config) return
    const types = [...new Set(
      config.fields.map((f) => f.options_from).filter(Boolean)
    )]
    if (types.length === 0) return

    let cancelled = false
    Promise.all(types.map((t) =>
      fetchMasterData(t)
        .then((rows) => [t, Array.isArray(rows) ? rows : []])
        // One failed list must not blank the other two: the field falls back to
        // an empty dropdown and the rest of the form still works.
        .catch(() => [t, []])
    )).then((pairs) => {
      if (!cancelled) setOptionSets(Object.fromEntries(pairs))
    })
    return () => { cancelled = true }
  }, [config])

  // What a given field may be set to, minus anything already chosen in one of
  // its distinct groups — the constraint is enforced server-side and in the
  // database, but a value that cannot be saved should not be offered.
  const optionsFor = useCallback((field) => {
    if (!field.options_from) return null
    const type = schema.find((s) => s.key === field.options_from)
    const labelField = type?.label_field || 'name'
    const all = (optionSets[field.options_from] || [])
      .map((row) => row[labelField])
      .filter(Boolean)

    const group = (config?.distinct_groups || []).find((g) => g.includes(field.key))
    if (!group) return all
    const taken = new Set(
      group.filter((k) => k !== field.key).map((k) => form[k]).filter(Boolean)
    )
    // The field's own current value stays listed, or editing a saved row would
    // show a blank select over a value that is really there.
    return all.filter((name) => !taken.has(name) || name === form[field.key])
  }, [optionSets, schema, config, form])

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

  const openImport = () => {
    setImportFile(null)
    setPreview(null)
    setOnDuplicate('skip')
    setOnCrossCompany('add')
    setImportOpen(true)
  }

  // Picking a file runs the dry run immediately. Nothing is written, and it is
  // the only way to know whether the duplicate question even needs asking.
  const handleImportFile = async (file) => {
    setImportFile(file)
    setPreview(null)
    if (!file) return
    setImportBusy(true)
    try {
      setPreview(await importBeneficiaries(file, false))
    } catch (err) {
      toast.error(err.message)
      setImportFile(null)
    } finally {
      setImportBusy(false)
    }
  }

  const runImport = async () => {
    setImportBusy(true)
    try {
      const result = await importBeneficiaries(
        importFile, true, onDuplicate, onCrossCompany)
      const parts = [`${result.inserted} added`]
      if (result.updated) parts.push(`${result.updated} updated`)
      if (result.skipped) parts.push(`${result.skipped} skipped`)
      if (result.rejected) parts.push(`${result.rejected} rejected`)
      toast.success(parts.join(', '))
      setImportOpen(false)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setImportBusy(false)
    }
  }

  const runClearAll = async () => {
    setClearOpen(false)
    try {
      const r = await deleteAllBeneficiaries()
      const parts = [`${r.deleted} deleted`]
      // Only mentioned when it happened — most companies have no ledger rows
      // booked against a beneficiary, and a zero here is noise.
      if (r.archived) parts.push(`${r.archived} archived (used by the ledger)`)
      if (r.unlinked_staged_rows) parts.push(`${r.unlinked_staged_rows} staged rows unlinked`)
      toast.success(parts.join(', '))
      load()
    } catch (err) {
      toast.error(err.message)
    }
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
          {canWrite && config.importable && (
            <button onClick={openImport} className="btn-secondary">
              <Upload className="h-4 w-4 mr-1.5" />
              Import
            </button>
          )}
          {/* Hidden when the table is already empty — a destructive button that
              would do nothing is only there to be pressed by mistake. */}
          {canWrite && config.importable && totalItems > 0 && (
            <button onClick={() => setClearOpen(true)} className="btn-danger">
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete All
            </button>
          )}
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

      <ConfirmDialog
        isOpen={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={runClearAll}
        danger
        title={`Delete all ${totalItems} ${config?.label?.toLowerCase() ?? ''} records?`}
        message={
          'This removes every row in the table and cannot be undone. Anyone the ' +
          'ledger has already booked against is archived instead of deleted, ' +
          'because removing them would break those transactions. Staged rows ' +
          'keep their data but lose the beneficiary and need it picked again.'
        }
        confirmText="Delete all"
      />

      {/* Sheet import */}
      <Modal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        title={`Import ${config?.label ?? ''}`}
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="label">Excel, CSV or PDF file</label>
            <input
              type="file"
              accept=".xlsx,.csv,.pdf"
              onChange={(e) => handleImportFile(e.target.files?.[0] || null)}
              className="input"
            />
            <p className="text-xs text-slate-500 mt-1">
              Needs a header row. Recognised: Beneficiary Name, Account Number,
              IFSC Code, Bank Name, Company, Head 1–3, and RERA Head 1–3 /
              TCP Head 1–3 when you add them.
            </p>
          </div>

          {importBusy && !preview && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner size="sm" /> Reading the sheet…
            </div>
          )}

          {preview && (
            <>
              <div className="grid grid-cols-5 gap-3 text-center">
                {[
                  ['Rows', preview.total_rows, 'text-slate-700'],
                  ['To add', preview.importable, 'text-emerald-600'],
                  ['Already exist', preview.duplicate_count, 'text-amber-600'],
                  ['Other company', preview.cross_company_count, 'text-sky-600'],
                  ['Rejected', preview.error_count, 'text-red-600'],
                ].map(([label, value, tone]) => (
                  <div key={label} className="card p-3">
                    <div className={`text-xl font-semibold ${tone}`}>{value}</div>
                    <div className="text-xs text-slate-500">{label}</div>
                  </div>
                ))}
              </div>

              {preview.unmapped_headers?.length > 0 && (
                <p className="text-xs text-slate-500">
                  Ignored columns: {preview.unmapped_headers.join(', ')}
                </p>
              )}

              {/* A PDF holds no table, only characters at positions — the rows
                  below were reconstructed, so they are worth a glance before
                  they become payment details. A sheet is read exactly. */}
              {importFile?.name?.toLowerCase().endsWith('.pdf') && (
                <p className="text-xs text-amber-700 flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    Read from a PDF, where the columns had to be worked out from
                    the layout. Check the account numbers and IFSC codes below
                    before importing — export as Excel or CSV if you can.
                  </span>
                </p>
              )}

              {preview.preview?.length > 0 && (
                <div className="card p-0 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        {['Name', 'Account', 'IFSC', 'Bank', 'Company', 'Head 1'].map((h) => (
                          <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview.map((r, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          {['name', 'account_number', 'ifsc_code', 'bank_name',
                            'company', 'head1'].map((k) => (
                            <td key={k} className="px-3 py-1.5 whitespace-nowrap">
                              {r[k] || <span className="text-slate-300">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Only asked when it can change the outcome. */}
              {preview.duplicate_count > 0 && (
                <div className="card p-3 space-y-2">
                  <div className="text-sm font-medium">
                    {preview.duplicate_count} row
                    {preview.duplicate_count === 1 ? '' : 's'} already exist
                    {preview.duplicate_count === 1 ? 's' : ''}, matched on account
                    number. What should happen to them?
                  </div>
                  {['skip', 'overwrite'].map((mode) => (
                    <label key={mode} className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name="on-duplicate"
                        value={mode}
                        checked={onDuplicate === mode}
                        onChange={() => setOnDuplicate(mode)}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium capitalize">{mode}</span>
                        <span className="text-slate-500">
                          {mode === 'skip'
                            ? ' — leave the existing beneficiary exactly as it is.'
                            : ' — replace it with what the sheet says. Anything edited in the app is lost.'}
                        </span>
                      </span>
                    </label>
                  ))}
                  <ul className="text-xs text-slate-500 pl-1">
                    {preview.duplicates.map((d) => (
                      <li key={d.row}>
                        Row {d.row}: {d.name} ({d.account_number || 'no account number'})
                      </li>
                    ))}
                    {preview.duplicates_truncated && <li>…and more</li>}
                  </ul>
                </div>
              )}

              {/* Same account number, different company. A separate question
                  from the duplicate one: these are not the same record, so
                  overwriting is not on the table — only whether they belong. */}
              {preview.cross_company_count > 0 && (
                <div className="card p-3 space-y-2">
                  <div className="text-sm font-medium">
                    {preview.cross_company_count} row
                    {preview.cross_company_count === 1 ? '' : 's'} use an account
                    number you already have under a <em>different</em> company.
                  </div>
                  {[
                    ['add', 'Add them',
                     ' — the same payee recorded for another group company. This is normal.'],
                    ['skip', 'Skip them',
                     ' — leave them out, e.g. if the account was pasted onto the wrong row.'],
                  ].map(([mode, title, note]) => (
                    <label key={mode} className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name="on-cross-company"
                        value={mode}
                        checked={onCrossCompany === mode}
                        onChange={() => setOnCrossCompany(mode)}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium">{title}</span>
                        <span className="text-slate-500">{note}</span>
                      </span>
                    </label>
                  ))}
                  <ul className="text-xs text-slate-500 pl-1">
                    {preview.cross_company.map((d) => (
                      <li key={d.row}>
                        Row {d.row}: {d.name} ({d.account_number}) → {d.company};
                        already held under {d.existing_company}
                      </li>
                    ))}
                    {preview.cross_company_truncated && <li>…and more</li>}
                  </ul>
                </div>
              )}

              {preview.error_count > 0 && (
                <div className="card p-3">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-red-600">
                    <AlertTriangle className="h-4 w-4" />
                    These rows will not be imported
                  </div>
                  <ul className="text-xs text-slate-600 mt-2 space-y-1">
                    {preview.errors.map((e) => (
                      <li key={e.row}>
                        <span className="font-medium">Row {e.row}</span>
                        {e.name ? ` (${e.name})` : ''}: {e.problems.join('; ')}
                      </li>
                    ))}
                    {preview.errors_truncated && <li>…and more</li>}
                  </ul>
                  <p className="text-xs text-slate-500 mt-2">
                    Fix the sheet, or add the missing entry under its own tab,
                    then import again. Importing now brings in the other rows.
                  </p>
                </div>
              )}
            </>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setImportOpen(false)} className="btn-secondary text-sm">
              Cancel
            </button>
            <button
              onClick={runImport}
              disabled={importBusy || !preview ||
                        (preview.importable === 0 &&
                         preview.duplicate_count === 0 &&
                         preview.cross_company_count === 0)}
              className="btn-primary text-sm"
            >
              {importBusy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </Modal>

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
              {field.options_from ? (
                <select
                  value={form[field.key] || ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  className="input"
                >
                  <option value="">Select...</option>
                  {optionsFor(field).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : field.type === 'select' ? (
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
                  // Upper-cased as it is typed, for fields the server says are
                  // upper-case — it normalises the value anyway, so this only
                  // makes that visible instead of surprising on save.
                  onChange={(e) => setForm({
                    ...form,
                    [field.key]: field.upper ? e.target.value.toUpperCase() : e.target.value,
                  })}
                  maxLength={field.maxlength}
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
