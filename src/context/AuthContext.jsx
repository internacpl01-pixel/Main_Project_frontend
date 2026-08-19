import { createContext, useContext, useState, useEffect } from 'react'
import { login, logout as apiLogout, getMe, switchCompany } from '../api/endpoints.js'

const AuthContext = createContext(null)

/**
 * Role levels, mirroring backend/permissions.py.
 *
 * LOWER NUMBER = MORE AUTHORITY. 0 is the company admin and the scale runs
 * down the org chart from there, so never write `level >= MANAGER` — use
 * hasLevel(), which encodes the direction in one place.
 *
 * These gates only decide which controls are drawn. Every one of them is
 * enforced again on the server; hiding a button is a courtesy, not a boundary.
 */
export const SUPER_ADMIN = -1
export const COMPANY_ADMIN = 0
export const MANAGER = 1
export const STAFF = 2

export const LEVELS = {
  super_admin: SUPER_ADMIN,
  company_admin: COMPANY_ADMIN,
  manager: MANAGER,
  staff: STAFF,
}

export const ROLE_LABELS = {
  staff: 'Staff',
  manager: 'Manager',
  company_admin: 'Company Admin',
  super_admin: 'Super Admin',
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // /auth/me is the source of truth for identity. localStorage is only a cache
  // to avoid a blank header on first paint — a role edited there grants nothing,
  // because the server reads the token, not the browser.
  const applyIdentity = (me) =>
    setUser({
      id: me.id,
      username: me.username,
      role: me.role,
      roleLabel: me.role_label,
      level: me.level ?? 0,
      companyId: me.company_id,
      // The company's real name, for the header. Null for a super admin who has
      // not picked a company yet. Comes from /auth/me on every load rather than
      // from the token, so renaming a company does not need everyone to sign in
      // again for the header to catch up.
      companyName: me.company_name || null,
      schema: me.schema,
      assignableRoles: me.assignable_roles || [],
    })

  useEffect(() => {
    const init = async () => {
      const token = localStorage.getItem('access_token')
      if (token) {
        try {
          applyIdentity(await getMe())
        } catch {
          localStorage.removeItem('access_token')
          localStorage.removeItem('username')
          localStorage.removeItem('role')
          localStorage.removeItem('schema')
        }
      }
      setLoading(false)
    }
    init()
  }, [])

  const signIn = async (username, password) => {
    const data = await login(username, password)
    localStorage.setItem('access_token', data.access_token)
    localStorage.setItem('role', data.role)
    localStorage.setItem('schema', data.schema)
    localStorage.setItem('username', username)
    // Fetch the full identity rather than piecing it together from the login
    // response, so there is exactly one shape of `user` in the app.
    applyIdentity(await getMe())
    return data
  }

  const signOut = async () => {
    try {
      await apiLogout()
    } catch {
      // ignore — we're clearing local state regardless
    }
    localStorage.removeItem('access_token')
    localStorage.removeItem('username')
    localStorage.removeItem('role')
    localStorage.removeItem('schema')
    setUser(null)
  }

  const switchToCompany = async (schemaName) => {
    const data = await switchCompany(schemaName)
    localStorage.setItem('access_token', data.access_token)
    localStorage.setItem('schema', data.schema)
    // The new token carries a company_id the old one lacked, so re-read identity.
    applyIdentity(await getMe())
    return data
  }

  // Default to STAFF, the least authority — an unknown level must never be
  // mistaken for an admin.
  const level = user?.level ?? STAFF
  const hasLevel = (required) => level <= required

  const value = {
    user,
    loading,
    signIn,
    signOut,
    switchToCompany,
    level,
    hasLevel,
    canWrite: hasLevel(MANAGER),
    canAdmin: hasLevel(COMPANY_ADMIN),
    isSuperAdmin: hasLevel(SUPER_ADMIN),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
