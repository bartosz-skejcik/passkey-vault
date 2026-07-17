"use client";

import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Eye, EyeOff, Plus, X } from "lucide-react";
import type { Folder, ItemFields, ItemType } from "@/lib/vault/types";
import {
  createVaultFolder,
  createVaultItem,
  updateVaultItem,
  useAllTags,
  useFolders,
} from "@/lib/vault/store";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { addressLines, composeLegacyAddress } from "@/lib/vault/identityAddress";
import PasskeyPlaceholderSection from "./PasskeyPlaceholderSection";
import GeneratorPopover from "@/components/generator/GeneratorPopover";

function emptyFieldsFor(type: ItemType): ItemFields {
  const common = { folderId: null as string | null, tags: [] as string[] };
  switch (type) {
    case "login":
      return {
        type,
        name: "",
        username: "",
        password: "",
        urls: [""],
        notes: "",
        ...common,
      };
    case "card":
      return {
        type,
        name: "",
        cardholderName: "",
        number: "",
        expiry: "",
        cvv: "",
        // Bartek live-review round 4 (TASK 4) additions — "" (not
        // undefined) so the controlled <input>s below never warn about
        // switching from uncontrolled to controlled.
        pin: "",
        zip: "",
        notes: "",
        ...common,
      };
    case "identity":
      return {
        type,
        name: "",
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        address: "",
        // Bartek live-review round 4 (TASK 6) additions — see the
        // CardFields.pin/zip comment above for the "" default rationale.
        addressLine1: "",
        addressLine2: "",
        city: "",
        state: "",
        zip: "",
        country: "",
        notes: "",
        ...common,
      };
    case "note":
      return {
        type,
        name: "",
        body: "",
        ...common,
      };
    case "totp":
      return {
        type,
        name: "",
        secret: "",
        issuer: "",
        algorithm: "SHA1" as const,
        digits: 6,
        period: 30,
        notes: "",
        ...common,
      };
    case "passkey":
      // Passkey vault items are created only by the provider ceremony
      // (crates/pv-provider's wasmCreateProviderCredential), never via this
      // manual-add form — TypePicker.tsx deliberately never offers
      // "passkey" as a tile, and DetailPanel.tsx/ItemContextMenu.tsx hide
      // every Edit affordance for an existing passkey item, so this branch
      // is unreachable at runtime. It exists purely to satisfy ItemType's
      // exhaustiveness now that "passkey" is one of its members.
      throw new Error("passkey items cannot be created or edited via the manual item form");
  }
}

/**
 * Bartek live-review round 4 (TASK 6): "When EDITING an item that has only
 * the legacy flat address, prefill Address Line 1 with it." Applied once,
 * at initial state seeding, to an identity item's initialFields (never to a
 * brand-new create-mode item, which has no legacy data to begin with). If
 * ANY structured address field is already populated, the legacy string is
 * left alone (it was already composed FROM those fields on a prior save —
 * see cleanFields' identity branch below). This is what makes the
 * prefill+compose-on-save round-trip lossless: after this prefill, saving
 * unconditionally recomposes `address` from the structured fields, which
 * (having been seeded with exactly the old legacy value) reproduces it
 * byte-for-byte if the user never touches the Address section at all.
 */
function withLegacyAddressPrefill(fields: ItemFields): ItemFields {
  if (fields.type !== "identity") return fields;
  if (addressLines(fields).length > 0) return fields;
  if (fields.address.trim() === "") return fields;
  return { ...fields, addressLine1: fields.address };
}

// otpauth://totp/{label}?secret=BASE32&issuer=X&algorithm=SHA1|SHA256|SHA512
// &digits=6|8&period=30 (Google Authenticator Key URI Format). `secret` is
// the only required parameter; everything else falls back to RFC 6238
// defaults when absent — mirrors 06-RESEARCH.md Pattern 4. Inlined here
// (not imported from lib/vault/importers/) since this task has no hard
// dependency on Plan 06-02's importer module.
function parseTotpValue(raw: string): {
  secret: string;
  issuer: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
} | null {
  if (!raw.startsWith("otpauth://")) return null;
  try {
    const url = new URL(raw);
    const secret = url.searchParams.get("secret");
    if (!secret) return null;
    const rawAlgorithm = url.searchParams.get("algorithm");
    const algorithm: "SHA1" | "SHA256" | "SHA512" =
      rawAlgorithm === "SHA256" || rawAlgorithm === "SHA512" ? rawAlgorithm : "SHA1";
    return {
      secret,
      issuer: url.searchParams.get("issuer") ?? "",
      algorithm,
      digits: Number(url.searchParams.get("digits") ?? 6),
      period: Number(url.searchParams.get("period") ?? 30),
    };
  } catch {
    return null;
  }
}

// Base32 (RFC 4648) charset check, tolerant of whitespace and '=' padding
// (mirrors pv-core's totp::generate_code, which strips both before
// decoding) — used to validate the secret field on submit, not on every
// keystroke (an otpauth:// URI is a valid intermediate value while typed).
function isValidBase32Secret(secret: string): boolean {
  const cleaned = secret.replace(/\s+/g, "").replace(/=+$/, "");
  return cleaned.length > 0 && /^[A-Za-z2-7]+$/.test(cleaned);
}

function TextField({
  id,
  label,
  value,
  onChange,
  mono = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <input
        id={id}
        data-testid={id}
        className={`input input-bordered w-full ${mono ? "font-mono" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function TextAreaField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      {/* Plain DM Sans — explicitly NOT ui-monospace; secure notes are prose. */}
      <textarea
        id={id}
        data-testid={id}
        className="textarea textarea-bordered w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// Proton Pass-inspired section grouping (Bartek live-review round 4, TASKS
// 4/6), adapted to our own 1px-border/rounded-box tokens — mirrors the exact
// bordered-card treatment DetailPanel.tsx already uses for its passkey/totp
// call-out sections, so a "section" reads the same whether it's viewing or
// editing.
function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-box border border-base-300 p-4">
      <span className="text-sm font-semibold text-base-content/70">{title}</span>
      {children}
    </div>
  );
}

// Two-up field grouping (e.g. Expiration Date + CVV, PIN + ZIP, City +
// State) — a plain responsive grid, no new visual language.
function FormRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

export default function ItemForm({
  type,
  mode = "create",
  itemId,
  currentRevision,
  initialFields,
  onCreated,
  onError,
}: {
  type: ItemType;
  mode?: "create" | "edit";
  itemId?: string;
  currentRevision?: number;
  initialFields?: ItemFields;
  onCreated: () => void;
  onError?: (err: Error) => void;
}) {
  const { t } = useLocale();
  const folders = useFolders();
  const allTags = useAllTags();
  const [fields, setFields] = useState<ItemFields>(() =>
    withLegacyAddressPrefill(initialFields ?? emptyFieldsFor(type)),
  );
  const [nameError, setNameError] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [totpSecretError, setTotpSecretError] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  // "Immediately selecting the newly-created folder" (UI-SPEC) must not
  // wait on useFolders()'s own subscription re-render — track it locally
  // as a fallback option so the <select> always has a matching <option>.
  const [pendingFolder, setPendingFolder] = useState<Folder | null>(null);

  const folderOptions =
    pendingFolder && !folders.some((f) => f.id === pendingFolder.id)
      ? [...folders, pendingFolder]
      : folders;

  function update(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }) as ItemFields);
  }

  function addTag(raw: string) {
    const tag = raw.trim();
    if (tag === "") return;
    setFields((prev) => (prev.tags.includes(tag) ? prev : { ...prev, tags: [...prev.tags, tag] }));
    setTagInput("");
  }

  function removeTag(tag: string) {
    setFields((prev) => ({ ...prev, tags: prev.tags.filter((existing) => existing !== tag) }));
  }

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
    }
  }

  function updateUrlAt(index: number, value: string) {
    setFields((prev) => {
      if (prev.type !== "login") return prev;
      const urls = [...prev.urls];
      urls[index] = value;
      return { ...prev, urls };
    });
  }

  function addUrlRow() {
    setFields((prev) => (prev.type === "login" ? { ...prev, urls: [...prev.urls, ""] } : prev));
  }

  function removeUrlAt(index: number) {
    setFields((prev) => {
      if (prev.type !== "login") return prev;
      const urls = prev.urls.filter((_, i) => i !== index);
      return { ...prev, urls: urls.length > 0 ? urls : [""] };
    });
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (name === "") return;
    setFolderError(null);
    try {
      const folder = await createVaultFolder(name);
      setPendingFolder(folder);
      setFields((prev) => ({ ...prev, folderId: folder.id }));
      setNewFolderName("");
      setAddingFolder(false);
    } catch {
      setFolderError(t("error.folderCreateFailed"));
    }
  }

  function cleanFields(f: ItemFields): ItemFields {
    if (f.type === "login") {
      return { ...f, urls: f.urls.filter((url) => url.trim() !== "") };
    }
    if (f.type === "identity") {
      // Bartek live-review round 4 (TASK 6): recompose the legacy flat
      // `address` string from the structured fields on every save, so the
      // extension's autofill (which only ever reads that one flat field —
      // see lib/vault/identityAddress.ts's own doc comment) always sees an
      // up-to-date value. Combined with withLegacyAddressPrefill() above,
      // this round-trips losslessly for an item that's never had its
      // Address section touched under the new structured form.
      return { ...f, address: composeLegacyAddress(f) };
    }
    return f;
  }

  // The secret field auto-parses an otpauth:// URI on paste (populating
  // issuer/algorithm/digits/period, Advanced collapse stays closed even
  // when auto-populated per 06-CONTEXT.md) — anything else (a bare base32
  // secret, or an unparseable value that's judged on submit, not here) is
  // stored as-is.
  function updateTotpSecret(value: string) {
    setFields((prev) => {
      if (prev.type !== "totp") return prev;
      const parsed = parseTotpValue(value);
      if (parsed !== null) {
        return {
          ...prev,
          secret: parsed.secret,
          issuer: parsed.issuer,
          algorithm: parsed.algorithm,
          digits: parsed.digits,
          period: parsed.period,
        };
      }
      return { ...prev, secret: value };
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (fields.name.trim() === "") {
      setNameError(true);
      return;
    }
    setNameError(false);
    if (fields.type === "totp" && !isValidBase32Secret(fields.secret)) {
      setTotpSecretError(true);
      return;
    }
    setTotpSecretError(false);
    setSubmitError(null);
    setSubmitting(true);
    const cleaned = cleanFields(fields);
    try {
      if (mode === "edit" && itemId !== undefined && currentRevision !== undefined) {
        await updateVaultItem(itemId, cleaned, currentRevision);
      } else {
        await createVaultItem(cleaned);
      }
      onCreated();
    } catch (err) {
      if (mode === "edit") {
        onError?.(err as Error);
      } else {
        setSubmitError(t("error.itemSaveFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Render helpers (not nested component definitions — see DetailPanel.tsx's
  // own renderCopyButton for why: defining a component function inside
  // another component's body would remount it, and thus reset its
  // would-be-internal state, on every parent render). Extracted so the
  // exact same folder-select/tag-input markup can be placed either at the
  // form's unlabeled bottom (every type except card/identity) or inside a
  // labeled "Inne"/"Other" FormSection (card/identity — Bartek live-review
  // round 4, TASKS 4/6).
  function renderFolderBlock() {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor="item-folder-select" className="text-sm">
          {t("item.folderLabel")}
        </label>
        <div className="flex items-center gap-2">
          <select
            id="item-folder-select"
            data-testid="item-folder-select"
            className="select select-bordered w-full"
            value={fields.folderId ?? ""}
            onChange={(e) =>
              setFields((prev) => ({
                ...prev,
                folderId: e.target.value === "" ? null : e.target.value,
              }))
            }
          >
            <option value="">{t("item.noFolder")}</option>
            {folderOptions.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="new-folder-button"
            aria-label={t("aria.newFolder")}
            className="btn btn-ghost btn-square btn-sm"
            onClick={() => setAddingFolder(true)}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
        {addingFolder ? (
          <div className="mt-2 flex items-center gap-2">
            <input
              data-testid="new-folder-name"
              className="input input-bordered input-sm flex-1"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder={t("aria.newFolder")}
            />
            <button
              type="button"
              data-testid="new-folder-confirm"
              className="btn btn-primary btn-sm"
              onClick={() => void handleCreateFolder()}
            >
              {t("item.folderLabel")}
            </button>
          </div>
        ) : null}
        {folderError ? (
          <p data-testid="folder-create-error" className="text-sm text-error">
            {folderError}
          </p>
        ) : null}
      </div>
    );
  }

  function renderTagsBlock() {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor="item-tags-input" className="text-sm">
          {t("item.tagsLabel")}
        </label>
        {fields.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {fields.tags.map((tag) => (
              <span
                key={tag}
                className="badge badge-sm gap-1 bg-base-200 text-base-content/70"
              >
                {tag}
                <button
                  type="button"
                  aria-label={t("aria.newTag")}
                  onClick={() => removeTag(tag)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <input
          id="item-tags-input"
          data-testid="item-tags-input"
          className="input input-bordered w-full"
          list="vault-tag-suggestions"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={handleTagKeyDown}
        />
        <datalist id="vault-tag-suggestions">
          {allTags.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
      data-testid={`item-form-${type}`}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="item-name" className="text-sm">
          {t("field.name")}
        </label>
        <input
          id="item-name"
          data-testid="item-name"
          className="input input-bordered w-full"
          value={fields.name}
          onChange={(e) => update("name", e.target.value)}
        />
        {nameError ? <p className="text-sm text-error">{t("validation.required")}</p> : null}
      </div>

      {fields.type === "login" ? (
        <>
          <TextField
            id="item-username"
            label={t("field.username")}
            value={fields.username}
            onChange={(v) => update("username", v)}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="item-password" className="text-sm">
              {t("field.password")}
            </label>
            {/* ui-monospace: password rides at Body size per UI-SPEC's
                typography table (rendered via Tailwind's font-mono utility,
                whose stack starts with ui-monospace). */}
            <div className="flex items-center gap-2">
              <input
                id="item-password"
                data-testid="item-password"
                type={showPassword ? "text" : "password"}
                className="input input-bordered w-full font-mono"
                value={fields.password}
                onChange={(e) => update("password", e.target.value)}
              />
              <button
                type="button"
                aria-label={showPassword ? t("aria.hidePassword") : t("aria.showPassword")}
                className="btn btn-ghost btn-square btn-sm"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? (
                  <EyeOff size={16} aria-hidden="true" />
                ) : (
                  <Eye size={16} aria-hidden="true" />
                )}
              </button>
              <GeneratorPopover onApply={(password) => update("password", password)} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm">{t("field.url")}</span>
            <div className="flex flex-col gap-2">
              {fields.urls.map((url, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    data-testid={`item-url-${i}`}
                    className="input input-bordered w-full"
                    value={url}
                    onChange={(e) => updateUrlAt(i, e.target.value)}
                  />
                  {fields.urls.length > 1 ? (
                    <button
                      type="button"
                      data-testid={`item-remove-url-${i}`}
                      aria-label={t("aria.removeUrl")}
                      className="btn btn-ghost btn-square btn-sm"
                      onClick={() => removeUrlAt(i)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <button
              type="button"
              data-testid="item-add-url"
              className="btn btn-ghost btn-sm w-fit gap-1"
              onClick={addUrlRow}
            >
              <Plus size={14} aria-hidden="true" />
              {t("item.addUrl")}
            </button>
          </div>
          <TextAreaField
            id="item-notes"
            label={t("field.notes")}
            value={fields.notes}
            onChange={(v) => update("notes", v)}
          />
          <PasskeyPlaceholderSection />
        </>
      ) : null}

      {/* Bartek live-review round 4 (TASK 4, Proton Pass-inspired card
          layout): Cardholder Name, Card Number, then a ROW of Expiration
          Date + CVV (both masked, both now with a reveal toggle — CVV
          previously had none in this form, VIEW mode already did), then a
          second ROW of PIN + ZIP. Notes moves out of this section entirely
          — it's rendered once, inside the shared "Inne"/"Other" section
          below, alongside Folder and tags. */}
      {fields.type === "card" ? (
        <FormSection title={t("form.cardDetailsSection")}>
          <TextField
            id="item-cardholderName"
            label={t("field.cardholderName")}
            value={fields.cardholderName}
            onChange={(v) => update("cardholderName", v)}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="item-number" className="text-sm">
              {t("field.number")}
            </label>
            {/* ui-monospace card number, masked with a reveal toggle. */}
            <div className="flex items-center gap-2">
              <input
                id="item-number"
                data-testid="item-number"
                type={showCardNumber ? "text" : "password"}
                className="input input-bordered w-full font-mono"
                value={fields.number}
                onChange={(e) => update("number", e.target.value)}
              />
              <button
                type="button"
                aria-label={showCardNumber ? t("aria.hidePassword") : t("aria.showPassword")}
                className="btn btn-ghost btn-square btn-sm"
                onClick={() => setShowCardNumber((v) => !v)}
              >
                {showCardNumber ? (
                  <EyeOff size={16} aria-hidden="true" />
                ) : (
                  <Eye size={16} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          <FormRow>
            <TextField
              id="item-expiry"
              label={t("field.expiry")}
              value={fields.expiry}
              onChange={(v) => update("expiry", v)}
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="item-cvv" className="text-sm">
                {t("field.cvv")}
              </label>
              {/* ui-monospace CVV — round 4 adds the reveal toggle (this
                  form previously had none; DetailPanel's VIEW mode already
                  did). */}
              <div className="flex items-center gap-2">
                <input
                  id="item-cvv"
                  data-testid="item-cvv"
                  type={showCvv ? "text" : "password"}
                  className="input input-bordered w-full font-mono"
                  value={fields.cvv}
                  onChange={(e) => update("cvv", e.target.value)}
                />
                <button
                  type="button"
                  aria-label={showCvv ? t("aria.hidePassword") : t("aria.showPassword")}
                  className="btn btn-ghost btn-square btn-sm"
                  onClick={() => setShowCvv((v) => !v)}
                >
                  {showCvv ? (
                    <EyeOff size={16} aria-hidden="true" />
                  ) : (
                    <Eye size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          </FormRow>
          <FormRow>
            <div className="flex flex-col gap-1">
              <label htmlFor="item-pin" className="text-sm">
                {t("field.pin")}
              </label>
              {/* ui-monospace PIN, masked with a reveal toggle (same
                  treatment as CVV above). */}
              <div className="flex items-center gap-2">
                <input
                  id="item-pin"
                  data-testid="item-pin"
                  type={showPin ? "text" : "password"}
                  className="input input-bordered w-full font-mono"
                  value={fields.pin ?? ""}
                  onChange={(e) => update("pin", e.target.value)}
                />
                <button
                  type="button"
                  aria-label={showPin ? t("aria.hidePassword") : t("aria.showPassword")}
                  className="btn btn-ghost btn-square btn-sm"
                  onClick={() => setShowPin((v) => !v)}
                >
                  {showPin ? (
                    <EyeOff size={16} aria-hidden="true" />
                  ) : (
                    <Eye size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
            <TextField
              id="item-zip"
              label={t("field.zip")}
              value={fields.zip ?? ""}
              onChange={(v) => update("zip", v)}
            />
          </FormRow>
        </FormSection>
      ) : null}

      {/* Bartek live-review round 4 (TASK 6): "Dane kontaktowe"/"Contact
          Details" keeps firstName/lastName as two separate fields — the
          spec's "Full Name" list item is DetailPanel's own combined display
          row (TASK 5), not a schema/form change; splitting the underlying
          IdentityFields.firstName/lastName into a single input was
          explicitly out of this task's SCHEMA scope. Then "Adres"/"Address
          Details": Line 1/Line 2 (each with a muted helper), then City+State
          and ZIP+Country rows. Notes moves out to the shared "Inne" section
          below, same as card's above. */}
      {fields.type === "identity" ? (
        <>
          <FormSection title={t("form.contactDetailsSection")}>
            <TextField
              id="item-firstName"
              label={t("field.firstName")}
              value={fields.firstName}
              onChange={(v) => update("firstName", v)}
            />
            <TextField
              id="item-lastName"
              label={t("field.lastName")}
              value={fields.lastName}
              onChange={(v) => update("lastName", v)}
            />
            <TextField
              id="item-email"
              label={t("field.email")}
              value={fields.email}
              onChange={(v) => update("email", v)}
            />
            <TextField
              id="item-phone"
              label={t("field.phone")}
              value={fields.phone}
              onChange={(v) => update("phone", v)}
            />
          </FormSection>
          <FormSection title={t("form.addressDetailsSection")}>
            <div className="flex flex-col gap-1">
              <TextField
                id="item-addressLine1"
                label={t("field.addressLine1")}
                value={fields.addressLine1 ?? ""}
                onChange={(v) => update("addressLine1", v)}
              />
              <p className="text-xs text-base-content/60">{t("form.addressLine1Helper")}</p>
            </div>
            <div className="flex flex-col gap-1">
              <TextField
                id="item-addressLine2"
                label={t("field.addressLine2")}
                value={fields.addressLine2 ?? ""}
                onChange={(v) => update("addressLine2", v)}
              />
              <p className="text-xs text-base-content/60">{t("form.addressLine2Helper")}</p>
            </div>
            <FormRow>
              <TextField
                id="item-city"
                label={t("field.city")}
                value={fields.city ?? ""}
                onChange={(v) => update("city", v)}
              />
              <TextField
                id="item-state"
                label={t("field.state")}
                value={fields.state ?? ""}
                onChange={(v) => update("state", v)}
              />
            </FormRow>
            <FormRow>
              <TextField
                id="item-zip"
                label={t("field.zip")}
                value={fields.zip ?? ""}
                onChange={(v) => update("zip", v)}
              />
              <TextField
                id="item-country"
                label={t("field.country")}
                value={fields.country ?? ""}
                onChange={(v) => update("country", v)}
              />
            </FormRow>
          </FormSection>
        </>
      ) : null}

      {fields.type === "note" ? (
        <TextAreaField
          id="item-body"
          label={t("field.body")}
          value={fields.body}
          onChange={(v) => update("body", v)}
        />
      ) : null}

      {fields.type === "totp" ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="item-secret" className="text-sm">
              {t("field.secret")}
            </label>
            <input
              id="item-secret"
              data-testid="item-secret"
              className="input input-bordered w-full font-mono"
              placeholder={t("totp.secretHelper")}
              value={fields.secret}
              onChange={(e) => updateTotpSecret(e.target.value)}
            />
            {totpSecretError ? (
              <p data-testid="totp-secret-error" className="text-sm text-error">
                {t("totp.invalidSecretError")}
              </p>
            ) : null}
          </div>
          {/* Advanced RFC 6238 fields — default closed even when otpauth://
              auto-parse populates them (06-CONTEXT.md, locked). */}
          <details className="collapse collapse-arrow border border-base-300 bg-base-100">
            <summary
              data-testid="totp-advanced-toggle"
              className="collapse-title text-sm"
            >
              {t("totp.advancedToggle")}
            </summary>
            <div className="collapse-content flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="item-issuer" className="text-sm">
                  {t("field.issuer")}
                </label>
                <input
                  id="item-issuer"
                  data-testid="item-issuer"
                  className="input input-bordered w-full"
                  value={fields.issuer}
                  onChange={(e) => update("issuer", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="item-algorithm" className="text-sm">
                  {t("field.algorithm")}
                </label>
                <select
                  id="item-algorithm"
                  data-testid="item-algorithm"
                  className="select select-bordered w-full"
                  value={fields.algorithm}
                  onChange={(e) =>
                    setFields((prev) =>
                      prev.type === "totp"
                        ? {
                            ...prev,
                            algorithm: e.target.value as "SHA1" | "SHA256" | "SHA512",
                          }
                        : prev,
                    )
                  }
                >
                  <option value="SHA1">SHA1</option>
                  <option value="SHA256">SHA256</option>
                  <option value="SHA512">SHA512</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="item-digits" className="text-sm">
                  {t("field.digits")}
                </label>
                <input
                  id="item-digits"
                  data-testid="item-digits"
                  type="number"
                  className="input input-bordered w-full"
                  value={fields.digits}
                  onChange={(e) =>
                    setFields((prev) =>
                      prev.type === "totp"
                        ? { ...prev, digits: Number(e.target.value) || 0 }
                        : prev,
                    )
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="item-period" className="text-sm">
                  {t("field.period")}
                </label>
                <input
                  id="item-period"
                  data-testid="item-period"
                  type="number"
                  className="input input-bordered w-full"
                  value={fields.period}
                  onChange={(e) =>
                    setFields((prev) =>
                      prev.type === "totp"
                        ? { ...prev, period: Number(e.target.value) || 0 }
                        : prev,
                    )
                  }
                />
              </div>
            </div>
          </details>
          <TextAreaField
            id="item-notes"
            label={t("field.notes")}
            value={fields.notes}
            onChange={(v) => update("notes", v)}
          />
        </>
      ) : null}

      {/* Shared folder/tag block — applies to every item type (VAULT-03),
          not just logins. Bartek live-review round 4 (TASKS 4/6): for
          card/identity specifically, this whole block (PLUS the Notes
          field, relocated out of those types' own sections above) now
          lives inside a labeled "Inne"/"Other" FormSection instead of
          floating unlabeled at the bottom — every other type keeps the
          exact same unlabeled placement as before. */}
      {fields.type === "card" || fields.type === "identity" ? (
        <FormSection title={t("form.otherSection")}>
          {renderFolderBlock()}
          <TextAreaField
            id="item-notes"
            label={t("field.notes")}
            value={fields.notes}
            onChange={(v) => update("notes", v)}
          />
          {renderTagsBlock()}
        </FormSection>
      ) : (
        <>
          {renderFolderBlock()}
          {renderTagsBlock()}
        </>
      )}

      {submitError ? (
        <p data-testid="item-form-submit-error" className="text-sm text-error">
          {submitError}
        </p>
      ) : null}

      <button
        type="submit"
        data-testid="item-form-submit"
        className="btn btn-primary"
        disabled={submitting}
      >
        {t("item.save")}
      </button>
    </form>
  );
}
