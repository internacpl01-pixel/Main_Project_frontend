import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Lock, ShieldCheck, Columns3, Check, Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Modal, Spinner } from './UI.jsx'
import {
  fetchMasterData, fetchTempImportFilters, checkTempRules, applyTempRules,
  fetchRuleSummary, fetchRuleTargets,
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

// Which statement columns to show beside each conflict, remembered.
//
// Per schema, because two companies on the same browser have different columns
// and a name stored by one is meaningless to the other. The value is a list of
// column names; what they are called on screen comes from the server every
// time, so renaming a field on the Field Mapping page renames the header here.
const columnsKey = () =>
  `checkrules.columns.${localStorage.getItem('schema') || 'unknown'}`

const readStoredColumns = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(columnsKey()))
    return Array.isArray(raw) ? raw.filter((n) => typeof n === 'string') : null
  } catch {
    // A hand-edited or half-written entry is not worth a broken dialog over.
    return null
  }
}

// Dates arrive ISO, numbers as numbers, everything else as the bank wrote it.
// Only null and '' become a dash — 0 is a value the statement printed.
const showValue = (v) => (v === null || v === undefined || v === '' ? '—' : String(v))

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
  // Which of the three heads this run judges. A row carries all three and each
  // has its own rules, so one run decides one column — checking all three at
  // once would report a row as wrong three ways with no way to say which
  // dropdown to change. Defaults to whatever the server calls its default, so
  // this file never names a master.
  const [targets, setTargets] = useState([])
  const [target, setTarget] = useState('')

  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState(null)
  // Conflicting DR rows have two legitimate answers, so each conflict carries
  // its own choice, defaulted to the rule's preferred head.
  const [choices, setChoices] = useState({})
  // What has happened to each row since this check ran: 'saving', 'saved', or
  // an error string. Picking a head from a dropdown writes it immediately —
  // choosing by hand IS the decision, and making someone press a second button
  // to confirm a choice they already made is a step that only exists to be
  // forgotten. The bulk button below is for the rows nobody touched.
  const [rowState, setRowState] = useState({})
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  // The statement columns shown beside each conflict, and whether the menu
  // offering them is open. Empty until a check has run — the list of columns
  // comes back with the result, from this company's own fieldmap.
  const [shown, setShown] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef(null)

  // Which row's "why this head" popover is open, if any. One at a time, and
  // closed by clicking anywhere else — the icon is there to be glanced at, not
  // to leave a dozen explanations pinned open over the table.
  const [infoOpenId, setInfoOpenId] = useState(null)
  const infoRef = useRef(null)

  useEffect(() => {
    if (infoOpenId == null) return
    const away = (e) => {
      if (infoRef.current && !infoRef.current.contains(e.target)) {
        setInfoOpenId(null)
      }
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [infoOpenId])

  // Click-away, so the menu behaves like a menu. Bound only while it is open.
  useEffect(() => {
    if (!pickerOpen) return
    const away = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [pickerOpen])

  // Fresh lists every time the dialog opens: an import or a Master Data edit
  // since the last open changes both, and a stale account list here means
  // checking rows that no longer exist.
  useEffect(() => {
    if (!isOpen) return
    setType(''); setAccount(''); setResult(null); setChoices({}); setError('')
    setRowState({})
    let cancelled = false
    setLoadingLists(true)
    Promise.all([
      fetchMasterData('account_type').catch(() => []),
      fetchTempImportFilters().catch(() => null),
      fetchRuleTargets().catch(() => null),
    ]).then(([typeRows, filters, targetList]) => {
      if (cancelled) return
      setTypes((Array.isArray(typeRows) ? typeRows : []).map((t) => t.name))
      setAccounts(filters?.account?.values || [])
      const list = targetList?.targets || []
      setTargets(list)
      // The server's default when this company can use it; otherwise the first
      // it can. A head type with no column mapped is one whose answer could
      // never be saved, so opening on it would be opening on a dead end.
      const usable = list.filter((t) => t.used)
      setTarget(
        usable.find((t) => t.target === targetList?.default)?.target
        || usable[0]?.target || targetList?.default || '')
    }).finally(() => { if (!cancelled) setLoadingLists(false) })
    return () => { cancelled = true }
  }, [isOpen])

  // The rule counts on the account-type dropdown are per head type, so they are
  // read again whenever it changes. Its own effect rather than part of the open
  // above: four MASTER rules on the RERA grid say nothing about whether an
  // Internal Head run would find anything, and showing last head type's numbers
  // is worse than showing none.
  useEffect(() => {
    if (!isOpen || !target) return
    let cancelled = false
    // Not fatal: without it the dropdown simply stops annotating itself.
    fetchRuleSummary(target).catch(() => ({})).then((counts) => {
      if (!cancelled) setRuleCounts(counts || {})
    })
    return () => { cancelled = true }
  }, [isOpen, target])

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
  // Rows the bulk button still has work to do on: unlocked, and not already
  // written by hand. A row saved from its own dropdown is done, and counting it
  // again would have the button offer to redo a decision already made.
  const actionable = conflicts.filter(
    (r) => !r.is_locked && !['saved', 'skipped'].includes(rowState[r.id]?.status))

  // In the fieldmap's order, not the order they were ticked — the extra
  // columns should read like the staging table, which is where the user knows
  // them from.
  const extraColumns = (result?.columns || []).filter((c) => shown.includes(c.name))

  const saved = conflicts.filter((r) => rowState[r.id]?.status === 'saved').length

  const toggleColumn = (name) => {
    setShown((prev) => {
      const next = prev.includes(name)
        ? prev.filter((n) => n !== name)
        : [...prev, name]
      // Saved on every tick rather than when the menu closes: this dialog can
      // be dismissed by the backdrop, by Escape or by finishing the fix, and a
      // preference that only survives one of those is worse than none.
      try {
        localStorage.setItem(columnsKey(), JSON.stringify(next))
      } catch {
        // Private browsing, or a full quota. The columns still work for this
        // session; only remembering them fails, and silently is right.
      }
      return next
    })
  }

  // One row, written the moment its dropdown changes.
  //
  // Goes through the same /check-rules/apply the bulk button uses, so the head
  // is re-checked against what the rule allows for THIS row — the endpoint is
  // not a bulk editor wearing a rule's name, and sending one row must not be
  // the way around that.
  const handlePick = async (row, headId) => {
    setChoices((prev) => ({ ...prev, [row.id]: headId }))
    setRowState((prev) => ({ ...prev, [row.id]: { status: 'saving' } }))
    try {
      const res = await applyTempRules({
        account_type: type,
        account_number: account,
        // The head type the check ran on, not the dropdown's current value:
        // they are the same until someone changes it, and if they differ this
        // would write a column nothing judged.
        target: result.target.target,
        rows: [{ id: row.id, head_id: Number(headId) }],
      })
      if (res.updated === 1) {
        setRowState((prev) => ({ ...prev, [row.id]: { status: 'saved' } }))
        // The table behind loses this row's red and gains its amber. Not
        // onClose: the point of saving here is to keep working down the list.
        onApplied?.(res.updated_ids)
      } else {
        // Applied nothing and did not throw: the row is locked, or it no
        // longer matches the account or this user's scope. Said on the row
        // rather than as a toast, because it is about that row.
        setRowState((prev) => ({
          ...prev,
          [row.id]: {
            status: 'error',
            message: res.skipped_locked
              ? 'Locked — unlock it first'
              : 'No longer matches this account',
          },
        }))
      }
    } catch (err) {
      setRowState((prev) => ({
        ...prev, [row.id]: { status: 'error', message: err.message },
      }))
    }
  }

  // Marks one row as dealt with without writing anything. It only removes the
  // row from the bulk button's count for this open dialog — the row itself
  // stays exactly as it is, still red on the staging table behind, since
  // nothing here told the server anything changed.
  const handleSkip = (row) => {
    setRowState((prev) => ({ ...prev, [row.id]: { status: 'skipped' } }))
  }

  const handleCheck = async () => {
    setChecking(true); setError(''); setResult(null)
    try {
      const data = await checkTempRules({
        account_type: type, account_number: account, target,
      })
      setResult(data)

      // Reconcile the remembered choice against the columns this company
      // actually has. A field deleted on the Field Mapping page must not leave
      // a header with nothing under it, and a browser that has never opened
      // this dialog takes the server's suggestion — what the bank printed,
      // plus whatever column a condition tested — rather than showing nothing.
      const offered = new Set((data.columns || []).map((c) => c.name))
      const stored = readStoredColumns()
      setShown((stored ?? data.default_columns ?? []).filter((n) => offered.has(n)))

      const defaults = {}
      data.rows.forEach((r) => {
        if (r.status !== 'conflict') return
        defaults[r.id] = allowedFor(data, r)[0]?.id
      })
      setChoices(defaults)
      setRowState({})
      // Paint the conflicting rows red on the table behind this dialog, so
      // closing it without fixing anything still leaves the findings visible.
      // The field the rule judged goes with them: fixing a red row through
      // the ordinary editor has to be able to clear its red, and which
      // dropdown that is depends on the rule, not on this component.
      // The account goes with them so the staging table can ask the server for
      // just these rows. It sends the account back rather than the ids: the
      // server re-judges, so the list cannot outlive the findings it is built
      // from — a row fixed since this check drops out on its own.
      onChecked?.(
        new Set(data.rows.filter((r) => r.status === 'conflict').map((r) => r.id)),
        data.target.field,
        { account_type: type, account_number: account,
          target: data.target.target, label: data.account.label },
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
        target: result.target.target,
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
    <Modal isOpen={isOpen} onClose={onClose} title="Check Rules" size="2xl">
      <div className="space-y-4">
        {/* Step 1: which head, which rule, which account. Changing any of the
            three invalidates the check below it, so all three resets clear the
            result. */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label flex items-center gap-2">
              Head to check
              {loadingLists && <Spinner size="sm" />}
            </label>
            <select
              className="input"
              value={target}
              disabled={loadingLists || targets.length === 0}
              onChange={(e) => {
                setTarget(e.target.value)
                // Not the account: it is chosen by its Bank master type, which
                // this does not touch. The result goes, because it judged a
                // different column.
                setResult(null); setChoices({}); setRowState({}); setError('')
              }}
            >
              {targets.map((t) => (
                <option key={t.target} value={t.target} disabled={!t.used}>
                  {t.label}
                  {t.used ? '' : ' · no column mapped'}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              A row carries three heads and each has its own rules. One run
              judges one of them.
            </p>
          </div>
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
            disabled={!type || !account || !target || checking}
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-red-600">
                    {result.summary.conflicts} of {result.summary.total} rows break
                    the rule
                    {result.summary.locked_conflicts > 0 &&
                      ` (${result.summary.locked_conflicts} locked — unlock to fix)`}
                    .
                  </p>

                  {/* Which statement columns to show beside each row. Date and
                      amount alone cannot tell two transfers on the same day
                      apart, and which column does is this company's business:
                      the list is its fieldmap, under its own names. */}
                  <div className="relative" ref={pickerRef}>
                    <button
                      onClick={() => setPickerOpen((o) => !o)}
                      className="btn-secondary btn-sm inline-flex items-center"
                      title="Choose which statement columns to show"
                    >
                      <Columns3 className="h-3.5 w-3.5 mr-1.5" />
                      Columns{extraColumns.length ? ` (${extraColumns.length})` : ''}
                    </button>
                    {pickerOpen && (
                      <div className="absolute right-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                        {(result.columns || []).length === 0 ? (
                          <p className="px-3 py-2 text-xs text-slate-400">
                            No columns are mapped yet.
                          </p>
                        ) : (
                          result.columns.map((c) => {
                            const on = shown.includes(c.name)
                            return (
                              <button
                                key={c.name}
                                onClick={() => toggleColumn(c.name)}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                              >
                                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                                  {on && <Check className="h-3.5 w-3.5 text-primary-600" />}
                                </span>
                                <span className={`truncate ${on ? 'text-slate-900' : 'text-slate-500'}`}>
                                  {c.label}
                                </span>
                              </button>
                            )
                          })
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2">CR/DR</th>
                        {extraColumns.map((c) => (
                          <th
                            key={c.name}
                            className={`px-3 py-2 ${c.kind === 'number' ? 'text-right' : ''}`}
                          >
                            {c.label}
                          </th>
                        ))}
                        <th className="px-3 py-2">Current {result.target.label}</th>
                        <th className="px-3 py-2">Replace with</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-red-100">
                      {conflicts.map((r) => {
                        const allowed = allowedFor(result, r)
                        const state = rowState[r.id]
                        const cond = r.rule_id != null
                          && result.conditions?.[String(r.rule_id)]
                        return (
                          // Green once written: the row is no longer a finding,
                          // it is a thing that has been dealt with, and leaving
                          // it red would have the list keep accusing rows the
                          // user has already fixed.
                          <tr
                            key={r.id}
                            className={
                              state?.status === 'saved'
                                ? 'bg-green-50'
                                : state?.status === 'skipped'
                                  ? 'bg-slate-50 opacity-70'
                                  : `bg-red-50 ${r.is_locked ? 'opacity-60' : ''}`
                            }
                          >
                            <td className="px-3 py-2 whitespace-nowrap">{r.txn_date || '—'}</td>
                            <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{fmtAmount(r.amount)}</td>
                            <td className="px-3 py-2 font-mono">{r.direction}</td>
                            {/* Wrapped in a width-capped block, not truncated:
                                a bank narration runs 60-80 characters and the
                                reference at its end is the part that identifies
                                the payment. Same treatment the staging table
                                gives the same column. */}
                            {extraColumns.map((c) => (
                              <td
                                key={c.name}
                                className={`px-3 py-2 align-top ${
                                  c.kind === 'number'
                                    ? 'text-right font-mono whitespace-nowrap'
                                    : ''
                                }`}
                              >
                                <div className="max-w-xs break-words">
                                  {showValue(r.values?.[c.name])}
                                </div>
                              </td>
                            ))}
                            <td className="px-3 py-2 text-red-700">
                              {r.current_name || <span className="italic">not set</span>}
                              {/* Which sentence judged this row. Only shown when
                                  a condition did — "the grid" is the default and
                                  saying so on every row would be noise. */}
                              {cond ? (
                                <span
                                  className="ml-1 rounded border border-violet-200 bg-violet-50 px-1 py-0.5 text-[10px] font-medium text-violet-700"
                                  title={cond.sentence}
                                >
                                  by condition
                                </span>
                              ) : (
                                <span
                                  className="ml-1 rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] font-medium text-slate-500"
                                  title={result.why?.[r.direction] ||
                                    `The ${result.account_type} grid's ${r.direction} column, for this head type.`}
                                >
                                  by grid
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {r.is_locked ? (
                                <span className="inline-flex items-center text-xs text-slate-500">
                                  <Lock className="h-3 w-3 mr-1" /> locked — skipped
                                </span>
                              ) : state?.status === 'skipped' ? (
                                // Nothing was written — this only hides the row
                                // from the bulk button for the rest of this
                                // open dialog. Undoable, because a row skipped
                                // by mistake should not need the dialog reopened.
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-slate-400">skipped for now</span>
                                  <button
                                    onClick={() => setRowState((prev) => {
                                      const next = { ...prev }
                                      delete next[r.id]
                                      return next
                                    })}
                                    className="text-xs text-primary-600 hover:underline"
                                  >
                                    undo
                                  </button>
                                </div>
                              ) : allowed.length > 1 ? (
                                // Debits have two legitimate answers, so each
                                // row decides for itself; the rule's first
                                // choice is preselected. Choosing writes it.
                                <div className="flex items-center gap-2">
                                  <select
                                    className="input py-1 text-xs"
                                    value={choices[r.id] ?? ''}
                                    disabled={state?.status === 'saving'}
                                    onChange={(e) => handlePick(r, e.target.value)}
                                  >
                                    {allowed.map((h) => (
                                      <option key={h.id} value={h.id}>{h.name}</option>
                                    ))}
                                  </select>
                                  {state?.status === 'saving' && <Spinner size="sm" />}
                                  {state?.status === 'saved' && (
                                    <span className="inline-flex shrink-0 items-center text-xs font-medium text-green-700">
                                      <Check className="h-3.5 w-3.5 mr-0.5" /> saved
                                    </span>
                                  )}
                                  {state?.status === 'error' && (
                                    <span
                                      className="shrink-0 text-xs font-medium text-red-700"
                                      title={state.message}
                                    >
                                      not saved
                                    </span>
                                  )}
                                  {!state && (
                                    <button
                                      onClick={() => handleSkip(r)}
                                      title="Leave this row exactly as it is for now"
                                      className="shrink-0 text-xs text-slate-400 hover:text-slate-600 hover:underline"
                                    >
                                      skip for now
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="relative flex items-center gap-2">
                                  <span className="text-green-700">{allowed[0]?.name}</span>
                                  <button
                                    onClick={() => setInfoOpenId(
                                      infoOpenId === r.id ? null : r.id)}
                                    title="Why this head?"
                                    className="shrink-0 text-slate-300 hover:text-slate-500"
                                  >
                                    <Info className="h-3.5 w-3.5" />
                                  </button>
                                  {infoOpenId === r.id && (
                                    <div
                                      ref={infoRef}
                                      className="absolute left-0 top-6 z-20 w-64 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-lg"
                                    >
                                      {cond ? (
                                        <>
                                          <p className="mb-1 font-medium text-violet-700">
                                            From a condition
                                          </p>
                                          <p>{cond.sentence}</p>
                                          <p className="mt-1 text-slate-400">
                                            That sentence matched this row, so its
                                            head{cond.heads?.length > 1 ? 's are' : ' is'} the
                                            only answer here — the grid is not
                                            consulted once a condition matches.
                                          </p>
                                        </>
                                      ) : (
                                        <>
                                          <p className="mb-1 font-medium text-slate-700">
                                            From the grid
                                          </p>
                                          <p>
                                            {result.why?.[r.direction] ||
                                              `The ${result.account_type} rule's ` +
                                              `${r.direction} column, for ${result.target.label}.`}
                                          </p>
                                          <p className="mt-1 text-slate-400">
                                            No condition matched this row, so it
                                            falls back to whatever the grid says a{' '}
                                            {r.direction === 'CR' ? 'credit' : 'debit'} on
                                            this account should be.
                                          </p>
                                        </>
                                      )}
                                    </div>
                                  )}
                                  <button
                                    onClick={() => handleSkip(r)}
                                    title="Leave this row exactly as it is for now"
                                    className="shrink-0 text-xs text-slate-400 hover:text-slate-600 hover:underline"
                                  >
                                    skip for now
                                  </button>
                                </div>
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
                  {saved > 0 &&
                    `. ${saved} ${saved === 1 ? 'row' : 'rows'} saved from the dropdowns above`}
                  .
                </p>
              </>
            )}

            {/* Only when there is something to press. With nothing to replace
                — every row already following the rule, or every one saved from
                its own dropdown — this dialog is finished, and the way out of a
                finished dialog is the X, not a button that does nothing. */}
            {canWrite && result.summary.conflicts > 0 && (
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={handleApply}
                  disabled={applying || actionable.length === 0}
                  title={actionable.length === 0
                    ? 'Nothing left to replace — every conflicting row is either saved or locked'
                    : 'Apply the rule to the rows still untouched'}
                  className="btn-primary text-sm"
                >
                  {applying && <Spinner size="sm" tone="white" className="mr-2" />}
                  {applying
                    ? 'Replacing...'
                    : `Replace heads according to rule (${actionable.length})`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
