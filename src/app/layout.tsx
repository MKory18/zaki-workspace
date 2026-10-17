import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "Zakai.io",
  description: "Zakai.io — Intelligent collaboration operating system",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

function getLangAndDir(): { lang: "ar" | "fr" | "en"; dir: "rtl" | "ltr" } {
  return { lang: "ar", dir: "rtl" };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { lang, dir } = getLangAndDir();
  return (
    <html lang={lang} dir={dir} className={plex.variable} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
