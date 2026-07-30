"use client";

import { Fragment, useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, KeyRound, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import type { ItemFields, VaultItem } from "@/lib/vault/types";
import { RevisionConflictError, touchVaultItem, useFolders } from "@/lib/vault/store";
import { getStoredEmail } from "@/lib/auth/session";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate, type DICTIONARY } from "@/lib/i18n/dictionary";
import { copyWithAutoClear, readClipboardSeconds } from "@/lib/clipboard";
import { showCopyToast } from "@/lib/vault/copyToast";
import { addressLines } from "@/lib/vault/identityAddress";
import PasskeyPlaceholderSection from "./PasskeyPlaceholderSection";
import TotpCountdownRing from "./TotpCountdownRing";
import ItemForm from "./ItemForm";
import DeleteConfirmDialog from "./DeleteConfirmDialog";
import ItemIconTile from "./ItemIconTile";

// Fields shaped as generic string values, rendered through a Label+value
// loop — `folderId` and `tags` are special-cased below instead (they need
// a lookup/chip rendering, not a raw value dump); a login item's `urls`
// (string[], not a plain string) is also special-cased, rendered right
// after `password` to match 02-UI-SPEC.md's per-type field order
// (username, password, URL, notes). `totp`'s entry is deliberately just
// `["secret"]` — `algorithm`/`digits`/`period` never render in view mode
// (06-RESEARCH.md Pattern 2); the live countdown ring is a bespoke block
// rendered separately, below.
// Passkey AND identity items get a fully composed layout (see their own
// `type === "passkey"`/`type === "identity"` branches in the render below),
// not this generic loop — their FIELD_ORDER entries are intentionally
// empty; kept only so this Record stays exhaustive over ItemFields["type"].
const FIELD_ORDER: Record<ItemFields["type"], string[]> = {
  login: ["username", "password", "notes"],
  // Bartek live-review (Proton Pass-inspired reorder): Card Number first,
  // then Expiration Date, then CVV, then cardholder name — was previously
  // cardholderName-first. Round 4 (TASK 4) inserts the new optional
  // pin/zip fields right after CVV, matching the CREATE/EDIT form's own
  // field grouping; both are skipped entirely (not shown as "—") when
  // empty — see OPTIONAL_IF_EMPTY_FIELDS below.
  card: ["number", "expiry", "cvv", "pin", "zip", "cardholderName", "notes"],
  identity: [],
  note: ["body"],
  totp: ["secret"],
  passkey: [],
};

// Fields whose row is entirely OMITTED (not rendered with a "—" placeholder)
// when empty — currently just the two new optional card fields (Bartek
// live-review round 4, TASK 4: "omit rows when empty"). Every other
// FIELD_ORDER entry keeps the pre-existing always-show-the-row behavior.
const OPTIONAL_IF_EMPTY_FIELDS = new Set(["pin", "zip"]);

const MONO_FIELDS = new Set(["password", "number", "cvv", "pin", "secret"]);

// Fields that get a per-field reveal toggle next to the copy button.
// `cvv`/`pin` previously had no entry here, matching ItemForm.tsx's own
// no-reveal-for-CVV convention for the ADD/EDIT form (where the user just
// typed the value and doesn't need it echoed back). DetailPanel's VIEW mode
// is a different context — reading the CVV/PIN back out to type into a
// checkout form is the whole point — so Bartek's live-review spec adds
// reveal+copy for both here (matches Proton Pass/other vaults' own card
// detail views).
const REVEALABLE_FIELDS = new Set(["password", "number", "secret", "cvv", "pin"]);

// A fixed-length mask so the visible placeholder never leaks the real
// value's character count.
const MASK = "•".repeat(10);

/** Formats `item.updatedAt` (SQLite's `datetime('now')` shape, no `T`/
 * timezone designator, always UTC) as a locale-aware absolute date for the
 * passkey detail section — mirrors `formatRelativeTime`'s own ISO
 * normalization (`lib/format/relativeTime.ts`) since that helper only
 * returns relative/near-term strings, not a plain date. Deliberately
 * NOT reused directly: this always wants an absolute date, never "2h ago". */
function formatAbsoluteDate(updatedAt: string, locale: string): string | null {
  const iso = updatedAt.includes("T") ? updatedAt : `${updatedAt.replace(" ", "T")}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : "en-US", {
    dateStyle: "medium",
  }).format(date);
}

export default function DetailPanel({
  item,
  initialMode = "view",
  onClose,
}: {
  item: VaultItem;
  initialMode?: "view" | "edit";
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const folders = useFolders();
  const [mode, setMode] = useState<"view" | "edit">(initialMode);
  const [conflict, setConflict] = useState(false);
  // Reactive (409) conflict-attribution (Plan 23-05, SYNC-06) — set
  // alongside setConflict(true) from the caught RevisionConflictError's own
  // lastEditorEmail; `undefined` for a personal item's conflict (byte-for-
  // byte unchanged generic copy), a real email for a shared item's.
  const [conflictEditorEmail, setConflictEditorEmail] = useState<string | undefined>(undefined);
  // Proactive live-edit-conflict banner (SYNC-03) — a SECOND, independently
  // controlled trigger path alongside the reactive save-time `conflict`
  // state above; never merged into one boolean. Captured only at edit-entry
  // (startEditing() and the initialMode effect below), never re-derived on
  // every live `item` prop update.
  const [editBaselineRevision, setEditBaselineRevision] = useState<number | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  // Safe: every key in FIELD_ORDER[item.fields.type] is a string field of
  // that exact variant — this loop never reads folderId/tags/type/name/urls
  // (those are special-cased separately).
  const fieldValues = item.fields as unknown as Record<string, string>;
  const folder = folders.find((f) => f.id === item.fields.folderId);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  // The panel is not remounted between item selections (page.tsx renders
  // <DetailPanel item={selectedItem} /> with no `key`), so a previously
  // revealed field must be explicitly re-masked whenever the item changes.
  useEffect(() => {
    setRevealedKeys(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // `initialMode` only seeds `useState` on first mount — since the panel is
  // never remounted between selections (see above), a context-menu "Edit"
  // request on an item that's already selected (same item.id, so the first
  // effect above wouldn't fire) still needs to force the panel into edit
  // mode. Re-applying `initialMode` whenever either it or the item changes
  // covers both cases: switching to a different item resets to its
  // requested mode, and re-requesting edit on the same item re-enters it.
  useEffect(() => {
    setMode(initialMode);
    setConflict(false);
    setConflictEditorEmail(undefined);
    if (initialMode === "edit") {
      setEditBaselineRevision(item.revision);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, initialMode]);

  function isRevealed(key: string): boolean {
    return revealedKeys.has(key);
  }

  function toggleReveal(key: string) {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        // Revealing a masked secret (password/card number/CVV/TOTP secret)
        // is a "use" of the item, same as copying it — never fired when
        // re-hiding, and never on mere viewing (T&C: single choke-point
        // through touchVaultItem, fire-and-forget).
        touchVaultItem(item.id);
      }
      return next;
    });
  }

  function displayValueFor(key: string, value: string): string {
    if (!value) return "—";
    if (MONO_FIELDS.has(key) && !REVEALABLE_FIELDS.has(key)) return MASK;
    if (REVEALABLE_FIELDS.has(key) && !isRevealed(key)) return MASK;
    return value;
  }

  function startEditing() {
    setConflict(false);
    setConflictEditorEmail(undefined);
    setEditBaselineRevision(item.revision);
    setMode("edit");
  }

  const liveConflict =
    mode === "edit" && editBaselineRevision !== null && item.revision !== editBaselineRevision;

  function fieldLabelFor(fieldKey: string): string {
    return fieldKey === "url" ? t("field.url") : t(`field.${fieldKey}` as keyof typeof DICTIONARY);
  }

  function handleCopy(testidSuffix: string, fieldKey: string, value: string) {
    if (!value) return;
    const seconds = readClipboardSeconds();
    copyWithAutoClear(value, seconds * 1000);
    showCopyToast(fieldLabelFor(fieldKey), seconds * 1000);
    // Single choke-point for every copy affordance in this panel (login
    // password, TOTP code, card number/CVV, identity fields, passkey
    // fields, ...) — see touchVaultItem's own doc comment for the
    // fire-and-forget/never-blocks contract.
    touchVaultItem(item.id);
    setCopiedKey(testidSuffix);
    setTimeout(
      () => setCopiedKey((current) => (current === testidSuffix ? null : current)),
      1500,
    );
  }

  // A render helper (not a nested component definition — defining a
  // component function inside another component's body would remount it,
  // and thus reset its would-be-internal state, on every parent render).
  function renderCopyButton(
    fieldKey: string,
    value: string,
    testidSuffix = fieldKey,
    ariaLabelOverride?: string,
  ) {
    return (
      <button
        type="button"
        data-testid={`copy-${testidSuffix}`}
        aria-label={ariaLabelOverride ?? interpolate(t("aria.copyField"), { field: fieldLabelFor(fieldKey) })}
        className="btn btn-ghost btn-square btn-sm shrink-0"
        onClick={() => handleCopy(testidSuffix, fieldKey, value)}
      >
        {copiedKey === testidSuffix ? (
          <Check size={16} className="text-success" aria-hidden="true" />
        ) : (
          <Copy size={16} aria-hidden="true" />
        )}
      </button>
    );
  }

  return (
    <aside
      data-testid="detail-panel"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col gap-4 overflow-y-auto border-l border-base-300 bg-base-100 p-6 shadow-xl md:w-[400px]"
    >
      <div className="flex items-start justify-between gap-2">
        {mode === "view" ? (
          <h2 className="flex items-center gap-2 text-[20px] font-bold leading-[1.2]">
            {/* Bartek live-review round 3: favicon/card-brand tile also
                surfaces here "for consistency" with the list row — scoped to
                the same three types ItemRow's own tile treats specially. */}
            {item.fields.type === "login" ||
            item.fields.type === "passkey" ||
            item.fields.type === "card" ? (
              <ItemIconTile item={item} variant="header" />
            ) : null}
            {item.fields.name}
          </h2>
        ) : (
          <h2 className="text-[20px] font-bold leading-[1.2]">{t("item.edit")}</h2>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {mode === "view" ? (
            <>
              {/* Phase 12 cross-client fix: no Edit affordance for passkey
                  items — ItemForm has no passkey branch, and re-encrypting
                  through it would risk corrupting `rawPasskeyJson` (the
                  provider ceremony's only source of truth for
                  key_cbor/counter/hmac_secret). Deletion stays available
                  below (a passkey item can always be removed, just never
                  hand-edited). CR-03 (code review iteration 1): same
                  suppression for `item.undecryptable` — its `revision` is
                  known stale, and `updateVaultItem` itself refuses the save
                  (`UndecryptableItemError`); hiding the affordance here is
                  defense in depth, not the only guard. */}
              {item.fields.type !== "passkey" && item.undecryptable !== true ? (
                <button
                  type="button"
                  data-testid="detail-panel-edit"
                  aria-label={t("item.edit")}
                  className="btn btn-ghost btn-square btn-sm"
                  onClick={startEditing}
                >
                  <Pencil size={16} aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                data-testid="detail-panel-delete"
                aria-label={interpolate(t("aria.deleteItem"), { name: item.fields.name })}
                className="btn btn-ghost btn-square btn-sm"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            data-testid="detail-panel-close"
            aria-label={t("aria.closePanel")}
            className="btn btn-ghost btn-square btn-sm"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* CR-03 (code review iteration 1): this item's last background sync
          merge failed to decrypt its server row and is showing a retained
          last-known-good copy at a now-stale revision — the AEAD
          integrity-failure signal a zero-knowledge vault has to surface,
          rather than silently rendering stale plaintext as current. Shown
          in BOTH view and edit mode (edit mode is unreachable through the
          UI for a flagged item via the hidden Edit button above, but this
          banner is the same defense-in-depth as that guard, not a
          replacement for it). */}
      {item.undecryptable === true ? (
        <div data-testid="undecryptable-item-banner" className="alert alert-warning text-sm">
          {t("sync.itemUndecryptableWarning")}
        </div>
      ) : null}

      {/* Defense-in-depth alongside the hidden Edit button above and
          ItemContextMenu.tsx's own guard: even if `initialMode="edit"` were
          ever passed for a passkey item, fall through to the view-mode
          branch below instead of mounting ItemForm (which has no passkey
          branch). */}
      {mode === "edit" && item.fields.type !== "passkey" ? (
        <>
          {conflict ? (
            <div
              data-testid="revision-conflict-banner"
              className="alert alert-error text-sm"
            >
              {conflictEditorEmail
                ? interpolate(t("error.revisionConflictAttributed"), {
                    email: conflictEditorEmail,
                  })
                : t("error.revisionConflict")}
            </div>
          ) : null}
          {liveConflict ? (
            <div data-testid="live-edit-conflict-banner" className="alert alert-error text-sm">
              <div className="flex w-full flex-col gap-2">
                {/* WR-05 (code review iteration 1): suppress the attributed
                    variant when `lastEditorEmail` is the VIEWER's own
                    account — otherwise a user who edited this item from
                    another device/tab sees a banner naming themselves,
                    which reads as nonsensical regardless of the copy's
                    wording. */}
                <span>
                  {item.isShared && item.lastEditorEmail && item.lastEditorEmail !== getStoredEmail()
                    ? interpolate(t("sync.itemChangedElsewhereAttributed"), {
                        email: item.lastEditorEmail,
                      })
                    : t("sync.itemChangedElsewhere")}
                </span>
                <span className="text-xs opacity-70">
                  {t("sync.itemChangedElsewhereConsequence")}
                </span>
                <button
                  type="button"
                  data-testid="live-edit-conflict-refresh"
                  className="btn btn-error btn-outline btn-sm self-start"
                  onClick={() => setEditBaselineRevision(item.revision)}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  {t("sync.refreshAction")}
                </button>
              </div>
            </div>
          ) : null}
          <ItemForm
            key={`${item.id}-${editBaselineRevision}`}
            type={item.fields.type}
            mode="edit"
            itemId={item.id}
            currentRevision={editBaselineRevision ?? item.revision}
            initialFields={item.fields}
            onCreated={() => {
              setConflict(false);
              setConflictEditorEmail(undefined);
              setMode("view");
            }}
            onError={(err) => {
              if (err instanceof RevisionConflictError) {
                setConflict(true);
                setConflictEditorEmail(err.lastEditorEmail);
              }
            }}
          />
        </>
      ) : (
        <>
          {item.fields.type === "totp" ? (
            <div className="flex flex-col items-center gap-2 pt-1">
              <span className="text-sm text-base-content/60">
                {item.fields.issuer || t("itemType.totp")}
              </span>
              <TotpCountdownRing
                secretB32={item.fields.secret}
                algorithm={item.fields.algorithm}
                digits={item.fields.digits}
                period={item.fields.period}
                size={64}
              />
              {renderCopyButton(
                "secret",
                item.fields.secret,
                "totp-code",
                t("aria.copyTotpCode"),
              )}
            </div>
          ) : null}
          {/* Passkey composed layout (Bartek live-review, Proton
              Pass-inspired, adapted to our own tokens/DaisyUI classes —
              never copied verbatim): a "Passkey" section (glyph + honest
              "last updated" date, since the server only ever returns
              `updated_at` — crates/pv-server/src/routes/vault.rs never
              selects `created_at` — never fake a "created" date) plus a
              muted plain-language explainer, ahead of the actual fields
              below. */}
          {item.fields.type === "passkey" ? (
            <div className="flex flex-col gap-3 pt-1">
              <span className="text-sm font-semibold text-base-content/70">
                {t("detail.passkeySectionTitle")}
              </span>
              <div className="flex items-center gap-2 text-sm text-base-content/70">
                <KeyRound size={16} className="shrink-0 text-accent" aria-hidden="true" />
                <span data-testid="passkey-last-updated">
                  {t("detail.passkeyLastUpdated")}:{" "}
                  {item.updatedAt ? (formatAbsoluteDate(item.updatedAt, locale) ?? "—") : "—"}
                </span>
              </div>
              <p className="text-sm text-base-content/70">{t("detail.passkeyExplainer")}</p>
            </div>
          ) : null}
          <div className="flex flex-col gap-3">
            {FIELD_ORDER[item.fields.type].map((key) => {
              if (OPTIONAL_IF_EMPTY_FIELDS.has(key) && !fieldValues[key]) {
                return null;
              }
              return (
              <Fragment key={key}>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-base-content/60">
                    {t(`field.${key}` as keyof typeof DICTIONARY)}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className={`text-base ${MONO_FIELDS.has(key) ? "font-mono" : ""}`}>
                      {displayValueFor(key, fieldValues[key])}
                    </span>
                    {fieldValues[key] && REVEALABLE_FIELDS.has(key) ? (
                      <button
                        type="button"
                        data-testid={`reveal-${key}`}
                        aria-label={isRevealed(key) ? t("aria.hidePassword") : t("aria.showPassword")}
                        className="btn btn-ghost btn-square btn-sm shrink-0"
                        onClick={() => toggleReveal(key)}
                      >
                        {isRevealed(key) ? (
                          <EyeOff size={16} aria-hidden="true" />
                        ) : (
                          <Eye size={16} aria-hidden="true" />
                        )}
                      </button>
                    ) : null}
                    {fieldValues[key] ? renderCopyButton(key, fieldValues[key]) : null}
                  </div>
                </div>
                {item.fields.type === "login" && key === "password" ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-base-content/60">{t("field.url")}</span>
                    {item.fields.urls.length > 0 ? (
                      item.fields.urls.map((url, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <span className="text-base">{url}</span>
                          {renderCopyButton("url", url, `url-${i}`)}
                        </div>
                      ))
                    ) : (
                      <span className="text-base">—</span>
                    )}
                  </div>
                ) : null}
              </Fragment>
              );
            })}

            {/* FIELD_ORDER.passkey is deliberately empty (see its comment
                above) — these three rows replace the generic loop for this
                type, using the non-technical labels from Bartek's
                live-review spec rather than the generic field.username/
                field.rpId labels the login-item loop above uses. */}
            {item.fields.type === "passkey" ? (
              <>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-base-content/60">
                    {t("field.passkeyUsername")}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-base">{item.fields.username || "—"}</span>
                    {item.fields.username ? (
                      renderCopyButton(
                        "username",
                        item.fields.username,
                        "username",
                        interpolate(t("aria.copyField"), { field: t("field.passkeyUsername") }),
                      )
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-sm text-base-content/60">
                    {t("field.passkeyWebsite")}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-base">{item.fields.rpId}</span>
                    {renderCopyButton(
                      "rpId",
                      item.fields.rpId,
                      "rpId",
                      interpolate(t("aria.copyField"), { field: t("field.passkeyWebsite") }),
                    )}
                  </div>
                </div>

                {item.fields.userDisplayName ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-base-content/60">
                      {t("field.userDisplayName")}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-base">{item.fields.userDisplayName}</span>
                      {renderCopyButton("userDisplayName", item.fields.userDisplayName)}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {/* Identity composed layout (Bartek live-review round 4, TASK
                5): FIELD_ORDER.identity is deliberately empty (see its
                comment above) — these rows replace the generic loop:
                a single combined "Full Name" row (not separate
                firstName/lastName rows), Email, Phone, then a stacked-line
                Address block that prefers the new structured fields but
                falls back to the legacy flat `address` string for items
                that predate this round (identityAddress.ts's
                addressLines()), then Notes. */}
            {item.fields.type === "identity" ? (
              <>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-base-content/60">{t("field.fullName")}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-base">
                      {[item.fields.firstName, item.fields.lastName]
                        .map((v) => v.trim())
                        .filter((v) => v !== "")
                        .join(" ") || "—"}
                    </span>
                    {item.fields.firstName || item.fields.lastName
                      ? renderCopyButton(
                          "fullName",
                          `${item.fields.firstName} ${item.fields.lastName}`.trim(),
                        )
                      : null}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-sm text-base-content/60">{t("field.email")}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-base">{item.fields.email || "—"}</span>
                    {item.fields.email ? renderCopyButton("email", item.fields.email) : null}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-sm text-base-content/60">{t("field.phone")}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-base">{item.fields.phone || "—"}</span>
                    {item.fields.phone ? renderCopyButton("phone", item.fields.phone) : null}
                  </div>
                </div>

                {(() => {
                  const structured = addressLines(item.fields);
                  const legacyLines = item.fields.address
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line !== "");
                  const lines = structured.length > 0 ? structured : legacyLines;
                  const copyValue = structured.length > 0 ? structured.join(", ") : item.fields.address;
                  return (
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-base-content/60">{t("field.address")}</span>
                      <div className="flex items-start gap-1">
                        <div className="flex flex-1 flex-col">
                          {lines.length > 0 ? (
                            lines.map((line, i) => (
                              <span key={i} className="text-base">
                                {line}
                              </span>
                            ))
                          ) : (
                            <span className="text-base">—</span>
                          )}
                        </div>
                        {lines.length > 0 ? renderCopyButton("address", copyValue) : null}
                      </div>
                    </div>
                  );
                })()}

                <div className="flex flex-col gap-1">
                  <span className="text-sm text-base-content/60">{t("field.notes")}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-base">{item.fields.notes || "—"}</span>
                    {item.fields.notes ? renderCopyButton("notes", item.fields.notes) : null}
                  </div>
                </div>
              </>
            ) : null}

            <div className="flex flex-col gap-1">
              <span className="text-sm text-base-content/60">{t("item.folderLabel")}</span>
              <span className="text-base">{folder ? folder.name : t("item.noFolder")}</span>
            </div>

            {item.fields.tags.length > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-sm text-base-content/60">{t("item.tagsLabel")}</span>
                <div className="flex flex-wrap gap-1">
                  {item.fields.tags.map((tag) => (
                    <span key={tag} className="badge badge-sm bg-base-200 text-base-content/70">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {item.fields.type === "login" ? <PasskeyPlaceholderSection /> : null}
        </>
      )}

      {showDeleteDialog ? (
        <DeleteConfirmDialog
          item={item}
          onClose={() => setShowDeleteDialog(false)}
          onDeleted={() => {
            setShowDeleteDialog(false);
            onClose();
          }}
        />
      ) : null}
    </aside>
  );
}
