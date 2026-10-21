import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import { HomePage } from './pages/HomePage';

export const routes: RouteObject[] = [{ path: '/', element: <HomePage /> }];

export const theme = { token: { colorPrimary: '#1668dc', borderRadius: 6 } };

type Router = ReturnType<typeof createBrowserRouter>;

export function App({ router }: { router?: Router }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [browserRouter] = useState(() => router ?? createBrowserRouter(routes));

  return (
    <ConfigProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
          <RouterProvider router={browserRouter} />
        </div>
      </QueryClientProvider>
    </ConfigProvider>
  );
}
