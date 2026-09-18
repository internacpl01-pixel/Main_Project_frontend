import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, MANAGER } from '../context/AuthContext.jsx'
import {
  getDriveFolderSettings, updateDriveFolderSettings, listDriveFolders,
  addDriveFolder, deleteDriveFolder, fetchUsers,
} from '../api/endpoints.js'
import ChangePasswordDialog from '../components/ChangePasswordDialog.jsx'
import DriveCleanupPanel from '../components/DriveCleanupPanel.jsx'
import { Spinner, ConfirmDialog } from '../components/UI.jsx'
import UsersPage from './UsersPage.jsx'
import toast from 'react-hot-toast'
import {
  KeyRound, LogOut, ChevronDown, Building2, Users as UsersIcon, HardDrive,
  Mail, FolderPlus, Trash2, Check, X, Pencil, Info, Link2,
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

/**
 * One collapsible settings section: icon, title, a one-line summary of what
 * is inside, and the contents themselves.
 *
 * Collapsed by default unless `defaultOpen`. That is the whole answer to
 * "minimize": this page now carries account controls, three Drive controls
 * and the entire team table, and showing all of it at once is what made it
 * read as a pile of forms rather than a settings page. The summary line is
 * what makes a closed section still worth having on screen -- it answers
 * the question most visits are actually asking (which folder? how many
 * people?) without being opened at all.
 */
function Section({ icon, title, summary, badge, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card mb-4 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="h-9 w-9 shrink-0 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            {badge}
          </div>
          <p className="text-xs text-slate-500 truncate">{summary}</p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="border-t border-slate-100 px-5 py-5">{children}</div>}
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

export default function SettingsPage() {
  const { user, signOut, hasLevel } = useAuth()
  const navigate = useNavigate()
  const isManager = hasLevel(MANAGER)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [teamCount, setTeamCount] = useState(null)

  // The Gmail folder (drive_settings). Editing it also updates the Apps
  // Script's own copy server-side -- see PUT /imports/drive-settings.
  const [folderId, setFolderId] = useState('')
  const [editingFolder, setEditingFolder] = useState(false)
  const [folderInput, setFolderInput] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)

  // The extra folders (drive_folders). Deliberately a separate list, not a
  // second value for the field above: changing the Gmail folder redirects
  // the Apps Script too, so pointing it at a one-off folder of statements
  // would stop the automatic collection landing where anyone expects.
  const [folders, setFolders] = useState([])
  const [folderUrl, setFolderUrl] = useState('')
  const [folderLabel, setFolderLabel] = useState('')
  const [addingFolder, setAddingFolder] = useState(false)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    if (!isManager) return
    getDriveFolderSettings().then((r) => setFolderId(r.folder_id || '')).catch(() => {})
    listDriveFolders().then((f) => setFolders(Array.isArray(f) ? f : [])).catch(() => {})
    // Just for the collapsed Team section's badge. UsersPage re-reports the
    // count through onCount once it is opened, so this only has to be right
    // before anyone has expanded it.
    fetchUsers().then((u) => setTeamCount(u.length)).catch(() => {})
  }, [isManager])

  const handleLogout = () => {
    signOut()
    navigate('/login')
  }

  const saveFolderId = async () => {
    const value = folderInput.trim()
    if (!value) { toast.error('Folder ID cannot be empty.'); return }
    setSavingFolder(true)
    try {
      const res = await updateDriveFolderSettings(value)
      setFolderId(res.folder_id)
      setEditingFolder(false)
      toast.success('Gmail statements folder updated')
    } catch (err) {
      toast.error(err.message || 'Could not update the Drive folder')
    } finally {
      setSavingFolder(false)
    }
  }

  const handleAddFolder = async () => {
    const url = folderUrl.trim()
    if (!url) { toast.error('Paste the folder link first.'); return }
    setAddingFolder(true)
    try {
      const row = await addDriveFolder(url, folderLabel.trim())
      setFolders((prev) => prev.some((f) => f.id === row.id)
        ? prev
        : [row, ...prev])
      setFolderUrl('')
      setFolderLabel('')
      toast.success(`"${row.label}" is now available on the Import page`)
    } catch (err) {
      toast.error(err.message || 'Could not add that folder')
    } finally {
      setAddingFolder(false)
    }
  }

  const handleRemoveFolder = async () => {
    setRemoving(true)
    try {
      await deleteDriveFolder(removeTarget.id)
      setFolders((prev) => prev.filter((f) => f.id !== removeTarget.id))
      toast.success(`Removed "${removeTarget.label}"`)
      setRemoveTarget(null)
    } catch (err) {
      toast.error(err.message || 'Could not remove that folder')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-900 mb-1">Settings</h1>
      <p className="text-sm text-slate-500 mb-6">
        Manage your account{isManager ? ', statement sources and your team' : ''}.
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

      {/* --- Drive: the Gmail folder -------------------------------------- */}
      {isManager && (
        <Section
          icon={<Mail className="h-4 w-4" />}
          title="Gmail statements folder"
          summary={folderId
            ? `Filled automatically by the Apps Script · ${folderId}`
            : 'Not set up yet — nothing is being collected automatically.'}
        >
          {editingFolder ? (
            <div>
              <label className="label">Drive Folder ID</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={folderInput}
                  onChange={(e) => setFolderInput(e.target.value)}
                  autoComplete="off"
                  autoFocus
                  placeholder="e.g. 1SutmDSaEILMkCJWf6Htx5p5WWJ11YuvR"
                  className="input flex-1 min-w-[16rem] font-mono text-xs"
                  disabled={savingFolder}
                />
                <button onClick={saveFolderId} disabled={savingFolder} className="btn-primary shrink-0">
                  {savingFolder
                    ? <Spinner size="sm" tone="white" />
                    : <><Check className="h-4 w-4 mr-1" />Save</>}
                </button>
                <button
                  onClick={() => setEditingFolder(false)}
                  disabled={savingFolder}
                  className="btn-secondary shrink-0"
                >
                  <X className="h-4 w-4 mr-1" />Cancel
                </button>
              </div>
              <p className="mt-2 text-xs text-amber-700 flex items-start gap-1.5 rounded-lg
                            bg-amber-50 border border-amber-100 px-3 py-2">
                <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
                Saving this also updates the Gmail Apps Script, so it keeps
                saving statements into the same folder this reads from. To
                import from somewhere else just once, add it under
                &ldquo;Other import folders&rdquo; below instead — that leaves
                the automatic collection alone.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">Drive Folder ID</p>
                <p className="text-sm font-mono text-slate-800 break-all">
                  {folderId || 'Not set'}
                </p>
              </div>
              <button
                onClick={() => { setFolderInput(folderId); setEditingFolder(true) }}
                className="btn-secondary shrink-0"
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />Change
              </button>
            </div>
          )}
        </Section>
      )}

      {/* --- Drive: extra folders ----------------------------------------- */}
      {isManager && (
        <Section
          icon={<HardDrive className="h-4 w-4" />}
          title="Other import folders"
          summary={folders.length
            ? `${folders.length} folder${folders.length === 1 ? '' : 's'} you can import from on the Import page`
            : 'Import statements from any Drive folder by pasting its link.'}
          badge={folders.length > 0 && (
            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
              {folders.length}
            </span>
          )}
        >
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="label">Add a folder by link</label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[18rem]">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={folderUrl}
                  onChange={(e) => setFolderUrl(e.target.value)}
                  autoComplete="off"
                  placeholder="https://drive.google.com/drive/folders/1AbC..."
                  className="input pl-9 bg-white"
                  disabled={addingFolder}
                />
              </div>
              <input
                value={folderLabel}
                onChange={(e) => setFolderLabel(e.target.value)}
                autoComplete="off"
                placeholder="Name it (optional)"
                className="input w-48 bg-white"
                disabled={addingFolder}
              />
              <button onClick={handleAddFolder} disabled={addingFolder} className="btn-primary shrink-0">
                {addingFolder
                  ? <Spinner size="sm" tone="white" />
                  : <><FolderPlus className="h-4 w-4 mr-1.5" />Add folder</>}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500 flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-px text-slate-400" />
              Paste the whole address bar — the folder ID is pulled out of it.
              The folder must be shared with the Google account this app signs
              in as, and its files still need the usual
              &ldquo;yyyymmdd BANK 1234&rdquo; names to be matched to an
              account. Adding one here does not touch the Gmail folder above.
            </p>
          </div>

          {folders.length > 0 && (
            <ul className="mt-4 divide-y divide-slate-100">
              {folders.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 shrink-0 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center">
                      <HardDrive className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{f.label}</p>
                      <p className="text-xs font-mono text-slate-400 truncate">{f.folder_id}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setRemoveTarget(f)}
                    className="btn-secondary shrink-0 text-red-600 hover:bg-red-50"
                    title="Remove this folder"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* --- Drive: cleanup ----------------------------------------------- */}
      {isManager && (
        <Section
          icon={<Trash2 className="h-4 w-4" />}
          title="Clean up old statements"
          summary="Move already-imported statements out of Drive once they're old enough."
        >
          <DriveCleanupPanel folders={folders} />
        </Section>
      )}

      {/* --- Team --------------------------------------------------------- */}
      {isManager && (
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
          {/* Rendered rather than described: UsersPage owns the whole table,
              its dialogs and its own permission rules, so embedding it is
              the only way this section and the /users route can't disagree
              about who may edit whom. */}
          <UsersPage embedded onCount={setTeamCount} />
        </Section>
      )}

      <ChangePasswordDialog
        isOpen={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onChanged={() => { setPasswordOpen(false); handleLogout() }}
      />

      <ConfirmDialog
        isOpen={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemoveFolder}
        title="Remove this import folder?"
        message={`"${removeTarget?.label}" will no longer appear as a source on the Import page. Nothing in Drive is deleted or unshared, and anything already imported from it stays imported.`}
        confirmText="Remove"
        danger
        busy={removing}
      />
    </div>
  )
}
