import "./globals.css";
import { DM_Sans, Space_Grotesk } from "next/font/google";

const bodyFont = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-body"
});

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-heading"
});

export const metadata = {
  title: "Hlidacka bazaru",
  description: "Automaticke hledani inzeratu bezi podle planu nastaveneho v administraci."
};

export default function RootLayout({ children }) {
  return (
    <html lang="cs">
      <body className={`${bodyFont.variable} ${headingFont.variable}`}>{children}</body>
    </html>
  );
}
