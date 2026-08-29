/**
 * The full-screen step list shown while a statement is being imported.
 *
 * An import is the longest wait in this app — minutes on a long PDF — and a
 * single bar creeping across the screen says only "still going". This says what
 * is actually happening, one line at a time, and ticks each line off as the
 * server finishes it.
 *
 * EVERY STEP IS REAL. Nothing here is on a timer and nothing is invented to
 * fill the silence: the lines come from the job the server is running, and a
 * step goes green when that work has actually finished. The batch and sheet
 * lines are named by the server too — "pages 21-40", or the workbook's own tab
 * name — so a four-batch PDF shows four lines and an eight-sheet workbook shows
 * eight. A file that parses in one pass gets one line, correctly.
 *
 * The list scrolls so the step being worked on stays in the same place, and the
 * lines above and below it fade out at the edges. That movement is the point:
 * the screen is visibly alive for the whole wait, which is the difference
 * between "this is working" and "this has hung".
 */
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'

// One step's slot, in px. Fixed rather than measured: the list is translated by
// a multiple of it, and a measured height would have to be re-read on every
// label change — which is every step. Tall enough for a label plus the bar
// under the step in progress, and no taller.
const ROW_HEIGHT = 58
// Which slot the step in progress occupies. 1 rather than 0 leaves a finished
// line visible above it, which is what makes the list read as a list being
// worked through rather than a label being replaced.
const ACTIVE_SLOT = 1
// Three: the one just finished, the one running, the one next. A fourth only
// ever showed a dimmed line nobody reads and made the card taller than the
// thing it is describing.
const VISIBLE_ROWS = 3

/**
 * The step list for a job, from what the server has actually reported.
 *
 * `sawProbe` is remembered by the caller because the header-page read is only
 * described while it is running — dropping the line the moment it finished
 * would shorten the list under the user and jerk everything up a row.
 */
function buildSteps({ fileName, uploadPct, progress, stepWord, sawProbe }) {
  const state = progress?.state
  const steps = []

  // 1 — the browser's half of the wait. Measured here, not reported: until the
  // last byte lands the server has nothing to say about this file at all.
  steps.push({
    key: 'upload',
    label: `Uploading ${fileName}`,
    status: uploadPct !== null ? 'active' : 'done',
    percent: uploadPct !== null ? uploadPct : null,
  })

  // 2 — the file has arrived and the job exists, but the parse has not begun.
  // Usually a blink; on a busy server it is where the time goes, and a blank
  // screen for it is exactly what this component exists to remove.
  steps.push({
    key: 'queued',
    label: 'Handing it to the parser',
    status: uploadPct !== null
      ? 'pending'
      : (!state || state === 'queued') ? 'active' : 'done',
  })

  // 3 — page 1 read on its own for the column header, which only happens on a
  // batched run. Shown only once the server has said it is doing it.
  if (sawProbe) {
    steps.push({
      key: 'probe',
      label: 'Reading page 1 for its column header',
      status: state === 'parsing' && progress.batch_index === 0 ? 'active' : 'done',
      percent: state === 'parsing' && progress.batch_index === 0
        ? progress.percent : null,
    })
  }

  // 4 — one line per batch of pages, or per sheet of a workbook. How many, and
  // what each is called, is the server's answer and not a guess made here.
  const total = Math.max(1, progress?.batch_total || 1)
  const finished = new Map((progress?.batches_done || []).map((b) => [b.index, b]))
  // Saving counts as still being on this step for a workbook, where each sheet
  // is written before the next is read.
  const working = state === 'parsing' || state === 'saving'

  for (let i = 1; i <= total; i++) {
    const done = finished.get(i)
    const current = working && progress.batch_index === i && !done
    steps.push({
      key: `step-${i}`,
      label: done
        ? `Read ${done.label}`
        : current
          ? (state === 'saving'
              ? progress.message
              : `Reading ${progress.batch_label || `${stepWord.toLowerCase()} ${i}`}`)
          : `${stepWord} ${i} of ${total}`,
      detail: done
        ? `${Number(done.rows).toLocaleString('en-IN')} ${done.rows === 1 ? 'row' : 'rows'}`
        : null,
      status: done ? 'done' : current ? 'active' : 'pending',
      percent: current ? progress.percent : null,
    })
  }

  // 5 — the single write at the end of a PDF import. A workbook saves inside
  // each sheet's step instead, so this line is added only when the server is
  // actually on it: appending below the active step moves nothing on screen.
  const savingAtTheEnd = state === 'saving' && finished.has(progress.batch_index)
  if (savingAtTheEnd || state === 'done') {
    steps.push({
      key: 'saving',
      label: state === 'done'
        ? 'Saved to your table'
        : (progress.message || 'Saving rows to your table'),
      status: state === 'done' ? 'done' : 'active',
    })
  }

  return steps
}

/** The circle at the head of a step: filled tick, turning ring, or waiting. */
function StepMark({ status }) {
  if (status === 'done') {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full
                       bg-white shadow-[0_0_14px_rgba(255,255,255,0.3)]">
        <Check className="h-4 w-4 text-emerald-500" strokeWidth={3} />
      </span>
    )
  }
  if (status === 'active') {
    return (
      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-white/20" />
        {/* The turning arc — one white quarter over a faint ring. This is the
            moving circle: while it turns, the import is alive. */}
        <span className="absolute inset-0 rounded-full border-2 border-transparent
                         border-t-white animate-spin
                         motion-reduce:[animation-duration:2s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
      </span>
    )
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full
                     border-2 border-white/15">
      <Check className="h-3.5 w-3.5 text-white/20" strokeWidth={3} />
    </span>
  )
}

export default function ImportProgressOverlay({
  open, fileName, uploadPct, progress, stepWord = 'Batch',
}) {
  // The header-page read, remembered once seen — see buildSteps.
  const [sawProbe, setSawProbe] = useState(false)

  // Cleared at the start of every import, and again if the file changes under
  // it. Only clearing on close would be enough for the way this page drives it
  // today, but the flag is sticky by design — carried into the next import it
  // would put a line about reading page 1 above a workbook that has no pages.
  useEffect(() => { setSawProbe(false) }, [open, fileName])

  useEffect(() => {
    // state as well as index: a job sits at batch_index 0 while it is queued
    // too, and that is not the header page being read.
    if (progress?.state === 'parsing' && progress.batch_index === 0) setSawProbe(true)
  }, [progress?.state, progress?.batch_index])

  // Nothing behind this should scroll while it is up — it covers the window,
  // and a page moving underneath an overlay is the kind of thing you only
  // notice as a bug.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  if (!open) return null

  const steps = buildSteps({ fileName, uploadPct, progress, stepWord, sawProbe })
  const activeIndex = Math.max(0, steps.findIndex((s) => s.status === 'active'))
  const offset = -(activeIndex - ACTIVE_SLOT) * ROW_HEIGHT

  const overall = uploadPct !== null
    ? null
    : progress?.batch_total > 1 ? progress.overall_percent : progress?.percent
  const elapsed = progress?.elapsed_ms >= 1000
    ? `${Math.round(progress.elapsed_ms / 1000)}s`
    : null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center
                 bg-slate-900/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Importing your statement"
    >
      {/* The list itself is a picture of progress; this is the same thing said
          once, so a screen reader announces each step as it starts rather than
          re-reading every line each time one of them changes. */}
      <p className="sr-only" role="status" aria-live="polite">
        {steps[activeIndex]?.label || 'Importing'}
      </p>

      {/* A card, not the whole window. Filling the screen with three lines of
          text left an acre of empty navy around them and made a working import
          look like the app had fallen over into some other mode. The page stays
          visible and dimmed behind, which is what every other dialog here does
          — this one just cannot be dismissed. */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl
                      border border-white/10 shadow-2xl
                      bg-gradient-to-br from-slate-900 via-slate-900 to-primary-900">
        {/* A soft light inside the card, so it reads as lit rather than as a
            flat rectangle. Purely decorative and never in the way. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(28rem 14rem at 50% 30%, rgba(59,130,246,0.18), transparent 70%)',
          }}
        />

        <div className="relative px-6 pt-5 pb-4">
          {/* Which file, said once at the top. It is true for the whole import,
              so it does not belong in a list of things that finish. */}
          <p className="truncate text-xs font-medium text-white/50" title={fileName}>
            {fileName}
          </p>
        </div>

        {/* The window the list scrolls through. The mask is what makes the step
            above and the step below fade rather than being cut off at an edge,
            which is what stops it looking like a clipped box. */}
        <div
          className="relative overflow-hidden px-6"
          style={{
            height: ROW_HEIGHT * VISIBLE_ROWS,
            maskImage:
              'linear-gradient(to bottom, transparent 0%, #000 24%, #000 74%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, transparent 0%, #000 24%, #000 74%, transparent 100%)',
          }}
        >
          {/* The travel is the whole point — it is what makes a four-minute
              parse look alive rather than stuck. Shortened under reduced
              motion rather than dropped: without any transition the list
              teleports a row at a time, which is the one reading worse than
              both. It is one row, once per finished step, and it is the thing
              the user is watching. */}
          <div
            className="transition-transform duration-500 ease-out motion-reduce:duration-200"
            style={{ transform: `translateY(${offset}px)` }}
          >
            {steps.map((step) => (
              <div
                key={step.key}
                style={{ height: ROW_HEIGHT }}
                className={`flex items-center gap-4 transition-opacity duration-500 ${
                  step.status === 'pending' ? 'opacity-45' : 'opacity-100'
                }`}
              >
                <StepMark status={step.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`truncate text-sm ${
                        step.status === 'active'
                          ? 'font-semibold text-white'
                          : step.status === 'done'
                            ? 'text-white/85'
                            : 'text-white/60'
                      }`}
                    >
                      {step.label}
                      {step.status !== 'done' && '...'}
                    </span>
                    {step.detail && (
                      <span className="shrink-0 text-xs text-white/45 tabular-nums">
                        {step.detail}
                      </span>
                    )}
                    {step.percent !== null && step.percent !== undefined && (
                      <span className="shrink-0 text-xs font-semibold text-white/70 tabular-nums">
                        {step.percent}%
                      </span>
                    )}
                  </div>
                  {/* A measured bar, only on the step being worked on. The
                      figure is the server's count of pages finished in this
                      batch, or the browser's count of bytes sent. */}
                  {step.status === 'active' && step.percent !== null
                    && step.percent !== undefined && (
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-white/80 transition-all duration-500 ease-out"
                        style={{ width: `${step.percent}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How far through the file, and the warning that matters. Under a rule
            rather than floating below the card, so the panel reads as one
            object instead of a list with captions drifting under it. */}
        <div className="relative border-t border-white/10 px-6 py-3">
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-white/45">
            {progress?.total_pages ? <span>{progress.total_pages} pages</span> : null}
            {overall !== null && overall !== undefined
              ? <span>· {overall}% of the file</span> : null}
            {elapsed ? <span>· {elapsed} elapsed</span> : null}
          </div>
          <p className="mt-1 text-xs text-white/30">
            Keep this tab open — closing it loses track of the import.
          </p>
        </div>
      </div>
    </div>
  )
}
