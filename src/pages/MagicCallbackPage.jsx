import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertCircle } from 'lucide-react'
import { Spinner } from '../components/UI.jsx'
import { useAuth } from '../context/AuthContext.jsx'

// Where a clicked magic link lands (see backend/services/supabase_auth.py's
// FRONTEND_URL + '/auth/callback', and config.py's own note on why it has to
// match this exact path). Supabase puts the session it minted in the URL's
// hash fragment, not a query string or the request body — a fragment never
// leaves the browser (it isn't sent to any server, including this app's own),
// which is exactly why Supabase chose it for a one-time credential.
//
// Not wrapped in ProtectedRoute in App.jsx: whoever lands here is, by
// definition, not signed in to this app yet — that is the whole point of the
// link they just clicked.
export default function MagicCallbackPage() {
  const [error, setError] = useState('')
  const { signInWithMagicLink } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const accessToken = hash.get('access_token')
    // Supabase's own shape for an expired/already-used link, e.g.
    // "#error=access_denied&error_code=otp_expired&error_description=...".
    const supabaseError = hash.get('error_description') || hash.get('error')

    if (supabaseError) {
      setError(decodeURIComponent(supabaseError.replace(/\+/g, ' ')))
      return
    }
    if (!accessToken) {
      setError('This link is missing its sign-in token. Request a new one from the login page.')
      return
    }

    signInWithMagicLink(accessToken)
      .then(() => {
        toast.success('Welcome back!')
        navigate('/')
      })
      .catch((err) => {
        // routers.auth.exchange_magic_link's own message — either "invalid
        // or expired" (Supabase's verdict) or "no account here is linked to
        // that email" (this app's own, the same refusal google_login gives).
        setError(err.message || 'Could not sign you in with that link.')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <div className="w-full max-w-md">
        <div className="card">
          <div className="card-body text-center space-y-4">
            {error ? (
              <>
                <AlertCircle className="mx-auto h-10 w-10 text-red-500" />
                <p className="text-sm font-medium text-slate-800">Could not sign you in</p>
                <p className="text-sm text-slate-500">{error}</p>
                <Link to="/login" className="btn-primary inline-flex py-2.5 px-5">
                  Back to login
                </Link>
              </>
            ) : (
              <>
                <Spinner size="lg" />
                <p className="text-sm text-slate-500">Signing you in...</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
