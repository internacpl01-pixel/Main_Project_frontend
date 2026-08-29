import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

// A default deadline, so a request to a backend that has stopped answering
// fails with a sentence instead of hanging on the browser's own timeout, which
// is minutes long and shows the user nothing at all in the meantime. Imports
// override it — parsing a long statement legitimately takes longer than this.
export const DEFAULT_TIMEOUT_MS = 30000

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: DEFAULT_TIMEOUT_MS,
})

/**
 * How many requests are in flight right now.
 *
 * Kept here rather than in a page, because this file is the one place every
 * request already passes through — a counter anywhere else would only know
 * about the calls that remembered to tell it. The global progress indicator
 * reads this, so any screen gets "the app is working" for free, including
 * screens written after it.
 *
 * A plain module counter plus a listener set: React 18's useSyncExternalStore
 * subscribes to exactly this shape, so there is no store library and no
 * provider to thread through the tree.
 */
let inFlight = 0
const busyListeners = new Set()
const emitBusy = () => busyListeners.forEach((fn) => fn())

export function subscribeBusy(fn) {
  busyListeners.add(fn)
  return () => busyListeners.delete(fn)
}

export function busyCount() {
  return inFlight
}

// Counting has to be symmetrical or the indicator never switches off, so every
// path that can start a request pairs with a path that can end one — including
// the request interceptor's own error arm, which fires when a request is
// rejected before it is ever sent.
const startedBusy = (config) => {
  if (config?.silent) return
  inFlight += 1
  emitBusy()
}

const finishedBusy = (config) => {
  if (config?.silent) return
  inFlight = Math.max(0, inFlight - 1)
  emitBusy()
}

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    startedBusy(config)
    return config
  },
  (error) => {
    finishedBusy(error?.config)
    return Promise.reject(error)
  }
)

/**
 * Turn any FastAPI error payload into a readable sentence.
 *
 * `detail` has three shapes and the old code assumed it was always a string:
 *
 *   422 validation -> [{loc:["body","username"], msg:"Field required"}, ...]
 *   HTTPException  -> "Wrong username or password."
 *   409 duplicate  -> {message:"...", existing_batch: 4}
 *
 * Passing the array straight to `new Error()` stringified it, which is where
 * "[object Object],[object Object]" on the login screen came from. Each entry
 * is turned into "field: message" instead, so a validation failure names the
 * field that actually failed.
 */
function describeError(error) {
  // No response at all: the request never reached the server, or the server
  // never answered. axios reports both as the bare string "Network Error",
  // which reads like the user did something wrong. Say what actually happened
  // and what to do about it — a long import is the usual cause here, and the
  // worst outcome is someone re-uploading a statement that did land.
  if (!error.response) {
    if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')) {
      return (
        'The server did not respond in time. A large statement can take several ' +
        'minutes to parse — open the Imports list to check whether it was saved ' +
        'before uploading it again.'
      )
    }
    return (
      'Cannot reach the server. It may be restarting, or busy parsing a large ' +
      'statement. Wait a moment and try again.'
    )
  }

  const detail = error.response?.data?.detail

  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        // loc is like ["body","username"]; drop the location prefix.
        const field = Array.isArray(d.loc) ? d.loc.slice(1).join('.') : ''
        return field ? `${field}: ${d.msg}` : d.msg
      })
      .filter(Boolean)
      .join('; ')
  }

  if (detail && typeof detail === 'object') {
    return detail.message || JSON.stringify(detail)
  }

  if (typeof detail === 'string') return detail
  if (typeof error.response?.data === 'string') return error.response.data

  return error.response?.data?.message || error.message || 'Something went wrong'
}

api.interceptors.response.use(
  (response) => {
    finishedBusy(response.config)
    return response
  },
  (error) => {
    // Before anything else, and in this arm as well as the other one: a failed
    // request is a finished request, and an indicator that only counted the
    // successes would stay lit forever the first time the server went away.
    finishedBusy(error?.config)
    // Handle 401 — token expired or invalid.
    // Only bounce to /login when we are not already there, otherwise a failed
    // login reloads the page and wipes the error message before it can be read.
    if (error.response?.status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem('access_token')
      localStorage.removeItem('role')
      localStorage.removeItem('schema')
      localStorage.removeItem('username')
      window.location.href = '/login'
    }
    const err = new Error(describeError(error))
    err.status = error.response?.status
    err.payload = error.response?.data
    return Promise.reject(err)
  }
)

export default api
