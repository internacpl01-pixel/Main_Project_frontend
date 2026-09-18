import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, MANAGER } from '../context/AuthContext.jsx'
import {
  getDriveFolderSettings, updateDriveFolderSettings, updateDriveImportFolder,
  fetchUsers,
} from '../api/endpoints.js'
import ChangePasswordDialog from '../components/ChangePasswordDialog.jsx'
import DriveCleanupPanel from '../components/DriveCleanupPanel.jsx'
import { Spinner } from '../components/UI.jsx'
import UsersPage from './UsersPage.jsx'
import toast from 'react-hot-toast'
import {
  KeyRound, LogOut, ChevronDown, Building2, Users as UsersIcon, HardDrive,
  Mail, Trash2, Check, X, Pencil, Info, Link2, CornerDownRight,
} from 'lucide-react'

// Mirrors UsersPage's own ROLE_BADGES -- kept as a small local copy rather
// than exported and shared, since this is the only other place a role shows
// as a standalone badge rather than inside that page's table.
const ROLE_BADGES = {
  super_admin: 'bg-purple-100 text-purple-700',
  company_admin: 'bg-primary-100 text-primary-700',
  manager: 'bg-amber-100 text-amber-700',
  staff: 'bg-slate-100 text-slate-600',
}

const FOLDER_URL = 'https://drive.google.com/drive/folders/'

/**
 * One collapsible settings section: icon, title, a one-line summary of what
 * is inside, and the contents themselves.
 *
 * Collapsed by default unless `defaultOpen`. That is the whole answer to
 * "minimize": this page carries account controls, two Drive folders,
 * cleanup and the entire team table, and showing all of it at once is what
 * made it read as a pile of forms rather than a settings page. The summary
 * line is what makes a closed section still worth having on screen -- it
 * answers the question most visits are actually asking (which folder? how
 * many people?) without being opened at all.
 */
// `tone="danger"` is for a section whose contents destroy something. Marked
// on the closed header rather than only inside, so what it does is visible
// without opening it -- the same reason the summary line is there.
const SECTION_TONES = {
  slate: {
    card: '',
    tile: 'bg-slate-100 text-slate-500',
    title: 'text-slate-900',
    summary: 'text-slate-500',
    hover: 'hover:bg-slate-50',
  },
  danger: {
    card: 'border-red-100',
    tile: 'bg-red-50 text-red-600',
    title: 'text-red-700',
    summary: 'text-red-600/70',
    hover: 'hover:bg-red-50/50',
  },
}

function Section({ icon, title, summary, badge, tone = 'slate',
                   defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  const t = SECTION_TONES[tone] || SECTION_TONES.slate
  return (
    <div className={`card mb-4 overflow-hidden ${t.card}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`w-full flex items-center gap-3 px-5 py-4 text-left transition-colors ${t.hover}`}
      >
        <div className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center ${t.tile}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={`text-sm font-semibold ${t.title}`}>{title}</p>
            {badge}
          </div>
          <p className={`text-xs truncate ${t.summary}`}>{summary}</p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${
            tone === 'danger' ? 'text-red-400' : 'text-slate-400'
          } ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className={`border-t px-5 py-5 ${
          tone === 'danger' ? 'border-red-100' : 'border-slate-100'
        }`}>
          {children}
        </div>
      )}
    </div>
  )
}

// A row inside a section: icon, title, description, control on the right.
function SettingsRow({ icon, iconTone = 'slate', title, description, children }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-500',
    red: 'bg-red-50 text-red-600',
  }
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${tones[iconTone]}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">{title}</p>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/**
 * A Drive folder setting: shows the folder as a real, clickable link and
 * swaps to a paste-a-URL box when changed.
 *
 * Both folders on this page behave identically -- paste the address bar,
 * the id gets pulled out server-side -- so they share this rather than
 * keeping two near-identical blocks that would drift the moment one of
 * them got a fix.
 *
 * `note` is whatever has to be said before saving THIS particular folder,
 * which is the one thing that genuinely differs between the two: changing
 * the export folder also moves the Apps Script, while changing the import
 * folder affects nothing but what gets read.
 */
function FolderField({ folderId, placeholder, note, onSave, onClear, clearLabel,
                       emptyText = 'Not set' }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  const start = () => {
    setValue(folderId ? FOLDER_URL + folderId : '')
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(value.trim())
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    setSaving(true)
    try {
      await onClear()
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 mb-0.5">Folder link</p>
          {folderId ? (
            <a
              href={FOLDER_URL + folderId}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary-600 hover:underline break-all inline-flex items-start gap-1.5"
            >
              <Link2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="font-mono">{FOLDER_URL}{folderId}</span>
            </a>
          ) : (
            <p className="text-sm text-slate-400">{emptyText}</p>
          )}
        </div>
        <button onClick={start} className="btn-secondary shrink-0">
          <Pencil className="h-3.5 w-3.5 mr-1.5" />Change
        </button>
      </div>
    )
  }

  return (
    <div>
      <label className="label">Paste the Drive folder link</label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[18rem]">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            autoFocus
            placeholder={placeholder}
            className="input pl-9 font-mono text-xs"
            disabled={saving}
          />
        </div>
        <button onClick={save} disabled={saving} className="btn-primary shrink-0">
          {saving ? <Spinner size="sm" tone="white" /> : <><Check className="h-4 w-4 mr-1" />Save</>}
        </button>
        <button
          onClick={() => setEditing(false)}
          disabled={saving}
          className="btn-secondary shrink-0"
        >
          <X className="h-4 w-4 mr-1" />Cancel
        </button>
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        Open the folder in Drive and copy the whole address bar — the folder
        ID is pulled out of it. A bare ID works too.
      </p>
      {onClear && (
        <button
          onClick={clear}
          disabled={saving}
          className="mt-2 text-xs text-primary-600 hover:underline inline-flex items-center gap-1"
        >
          <CornerDownRight className="h-3 w-3" />{clearLabel}
        </button>
      )}
      {note}
    </div>
  )
}

export default function SettingsPage() {
  const { user, signOut, hasLevel } = useAuth()
  const navigate = useNavigate()
  const isManager = hasLevel(MANAGER)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [teamCount, setTeamCount] = useState(null)

  // The two Drive folders, and they are deliberately two:
  //   exportId -- where the Gmail Apps Script SAVES attachments. Saving it
  //               rewrites the script's own copy too, so the collection and
  //               this app can never end up pointing at different folders.
  //   importId -- what Drive imports READ. null means "follow the export
  //               folder", which is the usual setup; set it to a different
  //               folder to take in statements that never came through
  //               Gmail, without disturbing the collection at all.
  const [exportId, setExportId] = useState('')
  const [importId, setImportId] = useState(null)

  useEffect(() => {
    if (!isManager) return
    getDriveFolderSettings()
      .then((r) => {
        setExportId(r.export_folder_id || r.folder_id || '')
        setImportId(r.import_folder_id || null)
      })
      .catch(() => {})
    // Just for the collapsed Team section's badge. UsersPage re-reports the
    // count through onCount once it is opened, so this only has to be right
    // before anyone has expanded it.
    fetchUsers().then((u) => setTeamCount(u.length)).catch(() => {})
  }, [isManager])

  const handleLogout = () => {
    signOut()
    navigate('/login')
  }

  const saveExport = async (value) => {
    if (!value) { toast.error('Paste the folder link first.'); throw new Error('empty') }
    try {
      const res = await updateDriveFolderSettings(value)
      setExportId(res.export_folder_id || res.folder_id)
      toast.success('Export folder updated — the Apps Script now uses it too')
    } catch (err) {
      toast.error(err.message || 'Could not update the export folder')
      throw err
    }
  }

  const saveImport = async (value) => {
    if (!value) { toast.error('Paste the folder link first.'); throw new Error('empty') }
    try {
      const res = await updateDriveImportFolder(value)
      setImportId(res.import_folder_id)
      toast.success(res.import_folder_id === exportId
        ? 'Importing from the export folder'
        : `Now importing from "${res.folder_name}"`)
    } catch (err) {
      toast.error(err.message || 'Could not update the import folder')
      throw err
    }
  }

  const followExport = async () => {
    try {
      await updateDriveImportFolder('')
      setImportId(null)
      toast.success('Importing from the export folder again')
    } catch (err) {
      toast.error(err.message || 'Could not update the import folder')
      throw err
    }
  }

  // The folder imports actually read, once "follow the export folder" is
  // resolved -- what the summary lines and the cleanup warning talk about.
  const effectiveImportId = importId || exportId
  const sameFolder = !importId || importId === exportId

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-900 mb-1">Settings</h1>
      <p className="text-sm text-slate-500 mb-6">
        Manage your account{isManager ? ', statement folders and your team' : ''}.
      </p>

      {/* Profile header -- a soft gradient card rather than another plain
          list row, so the page opens with something that actually looks
          like a Settings page rather than a form. */}
      <div className="relative overflow-hidden rounded-2xl border border-primary-100
                      bg-gradient-to-br from-primary-50 via-white to-white p-5 mb-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full
                    bg-primary-100/60 blur-2xl"
        />
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-primary-600 text-white flex items-center
                          justify-center text-xl font-semibold shrink-0 shadow-sm">
            {user?.username?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900 truncate">{user?.username}</h2>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                ROLE_BADGES[user?.role] || ROLE_BADGES.staff
              }`}>
                {user?.roleLabel || user?.role}
              </span>
            </div>
            {user?.companyName && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                <Building2 className="h-3.5 w-3.5 text-slate-400" />
                {user.companyName}
                <span className="text-slate-300">·</span>
                <span className="font-mono text-xs">{user.schema}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* --- Account ------------------------------------------------------ */}
      <Section
        icon={<KeyRound className="h-4 w-4" />}
        title="Account"
        summary="Password and sign-out for this device."
        defaultOpen
      >
        <div className="divide-y divide-slate-100">
          <SettingsRow
            icon={<KeyRound className="h-4 w-4" />}
            title="Change password"
            description="Update the password for this account."
          >
            <button onClick={() => setPasswordOpen(true)} className="btn-secondary">
              Change
            </button>
          </SettingsRow>

          <SettingsRow
            icon={<LogOut className="h-4 w-4" />}
            iconTone="red"
            title="Sign out"
            description="Ends this session on this device."
          >
            <button onClick={handleLogout} className="btn-danger">
              Sign out
            </button>
          </SettingsRow>
        </div>
      </Section>

      {isManager && (
        <>
          {/* Why these two sit next to each other and read as a pair: one
              says where statements ARRIVE, the other where they are READ
              FROM. Same folder in both is the ordinary setup; different
              folders is how a batch that never came through Gmail gets
              imported without touching the collection. */}
          <p className="px-1 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Bank statement folders
          </p>

          {/* --- 1. Export folder ---------------------------------------- */}
          <Section
            icon={<Mail className="h-4 w-4" />}
            title="Gmail statement export folder"
            summary={exportId
              ? 'Where the Gmail Apps Script saves statement attachments.'
              : 'Not set up yet — nothing is being collected automatically.'}
          >
            <p className="mb-4 text-sm text-slate-600">
              Statements emailed by your banks are picked up by the Gmail
              Apps Script and saved here, renamed
              {' '}<span className="font-mono text-xs">yyyymmdd BANK 1234.pdf</span>.
            </p>
            <FolderField
              folderId={exportId}
              placeholder={`${FOLDER_URL}1AbC...`}
              onSave={saveExport}
              emptyText="Not set — the Apps Script has nowhere to save to."
              note={
                <p className="mt-2 text-xs text-amber-700 flex items-start gap-1.5 rounded-lg
                              bg-amber-50 border border-amber-100 px-3 py-2">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
                  Saving this also updates the Gmail Apps Script, so future
                  statements are saved into this folder instead. It does not
                  change where imports read from — that is the setting below.
                </p>
              }
            />
          </Section>

          {/* --- 2. Import folder ---------------------------------------- */}
          <Section
            icon={<HardDrive className="h-4 w-4" />}
            title="Import folder"
            summary={sameFolder
              ? 'Same as the export folder — importing what Gmail collects.'
              : 'A different folder, separate from what Gmail collects.'}
            badge={!sameFolder && (
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                Custom
              </span>
            )}
          >
            <p className="mb-4 text-sm text-slate-600">
              Where <span className="font-medium">Import from Drive</span>{' '}
              reads statements. Usually the same folder as above — paste a
              different link to import a batch of statements that never came
              through Gmail. Either way the Apps Script is left alone.
            </p>

            {sameFolder ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-4">
                <p className="text-xs font-medium text-slate-500 mb-0.5">Currently reading</p>
                <p className="text-sm text-slate-800 flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  The export folder above
                  {!exportId && <span className="text-slate-400">— which is not set yet</span>}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-primary-100 bg-primary-50/50 p-4 mb-4">
                <p className="text-xs font-medium text-slate-500 mb-0.5">Currently reading</p>
                <a
                  href={FOLDER_URL + effectiveImportId}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary-600 hover:underline break-all font-mono"
                >
                  {FOLDER_URL}{effectiveImportId}
                </a>
              </div>
            )}

            <FolderField
              folderId={importId}
              placeholder={`${FOLDER_URL}1AbC...  (or the export folder's own link)`}
              onSave={saveImport}
              onClear={sameFolder ? null : followExport}
              clearLabel="Go back to reading the export folder"
              emptyText="Following the export folder"
            />
          </Section>

          {/* --- Cleanup ------------------------------------------------- */}
          <Section
            icon={<Trash2 className="h-4 w-4" />}
            title="Clean up old statements"
            summary="Move already-imported statements out of the import folder once they're old enough."
            tone="danger"
          >
            <DriveCleanupPanel />
          </Section>

          {/* --- Team ---------------------------------------------------- */}
          <p className="px-1 mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            People
          </p>
          <Section
            icon={<UsersIcon className="h-4 w-4" />}
            title="Team"
            summary={`Accounts for ${user?.schema || 'this company'}. You can manage anyone below your own level.`}
            badge={teamCount !== null && (
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                {teamCount} member{teamCount === 1 ? '' : 's'}
              </span>
            )}
          >
            {/* Rendered rather than described: UsersPage owns the whole
                table, its dialogs and its own permission rules, so
                embedding it is the only way this section and the /users
                route can't disagree about who may edit whom. */}
            <UsersPage embedded onCount={setTeamCount} />
          </Section>
        </>
      )}

      <ChangePasswordDialog
        isOpen={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onChanged={() => { setPasswordOpen(false); handleLogout() }}
      />
    </div>
  )
}
