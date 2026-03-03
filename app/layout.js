import "./globals.css";

export const metadata = {
  title: "Hlidacka bazaru",
  description: "Automaticke hledani inzeratu bezi podle planu nastaveneho v administraci."
};

export default function RootLayout({ children }) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );
}
