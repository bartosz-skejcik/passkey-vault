"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
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
  }
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
  const [fields, setFields] = useState<ItemFields>(() => initialFields ?? emptyFieldsFor(type));
  const [nameError, setNameError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showCardNumber, setShowCardNumber] = useState(false);
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
    const folder = await createVaultFolder(name);
    setPendingFolder(folder);
    setFields((prev) => ({ ...prev, folderId: folder.id }));
    setNewFolderName("");
    setAddingFolder(false);
  }

  function cleanFields(f: ItemFields): ItemFields {
    if (f.type !== "login") return f;
    return { ...f, urls: f.urls.filter((url) => url.trim() !== "") };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (fields.name.trim() === "") {
      setNameError(true);
      return;
    }
    setNameError(false);
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
        throw err;
      }
    } finally {
      setSubmitting(false);
    }
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

      {fields.type === "card" ? (
        <>
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
            {/* ui-monospace CVV — masked only, no reveal toggle (UI-SPEC). */}
            <input
              id="item-cvv"
              data-testid="item-cvv"
              type="password"
              className="input input-bordered w-full font-mono"
              value={fields.cvv}
              onChange={(e) => update("cvv", e.target.value)}
            />
          </div>
          <TextAreaField
            id="item-notes"
            label={t("field.notes")}
            value={fields.notes}
            onChange={(v) => update("notes", v)}
          />
        </>
      ) : null}

      {fields.type === "identity" ? (
        <>
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
          <TextField
            id="item-address"
            label={t("field.address")}
            value={fields.address}
            onChange={(v) => update("address", v)}
          />
          <TextAreaField
            id="item-notes"
            label={t("field.notes")}
            value={fields.notes}
            onChange={(v) => update("notes", v)}
          />
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

      {/* Shared folder/tag block — applies to every item type (VAULT-03),
          not just logins. */}
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
      </div>

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
