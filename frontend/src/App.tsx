import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { InactiveGate } from '@/components/auth/inactive-gate'
import { RecoveryRedirect } from '@/components/auth/recovery-redirect'
import { ProtectedRoute } from '@/components/auth/protected-route'
import { AppLayout } from '@/components/layout/app-layout'
import { ConnectionPage } from '@/pages/connection-page'
import { HistoryPage } from '@/pages/history-page'
import { HomePage } from '@/pages/home-page'
import { LabelsPage } from '@/pages/labels-page'
import { LocationPage } from '@/pages/location-page'
import { LocationsPage } from '@/pages/locations-page'
import { LoginPage } from '@/pages/login-page'
import { NomenclaturePage } from '@/pages/nomenclature-page'
import { NotFoundPage } from '@/pages/not-found-page'
import { PasswordPage } from '@/pages/password-page'
import { ResetPasswordPage } from '@/pages/reset-password-page'
import { ScanPage } from '@/pages/scan-page'
import { UnitPage } from '@/pages/unit-page'
import { UnitsPage } from '@/pages/units-page'
import { UsersPage } from '@/pages/users-page'
import { VerificationsPage } from '@/pages/verifications-page'

const ImportExportPage = lazy(() =>
  import('@/pages/import-export-page').then((module) => ({ default: module.ImportExportPage })),
)

export default function App() {
  return (
    <>
      <RecoveryRedirect />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/connection" element={<ConnectionPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<InactiveGate />}>
            <Route element={<AppLayout />}>
              <Route index element={<HomePage />} />
              <Route path="nomenclature" element={<NomenclaturePage />} />
              <Route path="units" element={<UnitsPage />} />
              <Route path="units/:code" element={<UnitPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="verifications" element={<VerificationsPage />} />
              <Route
                path="import-export"
                element={
                  <Suspense
                    fallback={<p className="p-6 text-sm text-muted-foreground">Загрузка…</p>}
                  >
                    <ImportExportPage />
                  </Suspense>
                }
              />
              <Route path="scan" element={<ScanPage />} />
              <Route path="labels" element={<LabelsPage />} />
              <Route path="locations" element={<LocationsPage />} />
              <Route path="locations/:id" element={<LocationPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="password" element={<PasswordPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  )
}
