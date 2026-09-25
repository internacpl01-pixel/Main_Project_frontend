import { useEffect, useState } from 'react'
import { Modal, Spinner } from './UI.jsx'
import { previewNarrationRule } from '../api/endpoints.js'
import { Plus, X, FlaskConical } from 'lucide-react'

// One narration rule, written as the sentence it is.
//
//   WHEN account type is [RERA]
//    AND the row is a    [credit]
//    AND [DESC] [contains] [045563400002477]
//   THEN show (From [YES IDW 0490] to [ICICI Current A/C])
//
// Same WHEN engine as ConditionBuilder — every dropdown filled from
// GET /rules/narration-rules, nothing named here. The THEN half is the one
// real difference: From/To or Purpose instead of a head picker, because this
// overrides a piece of generated text, not a head column.
//
// From/To and Purpose answer different rows — a row is only ever in the
// Internal Transfer branch (From/To) or a Receipt Credit/Payment
// Disbursement branch (Purpose), never both — so a rule sets exactly one,
// never both at once. `thenKind` picks which; switching clears the other so
// there is never a stale answer sitting in a field the rule does not use.

const emptyTest = (combinator = null) => ({
  subject_field: '', operator: '', value1: '', value2: '', combinator,
})

const emptyDraft = (opts) => ({
  account_type: opts.account_types?.[0] || '',
  direction: opts.directions?.[0] || 'CR',
  tests: [emptyTest()],
  thenKind: 'legs',
  from_label: '',
  to_label: '',
  purpose_label: '',
  is_active: true,
})

const inputTypeFor = (kind) =>
  kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text'

export default function NarrationRuleBuilder({
  isOpen, onClose, onSave, options, editing, saving,
}) {
  const [draft, setDraft] = useState(() => emptyDraft(options || {}))
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)

  const columns = options?.columns || []
  const operators = options?.operators || []

  useEffect(() => {
    if (!isOpen) return
    setError(''); setPreview(null)
    setDraft(editing
      ? {
          account_type: editing.account_type,
          direction: editing.direction,
          tests: (editing.tests || []).map((t) => ({
            subject_field: t.subject_field,
            operator: t.operator,
            value1: t.value1 ?? '',
            value2: t.value2 ?? '',
            combinator: t.combinator,
          })),
          thenKind: editing.purpose_label ? 'purpose' : 'legs',
          from_label: editing.from_label || '',
          to_label: editing.to_label || '',
          purpose_label: editing.purpose_label || '',
          is_active: editing.is_active,
        }
      : emptyDraft(options || {}))
  }, [isOpen, editing, options])

  const columnFor = (field) => columns.find((c) => c.name === field)
  const usableFor = (field) => {
    const col = columnFor(field)
    return operators.filter((o) => col && o.kinds.includes(col.kind))
  }
  const arityFor = (op) => operators.find((o) => o.name === op)?.values ?? 0

  const set = (patch) => {
    setDraft((d) => ({ ...d, ...patch }))
    setPreview(null)
  }

  const setTest = (i, patch) =>
    set({ tests: draft.tests.map((t, j) => (j === i ? { ...t, ...patch } : t)) })

  const pickColumn = (i, name) => {
    const next = columns.find((c) => c.name === name)
    const current = draft.tests[i]
    const stillValid = operators.find(
      (o) => o.name === current.operator && next && o.kinds.includes(next.kind))
    const fallback = operators.find((o) => next && o.kinds.includes(next.kind))
    setTest(i, {
      subject_field: name,
      operator: stillValid ? current.operator : (fallback?.name || ''),
      value1: '', value2: '',
    })
  }

  const pickOperator = (i, name) => {
    const op = operators.find((o) => o.name === name)
    setTest(i, {
      operator: name,
      value1: (op?.values ?? 0) >= 1 ? draft.tests[i].value1 : '',
      value2: (op?.values ?? 0) === 2 ? draft.tests[i].value2 : '',
    })
  }

  const addTest = () => set({ tests: [...draft.tests, emptyTest('AND')] })
  const removeTest = (i) => set({ tests: draft.tests.filter((_, j) => j !== i) })

  // Switching which THEN this rule sets clears the other — a rule answers
  // From/To or Purpose, never both, so a value left behind in the hidden
  // field would be saved as though it still meant something.
  const setThenKind = (kind) => set({
    thenKind: kind,
    ...(kind === 'legs' ? { purpose_label: '' } : { from_label: '', to_label: '' }),
  })

  const testsReady = draft.tests.length > 0 && draft.tests.every((t) => {
    const arity = arityFor(t.operator)
    return t.subject_field && t.operator &&
      (arity < 1 || t.value1) && (arity < 2 || t.value2)
  })
  const testReady = Boolean(draft.account_type && draft.direction) && testsReady
  const thenReady = draft.thenKind === 'legs'
    ? Boolean(draft.from_label.trim() && draft.to_label.trim())
    : Boolean(draft.purpose_label.trim())
  const complete = testReady && thenReady

  const cleanTests = () => draft.tests.map((t, i) => {
    const arity = arityFor(t.operator)
    return {
      subject_field: t.subject_field,
      operator: t.operator,
      value1: arity >= 1 ? t.value1 : null,
      value2: arity === 2 ? t.value2 : null,
      combinator: i === 0 ? null : t.combinator,
    }
  })

  const payload = () => ({
    account_type: draft.account_type,
    direction: draft.direction,
    tests: cleanTests(),
    from_label: draft.thenKind === 'legs' ? draft.from_label.trim() : null,
    to_label: draft.thenKind === 'legs' ? draft.to_label.trim() : null,
    purpose_label: draft.thenKind === 'purpose' ? draft.purpose_label.trim() : null,
    is_active: draft.is_active,
  })

  const handlePreview = async () => {
    setPreviewing(true); setError('')
    try {
      setPreview(await previewNarrationRule({
        account_type: draft.account_type,
        direction: draft.direction,
        tests: cleanTests(),
      }))
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
      title={editing ? 'Edit narration rule' : 'New narration rule'}
    >
      <div className="space-y-4 text-sm">
        <p className="text-slate-500">
          When a row matches this, its generated narration uses the text below
          instead of the guess pulled from the description — either the
          "(From ... to ...)" leg on an Internal Transfer row, or the Purpose
          on a Receipt Credit or Payment Disbursement row. Pick which one this
          rule answers below.
        </p>

        {/* WHEN */}
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

          {draft.tests.map((t, i) => {
            const col = columnFor(t.subject_field)
            const usable = usableFor(t.subject_field)
            const arity = arityFor(t.operator)
            return (
              <div key={i} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {i === 0 ? (
                    <span className="w-20 font-medium text-slate-400">AND</span>
                  ) : (
                    <select
                      className="input w-20 py-1 font-medium"
                      value={t.combinator || 'AND'}
                      onChange={(e) => setTest(i, { combinator: e.target.value })}
                    >
                      <option value="AND">AND</option>
                      <option value="OR">OR</option>
                    </select>
                  )}
                  <select
                    className="input w-auto py-1"
                    value={t.subject_field}
                    onChange={(e) => pickColumn(i, e.target.value)}
                  >
                    <option value="">— choose a column —</option>
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>{c.label}</option>
                    ))}
                  </select>
                  <select
                    className="input w-auto py-1"
                    value={t.operator}
                    disabled={!col}
                    onChange={(e) => pickOperator(i, e.target.value)}
                  >
                    {!col && <option value="">— pick a column first —</option>}
                    {usable.map((o) => (
                      <option key={o.name} value={o.name}>{o.label}</option>
                    ))}
                  </select>
                  {arity >= 1 && (
                    <input
                      className="input w-44 py-1"
                      type={inputTypeFor(col?.kind)}
                      value={t.value1}
                      placeholder="value"
                      onChange={(e) => setTest(i, { value1: e.target.value })}
                    />
                  )}
                  {arity === 2 && (
                    <>
                      <span className="text-slate-500">and</span>
                      <input
                        className="input w-44 py-1"
                        type={inputTypeFor(col?.kind)}
                        value={t.value2}
                        placeholder="value"
                        onChange={(e) => setTest(i, { value2: e.target.value })}
                      />
                    </>
                  )}
                  {draft.tests.length > 1 && (
                    <button
                      onClick={() => removeTest(i)}
                      title="Remove this test"
                      className="text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {col && (
                  <p className="pl-16 text-xs text-slate-400">
                    {col.label} holds {col.kind} values, so
                    only {col.kind} tests are offered. Text is matched without
                    regard to upper or lower case.
                  </p>
                )}
              </div>
            )
          })}
          <button onClick={addTest} className="btn-secondary btn-sm">
            <Plus className="h-3.5 w-3.5 mr-1" /> Add AND/OR
          </button>
        </div>

        {/* THEN — From/To or Purpose, never both: a row is only ever in the
            Internal Transfer branch or a Purpose branch, so a rule answers
            one question, not two. */}
        <div className="rounded-lg border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="w-14 font-medium text-slate-400">THEN</span>
            <span className="text-slate-600">this rule sets</span>
            <label className="flex items-center gap-1.5 text-slate-700">
              <input
                type="radio"
                checked={draft.thenKind === 'legs'}
                onChange={() => setThenKind('legs')}
              />
              From/To
            </label>
            <label className="flex items-center gap-1.5 text-slate-700">
              <input
                type="radio"
                checked={draft.thenKind === 'purpose'}
                onChange={() => setThenKind('purpose')}
              />
              Purpose
            </label>
          </div>

          {draft.thenKind === 'legs' ? (
            <div>
              <div className="flex flex-wrap items-center gap-2 pl-16">
                <span className="text-slate-600">show "(From</span>
                <input
                  className="input w-52 py-1"
                  value={draft.from_label}
                  placeholder="e.g. YES IDW 0490"
                  onChange={(e) => set({ from_label: e.target.value })}
                />
                <span className="text-slate-600">to</span>
                <input
                  className="input w-52 py-1"
                  value={draft.to_label}
                  placeholder="e.g. ICICI Current A/C"
                  onChange={(e) => set({ to_label: e.target.value })}
                />
                <span className="text-slate-600">)"</span>
              </div>
              <p className="pl-16 text-xs text-slate-400">
                Used on an Internal Transfer row. CR and DR are separate
                rules, so write a second one if the other direction needs its
                own wording.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex flex-wrap items-center gap-2 pl-16">
                <span className="text-slate-600">show Purpose "</span>
                <input
                  className="input w-64 py-1"
                  value={draft.purpose_label}
                  placeholder="e.g. Contractor Advance"
                  onChange={(e) => set({ purpose_label: e.target.value })}
                />
                <span className="text-slate-600">"</span>
              </div>
              <p className="pl-16 text-xs text-slate-400">
                Used on a Receipt Credit or Payment Disbursement row.
              </p>
            </div>
          )}
        </div>

        {/* Try it */}
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
                      <span className="font-mono">{e.amount}</span> —{' '}
                      {Object.entries(e.values || {})
                        .map(([field, v]) => `${columnFor(field)?.label || field}: ${v ?? '—'}`)
                        .join(', ')}
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
          Active — switched off, it is kept but not used by the next generation.
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
            {editing ? 'Save changes' : 'Add narration rule'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
