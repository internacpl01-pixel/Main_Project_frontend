import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  importPdf, importExcel, importCsv, inspectExcel, fetchMasterData,
  pollImportJob,
} from '../api/endpoints.js'
import { PasswordInput, Spinner } from '../components/UI.jsx'
import toast from 'react-hot-toast'
import {
  Upload, FileText, X, File, CheckCircle, AlertCircle, Lock, ArrowRight, Info,
  Layers,
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
                          onUploadPercent) {
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
  const fileInput = useRef()
  const navigate = useNavigate()

  useEffect(() => {
    fetchMasterData('bank').then((b) => setBanks(Array.isArray(b) ? b : [])).catch(() => {})
  }, [])

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

  const toggleSheet = (name) => {
    setChosenSheets((prev) => prev.includes(name)
      ? prev.filter((n) => n !== name)
      : [...prev, name])
  }

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0])
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
    try {
      const res = await importFile(file, bankId || null, password, pages.trim(),
                                   batchPages.trim() === '' ? null : Number(batchPages),
                                   setProgress, chosenSheets.join(','),
                                   // At 100 the browser has handed over every
                                   // byte; from here the wait belongs to the
                                   // parse, which reports itself.
                                   (pct) => setUploadPct(pct >= 100 ? null : pct))
      setResult(res)
      if (res.row_count > 0) {
        toast.success(
          res.sheets_imported > 1
            ? `Imported ${res.row_count} rows from ${res.sheets_imported} sheets`
            : `Imported ${res.row_count} rows`
        )
      } else toast.error('No transaction rows could be extracted from this file.')
    } catch (err) {
      // A wrong or missing password keeps the form up with the reason inline,
      // rather than a toast that disappears before it can be acted on.
      if (isPasswordProblem(err.message)) {
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* --- Pick a file ------------------------------------------------- */}
      {!file && !result && (
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
            <p className="text-sm text-slate-500 mt-1">or click to browse</p>
            <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 rounded-full text-xs text-slate-500">
              <FileText className="h-3.5 w-3.5" />PDF, CSV, XLS, XLSX — max 25 MB
            </div>
            <input
              ref={fileInput} type="file" accept=".pdf,.csv,.xls,.xlsx"
              onChange={(e) => handleFile(e.target.files[0])} className="hidden"
            />
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
                    <option key={b.id} value={b.id}>
                      {b.account_number ? `${b.bank_name} — ${b.account_number}` : b.bank_name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400">
                  Tags every row with the account it came from. Optional.
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

            {/* Real progress, not an animation: the server counts pages as it
                finishes them and this is that count. It only appears once the
                first reading arrives, so a fast file never flashes a bar.

                A batched import gets a bar PER BATCH, restarting at zero for
                each one. One bar spread over the whole file barely moves for
                minutes at a time, which reads as a hang; a bar per batch moves
                at a visible rate and the finished batches stay listed below it,
                so nothing about where the import has got to is lost. */}
            {/* The upload's own bar, shown until the last byte lands. Same
                shape as the parse bar below it and never both at once —
                they are two halves of one wait, in order. */}
            {importing && uploadPct !== null && (
              <div className="mb-5">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-sm font-medium text-slate-700">
                    Uploading {file?.name}
                  </span>
                  <span className="text-sm font-semibold text-slate-900 tabular-nums">
                    {uploadPct}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary-600 transition-all duration-300 ease-out"
                    style={{ width: `${uploadPct}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  Sending the file to the server. Reading it starts once it has
                  all arrived.
                </p>
              </div>
            )}

            {importing && uploadPct === null && progress && (
              <div className="mb-5">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-sm font-medium text-slate-700">
                    {progress.state === 'saving'
                      ? 'Saving rows'
                      : progress.batch_total > 1 && progress.batch_index >= 1
                        ? `${stepWord} ${progress.batch_index} of ${progress.batch_total}`
                          + (progress.batch_label ? ` — ${progress.batch_label}` : '')
                        : 'Reading statement'}
                  </span>
                  <span className="text-sm font-semibold text-slate-900 tabular-nums">
                    {progress.percent}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary-600 transition-all duration-500 ease-out"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  {progress.message}
                  {progress.total_pages ? ` · ${progress.total_pages} pages` : ''}
                  {progress.elapsed_ms >= 1000
                    ? ` · ${Math.round(progress.elapsed_ms / 1000)}s elapsed`
                    : ''}
                  {progress.batch_total > 1
                    ? ` · ${progress.overall_percent}% of the file`
                    : ''}
                </p>
                {progress.batch_total > 1 && progress.batches_done?.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {progress.batches_done.map((b) => (
                      <li key={b.index}
                          className="flex items-center text-xs text-emerald-700">
                        <CheckCircle className="mr-1.5 h-3 w-3 shrink-0" />
                        {stepWord} {b.index} of {b.total} completed · {b.label} ·{' '}
                        {b.rows} rows
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

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
    </div>
  )
}
