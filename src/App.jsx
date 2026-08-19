import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth, MANAGER, SUPER_ADMIN } from './context/AuthContext.jsx'
import Layout from './components/Layout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import ProjectsPage from './pages/ProjectsPage.jsx'
import CustomFieldsPage from './pages/CustomFieldsPage.jsx'
import FieldMappingPage from './pages/FieldMappingPage.jsx'
import ChangeLogPage from './pages/ChangeLogPage.jsx'
import MasterDataPage from './pages/MasterDataPage.jsx'
import StagingPage from './pages/StagingPage.jsx'
import ImportPage from './pages/ImportPage.jsx'
import ExportPage from './pages/ExportPage.jsx'
import UsersPage from './pages/UsersPage.jsx'
import CompaniesPage from './pages/CompaniesPage.jsx'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent" />
          <p className="mt-3 text-sm text-slate-500">Loading...</p>
        </div>
      </div>
    )
  }
  return user ? children : <Navigate to="/login" replace />
}

/**
 * Route guard by level. Sends anyone ranking below requiredLevel back to the
 * dashboard rather than showing a page whose every request would 403.
 *
 * This is convenience, not security — the API checks the same level on every
 * call, so typing the URL directly gets you an empty page, not data.
 */
function LevelRoute({ requiredLevel, children }) {
  const { hasLevel } = useAuth()
  return hasLevel(requiredLevel) ? children : <Navigate to="/" replace />
}

/**
 * Company pages, closed to super admins.
 *
 * A super admin has no company schema and the API refuses them company data
 * outright, so these pages would render nothing but errors. Sending them to
 * /companies is not a permission check — the server already made one — it is
 * the difference between landing somewhere useful and staring at a 403.
 */
function CompanyRoute({ children }) {
  const { isSuperAdmin } = useAuth()
  return isSuperAdmin ? <Navigate to="/companies" replace /> : children
}

export default function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent" />
          <p className="mt-3 text-sm text-slate-500">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      }>
        <Route index element={<CompanyRoute><DashboardPage /></CompanyRoute>} />
        <Route path="projects" element={<CompanyRoute><ProjectsPage /></CompanyRoute>} />
        {/* Two distinct jobs, not two views of one: /custom-fields creates and
            drops columns on temp_trans, /field-mapping edits how the columns
            that exist are recognised in a statement. */}
        <Route path="custom-fields" element={<CompanyRoute><CustomFieldsPage /></CompanyRoute>} />
        <Route path="field-mapping" element={<CompanyRoute><FieldMappingPage /></CompanyRoute>} />
        {/* Manager+: the log names who made each change, and the API returns
            403 to staff, so an ungated route would render an error page. */}
        <Route path="change-log" element={<CompanyRoute><LevelRoute requiredLevel={MANAGER}><ChangeLogPage /></LevelRoute></CompanyRoute>} />
        <Route path="master-data" element={<CompanyRoute><MasterDataPage /></CompanyRoute>} />
        <Route path="import" element={<CompanyRoute><ImportPage /></CompanyRoute>} />
        <Route path="staging" element={<CompanyRoute><StagingPage /></CompanyRoute>} />
        <Route path="export" element={<CompanyRoute><ExportPage /></CompanyRoute>} />
        <Route path="users" element={<CompanyRoute><LevelRoute requiredLevel={MANAGER}><UsersPage /></LevelRoute></CompanyRoute>} />
        <Route path="companies" element={<LevelRoute requiredLevel={SUPER_ADMIN}><CompaniesPage /></LevelRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
