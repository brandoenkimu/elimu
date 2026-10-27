import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loading } from './components/ui';
import { SessionProvider, useSession } from './state/session';
import { ToastProvider } from './state/toast';
import type { Role } from './lib/types';
import Landing from './pages/public/Landing';
import Login from './pages/public/Login';
import Register from './pages/public/Register';
import { Forgot, Reset } from './pages/public/Recover';
import AppShell from './pages/app/AppShell';
import Home from './pages/app/Home';

// Heavier screens load when first opened, so the first paint stays quick.
const Classes = lazy(() => import('./pages/app/Classes'));
const ClassPage = lazy(() => import('./pages/app/class/ClassPage'));
const Messages = lazy(() => import('./pages/app/Messages'));
const People = lazy(() => import('./pages/app/People'));
const Registration = lazy(() => import('./pages/app/Registration'));
const Grades = lazy(() => import('./pages/app/Grades'));
const Gradebooks = lazy(() => import('./pages/app/Gradebooks'));
const Settings = lazy(() => import('./pages/app/Settings'));
const Users = lazy(() => import('./pages/app/admin/Users'));
const Courses = lazy(() => import('./pages/app/admin/Courses'));
const Terms = lazy(() => import('./pages/app/admin/Terms'));
const AdminClasses = lazy(() => import('./pages/app/admin/AdminClasses'));
const Reports = lazy(() => import('./pages/app/admin/Reports'));
const Audit = lazy(() => import('./pages/app/admin/Audit'));
const System = lazy(() => import('./pages/app/admin/System'));

/** Sends people who open a page their role does not have back to their home screen. */
function Only({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useSession();
  return user && roles.includes(user.role) ? <>{children}</> : <Navigate to="/app" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <Suspense fallback={<div className="splash"><Loading /></div>}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot" element={<Forgot />} />
              <Route path="/reset-password" element={<Reset />} />
              <Route path="/app" element={<AppShell />}>
                <Route index element={<Home />} />
                <Route path="messages" element={<Messages />} />
                <Route path="messages/:id" element={<Messages />} />
                <Route path="people/*" element={<People />} />
                <Route path="classes" element={<Classes />} />
                <Route path="classes/:id/*" element={<ClassPage />} />
                <Route path="registration" element={<Only roles={['student']}><Registration /></Only>} />
                <Route path="grades" element={<Only roles={['student']}><Grades /></Only>} />
                <Route path="gradebooks" element={<Only roles={['lecturer', 'admin']}><Gradebooks /></Only>} />
                <Route path="settings/*" element={<Settings />} />
                <Route path="admin/users" element={<Only roles={['admin']}><Users /></Only>} />
                <Route path="admin/approvals" element={<Only roles={['admin']}><Users pendingOnly /></Only>} />
                <Route path="admin/courses" element={<Only roles={['admin']}><Courses /></Only>} />
                <Route path="admin/terms" element={<Only roles={['admin']}><Terms /></Only>} />
                <Route path="admin/classes" element={<Only roles={['admin']}><AdminClasses /></Only>} />
                <Route path="admin/reports" element={<Only roles={['admin']}><Reports /></Only>} />
                <Route path="admin/audit" element={<Only roles={['admin']}><Audit /></Only>} />
                <Route path="admin/system" element={<Only roles={['admin']}><System /></Only>} />
                <Route path="*" element={<Navigate to="/app" replace />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
