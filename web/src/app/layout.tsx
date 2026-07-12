import type { Metadata } from "next";
import { DM_Sans, Fuzzy_Bubbles } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const fuzzyBubbles = Fuzzy_Bubbles({
  variable: "--font-hand",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Passkey Vault",
  description: "Self-hostable password manager z passkey PRF unlock.",
};

// Reads the persisted theme (or falls back to system preference) and sets
// data-theme on <html> BEFORE first paint. This must stay an inline <script>
// (not a client useEffect) — a useEffect only runs after hydration/first
// paint, which would cause a visible flash of the wrong theme (FOUC).
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('pv-theme');
    var valid = stored === 'vault-light' || stored === 'vault-dark';
    var theme = valid ? stored : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'vault-light' : 'vault-dark');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'vault-dark');
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${dmSans.variable} ${fuzzyBubbles.variable}`}>
        {children}
      </body>
    </html>
  );
}
