import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchRuleMatrix, setRuleCell } from '../api/endpoints.js'
import { EmptyState, SearchInput, TableBusy, SkeletonRows, Spinner } from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import toast from 'react-hot-toast'
import { RefreshCw, ShieldCheck, ScrollText, ArrowRight } from 'lucide-react'

// The rule, as a grid.
//
// One row per head, one column per account type, and each cell says what that
// head means on that kind of account: money in (CR), money out (DR), or nothing
// at all. "Master 2 RERA" is money leaving the Master account and arriving in
// the RERA account, so it is DR under MASTER and CR under RERA, and blank under
// IDW and FREE.
//
// This grid IS the rule. Check Rules reads it to decide which staged rows are
// wrong and to fill its Replace dropdown, so a head left blank for a type is
// never offered there and never accepted there.
//
// Heads now come from all three masters (head_master, rera_head_master,
// idw_head_master) — one row per head, keyed by its master_kind and id.

// A blank cell is the absence of a rule, so the empty option carries no value
// and clearing sends null. The rest are the server's own list.
const BLANK = ''

const CELL_TONES = {
  CR: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  DR: 'border-red-200 bg-red-50 text-red-700',
  [BLANK]: 'border-slate-200 bg-white text-slate-400',
}

export default function RulesPage() {
  // Managers and above may change the rule; everyone may read it. The API
  // enforces the same split — this only spares staff dropdowns that would 403.
  const { canWrite } = useAuth()

  const [matrix, setMatrix] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  // Which cell is mid-flight, so a slow save shows and a second click on the
  // same cell cannot race the first.
  const [busyCell, setBusyCell] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setMatrix(await fetchRuleMatrix())
      setError('')
    } catch (err) {
      setError(err.message)
      setMatrix(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // heads_by_kind is {head: [...], rera_head: [...], idw_head: [...]}
  const headsByKind = matrix?.heads_by_kind || {}
  // Flatten into a single list, preserving master_kind on each entry.
  const heads = useMemo(
    () => Object.values(headsByKind).flat(),
    [headsByKind],
  )
  const types = matrix?.account_types || []
  // Cells are keyed "master_kind:head_id" -> {account_type: direction, ...}
  const cells = matrix?.cells || {}

  const needle = search.trim().toLowerCase()
  const shown = useMemo(
    () => (needle
      ? heads.filter((h) => h.name.toLowerCase().includes(needle))
      : heads),
    [heads, needle],
  )

  // How many heads each column accepts, for the count under its name. Read off
  // the grid in front of the user rather than fetched separately, so the two
  // can never disagree about what is set.
  const perType = useMemo(() => {
    const out = {}
    types.forEach((t) => { out[t] = { cr: 0, dr: 0 } })
    heads.forEach((h) => {
      const row = cells[`${h.master_kind}:${h.id}`] || {}
      types.forEach((t) => {
        if (row[t] === 'CR') out[t].cr += 1
        if (row[t] === 'DR') out[t].dr += 1
      })
    })
    return out
  }, [heads, types, cells])

  const totalSet = useMemo(
    () => Object.values(cells).reduce((n, row) => n + Object.keys(row).length, 0),
    [cells],
  )

  const handleChange = async (head, type, value) => {
    const rowKey = `${head.master_kind}:${head.id}`
    const key = `${rowKey}:${type}`
    const previous = cells[rowKey]?.[type]
    // Painted immediately, put back if the server refuses. A dropdown that
    // waits for a round trip before showing what was picked reads as broken.
    setMatrix((m) => {
      const next = { ...m, cells: { ...m.cells } }
      const row = { ...(next.cells[rowKey] || {}) }
      if (value === BLANK) delete row[type]
      else row[type] = value
      next.cells[rowKey] = row
      return next
    })
    setBusyCell(key)
    try {
      await setRuleCell(head.id, head.master_kind, type, value === BLANK ? null : value)
    } catch (err) {
      toast.error(err.message)
      setMatrix((m) => {
        const next = { ...m, cells: { ...m.cells } }
        const row = { ...(next.cells[rowKey] || {}) }
        if (previous === undefined) delete row[type]
        else row[type] = previous
        next.cells[rowKey] = row
        return next
      })
    } finally {
      setBusyCell(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Rules"
        description={
          'Which head is a valid answer for which kind of account, and in which ' +
          'direction. Check Rules on Imported Rows reads exactly this: a row is ' +
          'flagged only when its head is not marked for that account type and ' +
          'direction, and the Replace dropdown offers exactly what is marked here.'
        }
        actions={
          <button onClick={load} disabled={loading} className="btn-secondary btn-sm">
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${
              loading ? 'animate-spin motion-reduce:[animation-duration:2s]' : ''}`} />
            Refresh
          </button>
        }
      />

      {/* What the grid means, in one line, with the example that explains the
          whole shape of it. */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
          <ScrollText className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="font-medium text-slate-800">Master 2 RERA</span>
          <ArrowRight className="h-3.5 w-3.5 text-slate-300" />
          <span>money leaves the Master account, so</span>
          <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">DR</span>
          <span>under MASTER, and arrives in the RERA account, so</span>
          <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">CR</span>
          <span>under RERA. Left blank everywhere else, so it is never offered there.</span>
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="w-full sm:w-80">
          <SearchInput
            value={search}
            onChange={setSearch}
            onClear={() => setSearch('')}
            placeholder="Find a head..."
          />
        </div>
        {!loading && matrix && (
          <span className="text-xs text-slate-500">
            {heads.length} {heads.length === 1 ? 'head' : 'heads'} ·{' '}
            {types.length} account {types.length === 1 ? 'type' : 'types'} ·{' '}
            {totalSet} {totalSet === 1 ? 'cell' : 'cells'} set
          </span>
        )}
      </div>

      <div className="card">
        {/* Nothing to draw a grid from. Both causes need a different next step,
            so they are named rather than shown as one empty table. */}
        {!loading && matrix && (heads.length === 0 || types.length === 0) ? (
          <EmptyState
            icon={<ShieldCheck className="h-10 w-10" />}
            title="No heads yet"
            description={
              heads.length === 0
                ? `Add entries under Master Data, and they appear here as rows.`
                : 'Add entries under Master Data → Type of Account, and they appear here as columns.'
            }
            action={
              <Link to="/master-data" className="btn-primary text-sm">Open Master Data</Link>
            }
          />
        ) : (
          <div className="relative">
            {loading && heads.length > 0 && <TableBusy label="Loading the rule..." />}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50">
                    <th className="sticky left-0 z-10 bg-slate-50 px-6 py-3 text-left text-xs font-medium tracking-wide text-slate-500">
                      Head
                    </th>
                    {types.map((t) => (
                      <th key={t} className="px-4 py-3 text-center text-xs font-medium tracking-wide text-slate-500">
                        <div>{t}</div>
                        {/* What this column currently accepts. A column of
                            zeros is a type Check Rules will refuse to run. */}
                        <div className="mt-0.5 font-normal normal-case text-slate-400">
                          {perType[t]?.cr || 0} CR · {perType[t]?.dr || 0} DR
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading && heads.length === 0 ? (
                    <SkeletonRows cols={(types.length || 4) + 1} rows={8} />
                  ) : shown.length === 0 ? (
                    <tr>
                      <td colSpan={types.length + 1}>
                        <EmptyState
                          title="No matching head"
                          description={`Nothing in the head list matches "${search}".`}
                          action={
                            <button onClick={() => setSearch('')} className="btn-secondary text-sm">
                              Clear search
                            </button>
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    shown.map((h) => {
                      const row = cells[`${h.master_kind}:${h.id}`] || {}
                      const used = Object.keys(row).length
                      return (
                        <tr key={`${h.master_kind}:${h.id}`} className="hover:bg-slate-50/70 transition-colors">
                          {/* Sticky, because with several account types the
                              grid scrolls sideways and a cell whose head has
                              scrolled off is a cell you cannot safely set. */}
                          <td
                            className={`sticky left-0 z-10 px-6 py-2.5 ${
                              used ? 'bg-white' : 'bg-white text-slate-400'
                            }`}
                            title={used ? undefined : 'Not used by any rule yet'}
                          >
                            <span className={used ? 'font-medium text-slate-900' : ''}>
                              {h.name}
                            </span>
                          </td>
                          {types.map((t) => {
                            const value = row[t] || BLANK
                            const key = `${h.master_kind}:${h.id}:${t}`
                            return (
                              <td key={t} className="px-2 py-2 text-center">
                                <div className="relative inline-block">
                                  <select
                                    value={value}
                                    disabled={!canWrite || busyCell === key}
                                    onChange={(e) => handleChange(h, t, e.target.value)}
                                    title={
                                      canWrite
                                        ? `${h.name} on a ${t} account`
                                        : 'Only a manager can change the rule'
                                    }
                                    className={`w-24 rounded-lg border px-2 py-1 text-xs font-medium
                                      transition-colors disabled:cursor-not-allowed disabled:opacity-60
                                      ${CELL_TONES[value] || CELL_TONES[BLANK]}`}
                                  >
                                    <option value={BLANK}>—</option>
                                    {(matrix?.directions || ['CR', 'DR']).map((d) => (
                                      <option key={d} value={d}>{d}</option>
                                    ))}
                                  </select>
                                  {busyCell === key && (
                                    <span className="absolute -right-5 top-1/2 -translate-y-1/2">
                                      <Spinner size="sm" />
                                    </span>
                                  )}
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {!canWrite && (
        <p className="mt-3 text-xs text-slate-400">
          You can read the rule but not change it. Ask a manager to edit it.
        </p>
      )}
    </div>
  )
}
