"use client";

// DaisyUI `dropdown` popover, 320px wide, anchored below its trigger
// (02-UI-SPEC.md's Password generator section). Reuses strength.ts's
// scorePasswordMeter (built ahead of this plan for RegisterForm) rather
// than recreating a strength scorer.
import { useState } from "react";
import { RefreshCw, Wand2 } from "lucide-react";
import {
  generateCharacterPassword,
  generatePassphrase,
  type CharacterPasswordOptions,
} from "@/lib/generator/password";
import { scorePasswordMeter, type MeterColor } from "@/lib/generator/strength";
import { useLocale } from "@/lib/i18n/LocaleContext";

type Mode = "character" | "passphrase";

// Static class-name map — Tailwind only generates classes it sees as full
// string literals in source, not from a `bg-${...}` template (same
// convention as RegisterForm's own strength meter).
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
// always has something to show, matching this task's tolerance test.
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

export default function GeneratorPopover({
  onApply,
}: {
  onApply: (password: string) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
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

  function toggleOpen() {
    setOpen((v) => {
      const next = !v;
      if (next) {
        regenerate();
      }
      return next;
    });
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

  const meter = scorePasswordMeter(preview);

  return (
    <div className="dropdown dropdown-end">
      <button
        type="button"
        data-testid="generator-trigger"
        aria-label={t("aria.generatePassword")}
        className="btn btn-ghost btn-square btn-sm"
        onClick={toggleOpen}
      >
        <Wand2 size={16} aria-hidden="true" />
      </button>

      {open ? (
        <div
          data-testid="generator-popover"
          className="dropdown-content menu z-10 mt-2 w-[min(320px,calc(100vw-2rem))] flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4 shadow"
        >
          <div className="join w-full">
            <button
              type="button"
              data-testid="generator-mode-character"
              className={`btn join-item btn-sm flex-1 ${mode === "character" ? "btn-active" : ""}`}
              onClick={() => handleModeChange("character")}
            >
              {t("generator.modeCharacter")}
            </button>
            <button
              type="button"
              data-testid="generator-mode-passphrase"
              className={`btn join-item btn-sm flex-1 ${mode === "passphrase" ? "btn-active" : ""}`}
              onClick={() => handleModeChange("passphrase")}
            >
              {t("generator.modePassphrase")}
            </button>
          </div>

          <input
            data-testid="generator-preview"
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
                <label htmlFor="generator-length" className="text-sm">
                  {charLength}
                </label>
                <input
                  id="generator-length"
                  data-testid="generator-length"
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
                    data-testid="generator-lowercase"
                    className="checkbox checkbox-sm"
                    checked={charset.lowercase}
                    onChange={() => toggleCharsetClass("lowercase")}
                  />
                  a-z
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    data-testid="generator-uppercase"
                    className="checkbox checkbox-sm"
                    checked={charset.uppercase}
                    onChange={() => toggleCharsetClass("uppercase")}
                  />
                  A-Z
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    data-testid="generator-digits"
                    className="checkbox checkbox-sm"
                    checked={charset.digits}
                    onChange={() => toggleCharsetClass("digits")}
                  />
                  0-9
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    data-testid="generator-symbols"
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
              <label htmlFor="generator-word-count" className="text-sm">
                {wordCount}
              </label>
              <input
                id="generator-word-count"
                data-testid="generator-word-count"
                type="range"
                min={PASSPHRASE_MIN_WORDS}
                max={PASSPHRASE_MAX_WORDS}
                value={wordCount}
                className="range range-sm"
                onChange={(e) => handleWordCountChange(Number(e.target.value))}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              data-testid="generator-regenerate"
              aria-label={t("generator.regenerate")}
              className="btn btn-ghost btn-square btn-sm"
              onClick={() => regenerate()}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-testid="generator-apply"
              className="btn btn-primary btn-sm flex-1"
              onClick={() => {
                onApply(preview);
                setOpen(false);
              }}
            >
              {t("generator.apply")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
