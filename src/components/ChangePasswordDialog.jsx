import { useState } from 'react'
import { changePassword } from '../api/endpoints.js'
import { Modal, PasswordInput } from './UI.jsx'
import toast from 'react-hot-toast'
import { AlertCircle } from 'lucide-react'

// Mirrors accounts.MIN_PASSWORD_LENGTH. Checked here only to say so before the
// round trip — the server applies the same rule and its answer is the one that
// counts.
const MIN_LENGTH = 4

// Change your own password.
//
// Reachable from the profile menu by everyone, and it is the only route a super
// admin has to their own account at all: admin.users holds their row with no
// company, and the Users page edits by company_id.
//
// The current password is asked for because being signed in is not proof of
// identity — a machine left open would otherwise be enough to take the account.
// It is confirmed twice because it is write-only: nothing on this app can read
// a password back, so a typo here is a lockout, not an inconvenience.
export default function ChangePasswordDialog({ isOpen, onClose, onChanged }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const close = () => {
    setCurrent(''); setNext(''); setConfirm(''); setError(''); setSaving(false)
    onClose()
  }

  // Reported under the field rather than as a toast: it is about what is on
  // screen, and a toast disappears while the mistake stays.
  const mismatch = confirm.length > 0 && next !== confirm
  const tooShort = next.length > 0 && next.length < MIN_LENGTH
  const unchanged = next.length > 0 && next === current
  const ready = current && next && confirm && !mismatch && !tooShort && !unchanged

  const submit = async () => {
    if (!ready) return
    setSaving(true)
    setError('')
    try {
      await changePassword(current, next)
      toast.success('Password changed — sign in again with the new one')
      // Signed out on purpose. The token is stateless, so the old one keeps
      // working until it expires; signing out is what makes "I changed my
      // password" mean what people expect it to mean on this device at least.
      onChanged()
    } catch (err) {
      setError(err.message || 'The password could not be changed.')
      setSaving(false)
    }
  }

  const onKeyDown = (e) => { if (e.key === 'Enter' && ready && !saving) submit() }

  return (
    <Modal isOpen={isOpen} onClose={close} title="Change Password" size="sm">
      <div className="space-y-4">
        <div>
          <label className="label">Current Password</label>
          <PasswordInput
            value={current}
            onChange={(v) => { setCurrent(v); setError('') }}
            onKeyDown={onKeyDown}
            autoComplete="current-password"
            placeholder="The one you signed in with"
            invalid={!!error}
          />
        </div>

        <div>
          <label className="label">New Password</label>
          <PasswordInput
            value={next}
            onChange={setNext}
            onKeyDown={onKeyDown}
            placeholder={`At least ${MIN_LENGTH} characters`}
            invalid={tooShort || unchanged}
          />
          {tooShort && (
            <p className="mt-1 text-xs text-red-600">
              Must be at least {MIN_LENGTH} characters.
            </p>
          )}
          {unchanged && (
            <p className="mt-1 text-xs text-red-600">
              This is the password you already have.
            </p>
          )}
        </div>

        <div>
          <label className="label">Confirm New Password</label>
          <PasswordInput
            value={confirm}
            onChange={setConfirm}
            onKeyDown={onKeyDown}
            placeholder="Type it again"
            invalid={mismatch}
          />
          {mismatch && (
            <p className="mt-1 text-xs text-red-600">The two do not match.</p>
          )}
        </div>

        {error && (
          <p className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        {/* Said before it happens, not after. Anyone else signed in as this
            account stays signed in until their token expires — there is no
            blacklist, so there is nothing here that can cut them off. */}
        <p className="text-xs text-slate-500">
          You will be signed out and will need to sign in again. Any other device
          already signed in as this account stays signed in until its session
          expires.
        </p>

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={close} className="btn-secondary text-sm">Cancel</button>
          <button
            onClick={submit}
            disabled={!ready || saving}
            className="btn-primary text-sm"
          >
            {saving ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
