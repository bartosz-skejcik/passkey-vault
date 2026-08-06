"use client";

// D-3/E5's shared-item marker (26-UI-SPEC.md's E5 contract) -- this
// codebase's first overlapping-circle/initials component, no existing
// analog to extend (26-PATTERNS.md's own conclusion). Two variants:
//
//   - "circles" (default) -- 1-3 recipients render that many overlapping
//     20px circles (initial = uppercased first char of the recipient's
//     email local-part, no display-name field exists anywhere in this
//     schema); 4+ recipients render the first 3 circles plus a 4th `+N`
//     circle (D-3's required overflow form).
//   - "icon" -- a single small Share2 icon in text-secondary, no circles,
//     for narrow contexts (Sidebar's shared-folder rows, wired by Plan
//     26-10 -- Sidebar rows are per-COLLECTION, not per-item, so that
//     caller passes a pre-resolved `recipients` prop instead of an `item`,
//     avoiding a second fetch for data it already has).
//
// A suspended recipient (A-7: the server flags rather than filters
// suspended co-recipients) renders with a visibly distinct treatment --
// never merely present in the same aria-label as an active one -- because
// hiding it would tell the owner nobody has access when a single
// reinstate click would restore it.
//
// The stack carries exactly ONE aria-label summarizing every recipient
// (built from sharing.sharedWithLabel's interpolation pattern, then the
// full recipient list appended) -- never one label per circle, so a screen
// reader announces the whole set in one pass rather than navigating
// decorative overlapping circles individually.
import { Share2 } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";
import { useShareRecipients, type ShareRecipient } from "@/lib/vault/shareRecipients";
import type { VaultItem } from "@/lib/vault/types";

const MAX_VISIBLE_CIRCLES = 3;

function initialOf(recipient: ShareRecipient): string {
  return recipient.email.charAt(0).toUpperCase();
}

function buildAriaLabel(countLabel: string, recipients: ShareRecipient[]): string {
  const emails = recipients.map((r) => r.email).join(", ");
  return `${countLabel}: ${emails}`;
}

function Circle({ recipient }: { recipient: ShareRecipient }) {
  return (
    <span
      aria-hidden="true"
      data-testid={recipient.suspended ? "avatar-stack-circle-suspended" : "avatar-stack-circle"}
      className={
        "-ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase ring-2 first:ml-0 " +
        (recipient.suspended
          ? "bg-base-300 text-base-content/40 opacity-60 ring-warning"
          : "bg-base-300 text-base-content/70 ring-base-100")
      }
      title={recipient.suspended ? undefined : recipient.email}
    >
      {initialOf(recipient)}
    </span>
  );
}

function OverflowCircle({ count }: { count: number }) {
  return (
    <span
      aria-hidden="true"
      data-testid="avatar-stack-overflow"
      className="-ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-base-300 text-[10px] font-bold text-base-content/60 ring-2 ring-base-100"
    >
      +{count}
    </span>
  );
}

export interface AvatarStackProps {
  /** Circle-stack variant's default data source; icon variant may omit this
   * entirely when `recipients` is already known (Sidebar's per-collection
   * rows). */
  item?: VaultItem;
  /** Pre-resolved recipient set -- bypasses `useShareRecipients`'s own
   * fetch. Required for the icon variant when no `item` is given. */
  recipients?: ShareRecipient[];
  variant?: "circles" | "icon";
}

export default function AvatarStack({ item, recipients: providedRecipients, variant = "circles" }: AvatarStackProps) {
  const { t } = useLocale();
  // Always called (rules of hooks) -- `item ?? null` means the hook fetches
  // nothing and resolves to `[]` when the caller relies on `recipients`
  // instead (icon variant, no item).
  const resolvedFromHook = useShareRecipients(item ?? null);
  const recipients = providedRecipients ?? resolvedFromHook;

  // E5's loading backstop: while unresolved, render NOTHING -- not a
  // skeleton, not a placeholder, never a flash of an empty/wrong stack.
  if (recipients === null) {
    return null;
  }
  if (recipients.length === 0) {
    return null;
  }

  const countLabel = interpolate(t("sharing.sharedWithLabel"), { count: String(recipients.length) });
  const ariaLabel = buildAriaLabel(countLabel, recipients);

  if (variant === "icon") {
    return (
      <span
        data-testid="avatar-stack-icon"
        role="img"
        aria-label={ariaLabel}
        className="inline-flex shrink-0 items-center text-secondary"
      >
        <Share2 size={14} aria-hidden="true" />
      </span>
    );
  }

  const visible = recipients.slice(0, MAX_VISIBLE_CIRCLES);
  const overflowCount = recipients.length - visible.length;

  return (
    <span data-testid="avatar-stack" role="img" aria-label={ariaLabel} className="flex items-center">
      {visible.map((recipient, idx) => (
        <Circle key={`${recipient.email}-${idx}`} recipient={recipient} />
      ))}
      {overflowCount > 0 ? <OverflowCircle count={overflowCount} /> : null}
    </span>
  );
}
