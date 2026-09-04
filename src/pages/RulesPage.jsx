import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchRuleMatrix, setRuleCell, createMasterEntry } from '../api/endpoints.js'
import { EmptyState, SearchInput, TableBusy, SkeletonRows, Spinner, Modal, Pagination } from '../components/UI.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import ConditionsPanel from '../components/ConditionsPanel.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import toast from 'react-hot-toast'
import { RefreshCw, ShieldCheck, ScrollText, ArrowRight, Plus } from 'lucide-react'

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
// Neither axis is written down here. The rows come from one of the three head
// masters and the columns from the Type of Account master, both read live, so
// adding either on the Master Data page changes this grid with nothing to
// deploy.
//
// There are THREE grids, not one. A staged row carries an Internal Head, a RERA
// Head and a TCP Head, each written by its own dropdown into its own column, and
// each has its own rules. The switch at the top of the page chooses which one is
// being edited; the list of them comes from the server, so this file never names
// a master. One grid at a time because the three masters hold 97, 22 and 17
// heads — a combined table would be 136 rows deep, and two heads with the same
// name in different masters would be two rows nothing on screen could tell
// apart.

// A blank cell is the absence of a rule, so the empty option carries no value
// and clearing sends null. The rest are the server's own list.
const BLANK = ''

// Fixed at 5 rather than user-adjustable: this grid's rows are a fixed list of
// heads, not an open-ended feed, so there is no "load more" case to size for —
// just a long list that needs to stop making the page itself scroll.
const PAGE_SIZE = 5

const CELL_TONES = {
  CR: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  DR: 'border-red-200 bg-red-50 text-red-700',
  [BLANK]: 'border-slate-200 bg-white text-slate-400',
}

export default function RulesPage() {
  // Managers and above may change the rule; everyone may read it. The API
  // enforces the same split — this only spares staff dropdowns that would 403.
  const { canWrite } = useAuth()

  // Which half of the rule is on screen. The grid is the default because it is
  // the one that always has something in it; conditions start empty.
  const [tab, setTab] = useState('grid')
  // Kept here rather than in the panel so the tab can carry the count while the
  // panel is unmounted. Reported by the panel each time it loads.
  const [conditionCount, setConditionCount] = useState(0)

  // Which head master is being edited. Left undefined on the first load so the
  // server picks its own default — the page should not have to know which of
  // the three that is.
  const [target, setTarget] = useState(null)
  // Its own state rather than read off `matrix`, because switching clears the
  // matrix and the switch itself must not vanish while the new grid loads.
  const [targets, setTargets] = useState([])

  const [matrix, setMatrix] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  // Which cell is mid-flight, so a slow save shows and a second click on the
  // same cell cannot race the first.
  const [busyCell, setBusyCell] = useState(null)

  // Fixed at 5 rather than user-adjustable: this grid's rows are a fixed list
  // of heads, not an open-ended feed, so there is no "load more" case to size
  // for — just a long list that needs to stop making the page itself scroll.
  const PAGE_SIZE = 5
  const [page, setPage] = useState(1)

  // The "Add head" dialog. A new head has no data yet, so all it needs is a
  // name — it lands with every cell blank, same as any other unused row.
  const [addOpen, setAddOpen] = useState(false)
  const [newHeadName, setNewHeadName] = useState('')
  const [addBusy, setAddBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await fetchRuleMatrix(target || undefined)
      setMatrix(next)
      if (next.targets?.length) setTargets(next.targets)
      // Adopt whatever the server resolved, so every later call — including the
      // conditions panel's — names the same head type this grid is showing.
      setTarget(next.target?.target || null)
      setError('')
    } catch (err) {
      setError(err.message)
      setMatrix(null)
    } finally {
      setLoading(false)
    }
    // `target` deliberately out of the deps: switching head type goes through
    // handleTarget, which clears the grid first so the old cells cannot be
    // painted against the new head list for a frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  useEffect(() => { load() }, [load])

  // The heads change with the head type, and `cells` is keyed by head id — so
  // the old grid must go before the new one arrives, or a moment of the wrong
  // master's cells is painted against this one's rows. Search goes too: "find a
  // head" typed against 97 Internal Heads means nothing among 22 RERA ones.
  const handleTarget = (next) => {
    if (next === target) return
    setMatrix(null)
    setSearch('')
    setPage(1)
    setTarget(next)
  }

  const heads = matrix?.heads || []
  const types = matrix?.account_types || []
  const cells = matrix?.cells || {}

  // `target` while a switch is in flight, so the pressed button lights up at
  // once instead of after the round trip.
  const current = target || matrix?.target?.target || null
  const targetLabel = targets.find((t) => t.target === current)?.label
    || matrix?.target?.label || 'Head'
  const unusable = targets.filter((t) => !t.used)

  const needle = search.trim().toLowerCase()
  const filtered = useMemo(
    () => (needle
      ? heads.filter((h) => h.name.toLowerCase().includes(needle))
      : heads),
    [heads, needle],
  )

  // A search that no longer matches the page you were on would otherwise show
  // an empty table with results sitting one page back.
  useEffect(() => { setPage(1) }, [needle, current])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const shown = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  )

  // How many heads each column accepts, for the count under its name. Read off
  // the grid in front of the user rather than fetched separately, so the two
  // can never disagree about what is set.
  const perType = useMemo(() => {
    const out = {}
    types.forEach((t) => { out[t] = { cr: 0, dr: 0 } })
    heads.forEach((h) => {
      const row = cells[String(h.id)] || {}
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
    const rowKey = String(head.id)
    const key = `${head.id}:${type}`
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
      await setRuleCell(head.id, type, value === BLANK ? null : value,
                        matrix?.target?.target)
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

  const handleAddHead = async (e) => {
    e.preventDefault()
    const name = newHeadName.trim()
    if (!name) return
    setAddBusy(true)
    try {
      await createMasterEntry(current, { name })
      toast.success(`"${name}" added to ${targetLabel}`)
      setAddOpen(false)
      setNewHeadName('')
      await load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setAddBusy(false)
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
          tab === 'grid' && (
            <div className="flex gap-2">
              {canWrite && (
                <button
                  onClick={() => setAddOpen(true)}
                  disabled={!current}
                  className="btn-secondary btn-sm"
                  title={`Add a new ${targetLabel.toLowerCase()}`}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add {targetLabel}
                </button>
              )}
              <button onClick={load} disabled={loading} className="btn-secondary btn-sm">
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${
                  loading ? 'animate-spin motion-reduce:[animation-duration:2s]' : ''}`} />
                Refresh
              </button>
            </div>
          )
        }
      />

      <Modal
        isOpen={addOpen}
        onClose={() => { setAddOpen(false); setNewHeadName('') }}
        title={`Add a ${targetLabel}`}
      >
        <form onSubmit={handleAddHead}>
          <label className="label">Name</label>
          <input
            autoFocus
            className="input"
            value={newHeadName}
            onChange={(e) => setNewHeadName(e.target.value)}
            placeholder={`e.g. ${targetLabel === 'Internal Head' ? 'Contractor' : 'IDW Civil Works'}`}
          />
          <p className="text-xs text-slate-400 mt-1">
            Added blank — set its CR/DR cells below once it appears in the grid.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setAddOpen(false); setNewHeadName('') }}
              className="btn-secondary text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addBusy || !newHeadName.trim()}
              className="btn-primary text-sm"
            >
              {addBusy && <Spinner size="sm" tone="white" className="mr-2" />}
              Add
            </button>
          </div>
        </form>
      </Modal>

      {/* Which of the three heads these rules are about. Above the tabs, not
          inside one, because it governs both: the grid and the conditions on
          screen are always the same head type, and a switch that moved only one
          of them would be the surest way to write a condition against a grid it
          has nothing to do with.

          The list is the server's. A head type this company has not mapped on
          its Field Mapping page is still shown but disabled — hiding it would
          leave no way to find out why it is missing. */}
      {targets.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Rules for</span>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {targets.map((t) => (
              <button
                key={t.target}
                onClick={() => t.used && handleTarget(t.target)}
                disabled={!t.used}
                title={t.used
                  ? `Rules about the ${t.label} on a staged row`
                  : `This company has no column mapped to ${t.label}, so a rule `
                    + `about it could never be applied. Map one on Field Mapping.`}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  !t.used
                    ? 'cursor-not-allowed text-slate-300'
                    : t.target === current
                      ? 'bg-white text-primary-700 shadow-sm ring-1 ring-slate-200 cursor-pointer'
                      : 'text-slate-600 hover:text-slate-900 cursor-pointer'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {unusable.length > 0 && (
            <Link to="/field-mapping" className="text-xs text-slate-400 hover:text-slate-600 underline">
              {unusable.map((t) => t.label).join(' and ')}{' '}
              {unusable.length === 1 ? 'is' : 'are'} not mapped
            </Link>
          )}
        </div>
      )}

      {/* Two halves of one rule, so two tabs rather than one long page: with 22
          heads the grid is already taller than a screen, and a conditions list
          below it would never be found. */}
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {[
          { key: 'grid', label: 'Grid' },
          {
            key: 'conditions',
            label: `Conditions${conditionCount ? ` (${conditionCount})` : ''}`,
          },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
              tab === t.key
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'conditions' ? (
        <ConditionsPanel
          canWrite={canWrite}
          target={current}
          targetLabel={targetLabel}
          onCountChange={setConditionCount}
        />
      ) : (
      <>
      {/* What a cell means, in one line. Said about the head type on screen and
          about the directions themselves rather than about a named head: the
          grid used to illustrate itself with "Master 2 RERA", which is a row of
          the RERA master and reads as nonsense above the Internal Head one. */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
          <ScrollText className="h-4 w-4 shrink-0 text-slate-400" />
          <span>A</span>
          <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">CR</span>
          <span>cell says this {targetLabel.toLowerCase()} is what money</span>
          <span className="font-medium text-slate-800">arriving in</span>
          <span>that kind of account is recorded as;</span>
          <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">DR</span>
          <span>says the same for money</span>
          <span className="font-medium text-slate-800">leaving</span>
          <ArrowRight className="h-3.5 w-3.5 text-slate-300" />
          <span>a blank cell is no rule at all, so it is never flagged and never offered.</span>
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
            placeholder={`Find a ${targetLabel.toLowerCase()}...`}
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
            title={heads.length === 0
              ? `No ${targetLabel} entries yet`
              : 'No account types yet'}
            description={
              heads.length === 0
                ? `Add entries under Master Data → ${targetLabel}, and they appear here as rows.`
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
                      {targetLabel}
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
                      const row = cells[String(h.id)] || {}
                      const used = Object.keys(row).length
                      return (
                        <tr key={h.id} className="hover:bg-slate-50/70 transition-colors">
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
                            const key = `${h.id}:${t}`
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
            <Pagination
              page={safePage}
              limit={PAGE_SIZE}
              total={filtered.length}
              onPage={setPage}
            />
          </div>
        )}
      </div>

      {!canWrite && (
        <p className="mt-3 text-xs text-slate-400">
          You can read the rule but not change it. Ask a manager to edit it.
        </p>
      )}
      </>
      )}
    </div>
  )
}
