import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Lock, User, AlertCircle, Mail, KeyRound, ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import { Spinner, PasswordInput } from '../components/UI.jsx'
import { requestOtp } from '../api/endpoints.js'

// Vite only loads a var prefixed 'VITE_' (or 'API_', see vite.config.js) into
// import.meta.env — same rule API_BASE_URL already follows. Public on
// purpose: a Google OAuth Client ID identifies which app is asking, not a
// secret Google trusts to prove anything on its own (unlike DRIVE_CREDENTIALS
// _PATH's client, which is a Desktop-app credential used server-side).
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

// Which screen is showing. 'password' is where every session starts —
// Google's button and the "sign in with a code" link both live below the
// password form rather than replacing it, so nobody who has always typed a
// password has to learn a new page just to keep doing that.
const MODE = { PASSWORD: 'password', OTP_REQUEST: 'otp_request', OTP_VERIFY: 'otp_verify' }

export default function LoginPage() {
  const [mode, setMode] = useState(MODE.PASSWORD)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const { signIn, signInWithGoogle, signInWithOtp } = useAuth()
  const navigate = useNavigate()
  const googleButtonRef = useRef(null)

  // Google Identity Services' own script, loaded once. Not bundled with npm —
  // Google serves it live so a token-format change on their end doesn't need
  // a redeploy here, the same reason a payment provider's own JS is always
  // loaded from their CDN rather than vendored.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return undefined
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => {
      if (!window.google || !googleButtonRef.current) return
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          setError('')
          setLoading(true)
          try {
            await signInWithGoogle(credential)
            toast.success('Welcome back!')
            navigate('/')
          } catch (err) {
            // The backend's own "no account here is linked to that email" /
            // "ask your admin" message, shown verbatim — there is nothing to
            // add to it from this side.
            setError(err.message || 'Google sign-in failed')
          } finally {
            setLoading(false)
          }
        },
      })
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'outline', size: 'large', width: 336, text: 'signin_with',
      })
    }
    document.body.appendChild(script)
    return () => { document.body.removeChild(script) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The resend cooldown countdown, purely cosmetic — the real limit is
  // enforced server-side (services/otp.py's Cooldown) and this just stops
  // someone clicking "send another" a second time before that response
  // arrives.
  useEffect(() => {
    if (resendIn <= 0) return undefined
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  const handlePasswordSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(username, password)
      toast.success('Welcome back!')
      navigate('/')
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleRequestCode = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await requestOtp(email)
      toast.success('If that email has an account, a code is on its way.')
      setMode(MODE.OTP_VERIFY)
      setResendIn(60)
    } catch (err) {
      // The one case the backend is honest about — see routers/auth.py's
      // request_otp — is a resend that came in before the cooldown expired.
      // Everything else about whether the email matched an account stays
      // generic, on purpose.
      setError(err.message || 'Could not send a code')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyCode = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signInWithOtp(email, code)
      toast.success('Welcome back!')
      navigate('/')
    } catch (err) {
      setError(err.message || 'Wrong or expired code')
    } finally {
      setLoading(false)
    }
  }

  const backToPassword = () => {
    setMode(MODE.PASSWORD)
    setError('')
    setEmail('')
    setCode('')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-xl bg-primary-600 text-white text-2xl font-bold mb-4">
            L
          </div>
          <h1 className="text-2xl font-bold text-white">Ledger</h1>
          <p className="text-slate-400 mt-1 text-sm">Sign in to your account</p>
        </div>

        <div className="card">
          <div className="card-body">
            {error && (
              <div className="mb-5 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {mode === MODE.PASSWORD && (
              <>
                <form onSubmit={handlePasswordSubmit} className="space-y-5">
                  <div>
                    <label className="label">Username</label>
                    <div className="relative">
                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                        <User className="h-4 w-4 text-slate-400" />
                      </div>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="input pl-9"
                        placeholder="Enter username"
                        required
                        autoFocus
                      />
                    </div>
                  </div>

                  <div>
                    <label className="label">Password</label>
                    {/* current-password, not the component's new-password default:
                        this is the one field where a password manager should offer
                        what it already has rather than suggest a new one. */}
                    <PasswordInput
                      value={password}
                      onChange={setPassword}
                      autoComplete="current-password"
                      icon={<Lock className="h-4 w-4" />}
                      placeholder="Enter password"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full py-2.5"
                  >
                    {/* tone="white": this sits on a primary-600 button, and the
                        spinner's own primary-600 made it invisible. */}
                    {loading ? <Spinner size="sm" tone="white" className="mr-2" /> : null}
                    {loading ? 'Signing in...' : 'Sign In'}
                  </button>
                </form>

                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={() => { setMode(MODE.OTP_REQUEST); setError('') }}
                    className="text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    Sign in with a code instead
                  </button>
                </div>

                {/* Absent entirely when GOOGLE_CLIENT_ID is blank, rather than a
                    disabled button with no explanation — a company that never
                    sets this up should see a login page indistinguishable from
                    before this feature existed. */}
                {GOOGLE_CLIENT_ID && (
                  <div className="mt-5">
                    <div className="relative my-4">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-slate-200" />
                      </div>
                      <div className="relative flex justify-center text-xs">
                        <span className="bg-white px-2 text-slate-400">or</span>
                      </div>
                    </div>
                    <div ref={googleButtonRef} className="flex justify-center" />
                  </div>
                )}
              </>
            )}

            {mode === MODE.OTP_REQUEST && (
              <form onSubmit={handleRequestCode} className="space-y-5">
                <p className="text-sm text-slate-500">
                  Enter the email linked to your account and we'll send a
                  one-time code to sign in with — no password needed.
                </p>
                <div>
                  <label className="label">Email</label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <Mail className="h-4 w-4 text-slate-400" />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="input pl-9"
                      placeholder="you@company.com"
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
                  {loading ? <Spinner size="sm" tone="white" className="mr-2" /> : null}
                  {loading ? 'Sending...' : 'Send code'}
                </button>
                <button
                  type="button"
                  onClick={backToPassword}
                  className="flex w-full items-center justify-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to password
                </button>
              </form>
            )}

            {mode === MODE.OTP_VERIFY && (
              <form onSubmit={handleVerifyCode} className="space-y-5">
                <p className="text-sm text-slate-500">
                  Enter the 6-digit code sent to <span className="font-medium text-slate-700">{email}</span>.
                </p>
                <div>
                  <label className="label">Code</label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <KeyRound className="h-4 w-4 text-slate-400" />
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="input pl-9 tracking-widest"
                      placeholder="000000"
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <button type="submit" disabled={loading || code.length !== 6} className="btn-primary w-full py-2.5">
                  {loading ? <Spinner size="sm" tone="white" className="mr-2" /> : null}
                  {loading ? 'Verifying...' : 'Verify and sign in'}
                </button>
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={backToPassword}
                    className="flex items-center gap-1.5 font-medium text-slate-500 hover:text-slate-700"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to password
                  </button>
                  <button
                    type="button"
                    disabled={resendIn > 0 || loading}
                    onClick={handleRequestCode}
                    className="font-medium text-primary-600 hover:text-primary-700 disabled:text-slate-400 disabled:cursor-not-allowed"
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
        <p className="text-center text-xs text-slate-500 mt-6">
          Company Ledger API v0.1.0
        </p>
      </div>
    </div>
  )
}
