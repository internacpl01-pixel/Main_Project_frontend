import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  importPdf, importExcel, importCsv, inspectExcel, fetchMasterData,
  pollImportJob, startDriveImportJob, retryDriveFileWithPassword,
  getDriveFolderSettings, listDriveFiles, skipDriveFile, skipDriveFiles,
  fetchDriveLinkFile, cancelImportJob,
} from '../api/endpoints.js'
import { PasswordInput, Spinner, Modal } from '../components/UI.jsx'
import ImportProgressOverlay from '../components/ImportProgressOverlay.jsx'
import toast from 'react-hot-toast'
import {
  Upload, FileText, X, File, CheckCircle, AlertCircle, Lock, ArrowRight, Info,
  Layers, HardDrive, Search, EyeOff, Copy, RotateCcw, Square,
} from 'lucide-react'

// One step, like DPL: the file is parsed and written on the same request.
// There is no dry run and no confirm — /imports/* is always called with
// save=true, exactly as DPL's Api.uploadPdf always sent save:'true'. What the
// parser found is reported afterwards, from the same response.
//
// Every format goes the background route now. It hands back a job id in
// milliseconds and the work continues server-side, which is what makes a real
// progress bar possible and what keeps a long import from outliving the
// request. Excel used to stay direct because it was "about a second" — that was
// true when it read one sheet; a workbook of eight accounts and a few thousand
// rows is a different job, and it reports per sheet exactly as a PDF reports
// per batch.
// `onUploadPercent` covers the first half of the wait, which had nothing at
// all: the file has to reach the server before any of the above can start, and
// on a 25 MB statement over a home connection that is the longer half. The
// button read "Parsing PDF..." throughout it — describing work the server had
// not yet been given the bytes to begin.
async function importFile(file, bankId = null, password = '', pages = '',
                          batchPages = null, onProgress, sheets = '',
                          onUploadPercent, onJobId) {
  const ext = file.name.split('.').pop().toLowerCase()
  let started
  if (ext === 'pdf') {
    started = await importPdf(file, true, bankId, password,
                              { pages, batchPages, background: true,
                                onUploadPercent })
  } else if (ext === 'csv') {
    started = await importCsv(file, true, bankId,
                              { background: true, onUploadPercent })
  } else {
    started = await importExcel(file, true, bankId,
                                { sheets, background: true, onUploadPercent })
  }
  // Handed to the caller as soon as it exists, so a Stop button can reach
  // this exact run -- onProgress's first reading arrives a poll interval
  // later, which is otherwise how long Stop would stay unable to do anything.
  if (onJobId) onJobId(started.job_id)
  return pollImportJob(started.job_id, onProgress)
}

// Blank means the whole file. Otherwise a count ("30") or a range ("31-65"),
// validated here only enough to catch a typo before it costs a round trip —
// the server decides what is actually in range, since only it knows the file.
function pageSpecError(spec) {
  const s = (spec || '').trim()
  if (!s) return ''
  if (/^\d+$/.test(s)) return Number(s) >= 1 ? '' : 'Page count must be at least 1.'
  const m = s.match(/^(\d+)\s*-\s*(\d+)$/)
  if (!m) return 'Use a count like 30, a range like 31-65, or leave it blank.'
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a < 1) return 'Pages start at 1.'
  if (b < a) return `${a}-${b} runs backwards.`
  return ''
}

// parsers.py signals both of these as RuntimeError, which the router maps to a
// 422. They are the only two failures a password can fix, so they get the retry
// prompt instead of a generic red toast.
function isPasswordProblem(message = '') {
  return /ENCRYPTED|password-protected|Incorrect password/i.test(message)
}

export default function ImportPage() {
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const [importing, setImporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [banks, setBanks] = useState([])
  const [bankId, setBankId] = useState('')
  // Held only for the duration of the import and cleared by reset() — never
  // persisted, never sent anywhere but /imports/pdf.
  const [password, setPassword] = useState('')
  const [pwError, setPwError] = useState('')
  // "" = every page. A count or a range narrows it.
  const [pages, setPages] = useState('')
  // "" leaves the server's default (20). "0" reads the file in one pass.
  const [batchPages, setBatchPages] = useState('')
  // The last reading from the running job, or null when nothing is running.
  const [progress, setProgress] = useState(null)
  // The job the Stop button on ImportProgressOverlay would cancel -- whichever
  // of the single/batch/Drive flows is currently running, or null between
  // them and before the first one has a job id at all (see importFile's
  // onJobId). One field for all three: only one of them can ever be running
  // at once, since each sets `importing`/`batchRunning`/`driveRunning` for
  // the length of its own run and the buttons that start another are
  // disabled while any of those is true.
  const [currentJobId, setCurrentJobId] = useState(null)
  const [stoppingImport, setStoppingImport] = useState(false)
  // How much of the file has reached the server, 0-100, or null once it has
  // all landed and the server has taken over. Its own state and not folded
  // into `progress`, because they measure different things: this one is the
  // browser's upload, that one is the server's parse.
  const [uploadPct, setUploadPct] = useState(null)
  // What the workbook holds, once it has been inspected, and which of its
  // sheets are ticked. A workbook is one file but several statements, so this
  // is the spreadsheet's version of the PDF page selector.
  const [workbook, setWorkbook] = useState(null)
  const [inspecting, setInspecting] = useState(false)
  const [chosenSheets, setChosenSheets] = useState([])
  // Picking more than one file at once switches into batch mode instead of
  // the single-file flow above: one shared Bank Account, no per-file
  // password/page-range/sheet-picker (a workbook's sheets default to "every
  // statement sheet" -- importExcel already does that when `sheets` is
  // blank), imported one at a time so progress and duplicate detection stay
  // exactly as reliable as a single upload. A password-protected PDF or a
  // workbook needing specific sheets chosen is still imported individually
  // through the flow above.
  const [batchFiles, setBatchFiles] = useState([])
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchIndex, setBatchIndex] = useState(0)
  const [batchResults, setBatchResults] = useState([])
  // A failed batch row's own password box -- keyed by the file's index in
  // batchFiles, since more than one row could need one at once.
  // { [index]: { value, busy } }
  const [batchPwRetry, setBatchPwRetry] = useState({})
  // Which source the picker is showing -- 'computer' is everything above,
  // 'drive' imports whatever the Gmail Apps Script has already copied into
  // the one configured Drive folder. Which bank a Drive file belongs to is
  // read off its own filename and matched server-side -- nothing chosen here.
  const [source, setSource] = useState('computer')
  const [driveRunning, setDriveRunning] = useState(false)
  const [driveResults, setDriveResults] = useState(null)
  // A "password_required" Drive row's own password box, keyed by filename.
  // { [name]: { value, busy } }
  const [drivePwRetry, setDrivePwRetry] = useState({})
  // Which Drive folder this run reads is a company setting, not a choice
  // made here -- shown so it is obvious where files are coming from, but
  // changed only under Settings. One place decides it, so a run can never
  // read somewhere other than what Settings says.
  // exportId is where the Apps Script saves; importId is what this reads,
  // null when it simply follows the export folder.
  const [exportId, setExportId] = useState('')
  const [importId, setImportId] = useState(null)
  // The file-picker modal shown before a Drive run actually starts, so a
  // person can import just one or a few files instead of always sweeping
  // the whole pending list. pickerFiles is [{id, name}, ...]; selection and
  // deletion are both keyed by id, not name -- two files can legitimately
  // share a name (a leftover of the Apps Script's pre-fix collision race).
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerFiles, setPickerFiles] = useState([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerSelected, setPickerSelected] = useState(new Set())
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerSkipping, setPickerSkipping] = useState(new Set())
  // Files GET /imports/drive-files flagged unmatched -- an unparseable name,
  // or one naming a bank account that isn't in bank_master. Surfaced before
  // the main picker so a person can discard them up front instead of finding
  // out only after they're marked "_failed" post-import.
  const [unmatchedOpen, setUnmatchedOpen] = useState(false)
  const [unmatchedList, setUnmatchedList] = useState([])
  const [skippingUnmatched, setSkippingUnmatched] = useState(false)
  // A single file's Drive link, pasted instead of picking from disk -- goes
  // through fetchDriveLinkFile then straight into handleFileSelection, so
  // everything downstream (multi-sheet inspect, bank/password prompts) is
  // the exact same code path as a computer-picked file.
  const [driveLinkUrl, setDriveLinkUrl] = useState('')
  const [driveLinkLoading, setDriveLinkLoading] = useState(false)
  const fileInput = useRef()
  const navigate = useNavigate()

  useEffect(() => {
    // Inactive ones are fetched too, but only to be shown greyed out and
    // unpickable — a bank switched off must still not be usable to tag a
    // fresh import, it just should not look like it vanished off the list
    // someone was scrolling.
    fetchMasterData('bank', { include_inactive: true })
      .then((b) => setBanks(Array.isArray(b) ? b : []))
      .catch(() => {})
    getDriveFolderSettings()
      .then((r) => {
        setExportId(r.export_folder_id || r.folder_id || '')
        setImportId(r.import_folder_id || null)
      })
      .catch(() => {})
  }, [])

  // Reading the export folder is the ordinary setup; a separate import
  // folder is worth naming differently so it is obvious at a glance which
  // one a run is about to sweep.
  const readingExportFolder = !importId || importId === exportId
  const effectiveImportId = importId || exportId
  const driveSourceLabel = readingExportFolder
    ? 'Gmail statement export folder'
    : 'Import folder'

  const handleFile = useCallback(async (f) => {
    if (!f) return
    if (f.size > 25 * 1024 * 1024) { toast.error('File too large (max 25 MB)'); return }
    const ext = f.name.split('.').pop().toLowerCase()
    if (!['pdf', 'csv', 'xls', 'xlsx'].includes(ext)) {
      toast.error('Unsupported format. Use PDF, CSV, XLS, or XLSX.'); return
    }
    setFile(f)
    setResult(null)
    setPwError('')
    setWorkbook(null)
    setChosenSheets([])

    if (ext === 'xlsx' || ext === 'xls') {
      // Read the workbook before asking anything else. Which sheets exist, and
      // which of them are statements, decides what the rest of this form even
      // says — and a workbook whose columns were not recognised is worth
      // knowing about before the rows are staged, not after.
      setInspecting(true)
      setUploadPct(0)
      try {
        const info = await inspectExcel(f, {
          onUploadPercent: (pct) => setUploadPct(pct >= 100 ? null : pct),
        })
        setWorkbook(info)
        setChosenSheets(info.statement_sheets || [])
        if (!info.statement_sheets?.length) {
          toast.error('No sheet in this workbook looks like a bank statement.')
        }
      } catch (err) {
        // Not fatal: the import itself can still pick the sheets. This only
        // costs the picker.
        toast.error(`Could not read the sheets: ${err.message}`)
      } finally {
        setInspecting(false)
        setUploadPct(null)
      }
    }
  }, [])

  // Entry point for both the click-to-browse input and drag-drop -- one file
  // goes to the existing single-file flow untouched; more than one switches
  // to batch mode.
  const handleFileSelection = (selected) => {
    const list = Array.from(selected || [])
    if (list.length === 0) return
    if (list.length === 1) {
      setBatchFiles([]); setBatchResults([])
      handleFile(list[0])
      return
    }
    const valid = []
    for (const f of list) {
      if (f.size > 25 * 1024 * 1024) { toast.error(`${f.name}: too large (max 25 MB)`); continue }
      const ext = f.name.split('.').pop().toLowerCase()
      if (!['pdf', 'csv', 'xls', 'xlsx'].includes(ext)) {
        toast.error(`${f.name}: unsupported format`); continue
      }
      valid.push(f)
    }
    if (valid.length === 0) return
    setFile(null); setResult(null)
    setBatchFiles(valid)
    setBatchResults([])
  }

  const handleDriveLinkImport = async () => {
    if (!driveLinkUrl.trim()) return
    setDriveLinkLoading(true)
    try {
      const f = await fetchDriveLinkFile(driveLinkUrl.trim())
      setDriveLinkUrl('')
      handleFileSelection([f])
    } catch (err) {
      toast.error(err.message || 'Could not fetch that Drive file')
    } finally {
      setDriveLinkLoading(false)
    }
  }

  const handleImportBatch = async () => {
    const specError = pageSpecError(pages)
    if (specError) { toast.error(specError); return }

    setBatchRunning(true)
    const results = []
    for (let i = 0; i < batchFiles.length; i++) {
      const f = batchFiles[i]
      setBatchIndex(i + 1)
      setProgress(null)
      setUploadPct(0)
      setCurrentJobId(null)
      try {
        // Pages/batch-pages are PDF-only settings, same as the single-file
        // form -- importFile itself ignores them for an Excel/CSV file in
        // this same batch, so nothing extra is needed to scope that here.
        const res = await importFile(f, bankId || null, '', pages.trim(),
                                     batchPages.trim() === '' ? null : Number(batchPages),
                                     setProgress, '',
                                     (pct) => setUploadPct(pct >= 100 ? null : pct),
                                     setCurrentJobId)
        results.push({ name: f.name, status: res.row_count > 0 ? 'done' : 'empty',
                      rowCount: res.row_count })
      } catch (err) {
        if (err.jobCancelled) {
          // Stops the whole batch, not just this file -- a person reaching
          // for Stop mid-batch means "enough", not "skip this one".
          results.push({ name: f.name, status: 'failed', error: 'Stopped.' })
          for (let j = i + 1; j < batchFiles.length; j++) {
            results.push({ name: batchFiles[j].name, status: 'failed', error: 'Not started — batch stopped.' })
          }
          setBatchResults(results)
          setBatchRunning(false)
          setCurrentJobId(null)
          setStoppingImport(false)
          toast('Import stopped.', { icon: '⏹️' })
          return
        }
        // A bank with a saved password is already tried automatically (see
        // process_pdf_import) before this is ever reached -- so a password
        // problem surfacing here means it was missing or wrong, and this
        // file specifically needs one typed in by hand, not a hard failure.
        results.push({
          name: f.name,
          status: isPasswordProblem(err.message) ? 'password_required' : 'failed',
          error: err.message,
        })
      } finally {
        setProgress(null); setUploadPct(null)
      }
    }
    setBatchResults(results)
    setBatchRunning(false)
    setCurrentJobId(null)
    const failedCount = results.filter((r) => r.status === 'failed').length
    const pwCount = results.filter((r) => r.status === 'password_required').length
    const totalRows = results.reduce((s, r) => s + (r.rowCount || 0), 0)
    if (failedCount === 0 && pwCount === 0) {
      toast.success(`Imported ${totalRows} rows from ${results.length} files`)
    } else {
      const parts = []
      if (failedCount) parts.push(`${failedCount} failed`)
      if (pwCount) parts.push(`${pwCount} need a password`)
      toast.error(`${parts.join(', ')} of ${results.length} files`)
    }
  }

  // Retries one batch row that needs a password typed in by hand, using the
  // File object already held in batchFiles -- its bytes never left the
  // browser, so no backend lookup is needed the way Drive's retry needs one.
  const handleBatchRetryPassword = async (index) => {
    const entry = batchPwRetry[index]
    if (!entry?.value) return
    const f = batchFiles[index]
    setBatchPwRetry((prev) => ({ ...prev, [index]: { ...prev[index], busy: true } }))
    try {
      const res = await importFile(f, bankId || null, entry.value, pages.trim(),
                                   batchPages.trim() === '' ? null : Number(batchPages),
                                   null, '', null)
      setBatchResults((prev) => prev.map((r, i) => i === index
        ? { ...r, status: res.row_count > 0 ? 'done' : 'empty', rowCount: res.row_count, error: undefined }
        : r))
      setBatchPwRetry((prev) => {
        const next = { ...prev }; delete next[index]; return next
      })
      toast.success(`Imported ${res.row_count} rows`)
    } catch (err) {
      setBatchPwRetry((prev) => ({
        ...prev, [index]: { ...prev[index], busy: false, error: err.message },
      }))
    }
  }

  const resetBatch = () => {
    setBatchFiles([]); setBatchResults([]); setBatchRunning(false); setBatchIndex(0)
    setBatchPwRetry({})
  }

  // Opens the file picker instead of importing immediately -- fetches
  // whatever's currently pending in the Drive folder so the modal always
  // shows a fresh list, not one that might be stale from an earlier visit.
  const openDrivePicker = async () => {
    const specError = pageSpecError(pages)
    if (specError) { toast.error(specError); return }

    setPickerOpen(true)
    setPickerLoading(true)
    setPickerSearch('')
    try {
      const list = await listDriveFiles()
      setPickerFiles(list)
      setPickerSelected(new Set(list.map((f) => f.id)))   // select all by default

      // Flagged server-side (an unparseable name, or a bank the filename
      // names that isn't in bank_master) -- surfaced up front, before the
      // main picker is actually used, rather than only after importing them
      // fails the same way every time.
      const unmatched = list.filter((f) => f.unmatched)
      if (unmatched.length > 0) {
        setUnmatchedList(unmatched)
        setUnmatchedOpen(true)
      }
    } catch (err) {
      toast.error(err.message || 'Could not list the Drive folder')
      setPickerOpen(false)
    } finally {
      setPickerLoading(false)
    }
  }

  const handleSkipUnmatched = async () => {
    setSkippingUnmatched(true)
    try {
      // One request, not one per file -- see skipDriveFiles: the old
      // Promise.all here fired a full Drive folder listing PER file,
      // concurrently, which is what crashed the backend on a ~70-file list.
      await skipDriveFiles(unmatchedList.map((f) => f.id))
      const skippedIds = new Set(unmatchedList.map((f) => f.id))
      setPickerFiles((prev) => prev.filter((f) => !skippedIds.has(f.id)))
      setPickerSelected((prev) => {
        const next = new Set(prev)
        skippedIds.forEach((id) => next.delete(id))
        return next
      })
      toast.success(`Set ${unmatchedList.length} ` +
        `file${unmatchedList.length === 1 ? '' : 's'} aside — still in Drive`)
      setUnmatchedOpen(false)
      setUnmatchedList([])
    } catch (err) {
      toast.error(err.message || 'Could not set all of them aside')
    } finally {
      setSkippingUnmatched(false)
    }
  }

  const togglePickerFile = (id) => {
    setPickerSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Selects/clears every file currently matching the search box, not the
  // whole list -- toggling "all" while a search narrows the view should act
  // on what's visible, the same as every other filtered select-all in this
  // app.
  const togglePickerAll = (visibleFiles) => {
    const visibleIds = visibleFiles.map((f) => f.id)
    const allVisibleSelected = visibleIds.every((id) => pickerSelected.has(id))
    setPickerSelected((prev) => {
      const next = new Set(prev)
      visibleIds.forEach((id) => (allVisibleSelected ? next.delete(id) : next.add(id)))
      return next
    })
  }

  // Names that appear on more than one pending file -- the Apps Script's
  // pre-fix collision race left some of these behind (see Code.gs's
  // hasAnySavedVariant). Flagged here so a person can tell the two apart
  // and discard the extra copy before it wastes an import slot.
  const pickerDuplicateNames = new Set(
    Object.entries(
      pickerFiles.reduce((counts, f) => {
        counts[f.name] = (counts[f.name] || 0) + 1
        return counts
      }, {})
    ).filter(([, count]) => count > 1).map(([name]) => name)
  )

  const pickerVisible = pickerSearch.trim()
    ? pickerFiles.filter((f) =>
        f.name.toLowerCase().includes(pickerSearch.trim().toLowerCase()))
    : pickerFiles

  // Renames the file "..._bank_absent" in Drive so it stops appearing here.
  // The file itself is untouched, and adding the missing account to Master
  // Data brings it straight back into this list -- so there is no undo to
  // offer and nothing to warn about before clicking.
  const handleSkipPickerFile = async (file) => {
    setPickerSkipping((prev) => new Set(prev).add(file.id))
    try {
      await skipDriveFile(file.id)
      setPickerFiles((prev) => prev.filter((f) => f.id !== file.id))
      setPickerSelected((prev) => {
        const next = new Set(prev); next.delete(file.id); return next
      })
      toast.success(`"${file.name}" set aside — still in Drive`)
    } catch (err) {
      toast.error(err.message || 'Could not set that file aside')
    } finally {
      setPickerSkipping((prev) => {
        const next = new Set(prev); next.delete(file.id); return next
      })
    }
  }

  const handleImportFromDrive = async () => {
    const selectedFiles = pickerFiles
      .filter((f) => pickerSelected.has(f.id))
      .map((f) => f.id)
    if (selectedFiles.length === 0) { toast.error('Select at least one file.'); return }

    setPickerOpen(false)
    setDriveRunning(true)
    setProgress(null)
    setDriveResults(null)
    setCurrentJobId(null)
    try {
      const jobId = await startDriveImportJob(
        pages.trim(), batchPages.trim() === '' ? null : Number(batchPages),
        selectedFiles)
      setCurrentJobId(jobId)
      // Reuses the same `progress` state the single-file and batch flows
      // already drive ImportProgressOverlay from -- a Drive run reports
      // itself in the exact same step shape (one step per file here, the
      // same way one step is one workbook sheet), so the same overlay shows
      // it with no separate progress plumbing.
      const res = await pollImportJob(jobId, setProgress)
      setDriveResults(res)
      const totalRows = (res.files || []).reduce((s, f) => s + (f.row_count || 0), 0)
      if (res.failed === 0 && !res.needs_password) {
        toast.success(res.imported > 0
          ? `Imported ${totalRows} rows from ${res.imported} files`
          : 'Nothing new to import — every file in Drive is already marked done.')
      } else {
        const parts = []
        if (res.failed) parts.push(`${res.failed} failed`)
        if (res.needs_password) parts.push(`${res.needs_password} need a password`)
        toast.error(`${parts.join(', ')} of ${res.files.length} files`)
      }
    } catch (err) {
      // Whatever the job's own `results` held at the moment it was stopped
      // is gone here -- the Drive runner only reports that list once, on
      // `finish`, and a cancelled run never reaches it. This is the one
      // place that list would be worth keeping, but the files it already
      // finished are still renamed "_done" in Drive either way, so nothing
      // about them is actually lost -- only this run's own summary of them.
      if (err.jobCancelled) toast('Import stopped.', { icon: '⏹️' })
      else toast.error(err.message || 'Drive import failed')
    } finally {
      setDriveRunning(false)
      setProgress(null)
      setCurrentJobId(null)
      setStoppingImport(false)
    }
  }

  const resetDrive = () => { setDriveResults(null); setDrivePwRetry({}) }

  // Retries the one Drive file that needs a password typed in by hand --
  // fileName is its CURRENT name (already carrying "_needs_password"), which
  // is what proves the backend already matched it to a bank once.
  const handleDriveRetryPassword = async (fileName) => {
    const entry = drivePwRetry[fileName]
    if (!entry?.value) return
    setDrivePwRetry((prev) => ({ ...prev, [fileName]: { ...prev[fileName], busy: true } }))
    try {
      const res = await retryDriveFileWithPassword(fileName, entry.value)
      setDriveResults((prev) => ({
        ...prev,
        imported: prev.imported + 1,
        needs_password: Math.max(0, (prev.needs_password || 0) - 1),
        files: prev.files.map((f) => f.name === fileName
          ? { ...f, status: 'done', row_count: res.row_count, error: undefined }
          : f),
      }))
      setDrivePwRetry((prev) => {
        const next = { ...prev }; delete next[fileName]; return next
      })
      toast.success(`Imported ${res.row_count} rows`)
    } catch (err) {
      setDrivePwRetry((prev) => ({
        ...prev, [fileName]: { ...prev[fileName], busy: false, error: err.message },
      }))
    }
  }

  const toggleSheet = (name) => {
    setChosenSheets((prev) => prev.includes(name)
      ? prev.filter((n) => n !== name)
      : [...prev, name])
  }

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false); handleFileSelection(e.dataTransfer.files)
  }

  const handleImport = async () => {
    const specError = pageSpecError(pages)
    if (specError) { toast.error(specError); return }

    if (isExcel && workbook && chosenSheets.length === 0) {
      toast.error('Pick at least one sheet to import.')
      return
    }

    setImporting(true)
    setPwError('')
    setProgress(null)
    setUploadPct(0)
    setCurrentJobId(null)
    try {
      const res = await importFile(file, bankId || null, password, pages.trim(),
                                   batchPages.trim() === '' ? null : Number(batchPages),
                                   setProgress, chosenSheets.join(','),
                                   // At 100 the browser has handed over every
                                   // byte; from here the wait belongs to the
                                   // parse, which reports itself.
                                   (pct) => setUploadPct(pct >= 100 ? null : pct),
                                   setCurrentJobId)
      // A beat before the overlay comes down. pollImportJob reports the job one
      // last time with state 'done', so at this moment every step on screen has
      // just gone green — closing instantly would take that away in the same
      // frame it appeared, and the last thing seen of a four-minute parse would
      // be it vanishing.
      await new Promise((r) => setTimeout(r, 750))
      setResult(res)
      if (res.row_count > 0) {
        toast.success(
          res.sheets_imported > 1
            ? `Imported ${res.row_count} rows from ${res.sheets_imported} sheets`
            : `Imported ${res.row_count} rows`
        )
      } else toast.error('No transaction rows could be extracted from this file.')
    } catch (err) {
      if (err.jobCancelled) {
        toast('Import stopped.', { icon: '⏹️' })
      } else if (isPasswordProblem(err.message)) {
        // A wrong or missing password keeps the form up with the reason
        // inline, rather than a toast that disappears before it can be
        // acted on.
        setPwError(password
          ? 'That password did not unlock the PDF. Check it and try again.'
          : 'This PDF is password-protected. Enter its password to continue.')
      } else {
        toast.error(err.message)
      }
    } finally {
      setImporting(false)
      setProgress(null)
      setUploadPct(null)
      setCurrentJobId(null)
      setStoppingImport(false)
    }
  }

  // The overlay's red Stop button. Reused across the single-file, batch, and
  // Drive flows -- currentJobId always names whichever one is actually
  // running, since only one of them can be at once (see its declaration).
  const handleStopImport = async () => {
    if (!currentJobId) return
    setStoppingImport(true)
    try {
      await cancelImportJob(currentJobId)
      // Nothing else to do here: the running poll (pollImportJob, in
      // whichever handler started it) sees state 'cancelled' on its very
      // next reading and throws, which that handler's own catch turns into
      // the "Import stopped." toast and tears the overlay down.
    } catch (err) {
      toast.error(err.message || 'Could not stop the import')
      setStoppingImport(false)
    }
  }

  const reset = () => {
    setFile(null); setResult(null); setImporting(false)
    // Clearing the password is what re-hides it — PasswordInput drops back to
    // hidden whenever its value goes empty, so there is no separate flag here.
    setPassword(''); setPwError(''); setPages(''); setProgress(null)
    setBatchPages(''); setWorkbook(null); setChosenSheets([]); setInspecting(false)
    setUploadPct(null)
  }

  const isPdf = file?.name?.toLowerCase().endsWith('.pdf')
  const isExcel = /\.xlsx?$/i.test(file?.name || '')
  // The job registry counts "steps"; for a PDF a step is a batch of pages and
  // for a workbook it is a sheet. Same bar, and the word has to follow the file
  // or the progress line describes something the user never chose.
  const stepWord = isExcel ? 'Sheet' : 'Batch'
  const pageSpecErrorText = pageSpecError(pages)
  // A range not starting at page 1 gets page 1 added server-side, for its
  // header. Said before the upload rather than after, so the duplicate rows it
  // produces are expected rather than alarming.
  const rangeStartsLate = /^\s*(\d+)\s*-\s*\d+\s*$/.test(pages)
    && Number(pages.trim().split('-')[0]) > 1

  // Statement sheets only. Counting the pivot table and the beneficiary lists
  // would report "1 of 11" for a workbook where only 8 tabs were ever
  // importable, which reads as 10 sheets going missing.
  const statementSheetCount =
    (result?.sheets_available || []).filter((s) => s.is_statement).length
    || result?.sheets_imported || 0

  // Columns the parser matched to a field, and headers it could not place.
  const headers = result?.headers_detected || {}
  const unmapped = result?.unmapped_headers || []
  const docFields = result?.document_fields || {}
  // Only partially filled fields are listed; a full column needs no attention.
  const partialFill = Object.entries(result?.fill_rates || {})
    .filter(([, v]) => v.total > 0 && v.filled < v.total)

  // Nothing picked, running, or showing a result in any of the three modes --
  // the point at which it's meaningful to switch which source you're using.
  const idle = !file && !result && batchFiles.length === 0
    && batchResults.length === 0 && !driveRunning && !driveResults

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* --- Which source ------------------------------------------------- */}
      {idle && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSource('computer')}
            className={source === 'computer' ? 'btn-primary' : 'btn-secondary'}
          >
            <Upload className="h-4 w-4 mr-1.5" />Import from Computer
          </button>
          <button
            onClick={() => setSource('drive')}
            className={source === 'drive' ? 'btn-primary' : 'btn-secondary'}
          >
            <HardDrive className="h-4 w-4 mr-1.5" />Import from Drive
          </button>
        </div>
      )}

      {/* --- Pick a file ------------------------------------------------- */}
      {source === 'computer' && !file && !result && batchFiles.length === 0 && batchResults.length === 0 && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInput.current?.click()}
          className={`card cursor-pointer transition-all ${
            dragOver
              ? 'border-primary-400 bg-primary-50 ring-2 ring-primary-200'
              : 'border-dashed border-2 border-slate-300 hover:border-primary-400 hover:bg-slate-50'
          }`}
        >
          <div className="card-body py-16 text-center">
            <div className={`mx-auto mb-4 h-14 w-14 rounded-full flex items-center justify-center ${
              dragOver ? 'bg-primary-100 text-primary-600' : 'bg-slate-100 text-slate-400'
            }`}>
              <Upload className="h-7 w-7" />
            </div>
            <p className="text-base font-medium text-slate-900">Drop your statement here</p>
            <p className="text-sm text-slate-500 mt-1">
              or click to browse — select multiple files to import them all at once
            </p>
            <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 rounded-full text-xs text-slate-500">
              <FileText className="h-3.5 w-3.5" />PDF, CSV, XLS, XLSX — max 25 MB each
            </div>
            <input
              ref={fileInput} type="file" accept=".pdf,.csv,.xls,.xlsx" multiple
              onChange={(e) => handleFileSelection(e.target.files)} className="hidden"
            />
          </div>
        </div>
      )}

      {source === 'computer' && !file && !result && batchFiles.length === 0 && batchResults.length === 0 && (
        <div className="card">
          <div className="card-body flex items-center gap-3">
            <input
              type="text"
              value={driveLinkUrl}
              onChange={(e) => setDriveLinkUrl(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDriveLinkImport() }}
              placeholder="Or paste a Google Drive link to the statement (or a Google Sheet)"
              className="input flex-1"
              disabled={driveLinkLoading}
            />
            <button
              onClick={handleDriveLinkImport}
              disabled={driveLinkLoading || !driveLinkUrl.trim()}
              className="btn-secondary shrink-0"
            >
              {driveLinkLoading
                ? <Spinner size="sm" />
                : <><HardDrive className="h-4 w-4 mr-1.5" />Fetch from Drive</>}
            </button>
          </div>
        </div>
      )}

      {/* --- Import from Drive --------------------------------------------- */}
      {source === 'drive' && !driveResults && (
        <div className="card">
          <div className="card-body">
            <div className="flex items-center gap-3 mb-5">
              <div className="h-10 w-10 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center">
                <HardDrive className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">
                  Import from a Google Drive folder
                </p>
                <p className="text-xs text-slate-500">
                  Which bank account each file belongs to is read off its own
                  filename and matched server-side — nothing is chosen here.
                  A file that can&rsquo;t be matched is left for you rather
                  than imported unassigned.
                </p>
              </div>
            </div>

            <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500 mb-0.5">
                    Reading from
                  </p>
                  {effectiveImportId ? (
                    <a
                      href={`https://drive.google.com/drive/folders/${effectiveImportId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary-600 hover:underline break-all"
                    >
                      {driveSourceLabel}
                    </a>
                  ) : (
                    <p className="text-sm text-slate-400">
                      No folder set up yet
                    </p>
                  )}
                </div>
                <button
                  onClick={() => navigate('/settings')}
                  className="btn-secondary shrink-0"
                >
                  Change in Settings
                </button>
              </div>
              <p className="mt-1.5 text-xs text-slate-500 flex items-start gap-1">
                <Info className="h-3.5 w-3.5 shrink-0 mt-px text-slate-400" />
                {readingExportFolder
                  ? 'The folder the Gmail Apps Script saves statements into.'
                  : 'A folder set separately from where Gmail statements are '
                    + 'collected — the Apps Script does not write here.'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="sm:col-span-2">
                <label className="label">
                  Pages to read (PDFs in this run){' '}
                  <span className="text-slate-400 font-normal">(blank = the whole file)</span>
                </label>
                <input
                  value={pages}
                  onChange={(e) => setPages(e.target.value)}
                  disabled={driveRunning}
                  autoComplete="off"
                  placeholder="All pages — or 30 for the first 30, or 31-65 for a range"
                  className={`input ${pageSpecErrorText ? 'border-red-300 focus:ring-red-200' : ''}`}
                />
                {pageSpecErrorText ? (
                  <p className="mt-1 text-xs text-red-600 flex items-start gap-1">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />{pageSpecErrorText}
                  </p>
                ) : rangeStartsLate ? (
                  <p className="mt-1 text-xs text-slate-500 flex items-start gap-1">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-px text-slate-400" />
                    Page 1 will be read as well on every PDF this run finds —
                    it carries the column header, and the pages after it do
                    not.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">
                    Applied to every PDF this run finds — an Excel or CSV file
                    in the same run ignores this.
                  </p>
                )}
              </div>

              <div className="sm:col-span-2">
                <label className="label">
                  Read in batches of{' '}
                  <span className="text-slate-400 font-normal">
                    (blank = 20 pages, the recommended setting)
                  </span>
                </label>
                <input
                  value={batchPages}
                  onChange={(e) => setBatchPages(e.target.value.replace(/[^\d]/g, ''))}
                  disabled={driveRunning}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="20"
                  className="input"
                />
                <p className="mt-1 text-xs text-slate-400">
                  A long PDF is read a stretch at a time and stitched back
                  into one import. Enter <span className="font-mono">0</span>{' '}
                  to read it in one pass.
                </p>
              </div>
            </div>

            <div className="flex justify-center">
              <button
                onClick={openDrivePicker}
                disabled={driveRunning || !!pageSpecErrorText}
                className="btn-primary"
              >
                {driveRunning ? (
                  <><Spinner size="sm" tone="white" className="mr-2" />{progress?.message || 'Working...'}</>
                ) : (
                  <><HardDrive className="h-4 w-4 mr-1.5" />Import from Drive</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Drive import result -------------------------------------------- */}
      {driveResults && (
        <div className="card">
          <div className="card-body">
            <h2 className="text-base font-semibold text-slate-900 mb-4">
              {driveResults.imported > 0 ? 'Drive import complete' : 'Nothing to import'}
            </h2>
            {(driveResults.files || []).length === 0 ? (
              <p className="text-sm text-slate-500">
                Every file in the Drive folder is already marked done.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {driveResults.files.map((f, i) => {
                  const retry = drivePwRetry[f.name]
                  return (
                    <div key={f.name + i} className="px-3 py-2.5 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 min-w-0">
                          {f.status === 'failed' ? (
                            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                          ) : f.status === 'password_required' ? (
                            <Lock className="h-4 w-4 text-amber-500 shrink-0" />
                          ) : f.status === 'skipped' ? (
                            <Info className="h-4 w-4 text-slate-400 shrink-0" />
                          ) : (
                            <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                          )}
                          <span className="truncate text-slate-700">{f.name}</span>
                        </span>
                        <span className="text-xs text-slate-500 shrink-0 ml-2">
                          {f.status === 'done' ? `${f.row_count} rows` : f.error}
                        </span>
                      </div>
                      {f.status === 'password_required' && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="w-56">
                            <PasswordInput
                              value={retry?.value || ''}
                              onChange={(v) => setDrivePwRetry((prev) => (
                                { ...prev, [f.name]: { ...prev[f.name], value: v, error: null } }
                              ))}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleDriveRetryPassword(f.name) }}
                              placeholder="Password for this file"
                              autoComplete="off"
                              invalid={!!retry?.error}
                            />
                          </div>
                          <button
                            onClick={() => handleDriveRetryPassword(f.name)}
                            disabled={!retry?.value || retry?.busy}
                            className="btn-secondary text-xs shrink-0"
                          >
                            {retry?.busy ? <Spinner size="sm" /> : 'Retry'}
                          </button>
                          {retry?.error && (
                            <span className="text-xs text-red-600">{retry.error}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <div className="mt-6 flex items-center gap-3">
              <button onClick={() => navigate('/staging')} className="btn-primary">
                View Imported Rows
              </button>
              <button onClick={resetDrive} className="btn-secondary">Check Drive Again</button>
            </div>
          </div>
        </div>
      )}

      {/* --- Confirm the file, then import in one action ------------------ */}
      {file && !result && (
        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center">
                  <File className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">{file.name}</p>
                  <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              </div>
              <button onClick={reset} className="p-1.5 rounded hover:bg-slate-100 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="label">Bank Account</label>
                <select value={bankId} onChange={(e) => setBankId(e.target.value)} className="input">
                  <option value="">
                    {banks.length === 0 ? 'No bank accounts in Master Data yet' : 'Not specified'}
                  </option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id} disabled={!b.is_active}>
                      {b.account_number ? `${b.bank_name} — ${b.account_number}` : b.bank_name}
                      {!b.is_active ? ' (deactivated)' : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400">
                  Tags every row with the account it came from, and fills the
                  Account Number field on any row the statement itself left
                  blank. Optional.
                </p>
              </div>

              {isPdf && (
                <div>
                  <label className="label">
                    PDF Password <span className="text-slate-400 font-normal">(if protected)</span>
                  </label>
                  <PasswordInput
                    value={password}
                    onChange={(v) => { setPassword(v); setPwError('') }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !importing) handleImport() }}
                    autoFocus={!!pwError}
                    autoComplete="off"
                    invalid={!!pwError}
                    icon={<Lock className="h-4 w-4" />}
                    placeholder="Leave blank if not protected"
                  />
                  {pwError ? (
                    <p className="mt-1 text-xs text-red-600 flex items-start gap-1">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />{pwError}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-400">Used once to unlock. Not stored.</p>
                  )}
                </div>
              )}

              {isPdf && (
                <div className="sm:col-span-2">
                  <label className="label">
                    Pages to read{' '}
                    <span className="text-slate-400 font-normal">(blank = the whole file)</span>
                  </label>
                  <input
                    value={pages}
                    onChange={(e) => setPages(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !importing) handleImport() }}
                    autoComplete="off"
                    placeholder="All pages — or 30 for the first 30, or 31-65 for a range"
                    className={`input ${pageSpecErrorText ? 'border-red-300 focus:ring-red-200' : ''}`}
                  />
                  {pageSpecErrorText ? (
                    <p className="mt-1 text-xs text-red-600 flex items-start gap-1">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />{pageSpecErrorText}
                    </p>
                  ) : rangeStartsLate ? (
                    <p className="mt-1 text-xs text-slate-500 flex items-start gap-1">
                      <Info className="h-3.5 w-3.5 shrink-0 mt-px text-slate-400" />
                      Page 1 will be read as well — it carries the column header, and
                      the pages after it do not. Its own transactions will appear in
                      this import and are flagged as already seen.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-400">
                      Long statements take about two seconds a page. Import one part
                      now and the rest afterwards if you would rather not wait.
                    </p>
                  )}
                </div>
              )}

              {isPdf && (
                <div className="sm:col-span-2">
                  <label className="label">
                    Read in batches of{' '}
                    <span className="text-slate-400 font-normal">
                      (blank = 20 pages, the recommended setting)
                    </span>
                  </label>
                  <input
                    value={batchPages}
                    onChange={(e) => setBatchPages(e.target.value.replace(/[^\d]/g, ''))}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="20"
                    className="input"
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    A long statement is read a stretch at a time and stitched back
                    into one import. This keeps memory flat however long the file
                    is, and the progress bar reports each stretch as it finishes.
                    Costs about 10% more time. Enter <span className="font-mono">0</span>{' '}
                    to read the file in one pass.
                  </p>
                </div>
              )}
            </div>

            {/* --- Which sheets to import -------------------------------- */}
            {isExcel && inspecting && (
              <div className="mb-5 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                <Spinner size="sm" />
                {uploadPct !== null
                  ? `Uploading the workbook... ${uploadPct}%`
                  : "Reading the workbook's sheets..."}
              </div>
            )}

            {isExcel && workbook && (
              <div className="mb-5">
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="label mb-0 flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-slate-400" />
                    Sheets to import
                  </p>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setChosenSheets(workbook.statement_sheets || [])}
                      className="font-medium text-primary-600 hover:text-primary-700"
                    >
                      Select all statements
                    </button>
                    <button
                      type="button"
                      onClick={() => setChosenSheets([])}
                      className="font-medium text-slate-500 hover:text-slate-700"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* One row per sheet, including the ones that cannot be
                    imported. Leaving those out would make a sheet that SHOULD
                    be a statement look like it does not exist; shown with the
                    reason, it is obvious that the columns were not recognised. */}
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {(workbook.sheets || []).map((s) => {
                    const picked = chosenSheets.includes(s.name)
                    return (
                      <label
                        key={s.name}
                        className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 first:rounded-t-lg last:rounded-b-lg ${
                          picked ? 'bg-primary-50/60' : 'hover:bg-slate-50'
                        } ${s.is_statement ? '' : 'opacity-70'}`}
                      >
                        <input
                          type="checkbox"
                          checked={picked}
                          onChange={() => toggleSheet(s.name)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-sm font-medium text-slate-900">{s.name}</span>
                            {s.is_statement ? (
                              <span className="text-xs text-slate-500">
                                {s.data_rows.toLocaleString('en-IN')} rows ·{' '}
                                {Object.keys(s.headers_detected || {}).length} columns matched ·
                                header on row {s.header_row}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                                <Info className="h-3 w-3" />Not a statement
                              </span>
                            )}
                          </span>
                          {!s.is_statement && s.reason && (
                            <span className="mt-0.5 block text-xs text-slate-500">{s.reason}</span>
                          )}
                          {/* Two spreadsheet columns mapping to one field is a
                              fieldmap problem the user can fix, and the only
                              way they can is by being told which column lost. */}
                          {s.is_statement && s.column_collisions?.length > 0 && (
                            <span className="mt-1 block text-xs text-amber-700">
                              {s.column_collisions.map((c) => (
                                <span key={c.field} className="block">
                                  Using <span className="font-medium">{c.used}</span> for this
                                  field — {c.ignored.join(', ')} also matched and{' '}
                                  {c.ignored.length === 1 ? 'is' : 'are'} being skipped.
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </label>
                    )
                  })}
                </div>

                <p className="mt-1.5 text-xs text-slate-400">
                  Each sheet is imported as its own batch, so they can be reviewed
                  and discarded separately. Pick the Bank Account above only if
                  every sheet you have ticked belongs to it.
                </p>
              </div>
            )}

            {/* The progress panels that used to sit here are now the
                full-screen step list — see ImportProgressOverlay, mounted at
                the bottom of this page. Same readings from the same job; a
                statement takes minutes and that wait had outgrown a strip
                inside a form. */}

            <div className="flex justify-center">
              <button
                onClick={handleImport}
                disabled={importing || inspecting || !!pageSpecErrorText
                          || (isExcel && !!workbook && chosenSheets.length === 0)}
                className="btn-primary"
              >
                {importing ? (
                  <>
                    <Spinner size="sm" tone="white" className="mr-2" />
                    {uploadPct !== null
                      ? `Uploading… ${uploadPct}%`
                      : progress
                        ? (progress.batch_total > 1 && progress.batch_index >= 1
                            ? `${stepWord} ${progress.batch_index}/${progress.batch_total} · ${progress.percent}%`
                            : `Working… ${progress.percent}%`)
                        : (isPdf ? 'Parsing PDF...' : 'Reading file...')}
                  </>
                ) : (
                  <><Upload className="h-4 w-4 mr-1.5" />Upload and Import</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Batch mode: more than one file selected ----------------------- */}
      {batchFiles.length > 0 && batchResults.length === 0 && (
        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between mb-6">
              <p className="text-sm font-medium text-slate-900">
                {batchFiles.length} files selected
              </p>
              <button
                onClick={resetBatch}
                disabled={batchRunning}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-5">
              <label className="label">Bank Account</label>
              <select
                value={bankId} onChange={(e) => setBankId(e.target.value)}
                disabled={batchRunning} className="input"
              >
                <option value="">
                  {banks.length === 0 ? 'No bank accounts in Master Data yet' : 'Not specified'}
                </option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id} disabled={!b.is_active}>
                    {b.account_number ? `${b.bank_name} — ${b.account_number}` : b.bank_name}
                    {!b.is_active ? ' (deactivated)' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">
                Applied to every file in this batch — each is imported one at a
                time under this same account. A password-protected PDF, or
                picking only some of a workbook's sheets, is only available
                importing one file at a time; a workbook here imports every
                sheet that looks like a statement.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="sm:col-span-2">
                <label className="label">
                  Pages to read (PDFs in this batch){' '}
                  <span className="text-slate-400 font-normal">(blank = the whole file)</span>
                </label>
                <input
                  value={pages}
                  onChange={(e) => setPages(e.target.value)}
                  disabled={batchRunning}
                  autoComplete="off"
                  placeholder="All pages — or 30 for the first 30, or 31-65 for a range"
                  className={`input ${pageSpecErrorText ? 'border-red-300 focus:ring-red-200' : ''}`}
                />
                {pageSpecErrorText ? (
                  <p className="mt-1 text-xs text-red-600 flex items-start gap-1">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />{pageSpecErrorText}
                  </p>
                ) : rangeStartsLate ? (
                  <p className="mt-1 text-xs text-slate-500 flex items-start gap-1">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-px text-slate-400" />
                    Page 1 will be read as well on every PDF in this batch —
                    it carries the column header, and the pages after it do
                    not.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">
                    Applied to every PDF in this batch — an Excel or CSV file
                    in the same batch ignores this.
                  </p>
                )}
              </div>

              <div className="sm:col-span-2">
                <label className="label">
                  Read in batches of{' '}
                  <span className="text-slate-400 font-normal">
                    (blank = 20 pages, the recommended setting)
                  </span>
                </label>
                <input
                  value={batchPages}
                  onChange={(e) => setBatchPages(e.target.value.replace(/[^\d]/g, ''))}
                  disabled={batchRunning}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="20"
                  className="input"
                />
                <p className="mt-1 text-xs text-slate-400">
                  A long PDF is read a stretch at a time and stitched back
                  into one import. Enter <span className="font-mono">0</span>{' '}
                  to read it in one pass.
                </p>
              </div>
            </div>

            <div className="mb-6 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {batchFiles.map((f, i) => (
                <div key={f.name + i} className="flex items-center justify-between px-3 py-2.5 text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    <File className="h-4 w-4 text-slate-400 shrink-0" />
                    <span className="truncate text-slate-700">{f.name}</span>
                  </span>
                  {batchRunning && (
                    batchIndex - 1 > i ? (
                      <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                    ) : batchIndex - 1 === i ? (
                      <Spinner size="sm" />
                    ) : (
                      <span className="text-xs text-slate-400 shrink-0">Waiting</span>
                    )
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-center gap-2">
              <button
                onClick={handleImportBatch}
                disabled={batchRunning || !!pageSpecErrorText}
                className="btn-primary"
              >
                {batchRunning ? (
                  <>
                    <Spinner size="sm" tone="white" className="mr-2" />
                    File {batchIndex}/{batchFiles.length}
                    {progress
                      ? ` · ${progress.percent}%`
                      : uploadPct !== null ? ` · Uploading ${uploadPct}%` : ''}
                  </>
                ) : (
                  <><Upload className="h-4 w-4 mr-1.5" />Import {batchFiles.length} Files</>
                )}
              </button>
              {/* Stops after the file currently parsing -- see
                  handleImportBatch's jobCancelled branch, which marks every
                  file from here on "Not started" instead of trying the rest. */}
              {batchRunning && currentJobId && (
                <button
                  onClick={handleStopImport}
                  disabled={stoppingImport}
                  className="flex items-center gap-1.5 rounded-lg bg-red-500
                             px-3 py-2 text-sm font-semibold text-white
                             transition-colors hover:bg-red-600
                             disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  {stoppingImport ? 'Stopping…' : 'Stop'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- Batch mode result ---------------------------------------------- */}
      {batchResults.length > 0 && (
        <div className="card">
          <div className="card-body">
            <h2 className="text-base font-semibold text-slate-900 mb-4">Batch import complete</h2>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {batchResults.map((r, i) => {
                const retry = batchPwRetry[i]
                return (
                  <div key={r.name + i} className="px-3 py-2.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 min-w-0">
                        {r.status === 'failed' ? (
                          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                        ) : r.status === 'password_required' ? (
                          <Lock className="h-4 w-4 text-amber-500 shrink-0" />
                        ) : r.status === 'empty' ? (
                          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                        ) : (
                          <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                        )}
                        <span className="truncate text-slate-700">{r.name}</span>
                      </span>
                      <span className="text-xs text-slate-500 shrink-0 ml-2">
                        {r.status === 'failed' || r.status === 'password_required'
                          ? r.error : `${r.rowCount} rows`}
                      </span>
                    </div>
                    {r.status === 'password_required' && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="w-56">
                          <PasswordInput
                            value={retry?.value || ''}
                            onChange={(v) => setBatchPwRetry((prev) => (
                              { ...prev, [i]: { ...prev[i], value: v, error: null } }
                            ))}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleBatchRetryPassword(i) }}
                            placeholder="Password for this file"
                            autoComplete="off"
                            invalid={!!retry?.error}
                          />
                        </div>
                        <button
                          onClick={() => handleBatchRetryPassword(i)}
                          disabled={!retry?.value || retry?.busy}
                          className="btn-secondary text-xs shrink-0"
                        >
                          {retry?.busy ? <Spinner size="sm" /> : 'Retry'}
                        </button>
                        {retry?.error && (
                          <span className="text-xs text-red-600">{retry.error}</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="mt-6 flex items-center gap-3">
              <button onClick={() => navigate('/staging')} className="btn-primary">
                View Imported Rows
              </button>
              <button onClick={resetBatch} className="btn-secondary">Import More Files</button>
            </div>
          </div>
        </div>
      )}

      {/* --- Import result ------------------------------------------------ */}
      {result && (
        <div className="card">
          <div className="card-body">
            <div className="flex items-start gap-3">
              <div className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center ${
                result.row_count > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
              }`}>
                {result.row_count > 0
                  ? <CheckCircle className="h-5 w-5" />
                  : <AlertCircle className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-900">
                  {result.row_count > 0 ? 'Import complete' : 'Nothing imported'}
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  <span className="font-medium text-slate-700">{file?.name}</span>
                  {' · '}{result.stats?.parsed ?? 0} rows read
                  {' · '}<span className="font-medium text-slate-700">{result.row_count}</span> written to temp_trans
                  {result.duplicate_rows > 0 && ` · ${result.duplicate_rows} also seen in an earlier import`}
                </p>
              </div>
            </div>

            {/* One line per sheet. A workbook import is several batches, and a
                single total hides the one sheet that came back empty — which is
                the only line anyone needs to act on. */}
            {result.sheets?.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/60 text-xs text-slate-500">
                      <th className="px-3 py-2 text-left font-medium">Sheet</th>
                      <th className="px-3 py-2 text-right font-medium">Rows read</th>
                      <th className="px-3 py-2 text-right font-medium">Staged</th>
                      <th className="px-3 py-2 text-right font-medium">Already seen</th>
                      <th className="px-3 py-2 text-right font-medium">Batch</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.sheets.map((s) => (
                      <tr key={s.sheet || 'file'} className={s.error ? 'bg-amber-50/60' : ''}>
                        <td className="px-3 py-2">
                          <span className="font-medium text-slate-800">
                            {s.sheet || file?.name}
                          </span>
                          {s.error && (
                            <span className="mt-0.5 block text-xs text-amber-700">{s.error}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                          {s.parsed.toLocaleString('en-IN')}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">
                          {s.staged.toLocaleString('en-IN')}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {s.duplicate_rows ? s.duplicate_rows.toLocaleString('en-IN') : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                          {s.batch_id ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sheets present in the file that were not imported, so a tab left
                unticked by accident does not just quietly not appear. */}
            {statementSheetCount > result.sheets_imported && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-700">
                  Imported <span className="font-medium">
                    {result.sheets_imported} of {statementSheetCount}
                  </span> statement sheets in this workbook.
                  {' '}Upload the file again and tick the others to add them —
                  each sheet is staged separately, so nothing already imported is
                  affected.
                </p>
              </div>
            )}

            {/* Only when part of the file was read — otherwise the whole file
                is the obvious answer and saying so is noise. */}
            {result.batches > 1 && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-700">
                  Read in <span className="font-medium">{result.batches} batches</span>
                  {' '}of {result.batch_pages} pages and stitched into one import —
                  which is what keeps the narrower columns detected on a long file.
                </p>
              </div>
            )}

            {result.pages_parsed?.length > 0 && result.pages_total
              && result.pages_parsed.length < result.pages_total && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-700">
                  <span className="font-medium">
                    Read {result.pages_parsed.length} of {result.pages_total} pages
                  </span>
                  {' — '}
                  {result.header_page_added
                    ? `page 1 (for the column header) plus ${result.pages_parsed[1]}–${result.pages_parsed[result.pages_parsed.length - 1]}.`
                    : `pages ${result.pages_parsed[0]}–${result.pages_parsed[result.pages_parsed.length - 1]}.`}
                  {result.pages_total > result.pages_parsed.length && (
                    <>
                      <br />
                      Import the rest by uploading the same file again with a range
                      starting at page{' '}
                      {result.pages_parsed[result.pages_parsed.length - 1] + 1}.
                    </>
                  )}
                </p>
              </div>
            )}

            {Object.keys(headers).length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-medium text-slate-600 mb-2">Columns matched</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(headers).map(([field, header]) => (
                    <span key={field} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-slate-200 rounded text-xs">
                      <span className="text-slate-400">{field}</span>
                      <ArrowRight className="h-3 w-3 text-slate-300" />
                      <span className="font-medium text-slate-700">{String(header)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {unmapped.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs text-amber-800">
                  <span className="font-medium">Unmatched columns:</span> {unmapped.join(', ')}
                  <br />
                  Add these spellings under Field Mapping if you want them captured.
                </p>
              </div>
            )}

            {Object.keys(docFields).length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-slate-600 mb-2">Auto-filled from the document</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(docFields).map(([f, v]) => (
                    <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded text-xs">
                      <span className="opacity-70">{f}:</span>
                      <span className="font-medium">{String(v)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {partialFill.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-slate-600 mb-2">
                  Partially filled fields
                  <span className="font-normal text-slate-400"> — 0% usually means the column was never matched</span>
                </p>
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  {partialFill.map(([field, info]) => {
                    const pct = Math.round((info.filled / info.total) * 100)
                    return (
                      <span key={field} className="text-xs">
                        <span className="text-slate-500">{field}</span>{' '}
                        <span className={
                          pct === 0 ? 'text-red-600 font-medium'
                            : pct < 50 ? 'text-amber-600 font-medium'
                            : 'text-slate-600'
                        }>{info.filled}/{info.total} ({pct}%)</span>
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="mt-6 flex items-center gap-3">
              <button onClick={() => navigate('/staging')} className="btn-primary">
                View Imported Rows
              </button>
              <button onClick={reset} className="btn-secondary">Import Another</button>
            </div>
          </div>
        </div>
      )}

      {/* Covers the window for the whole import. Every line in it is a phase
          the server has actually reported — see the component. Shared with
          Drive import: a Drive run's job reports one step per file, in the
          exact shape the overlay already reads a workbook's one-step-per-sheet
          progress from -- skipUploadStep drops the browser-upload line, which
          isn't real for files that came from Drive rather than this tab.
          realProgress is true only for an actual PDF's own page-by-page read
          (services/pdf_import.py's parsers._progress.hook) -- a Drive run and
          an Excel/CSV sheet (services/tabular_import.py) are both read and
          staged without ever ticking their job, so showing a live percent for
          either would only ever read a frozen 0% until it snapped to 100. */}
      <ImportProgressOverlay
        open={importing || driveRunning}
        fileName={driveRunning ? driveSourceLabel : (file?.name || '')}
        uploadPct={driveRunning ? null : uploadPct}
        progress={progress}
        stepWord={driveRunning ? 'File' : stepWord}
        skipUploadStep={driveRunning}
        realProgress={!driveRunning && isPdf}
        onStop={currentJobId ? handleStopImport : undefined}
        stopping={stoppingImport}
      />

      {/* --- Drive file picker -------------------------------------------- */}
      <Modal isOpen={pickerOpen} onClose={() => setPickerOpen(false)}
            title={`Select files to import — ${driveSourceLabel}`} size="lg">
        {pickerLoading ? (
          <div className="py-10 flex justify-center"><Spinner /></div>
        ) : pickerFiles.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            Nothing pending — every file in the Drive folder is already
            marked done or waiting on a password.
          </p>
        ) : (
          <>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                autoComplete="off"
                placeholder="Search by filename or keyword..."
                className="input pl-9"
              />
              {pickerSearch && (
                <button
                  onClick={() => setPickerSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <label className="flex items-center gap-2.5 pb-3 mb-2 border-b border-slate-100 cursor-pointer">
              <input
                type="checkbox"
                checked={pickerVisible.length > 0
                  && pickerVisible.every((f) => pickerSelected.has(f.id))}
                onChange={() => togglePickerAll(pickerVisible)}
                className="h-4 w-4 rounded border-slate-300 text-primary-600"
              />
              <span className="text-sm font-medium text-slate-700">
                Select all
                {pickerSearch ? ` matching (${pickerVisible.length})` : ` (${pickerFiles.length})`}
              </span>
            </label>

            {pickerVisible.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">
                Nothing matches "{pickerSearch}".
              </p>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {pickerVisible.map((f) => {
                  const isDuplicate = pickerDuplicateNames.has(f.name)
                  const isSkipping = pickerSkipping.has(f.id)
                  return (
                    <div key={f.id}
                        className={`flex items-center gap-2.5 py-1.5 px-1 rounded hover:bg-slate-50 ${
                          isSkipping ? 'opacity-40' : ''
                        }`}>
                      <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pickerSelected.has(f.id)}
                          onChange={() => togglePickerFile(f.id)}
                          disabled={isSkipping}
                          className="h-4 w-4 rounded border-slate-300 text-primary-600 shrink-0"
                        />
                        <span className="text-sm text-slate-700 font-mono truncate">{f.name}</span>
                      </label>
                      {f.unmatched && (
                        <span
                          title={f.reason}
                          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5
                                     rounded-full text-[11px] font-medium bg-red-50
                                     text-red-700 border border-red-100"
                        >
                          <AlertCircle className="h-3 w-3" />No bank match
                        </span>
                      )}
                      {isDuplicate && (
                        <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5
                                         rounded-full text-[11px] font-medium bg-amber-50
                                         text-amber-700 border border-amber-100">
                          <Copy className="h-3 w-3" />Duplicate
                        </span>
                      )}
                      {f.restored && (
                        <span
                          title="Set aside earlier — its bank account now exists, so it is importable again."
                          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5
                                     rounded-full text-[11px] font-medium bg-emerald-50
                                     text-emerald-700 border border-emerald-100"
                        >
                          <RotateCcw className="h-3 w-3" />Back
                        </span>
                      )}
                      {(isDuplicate || f.unmatched) && (
                        <button
                          onClick={() => handleSkipPickerFile(f)}
                          disabled={isSkipping}
                          title="Set aside: hides it from this list but keeps the file in Drive. Adding the account to Master Data brings it back."
                          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded
                                     text-xs font-medium text-slate-500 hover:text-primary-700
                                     hover:bg-primary-50 disabled:opacity-40"
                        >
                          {isSkipping
                            ? <Spinner size="sm" />
                            : <><EyeOff className="h-3.5 w-3.5" />Skip</>}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4 mt-3 border-t border-slate-100">
              <button onClick={() => setPickerOpen(false)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleImportFromDrive}
                disabled={pickerSelected.size === 0}
                className="btn-primary"
              >
                <HardDrive className="h-4 w-4 mr-1.5" />
                Import {pickerSelected.size > 0 ? `(${pickerSelected.size})` : ''}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* --- Unmatched bank accounts warning ------------------------------- */}
      <Modal isOpen={unmatchedOpen} onClose={() => setUnmatchedOpen(false)}
            title="Bank accounts not found" size="md">
        <p className="text-sm text-slate-600 mb-3">
          {unmatchedList.length} file{unmatchedList.length === 1 ? '' : 's'}{' '}
          name a bank account that isn't in your Bank Master (or the filename
          itself couldn't be read). Importing them would just fail the same
          way. Setting them aside hides them from this list but leaves every
          file in Drive — add the missing account to Master Data and they
          come straight back.
        </p>
        <div className="max-h-56 overflow-y-auto space-y-1.5 mb-4 rounded-lg border border-slate-200 p-2">
          {unmatchedList.map((f) => (
            <div key={f.id} className="text-xs">
              <p className="font-mono text-slate-700 truncate">{f.name}</p>
              <p className="text-slate-400">{f.reason}</p>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setUnmatchedOpen(false)}
            disabled={skippingUnmatched}
            className="btn-secondary"
          >
            Keep them in the list
          </button>
          <button
            onClick={handleSkipUnmatched}
            disabled={skippingUnmatched}
            className="btn-primary"
          >
            {skippingUnmatched
              ? <Spinner size="sm" tone="white" className="mr-1.5" />
              : <EyeOff className="h-4 w-4 mr-1.5" />}
            Skip {unmatchedList.length}
          </button>
        </div>
      </Modal>
    </div>
  )
}
