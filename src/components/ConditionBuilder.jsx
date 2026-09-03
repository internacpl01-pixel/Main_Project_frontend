import { useEffect, useMemo, useState } from 'react'
import { Modal, Spinner } from './UI.jsx'
import { previewCondition } from '../api/endpoints.js'
import { Plus, X, FlaskConical } from 'lucide-react'

// One condition, written as the sentence it is.
//
//   WHEN account type is [RERA]
//    AND the row is a    [debit]
//    AND [Narration] [contains] [REFUND]
//   THEN it is [Cust Cancellation]
//
// Every dropdown is filled from GET /rules/conditions. No account type, column
// name, operator or head is written into this file — a company that renames a
// field on the Field Mapping page keeps a working builder, and an operator this
// version of the browser has never heard of still appears the moment the server
// implements it. The one thing this page decides for itself is how many value
// boxes to draw, and it reads that off the operator too.

// A condition names its answer directly, so unlike the grid there is no blank
// option here — a condition with no head is not a rule, it is half a sentence.
const emptyDraft = (opts) => ({
  account_type: opts.account_types?.[0] || '',
  direction: opts.directions?.[0] || 'CR',
  subject_field: '',
  operator: '',
  value1: '',
  value2: '',
  head_ids: [''],
  is_active: true,
})

// Which HTML input suits a column's kind. Dates get a date picker because the
// server parses ISO and that is what the picker emits; numbers get a numeric
// keyboard on a phone. Anything else is plain text.
const inputTypeFor = (kind) =>
  kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text'

export default function ConditionBuilder({
  isOpen, onClose, onSave, options, editing, saving,
}) {
  const [draft, setDraft] = useState(() => emptyDraft(options || {}))
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)

  const columns = options?.columns || []
  const operators = options?.operators || []
  const heads = options?.heads || []

  // Reset every time the dialog opens: editing one condition and then adding
  // another should not start from the previous one's answers.
  useEffect(() => {
    if (!isOpen) return
    setError(''); setPreview(null)
    setDraft(editing
      ? {
          account_type: editing.account_type,
          direction: editing.direction,
          subject_field: editing.subject_field,
          operator: editing.operator,
          value1: editing.value1 ?? '',
          value2: editing.value2 ?? '',
          head_ids: (editing.heads || []).map((h) => String(h.id)),
          is_active: editing.is_active,
        }
      : emptyDraft(options || {}))
  }, [isOpen, editing, options])

  const column = columns.find((c) => c.name === draft.subject_field)
  // Only the tests this column can answer. "More than" on a narration is not a
  // rule anyone can satisfy, and the server rejects it — so it is not offered.
  const usable = useMemo(
    () => operators.filter((o) => column && o.kinds.includes(column.kind)),
    [operators, column],
  )
  const operator = operators.find((o) => o.name === draft.operator)
  const arity = operator?.values ?? 0

  const set = (patch) => {
    setDraft((d) => ({ ...d, ...patch }))
    setPreview(null)
  }

  // Changing the column can strand the operator on a kind it does not apply to.
  // Rather than leave an impossible pair on screen, fall to the first test the
  // new column can answer.
  const pickColumn = (name) => {
    const next = columns.find((c) => c.name === name)
    const stillValid = operators.find(
      (o) => o.name === draft.operator && next && o.kinds.includes(next.kind))
    const fallback = operators.find((o) => next && o.kinds.includes(next.kind))
    set({
      subject_field: name,
      operator: stillValid ? draft.operator : (fallback?.name || ''),
      value1: '', value2: '',
    })
  }

  const pickOperator = (name) => {
    const op = operators.find((o) => o.name === name)
    // Values the new test does not use are dropped rather than carried unseen —
    // the server would discard them anyway, and a hidden value is one the
    // sentence on screen would not mention.
    set({
      operator: name,
      value1: (op?.values ?? 0) >= 1 ? draft.value1 : '',
      value2: (op?.values ?? 0) === 2 ? draft.value2 : '',
    })
  }

  const setHead = (i, value) =>
    set({ head_ids: draft.head_ids.map((h, j) => (j === i ? value : h)) })
  const addHead = () => set({ head_ids: [...draft.head_ids, ''] })
  const removeHead = (i) =>
    set({ head_ids: draft.head_ids.filter((_, j) => j !== i) })

  const testReady = Boolean(
    draft.account_type && draft.direction && draft.subject_field &&
    draft.operator && (arity < 1 || draft.value1) && (arity < 2 || draft.value2))
  const complete = testReady && draft.head_ids.some(Boolean)

  const payload = () => ({
    account_type: draft.account_type,
    direction: draft.direction,
    subject_field: draft.subject_field,
    operator: draft.operator,
    value1: arity >= 1 ? draft.value1 : null,
    value2: arity === 2 ? draft.value2 : null,
    head_ids: draft.head_ids.filter(Boolean).map(Number),
    is_active: draft.is_active,
  })

  const handlePreview = async () => {
    setPreviewing(true); setError('')
    try {
      const { head_ids, is_active, ...test } = payload()
      setPreview(await previewCondition(test))
    } catch (err) {
      setError(err.message); setPreview(null)
    } finally {
      setPreviewing(false)
    }
  }

  const handleSave = async () => {
    setError('')
    try {
      await onSave(payload())
    } catch (err) {
      setError(err.message)
    }
  }

  const sideWord = draft.direction === 'CR' ? 'credit' : 'debit'

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={editing ? 'Edit condition' : 'New condition'}
    >
      <div className="space-y-4 text-sm">
        <p className="text-slate-500">
          A condition outranks the grid. When a row matches it, its heads are the
          only answer — everything it does not describe is still judged by the
          grid.
        </p>

        {/* WHEN — the two axes the grid already speaks in. */}
        <div className="rounded-lg border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 font-medium text-slate-400">WHEN</span>
            <span className="text-slate-600">the account type is</span>
            <select
              className="input w-auto py-1"
              value={draft.account_type}
              onChange={(e) => set({ account_type: e.target.value })}
            >
              {(options?.account_types || []).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <span className="text-slate-600">and the row is a</span>
            <select
              className="input w-auto py-1"
              value={draft.direction}
              onChange={(e) => set({ direction: e.target.value })}
            >
              {(options?.directions || []).map((d) => (
                <option key={d} value={d}>
                  {d === 'CR' ? 'credit (CR)' : 'debit (DR)'}
                </option>
              ))}
            </select>
          </div>

          {/* AND — the one further test, on one column. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 font-medium text-slate-400">AND</span>
            <select
              className="input w-auto py-1"
              value={draft.subject_field}
              onChange={(e) => pickColumn(e.target.value)}
            >
              <option value="">— choose a column —</option>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>{c.label}</option>
              ))}
            </select>
            <select
              className="input w-auto py-1"
              value={draft.operator}
              disabled={!column}
              onChange={(e) => pickOperator(e.target.value)}
            >
              {!column && <option value="">— pick a column first —</option>}
              {usable.map((o) => (
                <option key={o.name} value={o.name}>{o.label}</option>
              ))}
            </select>
            {arity >= 1 && (
              <input
                className="input w-44 py-1"
                type={inputTypeFor(column?.kind)}
                value={draft.value1}
                placeholder="value"
                onChange={(e) => set({ value1: e.target.value })}
              />
            )}
            {arity === 2 && (
              <>
                <span className="text-slate-500">and</span>
                <input
                  className="input w-44 py-1"
                  type={inputTypeFor(column?.kind)}
                  value={draft.value2}
                  placeholder="value"
                  onChange={(e) => set({ value2: e.target.value })}
                />
              </>
            )}
          </div>
          {column && (
            <p className="pl-16 text-xs text-slate-400">
              {column.label} holds {column.kind} values, so
              only {column.kind} tests are offered. Text is matched without regard
              to upper or lower case.
            </p>
          )}
        </div>

        {/* THEN — the answer. Any active head, including one left blank on the
            grid: that is how a head can be valid only under this condition. */}
        <div className="rounded-lg border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 font-medium text-slate-400">THEN</span>
            <span className="text-slate-600">
              the {options?.target?.label || 'head'} must be
              {draft.head_ids.filter(Boolean).length > 1 ? ' one of' : ''}
            </span>
          </div>
          <div className="space-y-2 pl-16">
            {draft.head_ids.map((id, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-4 text-xs text-slate-400">{i + 1}.</span>
                <select
                  className="input w-72 py-1"
                  value={id}
                  onChange={(e) => setHead(i, e.target.value)}
                >
                  <option value="">— choose a head —</option>
                  {heads.map((h) => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
                {draft.head_ids.length > 1 && (
                  <button
                    onClick={() => removeHead(i)}
                    title="Remove this head"
                    className="text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            <button onClick={addHead} className="btn-secondary btn-sm">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add another head
            </button>
            <p className="text-xs text-slate-400">
              The first is what Replace preselects. A head left blank on the grid
              can be named here — that is how it becomes valid only when this
              test passes.
            </p>
          </div>
        </div>

        {/* Try it — the thing that stops a sentence being saved unread. */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handlePreview}
              disabled={!testReady || previewing}
              className="btn-secondary btn-sm"
              title={testReady
                ? undefined
                : 'Choose a column, a test and a value first'}
            >
              {previewing
                ? <Spinner size="sm" className="mr-1" />
                : <FlaskConical className="h-3.5 w-3.5 mr-1" />}
              Try it
            </button>
            <span className="text-xs text-slate-500">
              Runs the test against the rows already staged for{' '}
              {draft.account_type || 'this type'} accounts. Nothing is saved.
            </span>
          </div>
          {preview && (
            <div className="mt-3 text-sm">
              <p className="text-slate-700">
                <span className="font-medium">{preview.matched}</span> of{' '}
                {preview.scanned} staged {sideWord}
                {preview.scanned === 1 ? '' : 's'} match {preview.phrase}.
              </p>
              {preview.examples?.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {preview.examples.map((e) => (
                    <li key={e.id} className="truncate text-xs text-slate-500">
                      <span className="font-mono">{e.amount}</span> — {e.value}
                      {e.current_name && (
                        <span className="text-slate-400">
                          {' '}(currently {e.current_name})
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {preview.matched === 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  Nothing matches yet. That is fine if these rows have not been
                  imported — but worth a second look at the value first.
                </p>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
            {error}
          </div>
        )}

        <label className="flex items-center gap-2 text-slate-600">
          <input
            type="checkbox"
            checked={draft.is_active}
            onChange={(e) => set({ is_active: e.target.checked })}
          />
          Active — switched off, it is kept but not used by the next check.
        </label>

        <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!complete || saving}
            className="btn-primary text-sm"
            title={complete ? undefined : 'Finish the sentence first'}
          >
            {saving && <Spinner size="sm" tone="white" className="mr-2" />}
            {editing ? 'Save changes' : 'Add condition'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
