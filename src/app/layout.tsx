import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/700.css";
import "./globals.css";
import { cookies } from "next/headers";
import { Providers } from "@/components/providers";
import { Settings } from "luxon";
import { DEFAULT_LANG, LANG_COOKIE, dateLocale, isLang, setRenderLang } from "@/lib/i18n";
import "@fontsource/noto-sans-armenian/400.css";
import "@fontsource/noto-sans-armenian/500.css";
import "@fontsource/noto-sans-armenian/600.css";
import "@fontsource/noto-sans-armenian/700.css";
import "@fontsource/noto-serif-armenian/600.css";

export const metadata: Metadata = {
  title: { default: "US VISA WITH ARGISHTI — Client Desk", template: "%s · US VISA WITH ARGISHTI" },
  description: "Private AI-assisted client desk for US VISA WITH ARGISHTI — tasks, interviews, clients, documents and reminders.",
  applicationName: "US Visa Desk",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Visa Desk", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0b1426" },
    { media: "(prefers-color-scheme: dark)", color: "#070d1a" },
  ],
};

// Runs before first paint so the page never flashes the wrong theme.
const themeScript = `(function(){try{var t=localStorage.getItem('uva-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const raw = (await cookies()).get(LANG_COOKIE)?.value;
  const lang = isLang(raw) ? raw : DEFAULT_LANG;
  setRenderLang(lang);
  Settings.defaultLocale = dateLocale(lang); // month and weekday names in server-rendered dates
  return (
    <html lang={lang} suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers lang={lang}>{children}</Providers>
      </body>
    </html>
  );
}
