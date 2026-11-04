import { QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/syne';
import '@fontsource-variable/source-sans-3';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import '@xyflow/react/dist/style.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { createQueryClient } from './queryClient.js';
import './tokens.css';
// After tokens.css: a Theme block wins over the default by coming later in the same layer.
import './themes.css';
import './styles.css';
import './CanvasOverlays.css';
import './note.css';

const container = document.getElementById('root');
if (!container) throw new Error('N2 could not find its application root.');

const queryClient = createQueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000 },
    mutations: { retry: false }
  }
});

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
