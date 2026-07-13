"use client";

// Standalone Tools-menu password generator (GAP-02-02) — a centered modal
// following DeleteConfirmDialog.tsx's fixed/centered/backdrop structural
// pattern, deliberately NOT a viewport-anchored dropdown (a centered modal
// has no viewport-edge anchoring to get wrong, which is why this component
// does not import or modify the existing item-form generator trigger).
// Calls the pure generator/strength functions directly — no new generation
// logic lives here, only presentational JSX around them.
import { useState } from "react";
import { X } from "lucide-react";
import {
  generateCharacterPassword,
  generatePassphrase,
  type CharacterPasswordOptions,
} from "@/lib/generator/password";
import { scorePasswordMeter, type MeterColor } from "@/lib/generator/strength";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { copyWithAutoClear, readClipboardSeconds } from "@/lib/clipboard";
import { showCopyToast } from "@/lib/vault/copyToast";

type Mode = "character" | "passphrase";

// Static class-name map — Tailwind only generates classes it sees as full
// string literals in source, not from a `bg-${...}` template (same
// convention used elsewhere for strength-meter rendering).
const METER_BG: Record<MeterColor, string> = {
  error: "bg-error",
  warning: "bg-warning",
  success: "bg-success",
};

const CHAR_DEFAULT_LENGTH = 20;
const CHAR_MIN_LENGTH = 8;
const CHAR_MAX_LENGTH = 64;
const PASSPHRASE_DEFAULT_WORDS = 6;
const PASSPHRASE_MIN_WORDS = 3;
const PASSPHRASE_MAX_WORDS = 10;

// A "no class selected" state must never throw mid-render — the checkbox
// row falls back to this safe default (lowercase-only) so the preview
// always has something to show.
const SAFE_DEFAULT_CHARSET: CharacterPasswordOptions = {
  lowercase: true,
  uppercase: false,
  digits: false,
  symbols: false,
};

function generate(mode: Mode, length: number, charset: CharacterPasswordOptions): string {
  if (mode === "passphrase") {
    return generatePassphrase(length, "-");
  }
  const hasAnyClass = charset.lowercase || charset.uppercase || charset.digits || charset.symbols;
  return generateCharacterPassword(length, hasAnyClass ? charset : SAFE_DEFAULT_CHARSET);
}

export default function GeneratorDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const [mode, setMode] = useState<Mode>("character");
  const [charLength, setCharLength] = useState(CHAR_DEFAULT_LENGTH);
  const [wordCount, setWordCount] = useState(PASSPHRASE_DEFAULT_WORDS);
  const [charset, setCharset] = useState<CharacterPasswordOptions>({
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: false,
  });
  const [preview, setPreview] = useState(() =>
    generate("character", CHAR_DEFAULT_LENGTH, {
      lowercase: true,
      uppercase: true,
      digits: true,
      symbols: false,
    }),
  );

  function regenerate(
    nextMode: Mode = mode,
    nextCharLength: number = charLength,
    nextWordCount: number = wordCount,
    nextCharset: CharacterPasswordOptions = charset,
  ) {
    setPreview(
      generate(nextMode, nextMode === "passphrase" ? nextWordCount : nextCharLength, nextCharset),
    );
  }

  function handleModeChange(nextMode: Mode) {
    setMode(nextMode);
    regenerate(nextMode);
  }

  function handleCharLengthChange(value: number) {
    setCharLength(value);
    regenerate(mode, value);
  }

  function handleWordCountChange(value: number) {
    setWordCount(value);
    regenerate(mode, charLength, value);
  }

  function toggleCharsetClass(key: keyof CharacterPasswordOptions) {
    setCharset((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      regenerate(mode, charLength, wordCount, next);
      return next;
    });
  }

  function handleCopy() {
    const seconds = readClipboardSeconds();
    copyWithAutoClear(preview, seconds * 1000);
    showCopyToast(t("field.password"), seconds * 1000);
    onClose();
  }

  const meter = scorePasswordMeter(preview);

  return (
    <div
      data-testid="generator-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[400px] flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[20px] font-bold leading-[1.2]">{t("sidebar.generator")}</h2>
          <button
            type="button"
            data-testid="generator-dialog-close"
            aria-label={t("aria.closePanel")}
            className="btn btn-ghost btn-square btn-sm"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="join w-full">
          <button
            type="button"
            data-testid="generator-dialog-mode-character"
            className={`btn join-item btn-sm flex-1 ${mode === "character" ? "btn-active" : ""}`}
            onClick={() => handleModeChange("character")}
          >
            {t("generator.modeCharacter")}
          </button>
          <button
            type="button"
            data-testid="generator-dialog-mode-passphrase"
            className={`btn join-item btn-sm flex-1 ${mode === "passphrase" ? "btn-active" : ""}`}
            onClick={() => handleModeChange("passphrase")}
          >
            {t("generator.modePassphrase")}
          </button>
        </div>

        <input
          data-testid="generator-dialog-preview"
          readOnly
          className="input input-bordered w-full font-mono"
          value={preview}
        />

        <div className="h-1 w-full overflow-hidden rounded-full bg-base-300">
          <div
            className={`h-full transition-all duration-300 ${METER_BG[meter.color]}`}
            style={{ width: `${meter.percent}%` }}
          />
        </div>

        {mode === "character" ? (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor="generator-dialog-length" className="text-sm">
                {charLength}
              </label>
              <input
                id="generator-dialog-length"
                data-testid="generator-dialog-length"
                type="range"
                min={CHAR_MIN_LENGTH}
                max={CHAR_MAX_LENGTH}
                value={charLength}
                className="range range-sm"
                onChange={(e) => handleCharLengthChange(Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-testid="generator-dialog-lowercase"
                  className="checkbox checkbox-sm"
                  checked={charset.lowercase}
                  onChange={() => toggleCharsetClass("lowercase")}
                />
                a-z
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-testid="generator-dialog-uppercase"
                  className="checkbox checkbox-sm"
                  checked={charset.uppercase}
                  onChange={() => toggleCharsetClass("uppercase")}
                />
                A-Z
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-testid="generator-dialog-digits"
                  className="checkbox checkbox-sm"
                  checked={charset.digits}
                  onChange={() => toggleCharsetClass("digits")}
                />
                0-9
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-testid="generator-dialog-symbols"
                  className="checkbox checkbox-sm"
                  checked={charset.symbols}
                  onChange={() => toggleCharsetClass("symbols")}
                />
                !@#$
              </label>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor="generator-dialog-word-count" className="text-sm">
              {wordCount}
            </label>
            <input
              id="generator-dialog-word-count"
              data-testid="generator-dialog-word-count"
              type="range"
              min={PASSPHRASE_MIN_WORDS}
              max={PASSPHRASE_MAX_WORDS}
              value={wordCount}
              className="range range-sm"
              onChange={(e) => handleWordCountChange(Number(e.target.value))}
            />
          </div>
        )}

        <button
          type="button"
          data-testid="generator-dialog-copy"
          className="btn btn-primary w-full"
          onClick={handleCopy}
        >
          {t("action.copyPassword")}
        </button>
      </div>
    </div>
  );
}
