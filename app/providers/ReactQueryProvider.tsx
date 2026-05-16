'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60_000,
        // gcTime MUST exceed staleTime — otherwise tanstack/react-query
        // garbage-collects entries the moment they go inactive, and the
        // staleTime never gets a chance to keep cached data warm across
        // route transitions. 10 minutes keeps gallery thumbs cached
        // through quick back-nav from a session.
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
        placeholderData: undefined,
      },
    },
  });
}

export function ReactQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
