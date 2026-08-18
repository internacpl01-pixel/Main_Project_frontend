import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth, MANAGER, SUPER_ADMIN } from '../context/AuthContext.jsx'
import CompanySwitcher from './CompanySwitcher.jsx'
import {
  LayoutDashboard, Upload, FileSpreadsheet, ArrowLeftRight,
  LogOut, Menu, X, ChevronDown, ArrowDownToLine, Users, Building2, Columns3,
  FolderKanban, Database, History
} from 'lucide-react'
import { useState } from 'react'

// Every route in App.jsx has an entry here. Projects and Master Data were
// previously reachable only through links buried on the dashboard, which meant
// two working pages looked like they did not exist.
//
// requiredLevel omitted means everyone signed in, staff included. Staff can
// open every ungated page — the write controls inside them are hidden
// separately, so there is nothing gained by hiding the page itself.
const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/projects', icon: FolderKanban, label: 'Projects' },
  { to: '/master-data', icon: Database, label: 'Master Data' },
  { to: '/custom-fields', icon: Columns3, label: 'Custom Fields' },
  { to: '/field-mapping', icon: ArrowLeftRight, label: 'Field Mapping' },
  // Sits under Field Mapping because that is what it is a history of. Manager+
  // to match the route guard and the API.
  { to: '/change-log', icon: History, label: 'Change Log', requiredLevel: MANAGER },
  { to: '/import', icon: Upload, label: 'Import Statement' },
  { to: '/staging', icon: FileSpreadsheet, label: 'Imported Rows' },
  { to: '/export', icon: ArrowDownToLine, label: 'Export' },
  { to: '/users', icon: Users, label: 'Users', requiredLevel: MANAGER },
  { to: '/companies', icon: Building2, label: 'Companies', requiredLevel: SUPER_ADMIN },
]

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const { user, signOut, hasLevel, isSuperAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Routes that read the admin schema only and so work with no company picked.
  // /companies has to be one of them: on a fresh install it is where the first
  // company gets registered, and gating it behind "pick a company" would leave
  // a super admin with nothing to pick and no way to fix that.
  const COMPANY_OPTIONAL_PATHS = ['/companies']
  const needsCompany = !COMPANY_OPTIONAL_PATHS.includes(location.pathname)

  // 'admin' is the cross-company schema — it has no projects/transactions
  // tables, so no page can render against it.
  const hasCompany = Boolean(user?.schema) && user.schema !== 'admin'

  const handleLogout = () => {
    signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-60 bg-white border-r border-slate-200 transform transition-transform duration-200 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between h-14 px-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary-600 text-white flex items-center justify-center text-sm font-bold">L</div>
            <span className="font-semibold text-slate-900">Ledger</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1 rounded hover:bg-slate-100 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="p-3 space-y-0.5">
          {NAV.filter((item) => item.requiredLevel === undefined || hasLevel(item.requiredLevel)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Company badge */}
        {hasCompany && (
          <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-slate-100">
            <div className="px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-500">
              <span className="text-slate-400">Company:</span>{' '}
              <span className="font-medium text-slate-700">{user.schema}</span>
            </div>
          </div>
        )}
      </aside>

      {/* Main content area */}
      <div className="lg:pl-60">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-sm border-b border-slate-200 h-14">
          <div className="flex items-center justify-between px-4 h-full">
            <div className="flex items-center gap-3">
              <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-1.5 rounded hover:bg-slate-100 text-slate-500">
                <Menu className="h-5 w-5" />
              </button>
              <h1 className="text-sm font-medium text-slate-700 lg:hidden">Ledger</h1>
              {isSuperAdmin && hasCompany && <CompanySwitcher variant="menu" />}
            </div>

            <div className="relative">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <div className="h-7 w-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-medium">
                  {user?.username?.[0]?.toUpperCase() || 'U'}
                </div>
                <span className="text-sm font-medium text-slate-700 hidden sm:inline">{user?.username}</span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>

              {profileOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50">
                    <div className="px-3 py-2 border-b border-slate-100">
                      <p className="text-sm font-medium text-slate-900">{user?.username}</p>
                      <p className="text-xs text-slate-500">{user?.roleLabel || user?.role}</p>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page content.
            No company bound to the token means every query would hit the admin
            schema and fail, so show the picker instead of the page.
            key={user.schema} remounts the route on a switch — pages fetch in
            useEffect on mount, so this is what reloads them with the new token. */}
        <main className="p-4 lg:p-6">
          {hasCompany || !needsCompany ? (
            <Outlet key={user.schema} />
          ) : (
            <CompanySwitcher variant="panel" />
          )}
        </main>
      </div>
    </div>
  )
}
