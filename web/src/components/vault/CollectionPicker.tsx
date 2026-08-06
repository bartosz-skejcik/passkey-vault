"use client";

// E8's real collections picker (26-UI-SPEC.md) -- what Phase 24's own CR-02
// fix explicitly deferred here ("kept only so Phase 26 can re-wire a real
// collections picker later", FamilyTab.tsx:39's own comment). Reused by
// ShareDialog's implicit "which folder does this go in" context (Plan
// 26-08) and by FamilyTab's invite-scope select once its "folder" option
// stops being unconditionally disabled (Plan 26-12).
//
// Discharges three UI-SPEC backstops recorded in STATE.md as DISSOLVED, not
// met, after Phase 24's own folder-picker element (the thing they
// constrained) was deleted:
//
//   #4 zero-one-many -- zero collections renders folder.pickerEmpty in
//     place of the <select>, WITH the folder.pickerCreateNew trigger still
//     present (a picker with nothing to pick must still offer the way to
//     create the first option, never a dead end). One or many collections
//     render the exact same native select select-bordered -- no
//     special-casing exactly one option.
//   #5 long folder-name option truncation -- every <option> carries a
//     title attribute equal to its full visible text. This is the ONE
//     truncation mechanism a real <option> element supports; DaisyUI/
//     Tailwind classes do not apply inside native <option> rendering, so
//     this is the correct tool, not a workaround.
//   #6 selected-folder value truncation -- discharged at CLASS LEVEL ONLY.
//     jsdom performs no layout, so scrollWidth/clientWidth are always 0 in
//     tests and `0 <= 0` would pass unconditionally regardless of markup --
//     exactly the kind of test that cannot fail. This component instead
//     guarantees its outer container and the <select> itself both carry
//     w-full and no fixed/max-width class shorter than a realistic long
//     name; CollectionPicker.test.tsx asserts that class contract
//     structurally. The CLOSED native <select> value's own ellipsis
//     handling is browser-rendered and genuinely out of this component's
//     control -- Plan 26-13's live Playwright run is where that real
//     layout claim belongs, not here.
//
// Native <select> idiom (never a custom combobox/listbox primitive) per
// UI-SPEC E8 and FamilyTab.tsx's existing invite-scope-select precedent
// (FamilyTab.tsx:547-557) -- the title-attribute truncation handling above
// is exactly why a native element was kept.
//
// Loading: useCollections() (Plan 26-05) is a useSyncExternalStore-backed
// module singleton (same shape as this codebase's own useFolders()) that
// exposes no distinct "not yet fetched" signal -- only the current
// Collection[] snapshot. ItemForm.tsx's own personal-folder <select> (the
// exact same useFolders() shape) has never needed to distinguish "loading"
// from "genuinely empty" either. This component follows that established
// precedent: a not-yet-populated list and a genuinely empty list both
// render the same folder.pickerEmpty + create-new state, which stays
// honest in both cases ("no shared folders are known right now") without
// fabricating a spinner state this store cannot actually signal. Adding
// that signal would mean changing collections.ts, which is out of this
// plan's file scope (web/src/components/vault/CollectionPicker.tsx and its
// test only).
import { useLocale } from "@/lib/i18n/LocaleContext";
import { useCollections } from "@/lib/vault/collections";

export interface CollectionPickerProps {
  value: string | null;
  onSelect: (id: string) => void;
  onCreateNew: () => void;
}

export default function CollectionPicker({ value, onSelect, onCreateNew }: CollectionPickerProps) {
  const { t } = useLocale();
  const collections = useCollections();

  if (collections.length === 0) {
    return (
      <div className="flex w-full flex-col gap-2" data-testid="collection-picker-empty-state">
        <p data-testid="collection-picker-empty" className="text-sm text-base-content/70">
          {t("folder.pickerEmpty")}
        </p>
        <button
          type="button"
          data-testid="collection-picker-create-new"
          className="btn btn-ghost btn-sm w-fit"
          onClick={onCreateNew}
        >
          {t("folder.pickerCreateNew")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2" data-testid="collection-picker">
      <select
        id="collection-picker-select"
        data-testid="collection-picker-select"
        className="select select-bordered w-full"
        value={value ?? ""}
        onChange={(e) => onSelect(e.target.value)}
      >
        {value === null ? (
          <option value="" disabled>
            {t("folder.pickerLabel")}
          </option>
        ) : null}
        {collections.map((collection) => (
          <option key={collection.id} value={collection.id} title={collection.name}>
            {collection.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-testid="collection-picker-create-new"
        className="btn btn-ghost btn-sm w-fit"
        onClick={onCreateNew}
      >
        {t("folder.pickerCreateNew")}
      </button>
    </div>
  );
}
