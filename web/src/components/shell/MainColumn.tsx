import type { ReactNode } from "react";

export default function MainColumn({ children }: { children: ReactNode }) {
  return (
    <main className="flex-1 overflow-y-auto bg-base-300 p-4 md:p-8">
      <div className="mx-auto flex max-w-[720px] flex-col">
        <h1 className="text-[28px] font-bold leading-[1.15]">Vault</h1>

        <div className="mt-4 flex flex-col gap-1">
          <h2 className="text-[20px] font-bold leading-[1.2]">Vault jeszcze pusty</h2>
          <p className="font-[family-name:var(--font-hand)] text-base leading-[1.5]">
            Dodawanie itemów ląduje w kolejnej fazie — na razie sprawdź, czy
            krypto działa 👇
          </p>
        </div>

        <div className="mt-12">{children}</div>
      </div>
    </main>
  );
}
