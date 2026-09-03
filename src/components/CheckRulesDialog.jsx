import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Lock, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Modal, Spinner } from './UI.jsx'
import {
  fetchMasterData, fetchTempImportFilters, checkTempRules, applyTempRules,
  fetchRuleSummary,
} from '../api/endpoints.js'

// The Check Rules flow: pick an account type, pick one of that type's
// accounts that actually has staged rows, and have the server judge every one
// of those rows against the type's rule. Conflicts come back red with the
// heads the rule would put there; the user replaces them or walks away.
//
// Both dropdowns are live reads of the user's own data — the types from
// account_type_master, the accounts from the same filter feed the Account
// chip uses, which already labels each account with its Bank master type.
// Nothing here names a type or an account.

const fmtAmount = (n) =>
  n === null || n === undefined || n === ''
    ? ''
    : Number(n).toLocaleString('en-IN', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      })

// staging.normalise_account, in the browser: digits only, then leading zeros.
// The same reduction the server matches accounts by.
const accountDigits = (v) => String(v || '').replace(/\D/g, '').replace(/^0+/, '')

// What this row in particular may be replaced with.
//
// A row carries rule_id when a condition decided it, and that condition's heads
// are then the only answer — not the grid's, which may be a different and wider
// set. Reading it from the same place the check did is the whole point: the
// dropdown cannot offer a head the server would refuse on apply.
const allowedFor = (result, row) => {
  const cond = row.rule_id != null && result.conditions?.[String(row.rule_id)]
  return (cond ? cond.heads : result.expected[row.direction]) || []
}

export default function CheckRulesDialog({
  isOpen, onClose, canWrite, onChecked, onApplied,
}) {
  const [types, setTypes] = useState([])
  const [accounts, setAccounts] = useState([])
  // How many heads each account type accepts, from the Rules page. Only used to
  // say so on the dropdown: a type with no rule can still be picked, and the
  // check then explains where to set one — but knowing before pressing Check
  // saves the round trip and the red error.
  const [ruleCounts, setRuleCounts] = useState({})
  const [loadingLists, setLoadingLists] = useState(false)

  const [type, setType] = useState('')
  const [account, setAccount] = useState('')

  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState(null)
  // Conflicting DR rows have two legitimate answers, so each conflict carries
  // its own choice, defaulted to the rule's preferred head.
  const [choices, setChoices] = useState({})
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  // Fresh lists every time the dialog opens: an import or a Master Data edit
  // since the last open changes both, and a stale account list here means
  // checking rows that no longer exist.
  useEffect(() => {
    if (!isOpen) return
    setType(''); setAccount(''); setResult(null); setChoices({}); setError('')
    let cancelled = false
    setLoadingLists(true)
    Promise.all([
      fetchMasterData('account_type').catch(() => []),
      fetchTempImportFilters().catch(() => null),
      // Not fatal: without it the dropdown simply stops annotating itself.
      fetchRuleSummary().catch(() => ({})),
    ]).then(([typeRows, filters, counts]) => {
      if (cancelled) return
      setTypes((Array.isArray(typeRows) ? typeRows : []).map((t) => t.name))
      setAccounts(filters?.account?.values || [])
      setRuleCounts(counts || {})
    }).finally(() => { if (!cancelled) setLoadingLists(false) })
    return () => { cancelled = true }
  }, [isOpen])

  // Only accounts the Bank master types as the chosen kind, and only ones
  // with staged rows — the filter feed is already exactly that intersection.
  //
  // Folded to one entry per real account. The feed groups by the value as
  // written, and the same account legitimately appears twice when one sheet
  // stored it as text and another as a number that dropped the leading zero.
  // Both carry the same Bank row and the same label, so they would render as
  // two identical options with the rows split between them — and the check,
  // which matches on digits, would then report more rows than the option said
  // it held. Counts are summed here so the number beside an account is the
  // number the check will judge.
  const accountsForType = Object.values(
    accounts
      .filter((a) => a.in_bank_master &&
                     (a.account_type || '').toUpperCase() === type)
      .reduce((acc, a) => {
        const key = accountDigits(a.value)
        if (!acc[key]) acc[key] = { ...a, spellings: 1 }
        else {
          acc[key].count += a.count
          acc[key].spellings += 1
        }
        return acc
      }, {})
  )

  const conflicts = (result?.rows || []).filter((r) => r.status === 'conflict')
  const actionable = conflicts.filter((r) => !r.is_locked)

  const handleCheck = async () => {
    setChecking(true); setError(''); setResult(null)
    try {
      const data = await checkTempRules({
        account_type: type, account_number: account,
      })
      setResult(data)
      const defaults = {}
      data.rows.forEach((r) => {
        if (r.status !== 'conflict') return
        defaults[r.id] = allowedFor(data, r)[0]?.id
      })
      setChoices(defaults)
      // Paint the conflicting rows red on the table behind this dialog, so
      // closing it without fixing anything still leaves the findings visible.
      // The field the rule judged goes with them: fixing a red row through
      // the ordinary editor has to be able to clear its red, and which
      // dropdown that is depends on the rule, not on this component.
      onChecked?.(
        new Set(data.rows.filter((r) => r.status === 'conflict').map((r) => r.id)),
        data.target.field,
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setChecking(false)
    }
  }

  const handleApply = async () => {
    setApplying(true); setError('')
    try {
      const res = await applyTempRules({
        account_type: type,
        account_number: account,
        rows: actionable.map((r) => ({
          id: r.id, head_id: Number(choices[r.id]),
        })),
      })
      toast.success(
        `Replaced the ${result.target.label} on ${res.updated} ` +
        `${res.updated === 1 ? 'row' : 'rows'}` +
        (res.skipped_locked
          ? ` — ${res.skipped_locked} locked ${res.skipped_locked === 1 ? 'row' : 'rows'} skipped`
          : '')
      )
      onApplied?.(res.updated_ids)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Check Rules" size="xl">
      <div className="space-y-4">
        {/* Step 1: which rule, which account. Changing either invalidates the
            check below it, so both resets clear the result. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label flex items-center gap-2">
              Account type
              {/* Both dropdowns fill from the same two requests, so one
                  spinner covers the pair. */}
              {loadingLists && <Spinner size="sm" />}
            </label>
            <select
              className="input"
              value={type}
              disabled={loadingLists}
              onChange={(e) => {
                setType((e.target.value || '').toUpperCase())
                setAccount(''); setResult(null); setChoices({}); setError('')
              }}
            >
              <option value="">
                {loadingLists
                  ? 'Loading...'
                  : types.length === 0
                    ? 'No account types yet — add them under Master Data'
                    : '— choose a type —'}
              </option>
              {types.map((t) => {
                const c = ruleCounts[(t || '').toUpperCase()]
                // A type can have a rule made only of conditions, so "no rule
                // set" has to mean neither — not just an empty grid column.
                const parts = []
                if (c?.total) parts.push(`${c.cr} CR, ${c.dr} DR`)
                if (c?.conditions) {
                  parts.push(`${c.conditions} condition${c.conditions === 1 ? '' : 's'}`)
                }
                return (
                  <option key={t} value={t}>
                    {t}
                    {parts.length ? ` · ${parts.join(' · ')}` : ' · no rule set'}
                  </option>
                )
              })}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              From the Type of Account master, as the Bank master uses it. What
              each type accepts is set on the{' '}
              <Link to="/rules" className="text-primary-600 hover:underline">
                Rules page
              </Link>.
            </p>
          </div>
          <div>
            <label className="label">Account number</label>
            <select
              className="input"
              value={account}
              disabled={!type || loadingLists}
              onChange={(e) => {
                setAccount(e.target.value)
                setResult(null); setChoices({}); setError('')
              }}
            >
              <option value="">
                {!type
                  ? 'Choose a type first'
                  : accountsForType.length === 0
                    ? `No ${type} accounts have staged rows`
                    : '— choose an account —'}
              </option>
              {accountsForType.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label} · {a.count} {a.count === 1 ? 'row' : 'rows'}
                  {a.spellings > 1
                    ? ` (written ${a.spellings} ways in the statements)`
                    : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              Only {type || 'this type'}-typed accounts that have rows in staging.
            </p>
          </div>
        </div>

        {type && accountsForType.length === 0 && !loadingLists && (
          <p className="text-xs text-slate-500">
            An account appears here when its rows are staged AND the Bank
            master records it as a {type} account.
          </p>
        )}

        <div>
          <button
            onClick={handleCheck}
            disabled={!type || !account || checking}
            className="btn-primary text-sm inline-flex items-center"
          >
            {checking
              ? <Spinner size="sm" tone="white" className="mr-1.5" />
              : <ShieldCheck className="h-4 w-4 mr-1.5" />}
            {checking ? 'Checking...' : 'Check'}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {checking && (
          <div className="py-6 flex justify-center"><Spinner /></div>
        )}

        {result && (
          <div className="space-y-4">
            {/* The rule, in the company's own words: the column label comes
                from its fieldmap, the head names from its master table. */}
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm space-y-1">
              <p className="font-medium text-slate-700">
                The {result.account_type} rule — {result.target.label}
              </p>
              {['CR', 'DR'].map((d) => (
                result.expected[d] && (
                  <p key={d} className="text-slate-600">
                    <span className="font-mono font-medium">{d}</span>
                    {' → '}
                    {result.expected[d].map((h) => h.name).join(' or ')}
                    <span className="text-slate-400"> — {result.why[d]}</span>
                  </p>
                )
              ))}
              {/* The conditions that ran alongside it, in the order they
                  decided. Shown whether or not any row matched one: knowing a
                  sentence exists and caught nothing is worth as much as seeing
                  it catch something. */}
              {Object.keys(result.conditions || {}).length > 0 && (
                <div className="mt-2 border-t border-slate-200 pt-2">
                  <p className="text-xs font-medium text-slate-500">
                    Conditions, checked before the grid
                  </p>
                  {Object.entries(result.conditions).map(([id, c]) => {
                    const hit = result.rows.filter(
                      (r) => String(r.rule_id) === id).length
                    return (
                      <p key={id} className="text-slate-600">
                        <span className="font-mono font-medium">{c.direction}</span>
                        {' → '}{c.sentence}
                        <span className="text-slate-400">
                          {' '}— {hit} {hit === 1 ? 'row' : 'rows'} here
                        </span>
                      </p>
                    )
                  })}
                </div>
              )}
            </div>

            {result.summary.conflicts === 0 ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                All {result.summary.total}{' '}
                {result.summary.total === 1 ? 'row follows' : 'rows follow'} the
                rule on {result.account.label}.
                {result.summary.no_direction > 0 &&
                  ` ${result.summary.no_direction} without a CR/DR marker could not be judged.`}
              </div>
            ) : (
              <>
                <p className="text-sm font-medium text-red-600">
                  {result.summary.conflicts} of {result.summary.total} rows break
                  the rule
                  {result.summary.locked_conflicts > 0 &&
                    ` (${result.summary.locked_conflicts} locked — unlock to fix)`}
                  .
                </p>

                <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2">CR/DR</th>
                        <th className="px-3 py-2">Current {result.target.label}</th>
                        <th className="px-3 py-2">Replace with</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-red-100">
                      {conflicts.map((r) => {
                        const allowed = allowedFor(result, r)
                        const cond = r.rule_id != null
                          && result.conditions?.[String(r.rule_id)]
                        return (
                          <tr key={r.id} className={`bg-red-50 ${r.is_locked ? 'opacity-60' : ''}`}>
                            <td className="px-3 py-2 whitespace-nowrap">{r.txn_date || '—'}</td>
                            <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{fmtAmount(r.amount)}</td>
                            <td className="px-3 py-2 font-mono">{r.direction}</td>
                            <td className="px-3 py-2 text-red-700">
                              {r.current_name || <span className="italic">not set</span>}
                              {/* Which sentence judged this row. Only shown when
                                  a condition did — "the grid" is the default and
                                  saying so on every row would be noise. */}
                              {cond && (
                                <span
                                  className="ml-1 rounded border border-violet-200 bg-violet-50 px-1 py-0.5 text-[10px] font-medium text-violet-700"
                                  title={cond.sentence}
                                >
                                  by condition
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {r.is_locked ? (
                                <span className="inline-flex items-center text-xs text-slate-500">
                                  <Lock className="h-3 w-3 mr-1" /> locked — skipped
                                </span>
                              ) : allowed.length > 1 ? (
                                // Debits have two legitimate answers, so each
                                // row decides for itself; the rule's first
                                // choice is preselected.
                                <select
                                  className="input py-1 text-xs"
                                  value={choices[r.id] ?? ''}
                                  onChange={(e) => setChoices((prev) => ({
                                    ...prev, [r.id]: Number(e.target.value),
                                  }))}
                                >
                                  {allowed.map((h) => (
                                    <option key={h.id} value={h.id}>{h.name}</option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-green-700">{allowed[0]?.name}</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="text-xs text-slate-500">
                  {result.summary.ok} {result.summary.ok === 1 ? 'row' : 'rows'}{' '}
                  already follow the rule
                  {result.summary.no_direction > 0 &&
                    `, ${result.summary.no_direction} without a CR/DR marker skipped`}
                  .
                </p>
              </>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={onClose} className="btn-secondary text-sm">
                No change
              </button>
              {canWrite && result.summary.conflicts > 0 && (
                <button
                  onClick={handleApply}
                  disabled={applying || actionable.length === 0}
                  title={actionable.length === 0
                    ? 'Every conflicting row is locked — unlock them first'
                    : undefined}
                  className="btn-primary text-sm"
                >
                  {applying && <Spinner size="sm" tone="white" className="mr-2" />}
                  {applying
                    ? 'Replacing...'
                    : `Replace heads according to rule (${actionable.length})`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
