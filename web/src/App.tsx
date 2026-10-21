import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import { useState } from 'react';
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  type RouteObject,
} from 'react-router';
import { ApiError } from './api/client';
import { AppLayout } from './components/AppLayout';
import { NotFound } from './components/NotFound';
import { BulkIssuePage } from './pages/BulkIssuePage';
import { BulkIssueRunPage } from './pages/BulkIssueRunPage';
import { CertificateDetailPage } from './pages/CertificateDetailPage';
import { CertificatesPage } from './pages/CertificatesPage';
import { RootRedirect } from './pages/RootRedirect';
import { SignInPage } from './pages/SignInPage';

export const routes: RouteObject[] = [
  { path: '/', element: <RootRedirect /> },
  { path: '/sign-in', element: <SignInPage /> },
  {
    path: '/t/:tid',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="certificates" replace /> },
      { path: 'certificates', element: <CertificatesPage /> },
      { path: 'certificates/:id', element: <CertificateDetailPage /> },
      { path: 'bulk-issue', element: <BulkIssuePage /> },
      { path: 'bulk-issue/runs/:runId', element: <BulkIssueRunPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '*', element: <NotFound /> },
];

export const theme = { token: { colorPrimary: '#1668dc', borderRadius: 6 } };

type Router = ReturnType<typeof createBrowserRouter>;

export function App({ router }: { router?: Router }) {
  const [browserRouter] = useState(() => router ?? createBrowserRouter(routes));
  const [queryClient] = useState(() => {
    // Any 401 (expired or missing session) sends the user to sign-in; the sign-in
    // page's own requests are public, so this cannot loop.
    const onUnauthorized = (error: Error) => {
      if (error instanceof ApiError && error.status === 401) {
        if (browserRouter.state.location.pathname !== '/sign-in') {
          void browserRouter.navigate('/sign-in', { replace: true });
        }
      }
    };
    return new QueryClient({
      defaultOptions: { queries: { retry: false } },
      queryCache: new QueryCache({ onError: onUnauthorized }),
      mutationCache: new MutationCache({ onError: onUnauthorized }),
    });
  });

  return (
    <ConfigProvider theme={theme}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={browserRouter} />
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
