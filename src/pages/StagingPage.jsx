import { useEffect, useState, useCallback, useRef } from 'react'
import {
  fetchTempImport, fetchTempImportFilters, fetchProjects, fetchMasterData,
  updateTempRow, clearTempTrans, deleteTempRow, setTempRowLock,
} from '../api/endpoints.js'
import {
  Spinner, EmptyState, Modal, ConfirmDialog, SearchInput, Pagination,
  Highlight, matchesNumber, TableBusy, SkeletonRows,
} from '../components/UI.jsx'
import {
  FilterBar, SortHeader, nextSort, EMPTY_FILTERS, filterParams, activeCount,
} from '../components/TableFilters.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import CheckRulesDialog from '../components/CheckRulesDialog.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import toast from 'react-hot-toast'
import {
  Sparkles, RefreshCw, Pencil, Trash2, X, Highlighter, Lock, Unlock,
  ShieldCheck,
} from 'lucide-react'

// The four dropdowns on the edit dialog. Each is a live read of one of the
// company's own tables — no fallback list and no default id, so a company that
// has not created any heads yet gets an empty dropdown and a reason, not a
// guess.
//
// `mirrors` is the key the server uses for the display column this field
// writes, so the dialog can show what the row currently holds and preselect it.
// Which physical column that is comes from the fieldmap, in `editable` on the
// list response — nothing here is keyed to the words "BUSINESS UNIT".
const PICKERS = [
  { key: 'project_id',   mirrors: 'project',   source: 'projects',  label: 'Business Unit', hint: 'From the Project table' },
  { key: 'head_id',      mirrors: 'head',      master: 'head',      label: 'Head',          hint: 'From the Internal Head table' },
  { key: 'rera_head_id', mirrors: 'rera_head', master: 'rera_head', label: 'Type for RERA IDW', hint: 'From the RERA Head table' },
  { key: 'idw_head_id',  mirrors: 'idw_head',  master: 'idw_head',  label: 'TCP Head',      hint: 'From the TCP Head table' },
]

// Sent when a field's current value is not in its master table. It means "leave
// this exactly as the statement had it" — distinct from '' , which clears the
// field, and from an id, which replaces it. Without it the only way to keep an
// imported value the master does not know about would be to not open the dialog.
const KEEP = '__keep__'

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

  // Sorting and the three filters are done in SQL, like the search — the
  // browser holds one page, so sorting it would only reorder the fifty rows in
  // front of you and leave the other pages alone. `sort` null means the natural
  // order, which here is the order the statement was read in.
  const [sort, setSort] = useState(null)
  const [dir, setDir] = useState('asc')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  // The values the filter dropdowns can offer, read once per visit.
  const [filterOptions, setFilterOptions] = useState(null)

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

  const [target, setTarget] = useState(null) // the row being edited
  const [form, setForm] = useState({})
  // What the form looked like when it opened, so only what actually changed is
  // sent. A PATCH that resends every field would overwrite a value another
  // person edited between this dialog opening and being saved.
  const [initialForm, setInitialForm] = useState({})
  const [saving, setSaving] = useState(false)
  // Which display column each editable field writes, from the company's own
  // fieldmap. The dialog is built from this rather than from names in this file.
  const [editable, setEditable] = useState({})

  // Every row edited since this page was opened, kept yellow.
  //
  // Saving reloads the whole page of rows, and on a table this wide the one
  // cell that changed is usually off-screen — so a successful edit looked
  // exactly like nothing happening.
  //
  // The yellow stays rather than fading. A highlight on a timer is only useful
  // if you happen to be looking when it fires; these are also a record of what
  // has been touched, which is the more useful thing on a table of a thousand
  // rows being worked through a few at a time. Refresh clears them, and so does
  // the button that appears beside it.
  const [editedIds, setEditedIds] = useState(() => new Set())
  // The most recent one, which is the one worth scrolling to.
  const [lastEdited, setLastEdited] = useState(null)
  const flashRow = useRef(null)

  // Rows the last Check Rules run found breaking their account-type rule,
  // kept red for the same reason the amber stays: the dialog can be closed
  // without fixing anything, and the findings should survive that. Replacing
  // a head moves the row from red to amber; the Clear-highlights button and
  // Refresh clear both.
  const [rulesOpen, setRulesOpen] = useState(false)
  const [conflictIds, setConflictIds] = useState(() => new Set())
  // Which id column the last check judged, sent by the dialog. Editing that
  // field on a red row is a fix, and the red has to go — otherwise repairing
  // a row through the pencil looks like nothing happened, because red covers
  // the amber that would otherwise say "edited".
  const [conflictField, setConflictField] = useState(null)
  // The account the last check ran on, and whether the table is narrowed to
  // the rows it flagged. The account rather than the ids: the server re-judges
  // on every request, so the filter cannot outlive its own findings — a row
  // fixed since the check drops out of it by itself, which a captured id list
  // could never do.
  const [checkedAccount, setCheckedAccount] = useState(null)
  const [conflictsOnly, setConflictsOnly] = useState(false)

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
          // The bare name as well as the label: a row imported from a
          // spreadsheet carries the master's NAME in its display column and no
          // id, so the name is what the dialog matches on to preselect.
          name: o.name,
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
      const params = { page, limit, ...filterParams(filters) }
      if (query.trim()) params.search = query.trim()
      if (sort) { params.sort = sort; params.dir = dir }
      if (conflictsOnly && checkedAccount) {
        params.rule_conflicts =
          `${checkedAccount.account_type}:${checkedAccount.account_number}`
      }
      // The server decides the column set — it is read from the live
      // temp_trans table with names from the fieldmap, so a custom field shows
      // up here the moment it is created, with no change needed on this page.
      const data = await fetchTempImport(params)
      setColumns(data.columns || [])
      setRows(data.rows || [])
      setSummary(data.summary || null)
      setEditable(data.editable || {})
      setTerms(data.search_terms || [])
      setTotal(data.total ?? 0)
      // The server reports the sort it actually applied, which is not always
      // the one asked for — a sort naming a field deleted since the page loaded
      // falls back to the natural order. Following it keeps the header arrow
      // honest instead of pointing at a column nothing was ordered by.
      if ((data.sort ?? null) !== sort) { setSort(data.sort ?? null) }
      // Returned as well as stored: the caller that just saved an edit needs to
      // know whether its row came back on this page, and reading `rows` state
      // straight after setting it would still see the previous render's value.
      return data
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [query, page, limit, sort, dir, filters, conflictsOnly, checkedAccount])

  useEffect(() => { load() }, [load])

  // The dropdown contents, separate from the rows. Read across the whole table
  // rather than the current tab, so the accounts on offer are every account in
  // staging and not just the ones already on screen. Reloaded after anything
  // that changes which rows exist.
  const loadFilterOptions = useCallback(async () => {
    try {
      setFilterOptions(await fetchTempImportFilters())
    } catch {
      // A filter bar that cannot load is not worth interrupting the table for;
      // the buttons stay disabled and the rows still list.
      setFilterOptions(null)
    }
  }, [])

  useEffect(() => { loadFilterOptions() }, [loadFilterOptions])

  // Any change to sorting or filtering goes back to page 1. Page 7 of "sorted
  // by date" is not page 7 of anything else, and staying there shows an empty
  // table that reads as "no rows".
  const handleSort = (field) => {
    const n = nextSort(sort, dir, field)
    setSort(n.sort); setDir(n.dir); setPage(1)
  }

  const handleFilters = (next) => { setFilters(next); setPage(1) }

  // Scroll the flashed row back under the eye. Keyed on `rows` as well as the
  // id, because the ref only points at a real node once the reloaded page has
  // rendered — running this the moment the id is set would find nothing.
  //
  // block:'center' rather than the default: this table scrolls sideways too,
  // and 'nearest' leaves a row that is technically visible sitting against the
  // edge of the viewport, which is not the same as being found.
  useEffect(() => {
    if (lastEdited && flashRow.current) {
      flashRow.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [lastEdited, rows])

  const clearHighlights = () => {
    setEditedIds(new Set()); setLastEdited(null); setConflictIds(new Set())
    // The filter goes with the colours. A table left silently narrowed after
    // its highlights were cleared reads as "my rows have gone missing", and
    // the button that would put it back has just disappeared with them.
    setConflictsOnly(false); setCheckedAccount(null)
  }

  // The value a dropdown should start on for this row.
  //
  // The id if the row carries one. Otherwise the master entry whose name equals
  // what is in the display column — rows imported from a spreadsheet arrive with
  // 'Casa Romana' in the text column and no project_id, and matching the two
  // means the dialog opens on the value already on screen instead of blank.
  //
  // KEEP when the column holds something no master entry matches. Those values
  // came out of the statement and are not this dialog's to discard.
  const startingValue = (row, picker) => {
    const id = row[picker.key]
    if (id !== null && id !== undefined && id !== '') return String(id)
    const column = editable[picker.mirrors]?.column
    const current = column ? row[column] : null
    if (!current) return ''
    const hit = (options[picker.key] || []).find(
      (o) => String(o.name).trim().toLowerCase() === String(current).trim().toLowerCase()
    )
    return hit ? String(hit.id) : KEEP
  }

  const openEdit = (row) => {
    const next = {}
    PICKERS.forEach((p) => { next[p.key] = startingValue(row, p) })
    const narrationCol = editable.narration?.column
    next.narration = (narrationCol ? row[narrationCol] : '') || ''
    setTarget(row)
    setForm(next)
    setInitialForm(next)
  }

  const handleSaveEdit = async () => {
    // Only what changed. KEEP never goes out: it means the field was left as
    // the statement had it, and sending anything for it would replace a value
    // this dialog could not offer in the first place.
    const payload = {}
    PICKERS.forEach((p) => {
      const now = form[p.key]
      if (now === initialForm[p.key] || now === KEEP) return
      payload[p.key] = now === '' ? null : Number(now)
    })
    if (form.narration !== initialForm.narration) {
      payload.narration = form.narration
    }

    if (Object.keys(payload).length === 0) {
      setTarget(null)
      return
    }

    setSaving(true)
    const editedId = target.id
    try {
      await updateTempRow(editedId, payload)
      setTarget(null)
      const data = await load()

      // Sorting by a column that was just edited can move the row to another
      // page. Saying so is the difference between "my edit did not save" and
      // "my edit moved the row", which look identical otherwise.
      setEditedIds((prev) => new Set(prev).add(editedId))

      // The rule's own field was just set by hand, so whatever the last check
      // said about this row is now out of date. Amber takes over from red:
      // the row is no longer reported wrong, and it is on the edited list.
      // Only when that field was actually touched — an edit to the narration
      // does not answer a head the rule objected to.
      if (conflictField && conflictField in payload) {
        setConflictIds((prev) => {
          if (!prev.has(editedId)) return prev
          const next = new Set(prev)
          next.delete(editedId)
          return next
        })
      }

      const stillHere = (data?.rows || []).some((r) => r.id === editedId)
      if (stillHere) {
        toast.success('Row updated')
        setLastEdited(editedId)
      } else {
        // Nothing to scroll to and nothing to light up, which on its own looks
        // exactly like the save having failed. It stays in the set, so it is
        // still yellow wherever it went.
        setLastEdited(null)
        toast.success('Row updated - it has moved off this page under the current sort or filters.')
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
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
      // Every account number and company that was on offer just went with it.
      loadFilterOptions()
    } catch (err) {
      // 409 when rows are already posted — the message names the count, so it
      // is shown as-is and the dialog stays open.
      toast.error(err.message)
    } finally {
      setClearing(false)
    }
  }

  // Which row's padlock is mid-flight, so a slow network cannot register two
  // toggles from one impatient double-click.
  const [lockBusy, setLockBusy] = useState(null)

  const handleToggleLock = async (row) => {
    setLockBusy(row.id)
    try {
      const res = await setTempRowLock(row.id, !row.is_locked)
      // Patch the one row in place rather than reloading the page of rows: the
      // padlock answering instantly IS the feedback, and a full reload scrolls
      // and repaints a wide table to change one boolean.
      setRows((prev) => prev.map(
        (r) => (r.id === row.id ? { ...r, is_locked: res.is_locked } : r)
      ))
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLockBusy(null)
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
      // The counts beside each dropdown value just changed, and removing the
      // last row of an account takes that account off the list entirely.
      loadFilterOptions()
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

  // Every dropdown empty means Master Data has nothing to pick from yet, which
  // is worth saying once rather than four times inside the dialog.
  const noOptionsAtAll = !optionsLoading &&
    PICKERS.every((p) => (options[p.key] || []).length === 0)

  return (
    <div>
      <PageHeader
        title="Imported Rows"
        description="Everything parsed out of your statements, in temp_trans. Edit a row to set its Business Unit, Head, RERA and TCP categories, or its narration."
        actions={
          <div className="flex items-center gap-2">
            {/* Only once a check has run, because only then is there anything
                to narrow to. Red highlights show WHICH rows are wrong; this
                shows only those rows, so they can be read with every column,
                sorted and searched, instead of hunted for page by page. */}
            {checkedAccount && (
              <button
                onClick={() => { setConflictsOnly((v) => !v); setPage(1) }}
                title={conflictsOnly
                  ? 'Show every staged row again'
                  : `Show only the rows the last check flagged on ${checkedAccount.label}`}
                className={`btn-sm inline-flex items-center rounded-lg border px-3 py-1.5 font-medium ${
                  conflictsOnly
                    ? 'border-red-300 bg-red-100 text-red-800 hover:bg-red-200'
                    : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                {conflictsOnly ? 'Showing flagged only' : 'Show flagged only'}
              </button>
            )}
            {/* Only while something is lit. The yellow does not time out, so
                there has to be a way to put it back that is not "reload the
                page and hope". Counts the red rule conflicts too — one button
                clears every colour this page paints. */}
            {(editedIds.size > 0 || conflictIds.size > 0) && (
              <button
                onClick={clearHighlights}
                title="Stop highlighting the edited and rule-conflict rows"
                className="btn-sm inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 font-medium text-amber-700 hover:bg-amber-100"
              >
                <Highlighter className="h-3.5 w-3.5 mr-1" />
                Clear {editedIds.size + conflictIds.size} highlight
                {editedIds.size + conflictIds.size === 1 ? '' : 's'}
              </button>
            )}
            {/* The icon turns while the reload is in flight, as it already
                does on the Ledger and Master Data — this was the one Refresh
                in the app that gave no sign it had been pressed. */}
            <button
              onClick={() => { load(); loadFilterOptions(); clearHighlights() }}
              disabled={loading}
              className="btn-secondary btn-sm"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin motion-reduce:[animation-duration:2s]' : ''}`} />
              {loading ? 'Refreshing' : 'Refresh'}
            </button>
            {/* Read-only until the dialog's own Replace button, so it is not
                gated on canWrite — checking is looking, and anyone who can see
                the rows may look. */}
            <button
              onClick={() => setRulesOpen(true)}
              disabled={!summary?.staged_total}
              title="Check one account's rows against its account-type rule"
              className="btn-secondary btn-sm"
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              Check Rules
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
          or TCP Head. Add them under Master Data.
        </div>
      )}

      {/* No Pending / Classified tabs. They filtered on is_classified, which
          only the Classify button ever set — with that gone the Classified tab
          could only ever show an empty table. */}
      <div className="flex flex-wrap items-center justify-end gap-3 mb-4">
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
                ? 'No row matches'
                : `${total.toLocaleString('en-IN')} ${total === 1 ? 'row matches' : 'rows match'}`}
              {' across every page'}
              {terms.length > 1 ? ' · all words must appear' : ''}
            </p>
          )}
        </div>
      </div>

      {/* Filtered in SQL like the search, and for the same reason. The date
          range, the account number and the company are the three things a
          statement is looked up by, so they are buttons rather than something
          to be typed into the search box and hoped for. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterBar
          options={filterOptions}
          value={filters}
          onChange={handleFilters}
          loading={!filterOptions}
        />
        {activeCount(filters) > 0 && !loading && (
          <span className="text-xs text-slate-500">
            {total.toLocaleString('en-IN')} of{' '}
            {(summary?.staged_total ?? 0).toLocaleString('en-IN')} staged{' '}
            {summary?.staged_total === 1 ? 'row' : 'rows'}
          </span>
        )}
      </div>

      {/* Said out loud, because a reduced row count with no explanation is the
          one thing on this screen that looks like data loss. Every other
          filter announces itself in the bar above; this one is a button in the
          header, which is easy to walk away from and forget. */}
      {conflictsOnly && checkedAccount && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          <span>
            Showing only the{' '}
            <span className="font-medium">{total.toLocaleString('en-IN')}</span>{' '}
            {total === 1 ? 'row' : 'rows'} the last check flagged on{' '}
            <span className="font-medium">{checkedAccount.label}</span>. Fixing a
            row removes it from this list.
          </span>
          <button
            onClick={() => { setConflictsOnly(false); setPage(1) }}
            className="btn-sm shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1 font-medium text-red-700 hover:bg-red-100"
          >
            Show all rows
          </button>
        </div>
      )}

      <div className="card">
        {/* relative on this wrapper rather than on the scroll container: the
            scroller's box is as wide as the widest row, so an overlay inside
            it would centre its spinner somewhere off to the right. And not on
            the card either — that would cover the pager, which has to stay
            clickable so a slow page can be stepped away from. */}
        <div className="relative">
          {loading && rows.length > 0 && <TableBusy />}
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
                  <SortHeader
                    key={c.name}
                    field={c.name}
                    label={c.displayname || c.name}
                    title={c.name}
                    align={isNumeric(c) ? 'right' : 'left'}
                    sort={sort}
                    dir={dir}
                    onSort={handleSort}
                  />
                ))}
                {/* No Classification column. Every classification now writes
                    its name into the column that mirrors it — Project into
                    BUSINESS UNIT, and the three heads into HEAD, TYPE FOR RERA
                    IDW and TCP Head — so a separate tag list repeated what the
                    data columns already say. */}
                <th className="text-right px-6 py-3 text-xs font-medium text-slate-500 tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {/* Only for the very first load, when there is nothing to keep
                  on screen. Every reload after that keeps its rows and dims
                  them — the table used to empty itself on every page turn,
                  sort and keystroke, which collapsed the layout and snapped it
                  back each time. */}
              {loading && rows.length === 0 ? (
                // The column set arrives with the rows, so on the very first
                // load there is nothing to count yet — six is a table-shaped
                // guess for that one render.
                <SkeletonRows cols={columns.length ? columns.length + 1 : 6} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 1}>
                    {/* An empty table has three different causes and they need
                        three different next steps — nothing imported, a search
                        that matched nothing, or a filter left on from earlier.
                        The last one is the one people misread as lost data. */}
                    <EmptyState
                      icon={<Sparkles className="h-10 w-10" />}
                      title={
                        query || activeCount(filters) ? 'No matching rows' : 'No staged rows'
                      }
                      description={
                        query && activeCount(filters)
                          ? `Nothing matches "${query}" within the filters you have set.`
                          : query
                            ? `Nothing matches "${query}".`
                            : activeCount(filters)
                              ? `${summary?.staged_total ?? 0} rows are staged, but none of them match the filters you have set.`
                              : 'When you import a statement, rows land here for review.'
                      }
                      action={
                        query || activeCount(filters) ? (
                          <div className="flex items-center justify-center gap-2">
                            {query && (
                              <button onClick={() => setSearch('')} className="btn-secondary text-sm">
                                Clear search
                              </button>
                            )}
                            {activeCount(filters) > 0 && (
                              <button
                                onClick={() => handleFilters({ ...EMPTY_FILTERS })}
                                className="btn-secondary text-sm"
                              >
                                Clear filters
                              </button>
                            )}
                          </div>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                    // hover: is left out while a row is lit, or pointing at it
                    // would grey out the very highlight that marks it as edited.
                    <tr
                      key={row.id}
                      ref={row.id === lastEdited ? flashRow : undefined}
                      title={
                        conflictIds.has(row.id)
                          ? 'Breaks its account-type rule — open Check Rules to fix or unlock it'
                          : editedIds.has(row.id)
                            ? 'Edited since this page was opened'
                            : undefined
                      }
                      className={`transition-colors duration-700 ${
                        // Red beats amber: a row can be both edited and still
                        // wrong, and wrong is the one worth seeing.
                        conflictIds.has(row.id)
                          ? 'bg-red-50 ring-1 ring-inset ring-red-300'
                          : editedIds.has(row.id)
                            ? 'bg-amber-100 ring-1 ring-inset ring-amber-300'
                            : 'hover:bg-slate-50/70'
                      }`}
                    >
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
                      {/* Lock, edit, delete. The padlock leads because it
                          decides whether the other two work: a locked row's
                          edit and delete are disabled with the reason in their
                          tooltip, and the server refuses them anyway — the
                          disabled state is a courtesy, the 409 is the rule. */}
                      <td className="px-6 py-3 align-top">
                        <div className="flex items-center justify-end gap-1">
                          {canWrite ? (
                            <>
                              {/* Solid blue when locked, a white button when
                                  unlocked — a filled control reads as "this
                                  state is ON" in a way a tinted icon did not. */}
                              <button
                                onClick={() => handleToggleLock(row)}
                                disabled={lockBusy === row.id}
                                title={row.is_locked
                                  ? 'Locked — click to unlock and allow editing'
                                  : 'Unlocked — click to lock this row against edits'}
                                className={`p-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
                                  row.is_locked
                                    ? 'border-primary-600 bg-primary-600 text-white hover:bg-primary-700'
                                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                                }`}
                              >
                                {/* The padlock is its own feedback — it is
                                    the control and the state at once — so
                                    while the toggle is in flight it becomes a
                                    spinner rather than sitting in the state it
                                    is about to leave. */}
                                {lockBusy === row.id
                                  ? <Spinner size="sm" tone={row.is_locked ? 'white' : 'slate'} className="h-3.5 w-3.5" />
                                  : row.is_locked
                                    ? <Lock className="h-3.5 w-3.5" />
                                    : <Unlock className="h-3.5 w-3.5" />}
                              </button>
                              <button
                                onClick={() => openEdit(row)}
                                disabled={row.is_locked}
                                title={row.is_locked
                                  ? 'This row is locked — unlock it to edit'
                                  : 'Edit this row'}
                                className="p-1.5 rounded-lg text-slate-400 hover:bg-primary-50 hover:text-primary-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setDoomed(row)}
                                disabled={row.is_locked}
                                title={row.is_locked
                                  ? 'This row is locked — unlock it to delete'
                                  : 'Remove this staged row'}
                                className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400"
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
        title="Edit Row"
        size="lg"
      >
        {target && (
          <div className="space-y-4">
            {/* The row as it stands, built from the live column set. Read-only:
                everything below the divider is the statement as the bank sent
                it, and this dialog does not rewrite that. */}
            <div className="rounded-lg bg-slate-50 px-4 py-3 max-h-52 overflow-y-auto">
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
                // What the row holds in this field's display column right now.
                // Its own column per company, named by the fieldmap.
                const column = editable[p.mirrors]?.column
                const current = column ? target[column] : null
                const heading = editable[p.mirrors]?.label || p.label
                const unmatched = form[p.key] === KEEP
                return (
                  <div key={p.key}>
                    <label className="label">{heading}</label>
                    <select
                      value={form[p.key] ?? ''}
                      onChange={(e) => setForm({ ...form, [p.key]: e.target.value })}
                      className="input"
                      disabled={list.length === 0 && !unmatched}
                    >
                      {/* Offered only when the imported value is not in the
                          master table. Picking anything else replaces it; this
                          is how you say "leave what the statement had". */}
                      {unmatched && (
                        <option value={KEEP}>Keep "{current}" — not in {heading}</option>
                      )}
                      <option value="">
                        {list.length === 0
                          ? `No ${heading} entries yet — add them under Master Data`
                          : '— none —'}
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

            {editable.narration ? (
              <div>
                <label className="label">{editable.narration.label}</label>
                <textarea
                  value={form.narration ?? ''}
                  onChange={(e) => setForm({ ...form, narration: e.target.value })}
                  rows={3}
                  className="input resize-y"
                  placeholder="Typed by hand — this one has no master table behind it."
                />
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                This company has no narration column, so there is nothing to type here.
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setTarget(null)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={handleSaveEdit} disabled={saving || optionsLoading} className="btn-primary text-sm">
                {saving && <Spinner size="sm" tone="white" className="mr-2" />}
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <CheckRulesDialog
        isOpen={rulesOpen}
        onClose={() => setRulesOpen(false)}
        canWrite={canWrite}
        onChecked={(ids, field, account) => {
          setConflictIds(ids); setConflictField(field); setCheckedAccount(account)
        }}
        onApplied={async (ids) => {
          // Fixed rows go from red to amber — no longer wrong, but changed,
          // and the amber is the record of what this session touched.
          setConflictIds((prev) => {
            const next = new Set(prev)
            ids.forEach((id) => next.delete(id))
            return next
          })
          setEditedIds((prev) => {
            const next = new Set(prev)
            ids.forEach((id) => next.add(id))
            return next
          })
          await load()
        }}
      />

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
        busy={clearing}
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
        busy={deleting}
        danger
      />
    </div>
  )
}
