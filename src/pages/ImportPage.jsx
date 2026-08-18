import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { importPdf, importExcel, importCsv, fetchMasterData } from '../api/endpoints.js'
import toast from 'react-hot-toast'
import {
  Upload, FileText, X, File, CheckCircle, AlertCircle, Lock, ArrowRight,
} from 'lucide-react'

// One step, like DPL: the file is parsed and written on the same request.
// There is no dry run and no confirm — /imports/* is always called with
// save=true, exactly as DPL's Api.uploadPdf always sent save:'true'. What the
// parser found is reported afterwards, from the same response.
async function importFile(file, bankId = null, password = '') {
  const ext = file.name.split('.').pop().toLowerCase()
  if (ext === 'pdf') return importPdf(file, true, bankId, password)
  if (ext === 'csv') return importCsv(file, true, bankId)
  return importExcel(file, true, bankId)
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
    setImporting(true)
    setPwError('')
    try {
      const res = await importFile(file, bankId || null, password)
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
    }
  }

  const reset = () => {
    setFile(null); setResult(null); setImporting(false)
    setPassword(''); setPwError('')
  }

  const isPdf = file?.name?.toLowerCase().endsWith('.pdf')

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
                      type="password"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setPwError('') }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !importing) handleImport() }}
                      autoFocus={!!pwError}
                      autoComplete="off"
                      placeholder="Leave blank if not protected"
                      className={`input pl-9 ${pwError ? 'border-red-300 focus:ring-red-200' : ''}`}
                    />
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
            </div>

            <div className="flex justify-center">
              <button onClick={handleImport} disabled={importing} className="btn-primary">
                {importing ? (
                  <>
                    <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-r-transparent" />
                    {isPdf ? 'Parsing PDF...' : 'Reading file...'} please wait
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
