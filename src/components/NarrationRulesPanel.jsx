import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  fetchNarrationRules, createNarrationRule, updateNarrationRule,
  deleteNarrationRule, reorderNarrationRules,
} from '../api/endpoints.js'
import { EmptyState, ConfirmDialog, Spinner, SkeletonRows } from './UI.jsx'
import NarrationRuleBuilder from './NarrationRuleBuilder.jsx'
import {
  Plus, Pencil, Trash2, ChevronUp, ChevronDown, AlertTriangle, Sparkles,
} from 'lucide-react'

// The narration rules half of the Rules page — same shape as ConditionsPanel,
// grouped by account type and direction (the only grouping in which two of
// these compete), first match wins. No head type here: a narration rule never
// writes a head column, so unlike ConditionsPanel this takes no `target`.

export default function NarrationRulesPanel({ canWrite, onCountChange }) {
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
      const d = await fetchNarrationRules()
      setData(d)
      setError('')
      onCountChange?.(d.rules.length)
    } catch (err) {
      setError(err.message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [onCountChange])

  useEffect(() => { load() }, [load])

  const narrationRules = data?.rules || []

  const groups = useMemo(() => {
    const out = []
    narrationRules.forEach((c) => {
      const key = `${c.account_type}:${c.direction}`
      let g = out.find((x) => x.key === key)
      if (!g) {
        g = { key, account_type: c.account_type, direction: c.direction, rows: [] }
        out.push(g)
      }
      g.rows.push(c)
    })
    return out
  }, [narrationRules])

  const handleSave = async (payload) => {
    setSaving(true)
    try {
      if (editing) await updateNarrationRule(editing.id, payload)
      else await createNarrationRule(payload)
      setBuilderOpen(false)
      setEditing(null)
      await load()
      toast.success(editing ? 'Narration rule saved.' : 'Narration rule added.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    const c = deleting
    setBusyId(c.id)
    try {
      await deleteNarrationRule(c.id)
      setDeleting(null)
      await load()
      toast.success('Narration rule deleted.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const toggleActive = async (c) => {
    setBusyId(c.id)
    try {
      await updateNarrationRule(c.id, {
        account_type: c.account_type,
        direction: c.direction,
        tests: (c.tests || []).map(({ subject_field, operator, value1, value2, combinator }) =>
          ({ subject_field, operator, value1, value2, combinator })),
        from_label: c.from_label,
        to_label: c.to_label,
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
    const swapWith = index + delta
    if (swapWith < 0 || swapWith >= next.length) return
    ;[next[index], next[swapWith]] = [next[swapWith], next[index]]
    setBusyId(group.rows[index].id)
    try {
      await reorderNarrationRules(group.account_type, group.direction, next.map((c) => c.id))
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
          Generated NARRATION guesses the "(From ... to ...)" leg of an
          Internal Transfer from the description. A narration rule overrides
          just that leg's text when it matches — nothing else in the line
          changes. Where two rules could both match, the higher one decides.
        </p>
        {canWrite && (
          <button
            onClick={() => { setEditing(null); setBuilderOpen(true) }}
            disabled={loading || !data}
            className="btn-primary btn-sm"
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> New narration rule
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
        ) : narrationRules.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-10 w-10" />}
            title="No narration rules yet"
            description={
              'Without one, the Internal Transfer leg is guessed from the last ' +
              '4 characters after the description\'s third dash. A narration ' +
              'rule replaces that guess with exact text, but only for the rows ' +
              'it describes.'
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
                            {c.problem} Narration generation skips this rule for{' '}
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
                              ? 'Switch off — kept, but not used by the next generation'
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
                            title="Edit this narration rule"
                            className="p-1 text-slate-400 hover:text-primary-600 cursor-pointer"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleting(c)}
                            title="Delete this narration rule"
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

      {!canWrite && narrationRules.length > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          You can read the narration rules but not change them. Ask a manager to edit them.
        </p>
      )}

      <NarrationRuleBuilder
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
        title="Delete this narration rule?"
        message={deleting
          ? `"${deleting.sentence}" — those rows go back to the guessed leg ` +
            'text. Switch it off instead if you may want it later.'
          : ''}
        confirmText="Delete"
      />
    </div>
  )
}
