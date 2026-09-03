import { api } from './apiClient.js'

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function login(username, password) {
  const params = new URLSearchParams()
  params.append('username', username)
  params.append('password', password)
  const { data } = await api.post('/auth/login', params)
  return data
}

export async function logout() {
  await api.post('/auth/logout')
}

export async function getMe() {
  const { data } = await api.get('/auth/me')
  return data
}

// Change the signed-in account's own password. Works for every role, including
// a super admin — whose row lives in admin.users with no company, so the Users
// page cannot reach it. 400 if the current password is wrong or the new one is
// too short; the server's sentence is what gets shown.
export async function changePassword(currentPassword, newPassword) {
  const { data } = await api.post('/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  })
  return data
}

// POST /auth/switch-company no longer exists. A super admin administers
// companies and does not work inside one, so there is no company for them to
// switch into — see the note in backend/routers/auth.py.

// ── Companies (super-admin only) ─────────────────────────────────────────────

export async function fetchCompanies(includeInactive = false) {
  const { data } = await api.get('/companies/', {
    params: includeInactive ? { include_inactive: true } : {},
  })
  return data
}

export async function registerCompany(payload) {
  // payload: { name, code, copy_from_id?, admin_username?, admin_password? }
  // code is three lowercase letters and prefixes every username in the company.
  // copy_from_id gives the new company the source's columns, fieldmap, projects
  // and master data — never its transactions, imports or accounts.
  // Returns { company, admin, copied }. admin is null when no first admin was
  // seeded; copied is null for a blank company.
  const { data } = await api.post('/companies/', payload)
  return data
}

export async function fetchClonePreview(companyId) {
  // What copying this company would bring across, counted server-side.
  // { company, fields, custom_columns, projects, masters, tables }
  const { data } = await api.get(`/companies/${companyId}/clone-preview`)
  return data
}

export async function fetchDeleteCheck(companyId) {
  // Whether the company can be deleted and what is blocking it, asked before
  // the confirm dialog offers the button.
  const { data } = await api.get(`/companies/${companyId}/delete-check`)
  return data
}

export async function deleteCompany(companyId, confirmName) {
  // Permanent, and refused server-side unless the company holds no data.
  // confirm_name must match the company's name exactly.
  const { data } = await api.delete(`/companies/${companyId}`, {
    data: { confirm_name: confirmName },
  })
  return data
}

export async function addCompanyAdmin(companyId, username, password) {
  // The super admin's only way to put a person inside a company.
  const { data } = await api.post(`/companies/${companyId}/admin`, { username, password })
  return data
}

export async function updateCompany(companyId, payload) {
  // payload: { name?, code?, is_active? }
  const { data } = await api.patch(`/companies/${companyId}`, payload)
  return data
}

// ── Users (manager and above, scoped to the current company) ─────────────────

export async function fetchUsers() {
  const { data } = await api.get('/users/')
  return data
}

export async function createUser(payload) {
  // payload: { username, password, role }
  const { data } = await api.post('/users/', payload)
  return data
}

export async function updateUser(userId, payload) {
  // payload: { username?, password? }
  const { data } = await api.patch(`/users/${userId}`, payload)
  return data
}

export async function updateUserRole(userId, role) {
  // The backend declares Body(..., embed=True) on `role`, so it must be an
  // object, not a bare string.
  const { data } = await api.put(`/users/${userId}/role`, { role })
  return data
}

export async function deleteUser(userId) {
  const { data } = await api.delete(`/users/${userId}`)
  return data
}

// ── Project assignment ───────────────────────────────────────────────────────

export async function fetchUserProjects(userId) {
  // Returns every active project flagged with whether this user is on it,
  // plus sees_all_projects for admin accounts that need no assignment.
  const { data } = await api.get(`/users/${userId}/projects`)
  return data
}

export async function setUserProjects(userId, projectIds) {
  // The complete set, not a delta — see PUT /users/{id}/projects.
  const { data } = await api.put(`/users/${userId}/projects`, { project_ids: projectIds })
  return data
}

export async function fetchProjectMembers(projectId) {
  const { data } = await api.get(`/projects/${projectId}/members`)
  return data
}

// ── Projects ─────────────────────────────────────────────────────────────────

export async function fetchProjects() {
  const { data } = await api.get('/projects/')
  return data
}

export async function createProject(payload) {
  const { data } = await api.post('/projects/', payload)
  return data
}

export async function updateProject(projectId, payload) {
  const { data } = await api.patch(`/projects/${projectId}`, payload)
  return data
}

export async function deleteProject(projectId) {
  const { data } = await api.delete(`/projects/${projectId}`)
  return data
}

// ── Custom Fields (FieldMap) ──────────────────────────────────────────────────
// Aliases: fetchFieldMap, createFieldMapEntry, updateFieldMapEntry, deleteFieldMapEntry
// Page alias names: fetchFieldMappings, createFieldMapping, updateFieldMapping, deleteFieldMapping

export async function fetchFieldMap() {
  const { data } = await api.get('/fieldmap/')
  return data
}
export const fetchFieldMappings = fetchFieldMap

// There is no createFieldMapEntry. POST /fieldmap/ was removed: a mapping with
// no real column behind it still competes for a statement's header row, and one
// named Debit/Credit outmatched the real amount column's "Credit" alias, took
// the column and had nowhere to put the value. Fields are created by
// createCustomField below, which makes the column and the mapping together.

export async function updateFieldMapEntry(fieldmapId, payload) {
  const { data } = await api.patch(`/fieldmap/${fieldmapId}`, payload)
  return data
}
export const updateFieldMapping = updateFieldMapEntry

export async function deleteFieldMapEntry(fieldmapId) {
  const { data } = await api.delete(`/fieldmap/${fieldmapId}`)
  return data
}
export const deleteFieldMapping = deleteFieldMapEntry

// Audit trail of every fieldmap edit. Manager+; staff get a 403.
// Returns { rows, total, page, limit, offset }.
export async function fetchFieldChangeLog(params = {}) {
  const { data } = await api.get('/fieldmap/change-log', { params })
  return data
}

// ── Custom Fields ────────────────────────────────────────────────────────────
// These add and drop real columns on temp_trans. /fieldmap above only edits how
// an existing column is recognised — it never changes the table.

export async function fetchCustomFields() {
  const { data } = await api.get('/custom-fields/')
  return data
}

export async function createCustomField(type, displayname = '', mapfields = '', method = '') {
  // The column name is generated server-side (field_num_1, ...) because it is
  // interpolated into ALTER TABLE. Only the label is yours to choose.
  const { data } = await api.post('/custom-fields/', { type, displayname, mapfields, method })
  return data
}

export async function deleteCustomFieldById(fieldmapId) {
  // By id, not by name. A fieldname is not guaranteed to be URL-safe: a mapping
  // called 'Debit/Credit' contains a path separator, and encodeURIComponent does
  // not save it — the server decodes %2F back to / before routing, so the
  // request 404s on a field that is plainly on screen.
  const { data } = await api.delete(`/custom-fields/by-id/${fieldmapId}`)
  return data
}

export async function deleteCustomField(fieldname) {
  // By name. Only reaches a field whose name is a legal column name; used for
  // an orphaned column that has no fieldmap row, and so has no id.
  const { data } = await api.delete(`/custom-fields/${encodeURIComponent(fieldname)}`)
  return data
}

export async function fetchTableStructure() {
  const { data } = await api.get('/custom-fields/table-structure')
  return data
}

// ── Master Data ──────────────────────────────────────────────────────────────

export async function fetchMasterSchema() {
  // What master tables exist and what their columns are called. The Master Data
  // page builds its tabs and forms from this rather than from a second copy of
  // the backend's _TABLES config.
  const { data } = await api.get('/master/_schema')
  return data
}

export async function fetchMasterData(masterType, params = {}) {
  const { data } = await api.get(`/master/${masterType}`, { params })
  return data
}

export async function createMasterEntry(masterType, payload) {
  const { data } = await api.post(`/master/${masterType}`, payload)
  return data
}

// Empty the beneficiary table. A real delete, not the archive the single-row
// button does — archived rows keep their account numbers, and the importer
// matches on those, so a corrected sheet would be refused as duplicates.
export async function deleteAllBeneficiaries() {
  const { data } = await api.delete('/master/beneficiary/all')
  return data
}

// Bulk-load beneficiaries from a sheet. save=false previews and writes nothing;
// the preview is what tells the user how many rows already exist, which is the
// question onDuplicate answers on the second call.
export async function importBeneficiaries(
  file, save = false, onDuplicate = 'skip', onCrossCompany = 'add',
) {
  const form = new FormData()
  form.append('file', file)
  form.append('save', String(save))
  form.append('on_duplicate', onDuplicate)
  form.append('on_cross_company', onCrossCompany)
  const { data } = await api.post('/master/beneficiary/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: IMPORT_TIMEOUT_MS,
  })
  return data
}

export async function updateMasterEntry(masterType, itemId, payload) {
  const { data } = await api.patch(`/master/${masterType}/${itemId}`, payload)
  return data
}

export async function deleteMasterEntry(masterType, itemId) {
  const { data } = await api.delete(`/master/${masterType}/${itemId}`)
  return data
}

// ── Transactions (ledger) ────────────────────────────────────────────────────

// Paged. Returns { columns, rows, total, page, limit } — `total` is the count
// matching the filters, `rows` is one page of it. Anything totalling the ledger
// must read `total`, not rows.length.
export async function fetchTransactions(params = {}) {
  const { data } = await api.get('/transactions/', { params })
  return data
}

// Alias used by Dashboard and Export pages
export const fetchSummary = () => fetchTransactionSummary()

// Empty the ledger. Company admin only. Recoverable in the sense that matters:
// the staged rows keep their classification and can be posted again.
export async function deleteAllTransactions() {
  const { data } = await api.delete('/transactions/all')
  return data
}

export async function fetchTransactionSummary() {
  const { data } = await api.get('/transactions/summary')
  return data
}

// What the Date / Account Number / Company filters can offer on the ledger.
// Read once per visit rather than derived from `rows`: rows is one page, and a
// dropdown built from the page in front of you cannot change what is in front
// of you. A null facet means this company has no such column.
export async function fetchTransactionFilters() {
  const { data } = await api.get('/transactions/filters')
  return data
}

// The same three, for the staging table.
export async function fetchTempImportFilters() {
  const { data } = await api.get('/transactions/temp-trans/filters')
  return data
}

// Paged. Returns { columns, rows, summary, total, page, limit }.
// `total` follows the tab and search filters; `summary` deliberately does not —
// it is what the Clear button reports, which is everything staged.
export async function fetchTempImport(params = {}) {
  const { data } = await api.get('/transactions/temp-trans', { params })
  return data
}

// Remove one staged row. Manager+. 409 if it has already been posted.
export async function deleteTempRow(rowId) {
  const { data } = await api.delete(`/transactions/temp-trans/${rowId}`)
  return data
}

export async function clearTempTrans() {
  // Removes every staged row and its batch. Refused with 409 if any staged row
  // has already been posted to the ledger.
  const { data } = await api.delete('/transactions/temp-trans')
  return data
}

// Edit one staged row. `payload` carries only the fields being changed:
// project_id / head_id / rera_head_id / idw_head_id (master row ids, or null to
// clear) and narration (free text). A key that is absent is left alone, which
// is what makes this safe to call with a partial form — and unlike classify,
// it can be run on the same row as many times as it needs.
export async function updateTempRow(rowId, payload) {
  const { data } = await api.patch(`/transactions/temp-trans/${rowId}`, payload)
  return data
}

// Lock or unlock one staged row. While locked, edit and delete on the row are
// refused server-side (409), and Clear All refuses while anything is locked —
// the padlock on screen is a real gate, not a display state.
export async function setTempRowLock(rowId, locked) {
  const { data } = await api.post(`/transactions/temp-trans/${rowId}/lock`, { locked })
  return data
}

export async function classifyRow(rowId, payload) {
  const { data } = await api.post(`/transactions/temp-trans/${rowId}/classify`, payload)
  return data
}

export async function finalizeRow(rowId) {
  const { data } = await api.post(`/transactions/temp-trans/${rowId}/finalize`)
  return data
}

// Check one account's staged rows against its account-type rule (read-only).
// `payload` is { account_type, account_number }. Returns the judged rows with
// status ok / conflict / no_direction, plus the heads the rule expects per
// direction — resolved from this company's own master tables.
export async function checkTempRules(payload) {
  const { data } = await api.post('/transactions/temp-trans/check-rules', payload)
  return data
}

// Replace the heads the check found wrong. `payload` is { account_type,
// account_number, rows: [{ id, head_id }] }. The server re-checks every
// target against the rule before writing; locked rows are skipped and counted.
export async function applyTempRules(payload) {
  const { data } = await api.post('/transactions/temp-trans/check-rules/apply', payload)
  return data
}

// ── Rules ────────────────────────────────────────────────────────────────────
// The grid behind Check Rules: which heads are valid for which account type,
// and in which direction. Both axes are live reads on the server — the heads
// from the RERA Head master, the account types from the Type of Account master
// — so nothing here or on the page names either.

export async function fetchRuleMatrix() {
  // { heads, account_types, directions, cells: {headId: {TYPE: 'CR'|'DR'}}, target }
  // A head/type pair with no entry in `cells` has no rule and is not offered.
  const { data } = await api.get('/rules/matrix')
  return data
}

// One cell. `direction` null clears it — there is no "blank" value to store,
// because no rule and a rule saying nothing are the same state.
export async function setRuleCell(headId, accountType, direction) {
  const { data } = await api.put('/rules/cell', {
    head_id: headId, account_type: accountType, direction: direction || null,
  })
  return data
}

// { TYPE: {cr, dr, total} } — how many heads each account type accepts. Used to
// say whether a type has a rule at all before anyone runs a check against it.
export async function fetchRuleSummary() {
  const { data } = await api.get('/rules/summary')
  return data
}

// ── Rule conditions ──────────────────────────────────────────────────────────
// The exception to the grid: "a RERA debit whose narration mentions REFUND is a
// Cust Cancellation". Conditions are read first and the first one that matches
// decides a row on its own; anything they do not describe falls back to the grid.

// Everything the builder needs, in one response — the conditions themselves plus
// the columns, operators, heads and account types its dropdowns are filled from.
// The operator list in particular is the server's, never a copy in the browser,
// so the page cannot offer a test the check does not implement.
export async function fetchConditions() {
  const { data } = await api.get('/rules/conditions')
  return data
}

// `payload` is {account_type, direction, subject_field, operator, value1,
// value2, head_ids, is_active}. head_ids is ordered: the first is what the
// Replace dropdown preselects.
export async function createCondition(payload) {
  const { data } = await api.post('/rules/conditions', payload)
  return data
}

export async function updateCondition(id, payload) {
  const { data } = await api.put(`/rules/conditions/${id}`, payload)
  return data
}

export async function deleteCondition(id) {
  const { data } = await api.delete(`/rules/conditions/${id}`)
  return data
}

// The whole group in the order it should decide, not "move this one up", so the
// result cannot depend on what this tab thought the old order was.
export async function reorderConditions(accountType, direction, ids) {
  const { data } = await api.post('/rules/conditions/reorder', {
    account_type: accountType, direction, ids,
  })
  return data
}

// Run an unsaved test against the rows actually staged for that account type.
// Takes no heads — this asks only "how many of my rows does this describe?",
// which is the half worth checking before committing to an answer.
export async function previewCondition(payload) {
  const { data } = await api.post('/rules/conditions/preview', payload)
  return data
}

// ── Import / Upload ──────────────────────────────────────────────────────────

// Parsing is measured in seconds per page, so a long statement runs for
// minutes — a 65-page one took about two and a half. The default 30s deadline
// would abandon those uploads while the server was still working on them, so
// the import calls get their own, set above the backend's own parse timeout so
// that when a file really is too big the server's explanation wins the race.
const IMPORT_TIMEOUT_MS = 300000

/**
 * Report how much of the file has reached the server, 0-100.
 *
 * The upload is its own wait, and on a 25 MB statement over a home connection
 * it is the longer half. Until this existed the button said "Parsing PDF..."
 * from the moment it was pressed — through an upload during which the server
 * had not yet seen a single byte, let alone started parsing.
 *
 * `total` is absent when the browser cannot know the size; the callback is
 * simply not made in that case rather than reporting a made-up figure.
 */
const uploadProgress = (onUploadPercent) => (
  onUploadPercent
    ? (e) => { if (e.total) onUploadPercent(Math.round((e.loaded * 100) / e.total)) }
    : undefined
)

export async function importPdf(file, save = false, bankId = null, password = '',
                                { pages = '', background = false,
                                  batchPages = null, onUploadPercent } = {}) {
  const form = new FormData()
  form.append('file', file)
  form.append('save', String(save))
  if (bankId) form.append('bank_id', String(bankId))
  // Bank statements are routinely emailed password-protected. The backend has
  // always accepted this field; without it an encrypted PDF fails with
  // "ENCRYPTED: This PDF is password-protected" and there was no way to answer.
  if (password) form.append('password', password)
  // "30" reads the first thirty pages, "31-65" a range, blank the whole file.
  if (pages) form.append('pages', pages)
  // Read long files in stretches of this many pages. null leaves it to the
  // server's default; 0 is a deliberate "one pass", so it must still be sent.
  if (batchPages !== null && batchPages !== '') {
    form.append('batch_pages', String(batchPages))
  }
  // With background=true this resolves in milliseconds with a job id, and the
  // parse carries on server-side — see pollImportJob.
  if (background) form.append('background', 'true')
  const { data } = await api.post('/imports/pdf', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: IMPORT_TIMEOUT_MS,
    onUploadProgress: uploadProgress(onUploadPercent),
  })
  return data
}

// One progress reading for a background import:
// { state, percent, overall_percent, batch_index, batch_total, batch_label,
//   batches_done, pages_done, total_pages, message, result, error, elapsed_ms }
// state is queued | parsing | saving | done | failed. On done, `result` is
// exactly what a foreground import would have returned.
//
// `percent` is THIS BATCH, and restarts at zero on each one — a batched import
// is several parses and a bar that spans all of them barely moves. The
// whole-file figure is `overall_percent`, and `batches_done` is one entry per
// finished batch so the screen can keep showing what is already done.
// batch_index 0 is the one-page header probe, which is not a numbered batch.
export async function fetchImportJob(jobId) {
  // silent: kept out of the global progress indicator. This fires every 900ms
  // for the whole life of an import, which would pin the stripe on for minutes
  // and turn "the app is working" into background noise that means nothing.
  // The import screen draws its own bar from these readings, which is a real
  // measurement rather than a generic one.
  const { data } = await api.get(`/imports/jobs/${jobId}`, { silent: true })
  return data
}

/**
 * Follow a background import to the end, reporting progress as it goes.
 *
 * Resolves with the finished result, or throws with the server's own message.
 * A poll that fails to reach the server is ignored rather than fatal: the parse
 * is what matters and it is still running, so one missed reading should not
 * abandon an import that is going to succeed.
 */
export async function pollImportJob(jobId, onProgress, intervalMs = 900) {
  let misses = 0
  for (;;) {
    await new Promise((r) => setTimeout(r, intervalMs))
    let job
    try {
      job = await fetchImportJob(jobId)
      misses = 0
    } catch (err) {
      if (++misses >= 10) throw err
      continue
    }
    if (onProgress) onProgress(job)
    if (job.state === 'done') return job.result
    if (job.state === 'failed') {
      const e = new Error(job.error || 'The import failed.')
      e.jobFailed = true
      throw e
    }
  }
}

// What is in a workbook, before anything is imported. Returns
// { sheets: [{ name, rows, data_rows, header_row, headers_detected,
//              unmapped_headers, is_statement, reason, sample,
//              column_collisions, document_fields }], statement_sheets, ... }
//
// The spreadsheet equivalent of the PDF page selector, and it has to run first:
// a workbook holds one sheet per bank account and the tab names alone do not
// say which are statements or how many rows each holds. Nothing is written.
export async function inspectExcel(file, { onUploadPercent } = {}) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post('/imports/excel/inspect', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: IMPORT_TIMEOUT_MS,
    onUploadProgress: uploadProgress(onUploadPercent),
  })
  return data
}

// `sheets` is a comma-separated list of sheet names; blank imports every sheet
// that looks like a statement. Each sheet becomes its own batch.
export async function importExcel(file, save = false, bankId = null,
                                  { sheets = '', background = false,
                                    onUploadPercent } = {}) {
  const form = new FormData()
  form.append('file', file)
  form.append('save', String(save))
  if (bankId) form.append('bank_id', String(bankId))
  if (sheets) form.append('sheets', sheets)
  if (background) form.append('background', 'true')
  const { data } = await api.post('/imports/excel', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: IMPORT_TIMEOUT_MS,
    onUploadProgress: uploadProgress(onUploadPercent),
  })
  return data
}

export async function importCsv(file, save = false, bankId = null,
                                { background = false, onUploadPercent } = {}) {
  const form = new FormData()
  form.append('file', file)
  form.append('save', String(save))
  if (bankId) form.append('bank_id', String(bankId))
  if (background) form.append('background', 'true')
  const { data } = await api.post('/imports/csv', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: IMPORT_TIMEOUT_MS,
    onUploadProgress: uploadProgress(onUploadPercent),
  })
  return data
}

export async function fetchBatches(statusFilter = null) {
  const params = statusFilter ? { status: statusFilter } : {}
  const { data } = await api.get('/imports/batches', { params })
  return data
}

export async function fetchBatch(batchId) {
  const { data } = await api.get(`/imports/batches/${batchId}`)
  return data
}

export async function discardBatch(batchId) {
  const { data } = await api.delete(`/imports/batches/${batchId}`)
  return data
}

// ── Export ───────────────────────────────────────────────────────────────────

export async function exportTransactions(format = 'csv', params = {}) {
  const { data } = await api.get('/export/transactions', {
    params: { format, ...params },
    responseType: 'blob',
    // Rendering a large ledger to xlsx or pdf is built row by row on the
    // server, so this belongs with the imports rather than with the quick
    // reads the default deadline was chosen for.
    timeout: IMPORT_TIMEOUT_MS,
  })
  return data
}
