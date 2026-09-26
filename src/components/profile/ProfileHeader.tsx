import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChartColumn, MusicNotes, Pencil, UserPlus, Users } from "@/components/ui/icons";

import { WaveformCanvas, type TraceHue } from "@/components/audio";
import { ProMark } from "@/components/pro/ProMark";
import { routes } from "@/config/routes";
import type { FollowStatus, Profile } from "@/types/domain";
import { Avatar } from "@/components/ui";
import { cn, formatCount } from "@/lib/ui";

import { FollowButton } from "./FollowButton";
import { ProfileOverflowMenu } from "./ProfileOverflowMenu";
import { ShareProfileButton } from "./ShareProfileButton";

/** Matches `Button`'s `variant="secondary" size="sm"` — used here because these are real
 *  navigations (Edit profile, Message), not actions, and must render as `<a>`, not `<button>`.
 *  Key radius, hairline border, no fill: the same ink-line "key" look as everywhere else
 *  (§8.7) — never a pill (§12.4). */
const SECONDARY_LINK_BUTTON =
  // 44px, the touch baseline (WCAG 2.5.5, iOS 44pt, Android 48dp); was h-9.
  "akinti-press inline-flex h-11 items-center gap-1.5 rounded-key border border-hairline-strong px-3 " +
  "type-caption font-medium text-ink transition-colors hover:bg-paper-sunk " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide";

/** Trace height for the signature banner (§8): a real waveform, not a hero image. */
const SIGNATURE_HEIGHT = 96;

export interface ProfileHeaderViewerState {
  isSelf: boolean;
  isSignedIn: boolean;
  followStatus: FollowStatus | null;
  /** True when this profile already follows the viewer back. */
  followsViewer: boolean;
  /** True when the viewer has blocked this profile (not the reverse — that state never renders at all). */
  isBlockedByViewer: boolean;
}

export interface ProfileHeaderProps {
  profile: Profile;
  viewer: ProfileHeaderViewerState;
  /** This person's signature (SCREENS.md §8): composed from their own last 12
   *  Waves, newest first. Empty when they haven't published yet. */
  signature?: readonly number[];
  /**
   * The creator's dominant genre tint for the signature trace
   * (`docs/design/COLOR_V2.md` "Profile signature trace"), derived by the
   * caller with `deriveGenreHue` (`@/components/feed`) from the same Waves'
   * tags. Omitted draws the plain current, as it always has.
   */
  hue?: TraceHue;
  /**
   * AKINTI Pro (Wave F, PRODUCT_V2 §5) — from `withIsPro`
   * (`src/lib/db/mappers.ts`), which the caller composes from
   * `isPro(db, profile.id)` (`src/lib/billing/entitlements.ts`). Draws the
   * ink `ProMark` next to the handle; never rendered for a non-Pro profile.
   */
  isPro?: boolean;
  className?: string;
}

/** The dormant signature, before anyone has published a Wave (§8.2): a row
 *  of ink-hairline ticks at rest, never a fake shape. */
function DormantSignature() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full items-center gap-2 px-5"
      style={{ height: SIGNATURE_HEIGHT }}
    >
      {Array.from({ length: 28 }, (_, index) => (
        <span key={index} className="h-px w-3 shrink-0 bg-hairline-strong" />
      ))}
    </div>
  );
}

/**
 * Profile header (SCREENS.md §8): the signature trace as cover art, avatar,
 * identity, counts, and the Follow/Message/Share/Block/Report action row.
 * Creation-type-agnostic — this component knows nothing about
 * Recorded/Uploaded/Duet, that lives entirely on `WaveCard`.
 */
export async function ProfileHeader({
  profile,
  viewer,
  signature = [],
  hue,
  isPro = false,
  className,
}: ProfileHeaderProps) {
  const name = profile.displayName ?? profile.username;
  const t = await getTranslations("ProfileHeader");
  const tTerms = await getTranslations("Terms");

  return (
    <div className={cn("flex flex-col", className)}>
      {/* `DESIGN_V3_DESKTOP.md` (`Profile`: "signature trace as a wide
          banner (dark)") needs no `lg:` override here: `--akinti-paper-sunk`
          is itself re-aliased to the dark elevation-0 floor at >= 1024px
          (globals.css's desktop elevation block, "dark is the desktop
          default regardless of system preference"), so this banner is
          already the dark Akış ground at that width without a class
          change — same as every other `bg-paper*` surface in the product. */}
      <div className="w-full bg-paper-sunk" style={{ height: SIGNATURE_HEIGHT }}>
        {signature.length > 0 ? (
          <WaveformCanvas peaks={signature} height={SIGNATURE_HEIGHT} state="unplayed" hue={hue} />
        ) : (
          <DormantSignature />
        )}
      </div>

      <div className="flex flex-col gap-4 px-4 pb-2 sm:px-5">
        <div className="flex items-end justify-between gap-3">
          <Avatar
            name={name}
            src={profile.avatarUrl}
            size="xl"
            className="-mt-10 shrink-0 ring-4 ring-surface sm:-mt-12"
          />

          <div className="flex items-center gap-2 pb-1">
            {viewer.isSelf ? (
              <>
                <Link href={routes.settingsAccount()} className={SECONDARY_LINK_BUTTON}>
                  <Pencil className="size-4" aria-hidden="true" />
                  {tTerms("editProfile")}
                </Link>
                {/* spec §27 (creator analytics): one tap from the owner's own profile to their Plays/Replays/Wave performance dashboard. */}
                <Link href={routes.analytics()} className={SECONDARY_LINK_BUTTON}>
                  <ChartColumn className="size-4" aria-hidden="true" />
                  {t("analytics")}
                </Link>
              </>
            ) : (
              <>
                <FollowButton
                  profileId={profile.id}
                  initialFollowStatus={viewer.followStatus}
                  isSignedIn={viewer.isSignedIn}
                  followsViewer={viewer.followsViewer}
                />
                {/* Just the link (spec deliverable) — the compose flow itself is Messaging (Stage 10). */}
                <Link href={routes.messageNew(profile.username)} className={SECONDARY_LINK_BUTTON}>
                  {tTerms("message")}
                </Link>
                <ShareProfileButton username={profile.username} />
                {viewer.isSignedIn ? (
                  <ProfileOverflowMenu
                    profileId={profile.id}
                    username={profile.username}
                    isBlocked={viewer.isBlockedByViewer}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-fg">{name}</h1>
          <div className="flex items-center gap-2">
            <p className="text-sm text-fg-subtle">@{profile.username}</p>
            {isPro ? <ProMark /> : null}
          </div>
          {profile.bio ? (
            <p className="mt-1 max-w-prose text-sm leading-relaxed whitespace-pre-line text-fg-muted">
              {profile.bio}
            </p>
          ) : null}
          {viewer.isSelf ? (
            <p className="type-caption text-ink-subtle">
              {signature.length > 0 ? t("signatureWithWaves") : t("signatureEmpty")}
            </p>
          ) : null}
        </div>

        {/* `DESIGN_V3_DESKTOP.md` "Icons": "every ... metadata line has an
            icon" — desktop-only (`hidden lg:inline`) since the mobile stats
            row (`docs/design/DESIGN.md`) is deliberately icon-free text. */}
        <div className="flex items-center gap-4 text-sm">
          <Link
            href={routes.profileFollowers(profile.username)}
            className="flex items-center gap-1.5 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Users className="hidden size-3.5 text-fg-subtle lg:inline" aria-hidden="true" />
            <span className="font-semibold text-fg tabular-nums">
              {formatCount(profile.counts.followers)}
            </span>{" "}
            <span className="text-fg-subtle">{tTerms("followers")}</span>
          </Link>
          <Link
            href={routes.profileFollowing(profile.username)}
            className="flex items-center gap-1.5 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <UserPlus className="hidden size-3.5 text-fg-subtle lg:inline" aria-hidden="true" />
            <span className="font-semibold text-fg tabular-nums">
              {formatCount(profile.counts.following)}
            </span>{" "}
            <span className="text-fg-subtle">{tTerms("following")}</span>
          </Link>
          <span className="flex items-center gap-1.5">
            <MusicNotes className="hidden size-3.5 text-fg-subtle lg:inline" aria-hidden="true" />
            <span className="font-semibold text-fg tabular-nums">
              {formatCount(profile.counts.waves)}
            </span>{" "}
            <span className="text-fg-subtle">{tTerms("waves")}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
