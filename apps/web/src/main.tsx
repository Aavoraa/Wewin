import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth';
import { FyProvider } from '@/lib/fy';
import { ApiError } from '@/lib/api';
import { AppRoutes } from '@/routes';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
  mutationCache: new MutationCache({
    // Any posting can change stock: refresh stock-related queries after every successful mutation.
    onSuccess: () => void queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('stock') }),
  }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <FyProvider>
            <AppRoutes />
            <Toaster richColors position="top-right" closeButton />
          </FyProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
