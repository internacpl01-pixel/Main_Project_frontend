import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  fetchConditions, createCondition, updateCondition, deleteCondition,
  reorderConditions,
} from '../api/endpoints.js'
import { EmptyState, ConfirmDialog, Spinner, SkeletonRows } from './UI.jsx'
import ConditionBuilder from './ConditionBuilder.jsx'
import {
  Plus, Pencil, Trash2, ChevronUp, ChevronDown, AlertTriangle, Filter,
} from 'lucide-react'

// The conditions half of the Rules page.
//
// One sentence per row, grouped by the account type and direction it applies
// to — because that grouping is the only one in which two conditions ever
// compete, and competing is what the order is for. Within a group the first
// that matches a row decides it, so the arrows that reorder them are not
// decoration: they are the tie-break.
//
// The sentence itself is written by the server (rules.describe) and rendered
// here as text. It is deliberately not assembled in the browser — a sentence
// built twice is a sentence that can disagree with the rule that runs.

export default function ConditionsPanel({ canWrite, onCountChange }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [builderOpen, setBuilderOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await fetchConditions()
      setData(d)
      setError('')
      onCountChange?.(d.conditions.length)
    } catch (err) {
      setError(err.message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [onCountChange])

  useEffect(() => { load() }, [load])

  const conditions = data?.conditions || []

  // Grouped in the order the server sent them, which is already
  // account_type, direction, sort_order — so the arrows move a row against the
  // same sequence the check walks.
  const groups = useMemo(() => {
    const out = []
    conditions.forEach((c) => {
      const key = `${c.account_type}:${c.direction}`
      let g = out.find((x) => x.key === key)
      if (!g) {
        g = { key, account_type: c.account_type, direction: c.direction, rows: [] }
        out.push(g)
      }
      g.rows.push(c)
    })
    return out
  }, [conditions])

  const handleSave = async (payload) => {
    setSaving(true)
    try {
      if (editing) await updateCondition(editing.id, payload)
      else await createCondition(payload)
      setBuilderOpen(false)
      setEditing(null)
      await load()
      toast.success(editing ? 'Condition saved.' : 'Condition added.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    const c = deleting
    setBusyId(c.id)
    try {
      await deleteCondition(c.id)
      setDeleting(null)
      await load()
      toast.success('Condition deleted.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  // Switching one off is an edit of that condition, so it goes through the same
  // endpoint the builder does — one way to change a condition, not two.
  const toggleActive = async (c) => {
    setBusyId(c.id)
    try {
      await updateCondition(c.id, {
        account_type: c.account_type,
        direction: c.direction,
        subject_field: c.subject_field,
        operator: c.operator,
        value1: c.value1,
        value2: c.value2,
        head_ids: (c.heads || []).map((h) => h.id),
        is_active: !c.is_active,
      })
      await load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const move = async (group, index, delta) => {
    const next = [...group.rows]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setBusyId(group.rows[index].id)
    try {
      await reorderConditions(
        group.account_type, group.direction, next.map((c) => c.id))
      await load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-600">
          A condition is a smaller, louder statement than the grid: when a row
          matches it, its heads are the only answer. Rows no condition describes
          fall back to the grid. Where two conditions could both match, the
          higher one decides.
        </p>
        {canWrite && (
          <button
            onClick={() => { setEditing(null); setBuilderOpen(true) }}
            disabled={loading || !data}
            className="btn-primary btn-sm"
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> New condition
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card">
        {loading && !data ? (
          <table className="w-full text-sm">
            <tbody><SkeletonRows cols={2} rows={4} /></tbody>
          </table>
        ) : conditions.length === 0 ? (
          <EmptyState
            icon={<Filter className="h-10 w-10" />}
            title="No conditions yet"
            description={
              'The grid alone says what a credit or a debit may be. A condition ' +
              'narrows that for the rows you can describe — "a debit whose ' +
              'narration mentions REFUND is a cancellation" — or admits a head ' +
              'the grid leaves blank, but only when the test passes.'
            }
            action={canWrite && (
              <button
                onClick={() => { setEditing(null); setBuilderOpen(true) }}
                className="btn-primary text-sm"
              >
                Write the first one
              </button>
            )}
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {groups.map((g) => (
              <div key={g.key} className="px-5 py-4">
                <p className="mb-2 text-xs font-medium tracking-wide text-slate-500">
                  {g.account_type} · {g.direction === 'CR' ? 'credits' : 'debits'}
                  {g.rows.length > 1 && (
                    <span className="ml-2 font-normal text-slate-400">
                      first match wins
                    </span>
                  )}
                </p>
                <ol className="space-y-2">
                  {g.rows.map((c, i) => (
                    <li
                      key={c.id}
                      className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                        c.problem
                          ? 'border-red-200 bg-red-50'
                          : c.is_active
                            ? 'border-slate-200 bg-white'
                            : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      {/* Position, and the arrows that change it. Hidden when a
                          group has one row: there is nothing to order. */}
                      <div className="flex flex-col items-center pt-0.5">
                        <span className="text-xs text-slate-400">{i + 1}</span>
                        {canWrite && g.rows.length > 1 && (
                          <div className="mt-1 flex flex-col">
                            <button
                              onClick={() => move(g, i, -1)}
                              disabled={i === 0 || busyId === c.id}
                              title="Decide earlier"
                              className="text-slate-300 hover:text-slate-600 disabled:opacity-30 cursor-pointer"
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => move(g, i, 1)}
                              disabled={i === g.rows.length - 1 || busyId === c.id}
                              title="Decide later"
                              className="text-slate-300 hover:text-slate-600 disabled:opacity-30 cursor-pointer"
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className={`${
                          c.is_active ? 'text-slate-800' : 'text-slate-400 line-through'
                        }`}>
                          {c.sentence}
                        </p>
                        {c.problem && (
                          <p className="mt-1 flex items-start gap-1.5 text-xs text-red-700">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {c.problem} Check Rules refuses to run for{' '}
                            {c.account_type} accounts until this is fixed.
                          </p>
                        )}
                      </div>

                      {busyId === c.id && <Spinner size="sm" />}

                      {canWrite && (
                        <div className="flex items-center gap-1">
                          <label
                            className="mr-1 flex cursor-pointer items-center gap-1 text-xs text-slate-500"
                            title={c.is_active
                              ? 'Switch off — kept, but not used by the next check'
                              : 'Switch back on'}
                          >
                            <input
                              type="checkbox"
                              checked={c.is_active}
                              disabled={busyId === c.id}
                              onChange={() => toggleActive(c)}
                            />
                            on
                          </label>
                          <button
                            onClick={() => { setEditing(c); setBuilderOpen(true) }}
                            title="Edit this condition"
                            className="p-1 text-slate-400 hover:text-primary-600 cursor-pointer"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleting(c)}
                            title="Delete this condition"
                            className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </div>

      {!canWrite && conditions.length > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          You can read the conditions but not change them. Ask a manager to edit them.
        </p>
      )}

      <ConditionBuilder
        isOpen={builderOpen}
        onClose={() => { setBuilderOpen(false); setEditing(null) }}
        onSave={handleSave}
        options={data}
        editing={editing}
        saving={saving}
      />

      <ConfirmDialog
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        busy={busyId === deleting?.id}
        danger
        title="Delete this condition?"
        message={deleting
          ? `"${deleting.sentence}" — the rows it decides will go back to being ` +
            'judged by the grid. Switch it off instead if you may want it later.'
          : ''}
        confirmText="Delete"
      />
    </div>
  )
}
