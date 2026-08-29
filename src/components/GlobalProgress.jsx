/**
 * The app-wide "something is happening" signal.
 *
 * Every screen here talks to a server that is a network hop away, and between
 * the click and the answer there was nothing on screen that moved. A page that
 * does not move is a page that looks broken, whatever it is actually doing.
 *
 * Two surfaces, one signal:
 *   - a stripe across the very top of the window, mounted outside the router so
 *     it covers the login screen and the session bootstrap as well as the app;
 *   - a small spinning circle in the header, next to the company name.
 *
 * Both are driven by the request counter in apiClient, so a screen written
 * tomorrow gets this without doing anything, and nothing here needs to know
 * which request is running or what page asked for it.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { subscribeBusy, busyCount } from '../api/apiClient.js'
import { Spinner } from './UI.jsx'

// Below this, do not show anything. Most reads on a warm connection answer in
// well under it, and a bar that appears and vanishes inside a quarter second
// reads as a glitch rather than as progress.
const SHOW_AFTER_MS = 200
// Once shown, stay for at least this long. Without it a request that answers
// just after the delay expired would flash the bar for a single frame.
const MIN_VISIBLE_MS = 400

/**
 * True while the app should be telling the user it is working.
 *
 * Exported because the header circle and the stripe are rendered in different
 * trees — Layout owns one, main.jsx owns the other — and both have to follow
 * the same two timers, or one of them contradicts the other on screen.
 */
export function useIsBusy() {
  const count = useSyncExternalStore(subscribeBusy, busyCount, () => 0)
  const busy = count > 0
  const [visible, setVisible] = useState(false)
  // When the bar actually appeared, so the minimum can be measured from it.
  const shownAt = useRef(0)

  useEffect(() => {
    let timer
    if (busy) {
      if (visible) return
      timer = setTimeout(() => {
        shownAt.current = Date.now()
        setVisible(true)
      }, SHOW_AFTER_MS)
    } else if (visible) {
      const left = MIN_VISIBLE_MS - (Date.now() - shownAt.current)
      if (left <= 0) setVisible(false)
      else timer = setTimeout(() => setVisible(false), left)
    }
    return () => clearTimeout(timer)
  }, [busy, visible])

  return visible
}

/** The header's spinning circle. Renders nothing when the app is idle. */
export function BusyDot({ className = '' }) {
  const busy = useIsBusy()
  if (!busy) return null
  return (
    <span
      title="Loading..."
      className={`inline-flex items-center transition-opacity duration-200 ${className}`}
    >
      <Spinner size="sm" />
    </span>
  )
}

/**
 * The stripe.
 *
 * Indeterminate, because none of these requests reports how far along it is —
 * a bar filling to 100% would be inventing a number, and the one screen that
 * has a real measurement (Import, which counts pages as the server finishes
 * them) draws its own bar with it.
 *
 * Under reduced motion the stripe stops travelling and breathes in place
 * instead. It is deliberately not switched off: this is feedback, not
 * decoration, and it is only on screen while the app is actually working —
 * what reduced motion is asking to be spared is movement across the screen,
 * which is exactly the part that is dropped.
 */
export default function GlobalProgress() {
  const busy = useIsBusy()

  return (
    <>
      {/* Always mounted so screen readers see a live region rather than a node
          appearing and disappearing under them. */}
      <span role="status" aria-live="polite" className="sr-only">
        {busy ? 'Loading' : ''}
      </span>

      {busy && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-primary-100"
        >
          <div className="h-full w-full bg-primary-600
                          motion-safe:animate-progress
                          motion-reduce:animate-progress-still" />
        </div>
      )}
    </>
  )
}
