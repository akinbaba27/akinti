import { SerwistProvider } from "@serwist/next/react";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Archivo, Martian_Mono } from "next/font/google";

import { BRAND, SITE } from "@/config/terminology";
import { getCurrentUserWithProfile } from "@/lib/auth/server";
import { pickMessages } from "@/i18n/pickMessages";
import { resolveThemeMode, themeModeToDataAttribute, THEME_COOKIE } from "@/lib/ui/themeMode";

import { Providers } from "./providers";
import "./globals.css";

/**
 * Namespaces needed directly under the root layout's own tree — everything
 * that is NOT `(app)` or `(auth)` (both provide their own, larger,
 * self-sufficient sets below their own `NextIntlClientProvider`, since
 * nesting one does not merge with an ancestor's): `/onboarding`,
 * `/~offline`, and the `error.tsx`/`not-found.tsx` boundaries (review3
 * finding 12 — see `pickMessages`'s doc comment for why a nested provider
 * must be self-sufficient rather than additive).
 *
 * `NotFoundPage`/`ErrorPage` are load-bearing, not a "safe fallback" as an
 * earlier version of this comment described them: both boundaries call
 * `useTranslations` for every string they render. While they were missing
 * here, any 404 or unhandled error outside the five segments that list
 * `NotFoundPage` in their own layout (`(app)/create`, `explore`, `flow`,
 * `settings`, `w/[id]`) fell through to these root boundaries and rendered
 * the raw key paths — "NotFoundPage.title NotFoundPage.description
 * NotFoundPage.goHome NotFoundPage.browseExplore" — straight at the user,
 * plus a MISSING_MESSAGE console error. Caught by the 2026-09-25 audit
 * sweep on a mistyped URL.
 */
const ROOT_MESSAGE_NAMESPACES = [
  "Terms",
  "Offline",
  "OnboardingPage",
  "OnboardingFlow",
  "NotFoundPage",
  "ErrorPage",
] as const;

/**
 * Archivo Variable carries display, UI and body: the width axis, not a second
 * family, supplies the contrast (`docs/design/DESIGN.md` §3.1). `latin-ext` is
 * not optional — ı, İ, ğ, Ğ, ş and Ş live there, and requesting only `latin`
 * makes Turkish words fall back to a system font mid-word (§3.2). Fonts are
 * deliberately not preloaded: on mobile they must not compete with the LCP
 * element for bandwidth (`docs/research/mobile-guidelines.md` rule 43).
 */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
  display: "swap",
  preload: false,
});

/** Numerals and technical values only: timecodes, dB, latency, counts (§3.4). */
const martianMono = Martian_Mono({
  variable: "--font-martian-mono",
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
  display: "swap",
  preload: false,
});

/**
 * `generateMetadata`, not a static `export const metadata`: the title and
 * description are locale-dependent (`messages/{tr,en}.json`'s `Metadata`
 * namespace), and a plain object literal is evaluated once at module load,
 * before any per-request locale is known. `getTranslations` resolves
 * through the same `src/i18n/request.ts` config as everything else server-
 * side, so this stays in sync with `<html lang>` below.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations("Metadata"), getLocale()]);
  const title = t("title");
  const description = t("description");

  return {
    title: {
      default: title,
      template: `%s · ${BRAND}`,
    },
    description,
    applicationName: SITE.name,
    openGraph: {
      siteName: SITE.name,
      title,
      description,
      type: "website",
      locale: locale === "tr" ? "tr_TR" : "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    /**
     * iOS standalone-mode fixes (`docs/research/mobile-guidelines.md`: "no
     * native install prompt exists [on iOS] — design an explicit in-app
     * instruction card"; `docs/PRODUCT_V2.md` §4: "standalone-mode fixes for
     * iOS"). `appleWebApp` is what actually emits the `apple-mobile-web-app-*`
     * meta tags and the `apple-touch-icon` link Safari needs to add-to-home-
     * screen with the real icon and title instead of a screenshot thumbnail.
     * `statusBarStyle: "black-translucent"` lets the page draw under the status
     * bar, which is why `viewportFit: "cover"` (below) plus the shell's own
     * `env(safe-area-inset-*)` handling matter together.
     */
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: BRAND,
    },
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    // Safari's blue auto-link-ification of anything digit-heavy (timestamps,
    // durations) reads as a phone number often enough on an audio-metadata-
    // heavy UI that it's worth turning off product-wide.
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Mirrors `--akinti-paper` in both themes (`docs/design/COLOR_V2.md`,
  // `src/app/globals.css`) — the v2 tinted water grounds, not the retired
  // v1 warm-neutral pair.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9efec" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1614" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [{ user, profile }, locale, messages, cookieStore] = await Promise.all([
    getCurrentUserWithProfile(),
    getLocale(),
    getMessages(),
    cookies(),
  ]);
  const rootMessages = pickMessages(messages, ROOT_MESSAGE_NAMESPACES);
  // Settings → Appearance's theme row (`AppearanceForm.tsx`, `setThemeMode`
  // in `src/app/(app)/settings/actions.ts`). `system` omits the attribute
  // entirely, leaving `prefers-color-scheme` in charge — the CSS
  // (`globals.css`) and the two canvas components already watch for this
  // attribute, this is just what finally writes it.
  const dataTheme = themeModeToDataAttribute(resolveThemeMode(cookieStore.get(THEME_COOKIE)?.value));

  return (
    <html
      lang={locale}
      data-theme={dataTheme}
      className={`${archivo.variable} ${martianMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        {/* Registers `public/sw.js` (`serwist.config.mjs`, `src/app/sw.ts`)
            on mount. Disabled in development — a stale precache fighting
            Fast Refresh is strictly worse than no service worker at all,
            and neither the offline fallback nor push need to be exercised
            outside a real `next build && next start`.
            `type: "classic"`: `SerwistProvider` defaults to registering with
            `{ type: "module" }`, but `serwist build` (`@serwist/cli`, an
            esbuild bundle) emits a plain global-scope script (`var ... `,
            no `import`/`export`) — registering that as a module-type worker
            silently never activates it (Chromium accepts the registration
            but the worker never installs). */}
        <NextIntlClientProvider messages={rootMessages}>
          <SerwistProvider
            swUrl="/sw.js"
            disable={process.env.NODE_ENV === "development"}
            options={{ type: "classic" }}
          >
            <Providers initialUser={user} initialProfile={profile}>
              {children}
            </Providers>
          </SerwistProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
