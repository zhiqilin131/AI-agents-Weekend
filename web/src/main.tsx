import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router';
import HomePage from './pages/HomePage';
import UnifiedChatPage from './pages/UnifiedChatPage';
import HistoryPage from './pages/HistoryPage';
import ProfilePage from './pages/ProfilePage';
import ShadowChatPage from './pages/ShadowChatPage';
import ExecutionPlannerPage from './pages/ExecutionPlannerPage';
import SlimeCompanionPage from './pages/SlimeCompanionPage';
import DiaryPage from './pages/DiaryPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AppErrorPage from './pages/AppErrorPage';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuthLayout } from './auth/RequireAuthLayout';
import { unlockSlimeAudioContext } from './utils/slimeAudioContext';
import './styles/index.css';

/** One user gesture warms AudioContext so later TTS playback is less likely to be blocked. */
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    () => {
      unlockSlimeAudioContext();
    },
    { once: true, passive: true },
  );
}

const router = createHashRouter([
  { path: '/login', element: <LoginPage />, errorElement: <AppErrorPage /> },
  { path: '/register', element: <RegisterPage />, errorElement: <AppErrorPage /> },
  {
    element: <RequireAuthLayout />,
    errorElement: <AppErrorPage />,
    children: [
      { path: '/', element: <HomePage />, errorElement: <AppErrorPage /> },
      { path: '/chat', element: <UnifiedChatPage />, errorElement: <AppErrorPage /> },
      { path: '/trace/:decisionId', element: <HomePage />, errorElement: <AppErrorPage /> },
      { path: '/history', element: <HistoryPage />, errorElement: <AppErrorPage /> },
      { path: '/reflect', element: <ShadowChatPage />, errorElement: <AppErrorPage /> },
      { path: '/profile', element: <ProfilePage />, errorElement: <AppErrorPage /> },
      { path: '/buddy', element: <SlimeCompanionPage />, errorElement: <AppErrorPage /> },
      { path: '/diary', element: <DiaryPage />, errorElement: <AppErrorPage /> },
      { path: '/execution', element: <ExecutionPlannerPage />, errorElement: <AppErrorPage /> },
      { path: '/execution/:decisionId', element: <ExecutionPlannerPage />, errorElement: <AppErrorPage /> },
      { path: '*', element: <AppErrorPage />, errorElement: <AppErrorPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
