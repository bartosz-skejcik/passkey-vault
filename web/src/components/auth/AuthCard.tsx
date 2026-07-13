import type { ReactNode } from "react";

/**
 * Shared 400px-wide auth card wrapper (Login/Register) per UI-SPEC's Auth
 * screens section — no shell chrome (sidebar/top bar), since the user
 * isn't authenticated yet.
 */
export default function AuthCard({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-base-300 p-4">
      <div className="w-full max-w-[400px] rounded-box border border-base-300 bg-base-100 p-6">
        <h1 className="text-[20px] font-bold leading-[1.2]">{heading}</h1>
        <div className="mt-6 flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}
