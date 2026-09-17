import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, MANAGER } from '../context/AuthContext.jsx'
import ChangePasswordDialog from '../components/ChangePasswordDialog.jsx'
import UsersPage from './UsersPage.jsx'
import { KeyRound, LogOut, ChevronRight, Building2, Users as UsersIcon } from 'lucide-react'

// Mirrors UsersPage's own ROLE_BADGES -- kept as a small local copy rather
// than exported and shared, since this is the only other place a role shows
// as a standalone badge rather than inside that page's table.
const ROLE_BADGES = {
  super_admin: 'bg-purple-100 text-purple-700',
  company_admin: 'bg-primary-100 text-primary-700',
  manager: 'bg-amber-100 text-amber-700',
  staff: 'bg-slate-100 text-slate-600',
}

// A settings row: icon, title, description, and whatever control sits on the
// right (a button here, could as easily be a toggle later). Pulled out once
// three rows had started copying each other's markup by hand.
function SettingsRow({ icon, iconTone = 'slate', title, description, children }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-500',
    red: 'bg-red-50 text-red-600',
  }
  return (
    <div className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${tones[iconTone]}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">{title}</p>
          <p className="text-xs text-slate-500 truncate">{description}</p>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

// Deliberately thin on individual settings for now -- laid out the way every
// other platform's Settings page is (a profile header, then grouped
// sections under small uppercase labels) so the next thing added here
// (company preferences, notification options, whatever comes up) has an
// obvious home instead of getting bolted onto a page it doesn't belong on.
export default function SettingsPage() {
  const { user, signOut, hasLevel } = useAuth()
  const navigate = useNavigate()
  const [passwordOpen, setPasswordOpen] = useState(false)

  const handleLogout = () => {
    signOut()
    navigate('/login')
  }

  return (
    <div>
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold text-slate-900 mb-1">Settings</h1>
        <p className="text-sm text-slate-500 mb-6">
          Manage your account{hasLevel(MANAGER) ? ' and your company’s team' : ''}.
        </p>

        {/* Profile header -- a soft gradient card rather than another plain
            list row, so the page opens with something that actually looks
            like a Settings page rather than a form. */}
        <div className="relative overflow-hidden rounded-2xl border border-primary-100
                        bg-gradient-to-br from-primary-50 via-white to-white p-6 mb-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full
                      bg-primary-100/60 blur-2xl"
          />
          <div className="relative flex flex-wrap items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-primary-600 text-white flex items-center
                            justify-center text-2xl font-semibold shrink-0 shadow-sm">
              {user?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-900 truncate">{user?.username}</h2>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                  ROLE_BADGES[user?.role] || ROLE_BADGES.staff
                }`}>
                  {user?.roleLabel || user?.role}
                </span>
              </div>
              {user?.companyName && (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                  <Building2 className="h-3.5 w-3.5 text-slate-400" />
                  {user.companyName}
                  <span className="text-slate-300">·</span>
                  <span className="font-mono text-xs">{user.schema}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Account */}
        <p className="px-1 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Account
        </p>
        <div className="card mb-8">
          <div className="card-body divide-y divide-slate-100">
            <SettingsRow
              icon={<KeyRound className="h-4 w-4" />}
              title="Change password"
              description="Update the password for this account."
            >
              <button onClick={() => setPasswordOpen(true)} className="btn-secondary">
                Change
              </button>
            </SettingsRow>

            <SettingsRow
              icon={<LogOut className="h-4 w-4" />}
              iconTone="red"
              title="Sign out"
              description="Ends this session on this device."
            >
              <button onClick={handleLogout} className="btn-danger">
                Sign out
              </button>
            </SettingsRow>
          </div>
        </div>
      </div>

      {/* Team -- same UsersPage as the standalone /users route, embedded
          here too. Full width, unlike the account section above: its table
          wants the room. Manager+ only, matching that route's own guard, so
          this section simply doesn't render for anyone the API would 403
          anyway. */}
      {hasLevel(MANAGER) && (
        <>
          <div className="px-1 mb-2 flex items-center gap-2 text-xs font-semibold
                          uppercase tracking-wide text-slate-400">
            <UsersIcon className="h-3.5 w-3.5" />
            Team
            <ChevronRight className="h-3 w-3 text-slate-300" />
          </div>
          <UsersPage />
        </>
      )}

      <ChangePasswordDialog
        isOpen={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onChanged={() => { setPasswordOpen(false); handleLogout() }}
      />
    </div>
  )
}
