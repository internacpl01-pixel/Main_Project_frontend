import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchCompanies } from '../api/endpoints.js'
import {
  Building2, Users, ShieldAlert, Plus, KeyRound, ArrowRight, Clock,
  AlertCircle, ServerCog,
} from 'lucide-react'

// The super admin's landing screen.
//
// It replaces a card that said "This account is not attached to a company, so
// there is nothing here to show. Ask a super admin to check your account." —
// written for a company user whose account is misconfigured, and shown to the
// super admin as well. Telling the super admin to go and find a super admin is
// the app's own design reported as the user's mistake.
//
// Belonging to no company is not a fault here, it is the whole point: a super
// admin administers tenants and never works inside one. So this says what they
// do have, from live data, and puts the next action in reach.

// ── Motion --------------------------------------------------------------------
// Everything animated below asks this first. A tilt that follows the cursor and
// numbers that count up are exactly what someone who has turned motion down has
// turned down, and honouring it costs one listener.
function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const onChange = (e) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

// Count from zero to `target` on an ease-out curve.
//
// requestAnimationFrame rather than a CSS transition or an interval: the value
// is text, not a style, so it has to be produced per frame, and rAF is the only
// clock that stays in step with the compositor and stops when the tab is hidden.
function useCountUp(target, duration = 900) {
  const reduced = useReducedMotion()
  const [value, setValue] = useState(target)

  useEffect(() => {
    if (reduced) { setValue(target); return }
    let raf
    let start
    const tick = (now) => {
      start ??= now
      const p = Math.min(1, (now - start) / duration)
      // Ease-out cubic — fast at first, settling on the real number.
      setValue(Math.round(target * (1 - (1 - p) ** 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, reduced])

  return value
}

// Tilt an element toward the cursor in 3D.
//
// The rotation is written straight onto the node as two CSS custom properties
// rather than held in React state. A pointer move fires dozens of times a
// second and re-rendering a card on each one is work the browser can do for
// free in the compositor — setProperty touches no React tree at all.
function useTilt(maxDeg = 9) {
  const ref = useRef(null)
  const reduced = useReducedMotion()

  const onPointerMove = useCallback((e) => {
    const el = ref.current
    if (!el || reduced) return
    const r = el.getBoundingClientRect()
    const dx = (e.clientX - r.left) / r.width - 0.5
    const dy = (e.clientY - r.top) / r.height - 0.5
    el.style.setProperty('--ry', `${(dx * maxDeg).toFixed(2)}deg`)
    el.style.setProperty('--rx', `${(-dy * maxDeg).toFixed(2)}deg`)
    el.style.setProperty('--lift', '1')
  }, [maxDeg, reduced])

  const onPointerLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--ry', '0deg')
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--lift', '0')
  }, [])

  return { ref, onPointerMove, onPointerLeave }
}

// ── Formatting ----------------------------------------------------------------
// Intl rather than hand-rolled: en-IN groups 1,50,000 the way this app's users
// write it, and RelativeTimeFormat produces "3 days ago" without a table of
// plural forms to keep in step.
const NUMBER = new Intl.NumberFormat('en-IN')
const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS = [
  ['year', 31536e6], ['month', 2592e6], ['week', 6048e5],
  ['day', 864e5], ['hour', 36e5], ['minute', 6e4],
]

function timeAgo(iso) {
  if (!iso) return null
  const delta = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(delta)) return null
  for (const [unit, size] of UNITS) {
    if (Math.abs(delta) >= size) return RELATIVE.format(Math.round(delta / size), unit)
  }
  return 'just now'
}

function greetingFor(date) {
  const h = date.getHours()
  if (h < 5) return 'Working late'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// ── Pieces --------------------------------------------------------------------

// perspective on the wrapper, the rotation on the child: a transform only reads
// as depth if the vanishing point belongs to something that is not itself
// rotating. The inner block is pushed toward the viewer on translateZ so the
// content sits above the card face instead of painted flat onto it.
function StatCard({ icon: Icon, label, value, hint, tone = 'slate', onClick }) {
  const tilt = useTilt()
  const shown = useCountUp(value)

  const tones = {
    slate: 'from-slate-50 to-white text-slate-500',
    primary: 'from-primary-50 to-white text-primary-600',
    amber: 'from-amber-50 to-white text-amber-600',
  }

  return (
    <div className="[perspective:1000px]">
      <div
        ref={tilt.ref}
        onPointerMove={tilt.onPointerMove}
        onPointerLeave={tilt.onPointerLeave}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick() } : undefined}
        className={`card bg-gradient-to-br ${tones[tone]} px-5 py-4 transition-[transform,box-shadow] duration-200 ease-out
          [transform-style:preserve-3d]
          [transform:rotateX(var(--rx,0deg))_rotateY(var(--ry,0deg))_translateY(calc(var(--lift,0)*-3px))]
          hover:shadow-lg ${onClick ? 'cursor-pointer' : ''}`}
      >
        <div className="[transform:translateZ(28px)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {label}
            </span>
            <Icon className="h-4 w-4" />
          </div>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">
            {NUMBER.format(shown)}
          </p>
          {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
        </div>
      </div>
    </div>
  )
}

function ActionTile({ icon: Icon, title, description, onClick, primary }) {
  const tilt = useTilt(7)
  return (
    <div className="[perspective:900px] flex-1 min-w-[220px]">
      <button
        ref={tilt.ref}
        onPointerMove={tilt.onPointerMove}
        onPointerLeave={tilt.onPointerLeave}
        onClick={onClick}
        className={`w-full text-left rounded-xl border px-4 py-3.5 transition-[transform,box-shadow] duration-200 ease-out
          [transform-style:preserve-3d]
          [transform:rotateX(var(--rx,0deg))_rotateY(var(--ry,0deg))_translateY(calc(var(--lift,0)*-2px))]
          ${primary
            ? 'border-primary-600 bg-primary-600 text-white hover:shadow-lg hover:shadow-primary-600/25'
            : 'border-slate-200 bg-white text-slate-700 hover:shadow-md'}`}
      >
        <div className="[transform:translateZ(20px)] flex items-center gap-3">
          <Icon className={`h-5 w-5 shrink-0 ${primary ? 'text-white/90' : 'text-slate-400'}`} />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{title}</span>
            <span className={`block text-xs ${primary ? 'text-white/70' : 'text-slate-400'}`}>
              {description}
            </span>
          </span>
          <ArrowRight className={`ml-auto h-4 w-4 shrink-0 ${primary ? 'text-white/70' : 'text-slate-300'}`} />
        </div>
      </button>
    </div>
  )
}

// ── Screen --------------------------------------------------------------------

export default function SuperAdminHome({ user, onChangePassword }) {
  const [companies, setCompanies] = useState(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    // include_inactive: the count of what is switched off is part of the
    // picture, and asking twice for it would be two requests for one answer.
    fetchCompanies(true)
      .then((rows) => { if (!cancelled) setCompanies(Array.isArray(rows) ? rows : []) })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [])

  const stats = useMemo(() => {
    const rows = companies || []
    const active = rows.filter((c) => c.is_active)
    return {
      total: rows.length,
      active: active.length,
      inactive: rows.length - active.length,
      accounts: rows.reduce((n, c) => n + (c.user_count || 0), 0),
      // A company with no accounts cannot be signed into by anyone. It is the
      // one state here that is actually waiting on the super admin.
      empty: active.filter((c) => !c.user_count),
      // The API already sorts by created_at DESC.
      recent: rows.slice(0, 4),
    }
  }, [companies])

  const greeting = useMemo(() => greetingFor(new Date()), [])
  const loading = companies === null && !error

  return (
    <div className="space-y-6">
      {/* Hero. The layered translateZ panes are the depth: a plate behind the
          text, lit by two soft radial washes, so the band reads as a surface
          rather than a coloured rectangle. */}
      <div className="[perspective:1400px]">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-850 to-slate-800 px-6 py-8 sm:px-10 sm:py-10 [transform-style:preserve-3d]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background:
                'radial-gradient(60% 90% at 12% 0%, rgba(37,99,235,0.35), transparent 60%),' +
                'radial-gradient(50% 80% at 95% 100%, rgba(59,130,246,0.22), transparent 65%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full border border-white/10 [transform:translateZ(-40px)]"
          />
          <div className="relative [transform:translateZ(40px)]">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-200 ring-1 ring-inset ring-white/15">
              <ServerCog className="h-3 w-3" />
              Super admin console
            </span>
            <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
              {greeting}, {user?.username}.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
              You administer the companies on this install. Their ledgers, imports and
              staff belong to their own people — which is why no company data appears
              here, and why nothing is missing from your account.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="card flex items-start gap-2 px-5 py-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Could not load the company registry — {error}</span>
        </div>
      )}

      {/* Skeletons rather than a spinner: the tiles keep their place, so the
          screen does not jump when the numbers arrive. */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card animate-pulse px-5 py-4">
              <div className="h-3 w-20 rounded bg-slate-100" />
              <div className="mt-3 h-8 w-16 rounded bg-slate-100" />
              <div className="mt-2 h-3 w-24 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Building2}
            label="Companies"
            value={stats.active}
            tone="primary"
            hint={stats.inactive ? `${stats.inactive} switched off` : 'all active'}
            onClick={() => navigate('/companies')}
          />
          <StatCard
            icon={Users}
            label="Accounts"
            value={stats.accounts}
            hint="across every company"
          />
          <StatCard
            icon={ShieldAlert}
            label="Need an admin"
            value={stats.empty.length}
            tone={stats.empty.length ? 'amber' : 'slate'}
            hint={stats.empty.length ? 'nobody can sign in yet' : 'every company is staffed'}
            onClick={stats.empty.length ? () => navigate('/companies') : undefined}
          />
          <StatCard
            icon={Clock}
            label="Registered"
            value={stats.total}
            hint={
              stats.recent[0]
                ? `newest ${timeAgo(stats.recent[0].created_at)}`
                : 'nothing yet'
            }
          />
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <ActionTile
          icon={Plus}
          primary
          title="Register a company"
          description="Create a tenant and its first admin"
          onClick={() => navigate('/companies', { state: { register: true } })}
        />
        <ActionTile
          icon={Building2}
          title="Manage companies"
          description="Codes, admins, activation, deletion"
          onClick={() => navigate('/companies')}
        />
        <ActionTile
          icon={KeyRound}
          title="Change your password"
          description="Signs you out when it is done"
          onClick={onChangePassword}
        />
      </div>

      {/* Named outright, because it is the one thing on this screen that is
          waiting on somebody: a company with no accounts is registered and
          unusable, and nothing else on the install will say so. */}
      {stats.empty.length > 0 && (
        <div className="card border-amber-200 bg-amber-50/60 px-5 py-4">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <ShieldAlert className="h-4 w-4" />
            {stats.empty.length === 1
              ? 'One company has no accounts yet'
              : `${stats.empty.length} companies have no accounts yet`}
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Nobody can sign in to {stats.empty.map((c) => c.name).join(', ')} until it
            has an admin. Add one from the Companies page.
          </p>
        </div>
      )}

      {stats.recent.length > 0 && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-700">Recently registered</h2>
            <button
              onClick={() => navigate('/companies')}
              className="text-xs font-medium text-primary-600 hover:text-primary-700"
            >
              View all
            </button>
          </div>
          <ul className="divide-y divide-slate-100">
            {stats.recent.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => navigate('/companies')}
                  className="flex w-full items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-slate-50"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 font-mono text-xs font-semibold uppercase text-primary-700">
                    {c.code || '—'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">
                      {c.name}
                    </span>
                    <span className="block text-xs text-slate-400">
                      {c.user_count === 1 ? '1 account' : `${c.user_count} accounts`}
                      {' · '}
                      {timeAgo(c.created_at)}
                      {c.created_by_username ? ` · by ${c.created_by_username}` : ''}
                    </span>
                  </span>
                  {!c.is_active && (
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      Inactive
                    </span>
                  )}
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Fresh install. There is exactly one useful thing to do and it is the
          button, so the empty state is the button. */}
      {!loading && !error && stats.total === 0 && (
        <div className="card px-6 py-10 text-center">
          <Building2 className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">No companies yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
            Register the first one and give it an admin — after that, they run their
            own ledger and you will not need to be in it.
          </p>
          <button
            onClick={() => navigate('/companies', { state: { register: true } })}
            className="btn-primary mt-4 text-sm"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Register a company
          </button>
        </div>
      )}
    </div>
  )
}
