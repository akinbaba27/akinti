/**
 * Typed route builders. Every internal link in the app should go through these
 * so route shapes can change in one place.
 */

const enc = (segment: string): string => encodeURIComponent(segment);

export const routes = {
  /* App */
  home: () => "/",
  /** Flow (founder decision, 6 Sept 2026, `docs/FLOW.md`): the full-screen continuous listening feed, the default screen after login. */
  flow: () => "/flow",
  explore: () => "/explore",
  search: (q?: string) => (q && q.trim().length > 0 ? `/search?q=${enc(q.trim())}` : "/search"),
  create: (params?: { track?: string; challenge?: string }) => {
    const query = new URLSearchParams();
    if (params?.track) query.set("track", params.track);
    if (params?.challenge) query.set("challenge", params.challenge);
    const search = query.toString();
    return search ? `/create?${search}` : "/create";
  },
  /** Browse the curated/open backing-track library (see also Explore's own "Tracks to sing over" lane). */
  tracks: () => "/tracks",
  notifications: () => "/notifications",
  messages: () => "/messages",
  conversation: (conversationId: string) => `/messages/${enc(conversationId)}`,
  profile: (username: string) => `/u/${enc(username)}`,
  profileFollowers: (username: string) => `/u/${enc(username)}/followers`,
  profileFollowing: (username: string) => `/u/${enc(username)}/following`,
  wave: (waveId: string) => `/w/${enc(waveId)}`,
  /** Owned by the Duet stage/agent — Stage 8 only links here (spec §14 "Request a Duet"). */
  waveDuet: (waveId: string) => `/w/${enc(waveId)}/duet`,
  waveComments: (waveId: string) => `/w/${enc(waveId)}#comments`,
  messageNew: (to: string) => `/messages/new?to=${enc(to)}`,

  /* Duets (§15) */
  duets: () => "/duets",
  duetRecord: (waveId: string, requestId: string) =>
    `/w/${enc(waveId)}/duet/record?request=${enc(requestId)}`,

  /* Prompts & challenges (§4 "weekly theme + backing track, curated Top 5, hashtag pages") */
  challenges: () => "/challenges",
  challenge: (slug: string) => `/challenges/${enc(slug)}`,
  /** Hashtag pages — reuses `waves.tags`, not owned by the challenges tables. */
  hashtag: (tag: string) => `/hashtag/${enc(tag)}`,

  /* Creator analytics + product health (§27, §28) */
  analytics: (days?: number) => (days ? `/analytics?days=${days}` : "/analytics"),
  /** Moderators only — 404 otherwise (spec §28, mirrors `/moderation`). */
  analyticsHealth: (days?: number) => (days ? `/analytics/health?days=${days}` : "/analytics/health"),

  /* Settings (§25) */
  settings: () => "/settings",
  settingsAccount: () => "/settings/account",
  settingsPrivacy: () => "/settings/privacy",
  settingsAppearance: () => "/settings/appearance",
  settingsNotifications: () => "/settings/notifications",
  settingsContent: () => "/settings/content",
  settingsContentSaved: () => "/settings/content/saved",
  settingsContentCommented: () => "/settings/content/commented",
  settingsContentWaves: () => "/settings/content/waves",
  settingsContentDuets: () => "/settings/content/duets",
  settingsAudio: () => "/settings/audio",
  settingsSafety: () => "/settings/safety",
  settingsFollowRequests: () => "/settings/follow-requests",
  /** AKINTI Pro (Wave F, PRODUCT_V2 §4/§5) — screen owned by a later frontend wave; this route is needed now by `src/app/api/billing/iyzico/callback/route.ts`'s post-checkout redirect. */
  settingsPro: () => "/settings/pro",

  /* Moderation (§26) — moderators only, 404 otherwise */
  moderation: () => "/moderation",
  moderationReport: (reportId: string) => `/moderation?report=${enc(reportId)}`,

  /* Suspension (§26) */
  suspended: () => "/suspended",

  /* Auth & onboarding */
  login: (next?: string) => withNext("/login", next),
  signup: () => "/signup",
  forgotPassword: () => "/forgot-password",
  resetPassword: () => "/reset-password",
  authCallback: () => "/auth/callback",
  onboarding: (next?: string) => withNext("/onboarding", next),
} as const;

function withNext(path: string, next: string | undefined): string {
  if (!next || next === path) {
    return path;
  }
  return `${path}?next=${enc(next)}`;
}

export type RouteBuilders = typeof routes;
export type RouteName = keyof RouteBuilders;
export type Href = string;

/**
 * Routes reachable without a session (spec §8 — browsing is not gated).
 * Everything else is enforced by `src/proxy.ts` and, per page, by
 * `requireUser`/`requireOnboarded` (`src/lib/auth/server.ts`) as
 * defense-in-depth: the proxy redirect is a UX convenience, never the actual
 * authorization boundary (that's Postgres RLS — see `docs/SECURITY.md`).
 */
const PUBLIC_EXACT_ROUTES: readonly Href[] = [
  routes.login(),
  routes.signup(),
  routes.forgotPassword(),
  routes.resetPassword(),
  routes.explore(),
  routes.search(),
  // The Stage 1 component gallery: static UI only, no user data, useful
  // without an account.
  "/kit",
  // Reachable for a signed-in suspended user without the proxy's onboarding
  // gate bouncing them to `/onboarding` first (spec §26, migration 23) — the
  // page itself still requires a session (via `getCurrentUser`, never
  // `requireUser`, to avoid a redirect loop back to itself).
  routes.suspended(),
  // The Serwist offline fallback (`src/app/~offline/page.tsx`,
  // `src/app/sw.ts`'s `fallbacks.entries`). Without this, the Service
  // Worker's install-time precache fetch for `/~offline` — made with
  // whatever cookies happen to exist, often none — got redirected to
  // `/login` and cached THAT as the "offline" response: every visitor,
  // signed in or not, saw the login page instead of the real offline state
  // the instant the network genuinely failed.
  "/~offline",
];

/** Prefix-matched public routes: OAuth/callback plumbing and public content. */
const PUBLIC_ROUTE_PREFIXES: readonly Href[] = [
  "/auth/", // /auth/callback and any future OAuth provider routes
  "/api/", // Route Handlers do their own auth/authorization (RLS + can_view_* RPCs) and
           // must return a real API response (JSON/404), never an HTML redirect to
           // /login — e.g. GET /api/audio/[assetId]/url's documented "always 404,
           // never 403" contract (AUDIO_ARCHITECTURE.md, SECURITY.md). Without this,
           // an anonymous visitor's audio fetch for a fully public Wave was silently
           // redirected to the login page instead of getting a signed URL or a 404.
           // updateSession() still refreshes the session cookie for these paths first;
           // this only skips the page-style redirect branch.
  "/w/", // Wave detail — visibility is enforced server-side, not by gating the route
  "/u/", // Profile pages — same
  "/challenges", // Prompts & challenges (§4) — a live/closed challenge is public, RLS-gated
  "/hashtag/", // Hashtag pages (§4) — reuses waves.tags, public the same way /explore is
];

export function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_EXACT_ROUTES.includes(pathname)) {
    return true;
  }
  return PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Settings sub-navigation, in display order.
 *
 * `label` and `description` are English-only module-level constants, for the
 * same reason `TERMS` is (`src/config/terminology.ts`'s header): evaluated at
 * import time, before any per-request locale exists. Neither is rendered —
 * both `settings/page.tsx` and `SettingsNavPane.tsx` read the localized
 * `SettingsSections` namespace, keyed by `key`, and nothing reads
 * `description` at all. They are kept as the in-code index of what each
 * section covers, so they have to stay accurate even though no user sees
 * them.
 */
export interface SettingsSection {
  readonly key: string;
  readonly label: string;
  /** Not rendered anywhere; see the note above. Keep it true to the screen. */
  readonly description: string;
  readonly href: Href;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    key: "account",
    label: "Account",
    description: "Profile, username, email, password, account deletion.",
    href: routes.settingsAccount(),
  },
  {
    key: "privacy",
    label: "Privacy",
    description: "Profile visibility, messaging, Duet Requests, default Wave visibility.",
    href: routes.settingsPrivacy(),
  },
  {
    key: "appearance",
    label: "Appearance",
    description: "Theme mode (system, light, dark) and the profile signature hue.",
    href: routes.settingsAppearance(),
  },
  {
    key: "notifications",
    label: "Notifications",
    description: "Choose what you want to hear about.",
    href: routes.settingsNotifications(),
  },
  {
    key: "content",
    label: "Content",
    description: "Saved Waves, commented Waves, your Waves and Duets.",
    href: routes.settingsContent(),
  },
  {
    key: "analytics",
    label: "Analytics",
    description: "Plays, listeners, Replays and Wave performance over time.",
    href: routes.analytics(),
  },
  {
    key: "audio",
    label: "Audio",
    description: "Playback preferences, autoplay, audio quality.",
    href: routes.settingsAudio(),
  },
  {
    key: "safety",
    label: "Safety",
    description: "Blocked users, reports, security.",
    href: routes.settingsSafety(),
  },
  {
    /**
     * Listed here so the mobile Settings hub reaches it. `/settings/pro`
     * already existed and was linked from `DesktopSideNav` and the ⌘K command
     * palette — both desktop-only — so on a phone, which is this product's
     * design target, AKINTI Pro had no entry point at all. `settings/page.tsx`
     * renders any section outside its own `GROUPS` as a final cluster, so this
     * needs no change there; `SettingsNavPane` keeps its own `GROUPS` list and
     * so the desktop rail still, deliberately, does not repeat it.
     */
    key: "pro",
    label: "AKINTI Pro",
    description: "Subscription, Pro sounds, stems, billing.",
    href: routes.settingsPro(),
  },
];

/**
 * True when `pathname` is the given route or a descendant of it.
 * `/` only matches exactly.
 */
export function isActiveRoute(pathname: string, href: Href): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
