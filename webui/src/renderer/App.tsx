import React from 'react';
import { HashRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import AppShell from './components/layout/AppShell';

/**
 * @module
 * Renderer Root Component
 *
 * Architecture overview for Junior Devs:
 * This is the top of the React tree. It does three jobs:
 *  1. Provides the React Query client to the whole app (`QueryClientProvider`),
 *     so any component can fetch/cache server data.
 *  2. Sets up hash-based routing (`HashRouter`) — hash routes work whether the
 *     bundle is loaded by Electron or directly from the server.
 *  3. Renders the application shell immediately; session-aware components query
 *     the current browser session where needed.
 */

/** The root component: providers, router, and application shell. */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AppShell />
      </HashRouter>
    </QueryClientProvider>
  );
}
