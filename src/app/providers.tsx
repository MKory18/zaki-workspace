"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { ThemeProvider } from "@/components/theme/theme-provider";
import type { DecorLevel, ThemeKey } from "@/lib/themes/registry";
import { useState } from "react";

/**
 * Client providers: theme (the four themes and the decoration level, see
 * components/theme/theme-provider.tsx), i18n (Arabic only, RTL), server state.
 * `theme` and `decor` are what the root layout already painted from the cookies.
 */
export function Providers({ children, theme, decor }: { children: React.ReactNode; theme?: ThemeKey; decor?: DecorLevel }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
      }),
  );
  return (
    <ThemeProvider initialTheme={theme} initialDecor={decor}>
      <I18nProvider initial="ar">
        <QueryClientProvider client={queryClient}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
