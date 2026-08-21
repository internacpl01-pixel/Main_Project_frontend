import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Lock, User, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { Spinner, PasswordInput } from '../components/UI.jsx'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
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
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  {error}
                </div>
              )}

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
                {loading ? <Spinner size="sm" className="mr-2" /> : null}
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          </div>
        </div>
        <p className="text-center text-xs text-slate-500 mt-6">
          Company Ledger API v0.1.0
        </p>
      </div>
    </div>
  )
}
