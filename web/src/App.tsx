import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppHeader } from './components/AppHeader';
import { RequireAuth } from './components/RequireAuth';
import { AuthProvider } from './lib/auth';
import { MyBookingsPage } from './pages/MyBookingsPage';
import { SchedulePage } from './pages/SchedulePage';
import { SignInPage } from './pages/SignInPage';

/** Header and page for signed-in users; anonymous users are sent to `/sign-in?next=<path>` by `RequireAuth`. */
function ProtectedLayout() {
  return (
    <RequireAuth>
      <AppHeader />
      <Outlet />
    </RequireAuth>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<Navigate to="/schedule" replace />} />
            <Route path="/schedule" element={<SchedulePage />} />
            <Route
              path="/my-bookings"
              element={
                <RequireAuth roles={['member']}>
                  <MyBookingsPage />
                </RequireAuth>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
