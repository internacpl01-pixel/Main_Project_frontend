import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  importPdf, importExcel, importCsv, fetchMasterData, pollImportJob,
} from '../api/endpoints.js'
import toast from 'react-hot-toast'
import {
  Upload, FileText, X, File, CheckCircle, AlertCircle, Lock, ArrowRight, Info,
  Eye, EyeOff,
} from 'lucide-react'

// One step, like DPL: the file is parsed and written on the same request.
// There is no dry run and no confirm — /imports/* is always called with
// save=true, exactly as DPL's Api.uploadPdf always sent save:'true'. What the
// parser found is reported afterwards, from the same response.
//
// A PDF goes the background route: it hands back a job id in milliseconds and
// the parse continues server-side, which is what makes a real progress bar
// possible and what keeps a long statement from outliving the request. Excel
// and CSV stay direct — they finish in about a second, so a job would be more
// machinery than the work it describes.
async function importFile(file, bankId = null, password = '', pages = '',
                          batchPages = null, onProgress) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (ext === 'pdf') {
    const started = await importPdf(file, true, bankId, password,
                                    { pages, batchPages, background: true })
    return pollImportJob(started.job_id, onProgress)
  }
  if (ext === 'csv') return importCsv(file, true, bankId)
  return importExcel(file, true, bankId)
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
  // A bank's PDF password is something read off an email or an SMS — usually a
  // date of birth or part of an account number — so being able to check what
  // was typed is the difference between one attempt and three. Off by default,
  // and reset with the form.
  const [showPassword, setShowPassword] = useState(false)
  // "" = every page. A count or a range narrows it.
  const [pages, setPages] = useState('')
  // "" leaves the server's default (20). "0" reads the file in one pass.
  const [batchPages, setBatchPages] = useState('')
  // The last reading from the running job, or null when nothing is running.
  const [progress, setProgress] = useState(null)
  const fileInput = useRef()
  const navigate = useNavigate()

  useEffect(() => {
    fetchMasterData('bank').then((b) => setBanks(Array.isArray(b) ? b : [])).catch(() => {})
  }, [])

  const handleFile = useCallback((f) => {
    if (!f) return
    if (f.size > 25 * 1024 * 1024) { toast.error('File too large (max 25 MB)'); return }
    const ext = f.name.split('.').pop().toLowerCase()
    if (!['pdf', 'csv', 'xls', 'xlsx'].includes(ext)) {
      toast.error('Unsupported format. Use PDF, CSV, XLS, or XLSX.'); return
    }
    setFile(f)
    setResult(null)
    setPwError('')
  }, [])

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0])
  }

  const handleImport = async () => {
    const specError = pageSpecError(pages)
    if (specError) { toast.error(specError); return }

    setImporting(true)
    setPwError('')
    setProgress(null)
    try {
      const res = await importFile(file, bankId || null, password, pages.trim(),
                                   batchPages.trim() === '' ? null : Number(batchPages),
                                   setProgress)
      setResult(res)
      if (res.row_count > 0) toast.success(`Imported ${res.row_count} rows`)
      else toast.error('No transaction rows could be extracted from this file.')
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
    }
  }

  const reset = () => {
    setFile(null); setResult(null); setImporting(false)
    setPassword(''); setPwError(''); setPages(''); setProgress(null)
    setShowPassword(false); setBatchPages('')
  }

  const isPdf = file?.name?.toLowerCase().endsWith('.pdf')
  const pageSpecErrorText = pageSpecError(pages)
  // A range not starting at page 1 gets page 1 added server-side, for its
  // header. Said before the upload rather than after, so the duplicate rows it
  // produces are expected rather than alarming.
  const rangeStartsLate = /^\s*(\d+)\s*-\s*\d+\s*$/.test(pages)
    && Number(pages.trim().split('-')[0]) > 1

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
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setPwError('') }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !importing) handleImport() }}
                      autoFocus={!!pwError}
                      autoComplete="off"
                      placeholder="Leave blank if not protected"
                      className={`input pl-9 pr-10 ${pwError ? 'border-red-300 focus:ring-red-200' : ''}`}
                    />
                    {password && (
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        tabIndex={-1}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        title={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                      >
                        {showPassword
                          ? <EyeOff className="h-4 w-4" />
                          : <Eye className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
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
                    into one import. The parser picks one reading strategy for the
                    whole document, so a few awkward pages can cost columns on
                    every page; reading in stretches keeps that contained. Costs
                    about 10% more time. Enter <span className="font-mono">0</span>{' '}
                    to read the file in one pass.
                  </p>
                </div>
              )}
            </div>

            {/* Real progress, not an animation: the server counts pages as it
                finishes them and this is that count. It only appears once the
                first reading arrives, so a fast file never flashes a bar.

                A batched import gets a bar PER BATCH, restarting at zero for
                each one. One bar spread over the whole file barely moves for
                minutes at a time, which reads as a hang; a bar per batch moves
                at a visible rate and the finished batches stay listed below it,
                so nothing about where the import has got to is lost. */}
            {importing && progress && (
              <div className="mb-5">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-sm font-medium text-slate-700">
                    {progress.state === 'saving'
                      ? 'Saving rows'
                      : progress.batch_total > 1 && progress.batch_index >= 1
                        ? `Batch ${progress.batch_index} of ${progress.batch_total}`
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
                        Batch {b.index} of {b.total} completed · {b.label} ·{' '}
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
                disabled={importing || !!pageSpecErrorText}
                className="btn-primary"
              >
                {importing ? (
                  <>
                    <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-r-transparent" />
                    {progress
                      ? (progress.batch_total > 1 && progress.batch_index >= 1
                          ? `Batch ${progress.batch_index}/${progress.batch_total} · ${progress.percent}%`
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
