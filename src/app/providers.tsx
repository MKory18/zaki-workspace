"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { DigitsProvider } from "@/components/theme/digits-provider";
import type { DecorLevel, ThemeKey } from "@/lib/themes/registry";
import { useState } from "react";

/**
 * Client providers: theme (the four themes and the decoration level, see
 * components/theme/theme-provider.tsx), i18n (Arabic only, RTL), server state.
 * `theme`, `decor` and `digits` are what the root layout already painted from the cookies.
 */
export function Providers({ children, theme, decor, digits }: { children: React.ReactNode; theme?: ThemeKey; decor?: DecorLevel; digits?: string }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
      }),
  );
  return (
    <ThemeProvider initialTheme={theme} initialDecor={decor}>
      <DigitsProvider initialDigits={digits}>
      <I18nProvider initial="ar">
        <QueryClientProvider client={queryClient}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      </I18nProvider>
      </DigitsProvider>
    </ThemeProvider>
  );
}
