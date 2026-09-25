/**
 * The icon set (`docs/design/DESIGN.md` §9).
 *
 * Phosphor Icons, `regular` weight, 1.5px stroke on a 16px grid, at 16 / 20 /
 * 24px. This is a deliberate swap away from `lucide-react`: Lucide is the
 * shadcn default and reads as such, and its uniform 2px stroke fights the
 * hairline system (§12.26).
 *
 * One rule carries all icon state: **outline means available, fill means
 * engaged.** Saved is a filled bookmark, the active tab is a filled glyph,
 * playing is a filled pause. Pass `weight="fill"` for engaged; never a colour.
 *
 * Every icon in the product comes from this module, so the set can never
 * drift, mix weights, or acquire a hand-rolled glyph. Names are kept stable
 * across the swap so call sites keep reading in plain English; the comment on
 * each line records the Phosphor glyph actually being drawn where it differs.
 *
 * Imported from `@phosphor-icons/react/dist/ssr/<Icon>` one file at a time:
 * the `ssr` build carries no `"use client"` boundary, so a Server Component
 * can render an icon without becoming a Client Component, and the per-icon
 * path keeps the 1,500-glyph barrel out of the graph entirely.
 *
 * AKINTI's own marks are drawn geometry, not icons: the waterline, the
 * write-head, the record dot and the Duet mark are never in this file.
 */

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

export { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
export { ArrowBendUpLeft as Reply } from "@phosphor-icons/react/dist/ssr/ArrowBendUpLeft";
export { ArrowCounterClockwise as RotateCcw } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
export { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
export { Bell } from "@phosphor-icons/react/dist/ssr/Bell";
export { BookmarkSimple as Bookmark } from "@phosphor-icons/react/dist/ssr/BookmarkSimple";
export { CaretDown as ChevronDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
export { CaretLeft as ChevronLeft } from "@phosphor-icons/react/dist/ssr/CaretLeft";
export { CaretRight as ChevronRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
export { ChartBar as ChartColumn } from "@phosphor-icons/react/dist/ssr/ChartBar";
export { Crown } from "@phosphor-icons/react/dist/ssr/Crown";
export { ChatCircle as MessageCircle } from "@phosphor-icons/react/dist/ssr/ChatCircle";
export { ChatCircleSlash as MessageCircleOff } from "@phosphor-icons/react/dist/ssr/ChatCircleSlash";
export { ChatTeardrop as MessageSquare } from "@phosphor-icons/react/dist/ssr/ChatTeardrop";
export { Check } from "@phosphor-icons/react/dist/ssr/Check";
export { CheckCircle as CircleCheck } from "@phosphor-icons/react/dist/ssr/CheckCircle";
export { CircleNotch as Loader2 } from "@phosphor-icons/react/dist/ssr/CircleNotch";
export { Clock } from "@phosphor-icons/react/dist/ssr/Clock";
export { Compass } from "@phosphor-icons/react/dist/ssr/Compass";
export { DotsThree as MoreHorizontal } from "@phosphor-icons/react/dist/ssr/DotsThree";
export { DotsThreeVertical as MoreVertical } from "@phosphor-icons/react/dist/ssr/DotsThreeVertical";
export { DownloadSimple as Download } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
export { Flag } from "@phosphor-icons/react/dist/ssr/Flag";
export { Gear as Settings } from "@phosphor-icons/react/dist/ssr/Gear";
export { Handshake } from "@phosphor-icons/react/dist/ssr/Handshake";
export { House } from "@phosphor-icons/react/dist/ssr/House";
export { Info } from "@phosphor-icons/react/dist/ssr/Info";
export { LinkSimple as Link } from "@phosphor-icons/react/dist/ssr/LinkSimple";
export { Lock } from "@phosphor-icons/react/dist/ssr/Lock";
export { MagnifyingGlass as Search } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
export { Microphone as Mic } from "@phosphor-icons/react/dist/ssr/Microphone";
export { MicrophoneSlash as MicOff } from "@phosphor-icons/react/dist/ssr/MicrophoneSlash";
export { MicrophoneStage as Mic2 } from "@phosphor-icons/react/dist/ssr/MicrophoneStage";
export { MusicNotes } from "@phosphor-icons/react/dist/ssr/MusicNotes";
export { PaperPlaneTilt as Send } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
export { Pause } from "@phosphor-icons/react/dist/ssr/Pause";
export { PencilSimple as Pencil } from "@phosphor-icons/react/dist/ssr/PencilSimple";
export { Play } from "@phosphor-icons/react/dist/ssr/Play";
export { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
export { Prohibit as Ban } from "@phosphor-icons/react/dist/ssr/Prohibit";
export { Queue } from "@phosphor-icons/react/dist/ssr/Queue";
export { Repeat } from "@phosphor-icons/react/dist/ssr/Repeat";
export { SealCheck } from "@phosphor-icons/react/dist/ssr/SealCheck";
export { ShareNetwork as Share2 } from "@phosphor-icons/react/dist/ssr/ShareNetwork";
export { ShieldCheck } from "@phosphor-icons/react/dist/ssr/ShieldCheck";
export { Shuffle } from "@phosphor-icons/react/dist/ssr/Shuffle";
export { SidebarSimple } from "@phosphor-icons/react/dist/ssr/SidebarSimple";
export { SignOut as LogOut } from "@phosphor-icons/react/dist/ssr/SignOut";
export { SkipBack } from "@phosphor-icons/react/dist/ssr/SkipBack";
export { SkipForward } from "@phosphor-icons/react/dist/ssr/SkipForward";
export { SpeakerHigh } from "@phosphor-icons/react/dist/ssr/SpeakerHigh";
export { SpeakerLow } from "@phosphor-icons/react/dist/ssr/SpeakerLow";
export { SpeakerSlash as VolumeOff } from "@phosphor-icons/react/dist/ssr/SpeakerSlash";
export { Square } from "@phosphor-icons/react/dist/ssr/Square";
export { Trash as Trash2 } from "@phosphor-icons/react/dist/ssr/Trash";
export { Trophy } from "@phosphor-icons/react/dist/ssr/Trophy";
export { UploadSimple as Upload } from "@phosphor-icons/react/dist/ssr/UploadSimple";
export { Waves } from "@phosphor-icons/react/dist/ssr/Waves";
export { User } from "@phosphor-icons/react/dist/ssr/User";
export { UserCheck } from "@phosphor-icons/react/dist/ssr/UserCheck";
export { UserCircle as UserRound } from "@phosphor-icons/react/dist/ssr/UserCircle";
export { UserCirclePlus as UserRoundPlus } from "@phosphor-icons/react/dist/ssr/UserCirclePlus";
export { UserMinus as UserX } from "@phosphor-icons/react/dist/ssr/UserMinus";
export { UserPlus } from "@phosphor-icons/react/dist/ssr/UserPlus";
export { Users } from "@phosphor-icons/react/dist/ssr/Users";
export { Warning as AlertTriangle } from "@phosphor-icons/react/dist/ssr/Warning";
export { Warning as TriangleAlert } from "@phosphor-icons/react/dist/ssr/Warning";
export { WarningCircle as CircleAlert } from "@phosphor-icons/react/dist/ssr/WarningCircle";
export { X } from "@phosphor-icons/react/dist/ssr/X";
export { XCircle } from "@phosphor-icons/react/dist/ssr/XCircle";
export { XCircle as CircleX } from "@phosphor-icons/react/dist/ssr/XCircle";

/**
 * The type every icon in this module satisfies. Replaces the old set's
 * exported component type at the places that store an icon in a table rather
 * than rendering it directly.
 */
export type IconComponent = PhosphorIcon;

/** Icon sizes. Nothing renders an icon at a size outside this list (§9). */
export const ICON_SIZE = {
  sm: 16,
  md: 20,
  lg: 24,
} as const;

export type IconSize = keyof typeof ICON_SIZE;
