import { Navigate, Route, Routes } from 'react-router-dom'
import { RecoveryRedirect } from '@/components/auth/recovery-redirect'
import { ProtectedRoute } from '@/components/auth/protected-route'
import { AppLayout } from '@/components/layout/app-layout'
import { navItems } from '@/config/navigation'
import { ConnectionPage } from '@/pages/connection-page'
import { HistoryPage } from '@/pages/history-page'
import { HomePage } from '@/pages/home-page'
import { LabelsPage } from '@/pages/labels-page'
import { LocationPage } from '@/pages/location-page'
import { LocationsPage } from '@/pages/locations-page'
import { LoginPage } from '@/pages/login-page'
import { NomenclaturePage } from '@/pages/nomenclature-page'
import { ResetPasswordPage } from '@/pages/reset-password-page'
import { ScanPage } from '@/pages/scan-page'
import { StubPage } from '@/pages/stub-page'
import { UnitPage } from '@/pages/unit-page'
import { UnitsPage } from '@/pages/units-page'

const implemented = new Set([
  '/',
  '/units',
  '/nomenclature',
  '/locations',
  '/history',
  '/scan',
  '/labels',
])

export default function App() {
  return (
    <>
      <RecoveryRedirect />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/connection" element={<ConnectionPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<HomePage />} />
            <Route path="nomenclature" element={<NomenclaturePage />} />
            <Route path="units" element={<UnitsPage />} />
            <Route path="units/:code" element={<UnitPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="scan" element={<ScanPage />} />
            <Route path="labels" element={<LabelsPage />} />
            <Route path="locations" element={<LocationsPage />} />
            <Route path="locations/:id" element={<LocationPage />} />
            {navItems
              .filter((item) => !implemented.has(item.to))
              .map((item) => (
                <Route
                  key={item.to}
                  path={item.to.slice(1)}
                  element={
                    <StubPage
                      title={item.label}
                      description={item.description}
                      stage={item.stage}
                    />
                  }
                />
              ))}
            <Route
              path="*"
              element={
                <StubPage
                  title="Страница не найдена"
                  description="Такого раздела нет."
                  stage="Вернитесь в меню слева или снизу."
                />
              }
            />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  )
}
