// ItemDetailView.tsx — minimal, picker-only detail pane (09-UI-SPEC.md's
// "Item Detail view" section; CONTEXT.md's Discretion Area: picker-only
// depth, not full CRUD). Sourced from the SAME item object already
// present in ItemListView's fetched array -- no separate vault.getItem
// message. No edit/delete/deep-link controls this phase.
import { useEffect, useState } from "react";
import { ChevronLeft, Copy, Check, Eye, EyeOff } from "lucide-react";
import type { ItemFields, VaultItem } from "../../lib/vault/types";
import { t, interpolate, type Locale, type DICTIONARY } from "../../lib/i18n/dictionary";
import { sendMessage } from "../../lib/messaging/ext-protocol";
import type { MessageResponseMap } from "../../lib/messaging/ext-protocol";
import SharedBadge from "./SharedBadge";

// Same D-05 route as ItemListView.tsx's own type derivation -- this
// popup component may only reach a decrypted collection name via
// vault.list's `collections` field, never a direct background import.
type CollectionSummary = MessageResponseMap["vault.list"]["collections"][number];

const FIELD_ORDER: Record<ItemFields["type"], string[]> = {
  login: ["username", "password", "notes"],
  card: ["cardholderName", "number", "expiry", "cvv", "notes"],
  identity: ["firstName", "lastName", "email", "phone", "address", "notes"],
  note: ["body"],
  totp: ["secret"],
  // Phase 12 (Plan 12-02): "passkey" now exists in the data model
  // (PasskeyFields) -- intentionally empty here, the dedicated
  // `passkey !== null` block below already renders the guaranteed RP
  // ID/last-used rows (BINDING, Bartek 2026-07-15).
  passkey: [],
};

const MONO_FIELDS = new Set(["password", "number", "cvv", "secret"]);
const REVEALABLE_FIELDS = new Set(["password", "number", "secret"]);
const MASK = "•".repeat(10);

/**
 * Fire-and-forget "this item's secret was just used" signal (NordPass-style
 * last-used tracking, quick-260717). This popup document decrypts/copies
 * CLIENT-SIDE (unlike every autofill/ceremony touch-point, which already
 * runs in the background) -- the `vault.touch` message kind
 * (lib/messaging/ext-protocol.ts) is the lightweight hop into
 * vault-store.ts's own touchVaultItem(), never a duplicated fetch here.
 * Never awaited by callers: a failed/offline touch must never delay a
 * reveal/copy in this view (catch + debug-log only).
 */
function touchItem(itemId: string): void {
  void sendMessage({ kind: "vault.touch", itemId }).catch((err: unknown) => {
    console.debug("[passkey-vault] touchItem failed (non-fatal, fire-and-forget)", itemId, err);
  });
}

/**
 * Renders the guaranteed RP ID/last-used rows for a passkey item (BINDING,
 * Bartek 2026-07-15). `PasskeyFields` (Plan 12-02, lib/vault/types.ts) has
 * no `lastUsedAt` field -- that row always renders "—" today; a future plan
 * that tracks last-use time can populate it without touching this view.
 */
function passkeyMeta(item: VaultItem): { rpId?: string; lastUsedAt?: string } | null {
  if (item.fields.type !== "passkey") {
    return null;
  }
  return { rpId: item.fields.rpId, lastUsedAt: undefined };
}

export default function ItemDetailView({
  locale,
  item,
  onBack,
}: {
  locale: Locale;
  item: VaultItem;
  onBack: () => void;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  // 27-08 (Task 3): the E3 shared-folder note's name source. Fetched only
  // when this item is actually collection-scoped -- a directly-shared item
  // (`collectionId == null`) needs no lookup at all, and every pre-27-08
  // test fixture that constructs a VaultItem without `collectionId` keeps
  // this component's mount behavior (no vault.list call) unchanged.
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const fieldValues = item.fields as unknown as Record<string, string>;
  const passkey = passkeyMeta(item);

  useEffect(() => {
    if (item.collectionId == null) {
      return;
    }
    let cancelled = false;
    void sendMessage({ kind: "vault.list" })
      .then((result) => {
        if (!cancelled) {
          setCollections(result.collections ?? []);
        }
      })
      .catch(() => {
        // No fallback needed -- an unresolved folder name simply renders
        // nothing in that slot (see the folder-note render below), never a
        // raw UUID or a blank placeholder.
      });
    return () => {
      cancelled = true;
    };
  }, [item.collectionId]);

  const folderName =
    item.collectionId != null ? collections.find((c) => c.id === item.collectionId)?.name : undefined;

  function isRevealed(key: string): boolean {
    return revealedKeys.has(key);
  }

  // 26-VERIFICATION.md gap 1 (SHARE-03), ported per UX-4's OWN extension
  // divergence (27-CONTEXT.md): checked BEFORE the reveal-state branch in
  // displayValueFor below, unconditional on every render -- a field the
  // user had already revealed on a previous item can never leak through.
  // Unlike web's DetailPanel.tsx (which suppresses reveal only, still
  // allowing copy), THIS popup suppresses BOTH reveal AND copy for
  // `hidden_password` -- see the field-row JSX below and
  // share.hiddenPasswordExtensionNote's own doc comment in dictionary.ts
  // for why that requires its own, non-web-verbatim honesty string.
  function passwordFieldHidden(key: string): boolean {
    return key === "password" && item.accessLevel === "hidden_password";
  }

  function toggleReveal(key: string) {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        // Revealing a masked secret is a "use" of the item, same as
        // copying it -- never fired when re-hiding.
        touchItem(item.id);
      }
      return next;
    });
  }

  function displayValueFor(key: string, value: string): string {
    if (!value) return "—";
    // Fail-closed priority: checked before the reveal-state branch, so the
    // masked value is unconditional for as long as the grant says hidden,
    // never merely "not yet toggled."
    if (passwordFieldHidden(key)) return MASK;
    if (MONO_FIELDS.has(key) && !REVEALABLE_FIELDS.has(key)) return MASK;
    if (REVEALABLE_FIELDS.has(key) && !isRevealed(key)) return MASK;
    return value;
  }

  async function handleCopy(key: string, value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API unavailable in this document context -- nothing
      // else to fall back to; the copy button simply has no effect.
    }
    // Single choke-point for every copy affordance in this view.
    touchItem(item.id);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  }

  function fieldLabelKey(key: string): keyof typeof DICTIONARY {
    return `field.${key}` as keyof typeof DICTIONARY;
  }

  // 11-09 addendum, CORRECTED (regression report): see ServerConfigView's
  // identical comment. `max-h-[600px] overflow-y-auto` lets Chrome
  // auto-size this view to its natural height for the common case (a
  // handful of fields), and becomes this view's own single scroll region
  // only if a very long note or many custom fields would otherwise push
  // past the popup's own height cap -- no nested doubles either way.
  return (
    <div className="flex w-[380px] max-h-[600px] flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={t(locale, "aria.backToList")}
          className="btn btn-ghost btn-square btn-sm"
          onClick={onBack}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <h2 className="flex min-w-0 items-center gap-1 text-[20px] font-bold leading-[1.2]">
          <span className="truncate">{item.fields.name}</span>
          {/* 27-08 (Task 3): the header-tile badge. This view renders no
              icon/glyph in its header at all (confirmed: back button + this
              heading only, no ItemIconTile) -- SharedBadge's own "detail"
              variant is the documented adaptation for that (see its own doc
              comment), rendered as a small inline marker beside the item
              name rather than corner-anchored to a frame this view doesn't
              have. */}
          {item.isShared === true ? <SharedBadge locale={locale} size="detail" /> : null}
        </h2>
      </div>

      {/* 27-08 (Task 3), E3-error backstop: no live path renders this in
          the extension today (27-04's vault-store.ts never retains a
          last-known-good VaultItem for the popup, unlike web -- see
          ItemListView.tsx's own E1-error comment) -- wired here as
          defense-in-depth for the case where a Collection Key resolves but
          the row's own enc_data still fails its integrity check, the same
          class of failure web's undecryptable-item-banner handles. Must
          never fire for the ordinary pending window (Copywriting honesty
          constraint 3) -- E2's pending rows are non-interactive by
          construction and never navigate here in the first place.
          Suppressing "the normal field-editing/reveal affordances" for this
          case is a documented no-op: this view has no edit affordance for
          ANY item, personal or shared (picker-only, 09-CONTEXT.md), so
          there is nothing to hide beyond what's already absent. */}
      {item.undecryptable === true ? (
        <div data-testid="undecryptable-item-banner" className="alert alert-warning text-sm">
          {t(locale, "sync.itemUndecryptableWarning")}
        </div>
      ) : folderName !== undefined ? (
        // E3 "partial": a directly-shared item (collectionId == null)
        // renders NOTHING here -- no invented placeholder. The header badge
        // above already carries the "shared" fact.
        <div data-testid="item-shared-on-collection-note" className="text-sm text-base-content/70">
          {interpolate(t(locale, "share.itemSharedOnCollectionNote"), { folder: folderName })}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {FIELD_ORDER[item.fields.type].map((key) => {
          const value = fieldValues[key] ?? "";
          const hidden = passwordFieldHidden(key);
          return (
            <div key={key} className="flex flex-col gap-1">
              <span className="text-sm text-base-content/60">{t(locale, fieldLabelKey(key))}</span>
              <div className="flex items-center gap-1">
                <span className={`text-base ${MONO_FIELDS.has(key) ? "font-mono" : ""}`}>
                  {displayValueFor(key, value)}
                </span>
                {/* 27-08 (Task 3), UX-4: reveal is omitted ENTIRELY (not
                    merely disabled) for a hidden-password field -- unlike
                    web, which still allows this toggle to render suppressed
                    reveal-only. */}
                {value && REVEALABLE_FIELDS.has(key) && !hidden ? (
                  <button
                    type="button"
                    aria-label={t(locale, isRevealed(key) ? "aria.hidePassword" : "aria.showPassword")}
                    className="btn btn-ghost btn-square btn-sm"
                    onClick={() => toggleReveal(key)}
                  >
                    {isRevealed(key) ? (
                      <EyeOff size={16} aria-hidden="true" />
                    ) : (
                      <Eye size={16} aria-hidden="true" />
                    )}
                  </button>
                ) : null}
                {/* Copy is ALSO omitted entirely for a hidden-password field
                    -- UX-4's own extension-specific divergence from web
                    (which still allows copy at this level). This is exactly
                    why share.hiddenPasswordExtensionNote is its own,
                    non-web-verbatim honesty string (see dictionary.ts). */}
                {value && !hidden ? (
                  <button
                    type="button"
                    aria-label={interpolate(t(locale, "aria.copyField"), { field: t(locale, fieldLabelKey(key)) })}
                    className="btn btn-ghost btn-square btn-sm"
                    onClick={() => void handleCopy(key, value)}
                  >
                    {copiedKey === key ? (
                      <Check size={16} className="text-success" aria-hidden="true" />
                    ) : (
                      <Copy size={16} aria-hidden="true" />
                    )}
                  </button>
                ) : null}
              </div>
              {/* UX-4 honesty obligation (Copywriting honesty constraint 1):
                  rendered directly beneath the masked field on EVERY render,
                  not just the first -- never a one-time dismissible tip. */}
              {hidden ? (
                <span
                  data-testid="hidden-password-extension-note"
                  className="text-xs text-base-content/70"
                >
                  {t(locale, "share.hiddenPasswordExtensionNote")}
                </span>
              ) : null}
            </div>
          );
        })}

        {/* BINDING (Bartek 2026-07-15, resolves 09-UI-SPEC.md's Review
            Question 4 as an override): guaranteed RP ID/last-used rows
            for passkey-type items, present or muted "—" -- never omitted. */}
        {passkey !== null ? (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-base-content/60">{t(locale, "field.rpId")}</span>
              <span className="text-base">{passkey.rpId || "—"}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-base-content/60">{t(locale, "field.lastUsed")}</span>
              <span className="text-base">{passkey.lastUsedAt || "—"}</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
