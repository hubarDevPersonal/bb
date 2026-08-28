import { Provider as JotaiProvider } from "jotai";
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from "@tanstack/react-query";
import type { JSX, ReactNode } from "react";
import { createAppQueryClient } from "@/lib/query-client";

interface QueryClientTestWrapperProps {
  children: ReactNode;
}

type QueryClientTestWrapper = (
  props: QueryClientTestWrapperProps,
) => JSX.Element;

interface QueryClientTestHarness {
  queryClient: QueryClient;
  wrapper: QueryClientTestWrapper;
}

/**
 * Retries are off by default so a failing assertion surfaces as one failure
 * rather than a retry storm. Pass `overrides` to opt a single test back into a
 * production policy it needs to exercise, such as transient-read retry.
 */
export function createQueryClientTestHarness(
  overrides?: QueryClientConfig["defaultOptions"],
): QueryClientTestHarness {
  const queryClient = createAppQueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
        ...overrides?.mutations,
      },
      queries: {
        gcTime: Infinity,
        retry: false,
        ...overrides?.queries,
      },
    },
  });

  const wrapper: QueryClientTestWrapper = ({ children }) => (
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </JotaiProvider>
  );

  return {
    queryClient,
    wrapper,
  };
}
