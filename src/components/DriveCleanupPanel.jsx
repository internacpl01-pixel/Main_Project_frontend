import { useState } from 'react'
import { cleanupDriveDoneFiles } from '../api/endpoints.js'
import { ConfirmDialog } from './UI.jsx'
import toast from 'react-hot-toast'
import { Trash2, X } from 'lucide-react'

// A fixed list as a shortcut into the box beside it, not instead of it --
// "roughly how long" is what this figure ever means, but a person who wants
// exactly 45 days shouldn't have to round to one of these.
const CLEANUP_DAY_OPTIONS = [30, 60, 90, 180, 365]

/**
 * "Clean up old statements" — trashes every "_done" file in a Drive folder
 * whose OWN statement date (the yyyymmdd in its name, not when it happened
 * to be imported) is older than the given number of days.
 *
 * Lives here rather than inside DriveImportLogPage because it is now
 * reachable from two places: that page, where it sits beside the history of
 * what was imported, and Settings, where it sits beside the folders it acts
 * on. Two copies of a control that trashes real files would eventually
 * drift, and the copy someone hadn't looked at recently would be the one
 * with the weaker warning.
 *
 * `folders` are the saved extra folders (listDriveFolders). When there are
 * any, a folder selector appears; with none, this silently targets the
 * configured Gmail folder exactly as it did before extra folders existed.
 */
export default function DriveCleanupPanel({ onCancel, onDone, folders = [] }) {
  const [days, setDays] = useState('90')
  const [folderId, setFolderId] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const daysValid = /^\d+$/.test(days) && Number(days) >= 1
  const folderLabel = folderId
    ? (folders.find((f) => f.folder_id === folderId)?.label || 'that folder')
    : 'the Gmail statements folder'

  const run = async () => {
    setBusy(true)
    try {
      const res = await cleanupDriveDoneFiles(Number(days), folderId)
      setConfirmOpen(false)
      toast.success(res.count > 0
        ? `Moved ${res.count} old statement${res.count === 1 ? '' : 's'} to Drive's Trash`
        : `Nothing older than ${days} days to clean up`)
      onDone?.(res)
    } catch (err) {
      toast.error(err.message || 'Could not clean up the Drive folder')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="rounded-xl border border-primary-100 bg-gradient-to-br from-primary-50/60 to-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end gap-3">
            <div className="h-10 w-10 shrink-0 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <label className="label mb-1.5">
                Move &ldquo;Done&rdquo; statements older than
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={days}
                  onChange={(e) => setDays(e.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="90"
                  className={`input w-24 bg-white ${!daysValid ? 'border-red-300 focus:ring-red-200' : ''}`}
                />
                <span className="text-sm text-slate-600">days, or</span>
                <select
                  // Purely a shortcut into the input above -- it never holds
                  // a value of its own, so picking the same preset twice in a
                  // row still fires the change and updates `days` each time.
                  value=""
                  onChange={(e) => e.target.value && setDays(e.target.value)}
                  className="input w-36 bg-white"
                >
                  <option value="" disabled>Quick pick...</option>
                  {CLEANUP_DAY_OPTIONS.map((d) => (
                    <option key={d} value={d}>{d} days</option>
                  ))}
                </select>
                {folders.length > 0 && (
                  <>
                    <span className="text-sm text-slate-600">in</span>
                    <select
                      value={folderId}
                      onChange={(e) => setFolderId(e.target.value)}
                      className="input w-56 bg-white"
                    >
                      <option value="">Gmail statements folder</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.folder_id}>{f.label}</option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={!daysValid}
              className="btn-primary"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />Clean up
            </button>
            {onCancel && (
              <button onClick={onCancel} className="btn-secondary">
                <X className="h-4 w-4 mr-1.5" />Cancel
              </button>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-primary-900/60">
          Judged by the statement&rsquo;s own date, not when it was imported.
          Only files already marked &ldquo;_done&rdquo; are touched — a failed
          or password-waiting file is left alone no matter how old it is.
          Moved to Drive&rsquo;s own Trash, recoverable there for about 30
          days, not deleted outright.
        </p>
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={run}
        title="Clean up old Drive statements?"
        message={`Every "_done" file in ${folderLabel} whose own statement date is more than ${days} days old will be moved to Drive's Trash. This can't be undone from here — recovery would be through Drive's own Trash directly.`}
        confirmText="Move to Trash"
        danger
        busy={busy}
      />
    </>
  )
}
