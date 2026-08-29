import { useEffect, useState, useCallback } from 'react'
import { fetchFieldChangeLog, fetchFieldMap } from '../api/endpoints.js'
import {
  EmptyState, Pagination, SearchInput, TableBusy, SkeletonRows,
} from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import toast from 'react-hot-toast'
import { History, ArrowRight } from 'lucide-react'

// The three actions the API records. `all` is the absence of a filter, not a
// value the server knows.
const ACTIONS = ['all', 'created', 'updated', 'deleted']

const ACTION_STYLE = {
  created: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  updated: 'bg-amber-50 text-amber-700 border-amber-100',
  deleted: 'bg-red-50 text-red-700 border-red-100',
}

// Column names as stored, rendered as the label the user sees elsewhere in the
// app. Only the fieldmap's own columns appear here — this is the log's own
// vocabulary, not user data, so it is not read from the fieldmap.
const CHANGED_LABEL = {
  fieldname: 'Column name',
  displayname: 'Display name',
  mapfields: 'Aliases',
  data_type: 'Type',
  method: 'Method',
  is_active: 'Active',
}

function when(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// An empty string and an unset value are different things and the log stores
// them differently, so they are drawn differently too — "narrowed the aliases
// to nothing" and "there were no aliases" are not the same event.
function Value({ text, tone }) {
  if (text === null || text === undefined) {
    return <span className="text-slate-300 italic">unset</span>
  }
  if (text === '') {
    return <span className="text-slate-400 italic">empty</span>
  }
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-xs break-all ${tone}`}>
      {text}
    </span>
  )
}

export default function ChangeLogPage() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const [action, setAction] = useState('all')
  const [field, setField] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)

  // Populates the field filter's suggestion list. Free text underneath, because
  // a field that has since been deleted still has history and is no longer in
  // this list.
  const [knownFields, setKnownFields] = useState([])

  useEffect(() => {
    fetchFieldMap()
      .then((list) => setKnownFields(list.map((f) => f.fieldname)))
      .catch(() => setKnownFields([]))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => { setQuery(field); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [field])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, limit }
      if (action !== 'all') params.action = action
      if (query.trim()) params.fieldname = query.trim()
      const data = await fetchFieldChangeLog(params)
      setRows(data.rows || [])
      setTotal(data.total ?? 0)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [action, query, page, limit])

  useEffect(() => { load() }, [load])

  const filtered = action !== 'all' || query.trim()

  return (
    <div>
      <PageHeader
        title="Change Log"
        description="Every edit to the field mappings — what changed, from what to what, and who did it."
      />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          {ACTIONS.map((a) => (
            <button
              key={a}
              onClick={() => { setAction(a); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize ${
                action === a
                  ? 'bg-primary-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {a}
            </button>
          ))}
        </div>

        <div className="w-full sm:w-80">
          <SearchInput
            value={field}
            onChange={setField}
            onClear={() => setField('')}
            placeholder="Filter by column name..."
            list="changelog-fields"
          />
          {/* Exact-match on the server, so the suggestions matter more here than
              on a free-text search box. */}
          <datalist id="changelog-fields">
            {knownFields.map((f) => <option key={f} value={f} />)}
          </datalist>
        </div>
      </div>

      <div className="card">
        {/* Overlay on the wrapper, not on the scroller (as wide as its widest
            row) and not on the card (which holds the pager). */}
        <div className="relative">
        {loading && rows.length > 0 && <TableBusy />}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 tracking-wide whitespace-nowrap">When</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 tracking-wide">Field</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 tracking-wide">Action</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 tracking-wide">Changed</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 tracking-wide">From → To</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 tracking-wide">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && rows.length === 0 ? (
                <SkeletonRows cols={6} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={<History className="h-10 w-10" />}
                      title={filtered ? 'No matching entries' : 'No changes recorded yet'}
                      description={
                        filtered
                          ? 'Nothing in the log matches these filters.'
                          : 'Edits made from Field Mapping and Custom Fields are recorded here from now on. Changes made before this page existed were not logged.'
                      }
                      action={filtered
                        ? <button onClick={() => { setAction('all'); setField('') }} className="btn-secondary text-sm">Clear filters</button>
                        : undefined}
                    />
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70 transition-colors align-top">
                    <td className="px-6 py-3 whitespace-nowrap text-xs text-slate-500">{when(r.changed_at)}</td>
                    <td className="px-6 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">{r.fieldname}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${
                        ACTION_STYLE[r.action] || 'bg-slate-50 text-slate-600 border-slate-200'
                      }`}>
                        {r.action}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {CHANGED_LABEL[r.field_changed] || r.field_changed || '—'}
                    </td>
                    <td className="px-6 py-3 max-w-md">
                      <div className="flex items-start gap-2 flex-wrap">
                        <Value text={r.old_value} tone="bg-red-50 text-red-700" />
                        <ArrowRight className="h-3.5 w-3.5 text-slate-300 mt-1 shrink-0" />
                        <Value text={r.new_value} tone="bg-emerald-50 text-emerald-700" />
                      </div>
                    </td>
                    <td className="px-6 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {r.changed_by || <span className="text-slate-300">—</span>}
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
    </div>
  )
}
