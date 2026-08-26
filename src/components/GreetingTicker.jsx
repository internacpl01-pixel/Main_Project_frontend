/**
 * The rotating greeting in the middle of the header bar.
 *
 * Two lines that take turns: "Good morning, amb-admin", then "Welcome —
 * AMBITION COLONISERS PRIVATE LIMITED". Each one rotates away on the X axis as
 * the next rotates up into its place, like the faces of a drum.
 *
 * The 3D is done with rotateX on a perspective container rather than with a
 * library. Two transforms and an opacity is the whole effect, it costs nothing
 * at runtime because the browser composites it on the GPU, and there is no
 * dependency to keep up to date for a piece of decoration.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Sun, Sunrise, Moon } from 'lucide-react'

// How long each line is held, and how long the turn between them takes. The
// hold is deliberately long: this sits in a header on every screen, and text
// that changes every second in the corner of your eye is something you end up
// wanting to cover with your hand.
const HOLD_MS = 5000
const TURN_MS = 700

function partOfDay(hour) {
  if (hour < 12) return { greeting: 'Good morning', Icon: Sunrise }
  if (hour < 17) return { greeting: 'Good afternoon', Icon: Sun }
  return { greeting: 'Good evening', Icon: Moon }
}

export function GreetingTicker({ username, companyName }) {
  // Re-read on every turn, so a screen left open across noon stops saying
  // "Good morning" at half past one.
  const [hour, setHour] = useState(() => new Date().getHours())
  const [index, setIndex] = useState(0)
  const [leaving, setLeaving] = useState(-1)
  const cursor = useRef(0)
  const resetTimer = useRef(null)

  // An animation nobody asked for is exactly what this setting is for, so when
  // it is on the lines cross-fade in place with no movement at all.
  const [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const { greeting, Icon } = partOfDay(hour)

  // A super admin belongs to no company, so there is no second line to show and
  // nothing to rotate. One line simply sits there.
  const lines = useMemo(() => {
    const out = [
      <>
        <span className="text-slate-500">{greeting},</span>{' '}
        <span className="font-medium text-slate-800">{username}</span>
      </>,
    ]
    if (companyName) {
      out.push(
        <>
          <span className="text-slate-500">Welcome to</span>{' '}
          <span className="font-medium text-primary-700">{companyName}</span>
        </>
      )
    }
    return out
  }, [greeting, username, companyName])

  useEffect(() => {
    if (lines.length < 2) return undefined
    const timer = setInterval(() => {
      // The index is tracked in a ref as well as in state because the tick has
      // to know the current one to mark it as leaving, and reading it from
      // state inside the interval would close over the value it had when the
      // interval was created.
      setLeaving(cursor.current)
      cursor.current = (cursor.current + 1) % lines.length
      setIndex(cursor.current)
      setHour(new Date().getHours())
      // Once the turn has finished, the line that left stops being "above" and
      // goes back to waiting below. Without this it would still be above when
      // its turn came round again, so it would drop in from the top while the
      // outgoing line rose past it — two lines crossing rather than a drum
      // rolling one way. The move itself is not animated (see faceOf) and
      // happens at zero opacity, so nothing is visible.
      resetTimer.current = setTimeout(() => setLeaving(-1), TURN_MS)
    }, HOLD_MS)
    return () => { clearInterval(timer); clearTimeout(resetTimer.current) }
  }, [lines.length])

  // Where each line sits on the drum: the current one facing forward, the one
  // it replaced tipped away over the top, everything else waiting underneath.
  const faceOf = (i) => {
    if (reducedMotion) {
      return { opacity: i === index ? 1 : 0, transition: `opacity ${TURN_MS}ms ease` }
    }
    // Three places on the drum: facing you, tipped away over the top, or
    // waiting underneath.
    const current = i === index
    const above = i === leaving
    const transform =
      current ? 'rotateX(0deg) translateY(0)'
        : above ? 'rotateX(90deg) translateY(-60%)'
          : 'rotateX(-90deg) translateY(60%)'
    return {
      transform,
      opacity: current ? 1 : 0,
      // Only the two lines taking part in this turn animate. A line waiting
      // underneath is repositioned, not moved: animating it would spend 700ms
      // rotating an invisible element back through the front of the drum.
      transition: current || above
        ? `transform ${TURN_MS}ms cubic-bezier(.2,.8,.25,1), opacity ${TURN_MS}ms ease`
        : 'none',
      backfaceVisibility: 'hidden',
    }
  }

  return (
    <div className="flex items-center gap-2 select-none">
      <Icon className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />

      {/* Read once, in full, instead of being announced again every five
          seconds as it turns. */}
      <span className="sr-only">
        {greeting}, {username}
        {companyName ? `. Welcome to ${companyName}.` : '.'}
      </span>

      <div
        aria-hidden="true"
        className="relative h-5 min-w-[16rem] max-w-[34rem] overflow-hidden text-sm leading-5"
        style={{ perspective: '420px' }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            className="absolute inset-0 flex items-center justify-center whitespace-nowrap"
            style={faceOf(i)}
          >
            <span className="truncate">{line}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
