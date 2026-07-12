import { Search } from "lucide-react";

export default function TopBar() {
  return (
    <header className="flex h-16 items-center gap-4 border-b border-base-300 bg-base-200 px-4 md:px-6">
      <label className="input input-bordered flex flex-1 max-w-md items-center gap-2">
        <Search size={16} aria-hidden="true" className="text-base-content/50" />
        <input
          type="text"
          placeholder="Szukaj..."
          className="grow bg-transparent outline-none"
          disabled
        />
        <kbd className="kbd kbd-sm">⌘K</kbd>
      </label>

      <div className="flex-1" />

      <button type="button" className="btn btn-primary btn-sm" disabled>
        + Nowy item
      </button>
    </header>
  );
}
