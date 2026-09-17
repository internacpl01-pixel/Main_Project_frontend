import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, MANAGER } from '../context/AuthContext.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import ChangePasswordDialog from '../components/ChangePasswordDialog.jsx'
import UsersPage from './UsersPage.jsx'
import { KeyRound, LogOut } from 'lucide-react'

// Deliberately thin for now -- one account action, laid out the way every
// other platform's Settings page is so the next thing added here (company
// preferences, notification options, whatever comes up) has an obvious home
// instead of getting bolted onto a page it doesn't belong on.
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
      <div className="max-w-2xl">
        <PageHeader
          title="Settings"
          description="Account settings for the account you're signed in as."
        />

        <div className="card">
          <div className="card-body divide-y divide-slate-100">
            <div className="flex items-center justify-between py-3 first:pt-0">
              <div>
                <p className="text-sm font-medium text-slate-900">{user?.username}</p>
                <p className="text-xs text-slate-500">{user?.roleLabel || user?.role}</p>
              </div>
            </div>

            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                  <KeyRound className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">Change password</p>
                  <p className="text-xs text-slate-500">Update the password for this account.</p>
                </div>
              </div>
              <button onClick={() => setPasswordOpen(true)} className="btn-secondary shrink-0">
                Change
              </button>
            </div>

            <div className="flex items-center justify-between py-3 last:pb-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                  <LogOut className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">Sign out</p>
                  <p className="text-xs text-slate-500">Ends this session on this device.</p>
                </div>
              </div>
              <button onClick={handleLogout} className="btn-danger shrink-0">
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Same page as the standalone /users route, embedded here too --
          Manager+ only, matching that route's own guard, so this section
          simply doesn't render for anyone the API would 403 anyway. */}
      {hasLevel(MANAGER) && (
        <div className="mt-10 pt-8 border-t border-slate-200">
          <UsersPage />
        </div>
      )}

      <ChangePasswordDialog
        isOpen={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onChanged={() => { setPasswordOpen(false); handleLogout() }}
      />
    </div>
  )
}
