import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router';
import HomePage from './pages/HomePage';
import UnifiedChatPage from './pages/UnifiedChatPage';
import HistoryPage from './pages/HistoryPage';
import ProfilePage from './pages/ProfilePage';
import ShadowChatPage from './pages/ShadowChatPage';
import PersonalizePage from './pages/PersonalizePage';
import ExecutionPlannerPage from './pages/ExecutionPlannerPage';
import AppErrorPage from './pages/AppErrorPage';
import './styles/index.css';

const router = createHashRouter([
  { path: '/', element: <HomePage />, errorElement: <AppErrorPage /> },
  { path: '/chat', element: <UnifiedChatPage />, errorElement: <AppErrorPage /> },
  { path: '/trace/:decisionId', element: <HomePage />, errorElement: <AppErrorPage /> },
  { path: '/history', element: <HistoryPage />, errorElement: <AppErrorPage /> },
  { path: '/reflect', element: <ShadowChatPage />, errorElement: <AppErrorPage /> },
  { path: '/profile', element: <ProfilePage />, errorElement: <AppErrorPage /> },
  { path: '/personalize', element: <PersonalizePage />, errorElement: <AppErrorPage /> },
  { path: '/execution', element: <ExecutionPlannerPage />, errorElement: <AppErrorPage /> },
  { path: '/execution/:decisionId', element: <ExecutionPlannerPage />, errorElement: <AppErrorPage /> },
  { path: '*', element: <AppErrorPage />, errorElement: <AppErrorPage /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
