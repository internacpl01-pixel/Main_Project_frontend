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

export async function fetchTransactionSummary() {
  const { data } = await api.get('/transactions/summary')
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

export async function classifyRow(rowId, payload) {
  const { data } = await api.post(`/transactions/temp-trans/${rowId}/classify`, payload)
  return data
}

export async function finalizeRow(rowId) {
  const { data } = await api.post(`/transactions/temp-trans/${rowId}/finalize`)
  return data
}

// ── Import / Upload ──────────────────────────────────────────────────────────

// Parsing is measured in seconds per page, so a long statement runs for
// minutes — a 65-page one took about two and a half. The default 30s deadline
// would abandon those uploads while the server was still working on them, so
// the import calls get their own, set above the backend's own parse timeout so
// that when a file really is too big the server's explanation wins the race.
const IMPORT_TIMEOUT_MS = 300000

export async function importPdf(file, save = false, bankId = null, password = '',
                                { pages = '', background = false,
                                  batchPages = null } = {}) {
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
  const { data } = await api.get(`/imports/jobs/${jobId}`)
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

export async function importExcel(file, save = false, bankId = null) {
  const form = new FormData()
  form.append('file', file)
  form.append('save', String(save))
  if (bankId) form.append('bank_id', String(bankId))
  const { data } = await api.post('/imports/excel', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: IMPORT_TIMEOUT_MS,
  })
  return data
}

export async function importCsv(file, save = false, bankId = null) {
  const form = new FormData()
  form.append('file', file)
  form.append('save', String(save))
  if (bankId) form.append('bank_id', String(bankId))
  const { data } = await api.post('/imports/csv', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: IMPORT_TIMEOUT_MS,
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
