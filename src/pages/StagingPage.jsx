import { useEffect, useState, useCallback } from 'react'
import {
  fetchTempImport, fetchProjects, fetchMasterData, classifyRow, finalizeRow,
  clearTempTrans, deleteTempRow,
} from '../api/endpoints.js'
import {
  Spinner, EmptyState, Modal, ConfirmDialog, SearchInput, Pagination,
  Highlight, matchesNumber,
} from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import toast from 'react-hot-toast'
import { CheckCircle, Loader2, Sparkles, AlertCircle, RefreshCw, Tag, Trash2, X } from 'lucide-react'

// Every dropdown on this page is a live read of one of the company's own
// tables. `master` is the master_type the API takes; `label` is only what the
// form field is called. There is deliberately no fallback list and no default
// id — a company that has not created any heads yet gets an empty dropdown and
// a link to Master Data, not a guess.
const PICKERS = [
  { key: 'project_id',      source: 'projects',    label: 'Project',     hint: 'Which project this transaction belongs to' },
  { key: 'head_id',         master: 'head',        label: 'Head',        hint: 'Your own expense/income category' },
  { key: 'rera_head_id',    master: 'rera_head',   label: 'RERA Head',   hint: 'Category as reported under RERA' },
  { key: 'idw_head_id',     master: 'idw_head',    label: 'IDW Head',    hint: 'Category as reported under IDW' },
  { key: 'beneficiary_id',  master: 'beneficiary', label: 'Beneficiary', hint: 'Who was paid, or who paid you' },
]

// At least one of the three heads has to be set — the same rule the API
// enforces, checked here so the user is told before the request goes out.
const HEAD_KEYS = ['head_id', 'rera_head_id', 'idw_head_id']

const EMPTY_FORM = { project_id: '', head_id: '', rera_head_id: '', idw_head_id: '', beneficiary_id: '' }

export default function StagingPage() {
  const { canWrite } = useAuth()
  const [rows, setRows] = useState([])
  const [columns, setColumns] = useState([])
  // Unfiltered totals from the server — the tab filter must not change what
  // the Clear button says it will remove.
  const [summary, setSummary] = useState(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [filter, setFilter] = useState('pending') // pending | classified | all

  // The row the delete dialog is about, or null.
  const [doomed, setDoomed] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // `search` is what is typed, `query` is what has been sent. Separating them
  // is the debounce: a request per keystroke over a few hundred thousand rows
  // is a sequential scan per keystroke.
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  // The words the server actually matched on, which is what gets marked up in
  // the cells. Its own state rather than a split of `query`, so the highlight
  // always describes the rows on screen instead of the box being typed in.
  const [terms, setTerms] = useState([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  // Rows matching the current tab and search. summary.staged_total is the
  // unfiltered count and is what the Clear button reports — the two are
  // different numbers and mean different things.
  const [total, setTotal] = useState(0)

  useEffect(() => {
    // setPage in the same tick as setQuery, so the two land in one render and
    // the table fetches once. Resetting the page matters: staying on page 7
    // while typing a search that returns two pages shows an empty table and
    // reads as "no matches".
    const t = setTimeout(() => { setQuery(search); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  // Live option lists, keyed by picker key.
  const [options, setOptions] = useState({})
  const [optionsLoading, setOptionsLoading] = useState(true)

  const [target, setTarget] = useState(null) // the row being classified
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Master data and the project list are read once per visit and reused for
  // every row — one request each, not one per dropdown per row.
  useEffect(() => {
    let cancelled = false
    const loadOptions = async () => {
      setOptionsLoading(true)
      const results = await Promise.all(
        PICKERS.map((p) =>
          (p.source === 'projects' ? fetchProjects() : fetchMasterData(p.master))
            .catch(() => [])
        )
      )
      if (cancelled) return
      const next = {}
      PICKERS.forEach((p, i) => {
        // projects has `name`; the master tables agree on `name` too, except
        // bank_master — which this page never reads.
        next[p.key] = (Array.isArray(results[i]) ? results[i] : []).map((o) => ({
          id: o.id,
          label: o.code ? `${o.name} (${o.code})` : o.name,
        }))
      })
      setOptions(next)
      setOptionsLoading(false)
    }
    loadOptions()
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, limit }
      if (filter === 'pending') params.classified = false
      if (filter === 'classified') params.classified = true
      if (query.trim()) params.search = query.trim()
      // The server decides the column set — it is read from the live
      // temp_trans table with names from the fieldmap, so a custom field shows
      // up here the moment it is created, with no change needed on this page.
      const data = await fetchTempImport(params)
      setColumns(data.columns || [])
      setRows(data.rows || [])
      setSummary(data.summary || null)
      setTerms(data.search_terms || [])
      setTotal(data.total ?? 0)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [filter, query, page, limit])

  useEffect(() => { load() }, [load])

  const openClassify = (row) => {
    setTarget(row)
    // Pre-fill from whatever the row already carries, so re-opening the dialog
    // shows the current state instead of a blank form.
    setForm({
      project_id: row.project_id ?? '',
      head_id: row.head_id ?? '',
      rera_head_id: row.rera_head_id ?? '',
      idw_head_id: row.idw_head_id ?? '',
      beneficiary_id: row.beneficiary_id ?? '',
    })
  }

  const handleClassify = async () => {
    if (!HEAD_KEYS.some((k) => form[k])) {
      toast.error('Pick at least one of Head, RERA Head or IDW Head.')
      return
    }
    setSaving(true)
    try {
      // Blank selects are dropped rather than sent as null, so the API only
      // ever receives the fields the user actually chose.
      const payload = {}
      Object.entries(form).forEach(([k, v]) => { if (v !== '' && v !== null) payload[k] = Number(v) })
      await classifyRow(target.id, payload)
      toast.success('Row classified')
      setTarget(null)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleFinalize = async (row) => {
    setBusyId(`f-${row.id}`)
    try {
      await finalizeRow(row.id)
      toast.success('Row posted to the ledger')
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const handleClear = async () => {
    setClearing(true)
    try {
      const res = await clearTempTrans()
      toast.success(
        `Cleared ${res.rows_removed} staged ${res.rows_removed === 1 ? 'row' : 'rows'}` +
        ` from ${res.batches_removed} ${res.batches_removed === 1 ? 'batch' : 'batches'}`
      )
      setClearOpen(false)
      load()
    } catch (err) {
      // 409 when rows are already posted — the message names the count, so it
      // is shown as-is and the dialog stays open.
      toast.error(err.message)
    } finally {
      setClearing(false)
    }
  }

  const handleDeleteRow = async () => {
    setDeleting(true)
    try {
      await deleteTempRow(doomed.id)
      toast.success('Staged row removed')
      setDoomed(null)
      // Deleting the last row of a page leaves you looking at an empty one, so
      // step back before reloading.
      if (rows.length === 1 && page > 1) setPage(page - 1)
      else load()
    } catch (err) {
      // 409 names the transaction holding it — shown as-is, dialog stays open.
      toast.error(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const fmt = (n) => {
    if (n === null || n === undefined) return '—'
    return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  // Same test DPL used to right-align money columns, driven off the type the
  // server reports rather than off the column's name.
  const NUMERIC_TYPES = ['numeric', 'real', 'double precision', 'integer', 'bigint']
  const isNumeric = (c) => NUMERIC_TYPES.includes((c.type || '').toLowerCase())

  // One cell. Numbers get thousands separators and right alignment, the DR/CR
  // marker keeps its colour coding, everything else prints as text — decided by
  // the column's declared type and value, never by a hardcoded column name.
  //
  // Search hits are marked up here rather than at the table, because what a
  // match looks like depends on how the cell is drawn. Text can have the words
  // themselves highlighted. A number cannot: it is printed 1,50,000.00 and
  // stored 150000.00, so the whole figure is marked when it matches. The DR/CR
  // badge already carries a background colour, and a second one inside it just
  // reads as a rendering fault, so it gets a ring instead.
  const renderCell = (row, c) => {
    const val = row[c.name]
    if (val === null || val === undefined || val === '') return '—'
    if (isNumeric(c)) {
      const shown = fmt(val)
      return matchesNumber(val, terms)
        ? <mark className="rounded-sm bg-amber-200 px-0.5 text-inherit">{shown}</mark>
        : shown
    }
    if (val === 'CR' || val === 'DR') {
      const hit = terms.some((t) => String(t).toLowerCase() === val.toLowerCase())
      return (
        <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
          val === 'CR' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
        } ${hit ? 'ring-2 ring-amber-400' : ''}`}>{val}</span>
      )
    }
    return <Highlight text={val} terms={terms} />
  }

  // Whichever data columns this row actually has a value in. Used by the
  // classify preview and the delete dialog, both of which used to name
  // description/txn_date/amount directly — three columns that stopped existing
  // when the fieldmap became the source of truth, so both were rendering blank.
  const populated = (row) =>
    columns.filter((c) => {
      const v = row[c.name]
      return v !== null && v !== undefined && v !== ''
    })

  // A one-line label for a row, for dialogs that have to say which row they
  // mean. Falls back to its position in the file when every column is empty —
  // which is exactly the kind of row someone opens the delete dialog for.
  const rowLabel = (row) => {
    const parts = populated(row).slice(0, 3).map((c) => String(row[c.name]))
    return parts.length ? parts.join(' · ') : `row ${row.row_number} of batch ${row.batch_id}`
  }

  // The names come back joined from the API, so the table shows what was
  // picked without holding a copy of every master list to look ids up against.
  const classificationOf = (row) => [
    row.project_name, row.head_name, row.rera_head_name, row.idw_head_name, row.beneficiary_name,
  ].filter(Boolean)

  const noOptionsAtAll = !optionsLoading &&
    HEAD_KEYS.every((k) => (options[k] || []).length === 0)

  return (
    <div>
      <PageHeader
        title="Imported Rows"
        description="Everything parsed out of your statements, in temp_trans. Tag a row and post it to the ledger."
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} className="btn-secondary btn-sm">
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Refresh
            </button>
            {canWrite && (
              <button
                onClick={() => setClearOpen(true)}
                disabled={!summary?.staged_total}
                title={
                  summary?.posted
                    ? `${summary.posted} staged row(s) are already posted — clearing is blocked`
                    : 'Remove every staged row and its batch'
                }
                className="btn-sm inline-flex items-center rounded-lg border border-red-200 bg-white px-3 py-1.5 font-medium text-red-600 enabled:hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Clear All
                {summary?.staged_total ? ` (${summary.staged_total})` : ''}
              </button>
            )}
          </div>
        }
      />

      {noOptionsAtAll && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong className="font-medium">No heads defined yet.</strong>{' '}
          Rows cannot be classified until this company has at least one Head, RERA Head
          or IDW Head. Add them under Master Data.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          {['pending', 'classified', 'all'].map((f) => (
            <button
              key={f}
              // Page reset in the same click as the filter, for the same reason
              // the search debounce does it: page 7 of "pending" is rarely a
              // page of "classified".
              onClick={() => { setFilter(f); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize ${
                filter === f
                  ? 'bg-primary-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Searched in SQL, not here. The browser only ever holds one page, so
            filtering client-side could never find a match on any other page —
            this looks at every staged row and pages the matches. */}
        <div className="w-full sm:w-80">
          <SearchInput
            value={search}
            onChange={setSearch}
            onClear={() => setSearch('')}
            placeholder="Search every column, every page..."
          />
          {/* Says outright that the whole table was searched, not the page.
              Without it there is no way to tell a search that found nothing
              from one that only looked at the fifty rows in front of you. */}
          {query && !loading && (
            <p className="mt-1 px-1 text-xs text-slate-500">
              {total === 0
                ? `No ${filter === 'all' ? '' : `${filter} `}row matches`
                : `${total.toLocaleString('en-IN')} ${total === 1 ? 'row matches' : 'rows match'}`}
              {' across every page'}
              {terms.length > 1 ? ' · all words must appear' : ''}
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                {/* No `uppercase` here, unlike the fixed headers beside it.
                    These are the user's own display names, and CSS-uppercasing
                    them means every spelling renders identically — renaming a
                    field to "date" still showed "DATE", which read as the edit
                    not saving at all. Shown exactly as typed.

                    `|| c.name` is DPL's guard (data.js:148). Every header comes
                    from the fieldmap; a column with no mapping falls back to its
                    own name rather than rendering an empty cell. */}
                {columns.map((c) => (
                  <th
                    key={c.name}
                    title={c.name}
                    className={`px-6 py-3 text-xs font-medium text-slate-500 tracking-wide whitespace-nowrap ${
                      isNumeric(c) ? 'text-right' : 'text-left'
                    }`}
                  >
                    {c.displayname || c.name}
                  </th>
                ))}
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 tracking-wide">Classification</th>
                <th className="text-center px-6 py-3 text-xs font-medium text-slate-500 tracking-wide">Status</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-slate-500 tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={columns.length + 3} className="px-6 py-12"><Spinner /></td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 3}>
                    <EmptyState
                      icon={<Sparkles className="h-10 w-10" />}
                      title={query ? 'No matching rows' : 'No staged rows'}
                      description={
                        query
                          ? `Nothing in the ${filter} rows matches "${query}".`
                          : 'When you import a statement, rows land here for review.'
                      }
                      action={query
                        ? <button onClick={() => setSearch('')} className="btn-secondary text-sm">Clear search</button>
                        : undefined}
                    />
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const tags = classificationOf(row)
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                      {columns.map((c) => (
                        <td
                          key={c.name}
                          title={typeof row[c.name] === 'string' ? row[c.name] : undefined}
                          className={`px-6 py-3 align-top ${
                            isNumeric(c) ? 'text-right font-mono font-medium whitespace-nowrap' : ''
                          }`}
                        >
                          {/* Wrap, do not truncate. This cell was `max-w-xs truncate`
                              — ellipsis plus nowrap — and a bank narration runs 60-80
                              characters, so every row ended in "..." with the
                              reference number, the part that identifies the payment,
                              hidden. Nothing ever shortened the data; the cell just
                              refused to show it.

                              The width cap sits on this div rather than on the td
                              because under `table-layout: auto` a cell's max-width is
                              only a suggestion — with enough columns to overflow, the
                              browser is free to size to content and would lay the
                              whole narration out on one line, trading an ellipsis for
                              a very long horizontal scroll. A block inside the cell
                              is bound by it.

                              break-words, not plain wrapping: these strings contain
                              unbroken tokens like 22112548410642 with nowhere to
                              break, which would push past the cap on their own. */}
                          {isNumeric(c) ? renderCell(row, c) : (
                            <div className="max-w-md break-words">{renderCell(row, c)}</div>
                          )}
                        </td>
                      ))}
                      <td className="px-6 py-3 align-top">
                        {tags.length === 0 ? (
                          <span className="text-xs text-slate-300">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {/* Marked up too: the search reaches into the
                                joined master names, so a row can be here
                                because of its head or beneficiary and nothing
                                in the data columns will show why. */}
                            {tags.map((t) => (
                              <span key={t} className="inline-flex px-2 py-0.5 rounded bg-slate-100 text-xs text-slate-600">
                                <Highlight text={t} terms={terms} />
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-3 text-center align-top">
                        {row.is_classified ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                            <CheckCircle className="h-3.5 w-3.5" />
                            Classified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                            <AlertCircle className="h-3.5 w-3.5" />
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 align-top">
                        <div className="flex items-center justify-end gap-1">
                          {canWrite && !row.is_classified && (
                            <button
                              onClick={() => openClassify(row)}
                              className="btn btn-sm btn-secondary text-xs"
                            >
                              <Tag className="h-3 w-3 mr-1" />
                              Classify
                            </button>
                          )}
                          {canWrite && row.is_classified && (
                            <button
                              onClick={() => handleFinalize(row)}
                              disabled={busyId === `f-${row.id}`}
                              className="btn btn-sm btn-primary text-xs"
                            >
                              {busyId === `f-${row.id}`
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : 'Post to Ledger'}
                            </button>
                          )}
                          {canWrite && (
                            <button
                              onClick={() => setDoomed(row)}
                              title="Remove this staged row"
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {!canWrite && <span className="text-xs text-slate-300">—</span>}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          limit={limit}
          total={total}
          onPage={setPage}
          onLimit={(n) => { setLimit(n); setPage(1) }}
        />
      </div>

      <Modal
        isOpen={!!target}
        onClose={() => setTarget(null)}
        title="Classify Row"
        size="lg"
      >
        {target && (
          <div className="space-y-4">
            {/* Built from the live column set, like the table behind it. The
                previous version read target.description and target.txn_date by
                name; both columns are gone, so this panel showed
                "(no description)" above a blank line for every row. */}
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              {populated(target).length === 0 ? (
                <p className="text-sm text-slate-400">
                  This row parsed with no values — row {target.row_number} of batch {target.batch_id}.
                </p>
              ) : (
                <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-1 text-sm">
                  {populated(target).map((c) => (
                    <div key={c.name} className="contents">
                      <dt className="text-xs text-slate-500 truncate pt-0.5" title={c.name}>
                        {c.displayname}
                      </dt>
                      <dd className={`text-slate-900 break-words ${isNumeric(c) ? 'font-mono' : ''}`}>
                        {renderCell(target, c)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            {optionsLoading ? (
              <div className="py-8 flex justify-center"><Spinner /></div>
            ) : (
              PICKERS.map((p) => {
                const list = options[p.key] || []
                return (
                  <div key={p.key}>
                    <label className="label">
                      {p.label}
                      {HEAD_KEYS.includes(p.key) && <span className="text-slate-400 font-normal"> — one of these three</span>}
                    </label>
                    <select
                      value={form[p.key]}
                      onChange={(e) => setForm({ ...form, [p.key]: e.target.value })}
                      className="input"
                      disabled={list.length === 0}
                    >
                      <option value="">
                        {list.length === 0 ? `No ${p.label.toLowerCase()} entries yet` : `Select ${p.label.toLowerCase()}...`}
                      </option>
                      {list.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-400">{p.hint}</p>
                  </div>
                )
              })
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setTarget(null)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={handleClassify} disabled={saving || optionsLoading} className="btn-primary text-sm">
                {saving ? 'Saving...' : 'Classify'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={handleClear}
        title="Clear staging table"
        message={
          `Delete all ${summary?.staged_total ?? 0} staged ` +
          `${summary?.staged_total === 1 ? 'row' : 'rows'} and the ` +
          `${summary?.batches ?? 0} ${summary?.batches === 1 ? 'batch' : 'batches'} ` +
          'they came from? Nothing already posted to the ledger is touched — if any ' +
          'staged row has been finalized, this is refused instead. Clearing the batches ' +
          'also releases their file fingerprints, so the same statements can be imported ' +
          'again. This cannot be undone.'
        }
        confirmText={clearing ? 'Clearing...' : 'Clear everything'}
        danger
      />

      <ConfirmDialog
        isOpen={!!doomed}
        onClose={() => setDoomed(null)}
        onConfirm={handleDeleteRow}
        title="Remove this staged row"
        message={
          doomed
            ? `Delete "${rowLabel(doomed)}"? It is removed from staging only — ` +
              'the batch it came from stays, so the rest of that statement is ' +
              'untouched. If this row has already been posted to the ledger, the ' +
              'delete is refused instead. This cannot be undone.'
            : ''
        }
        confirmText={deleting ? 'Removing...' : 'Remove row'}
        danger
      />
    </div>
  )
}
