import "./globals.css";

export const metadata = {
  title: "Hlidacka bazaru",
  description: "Automaticke hledani inzeratu bezi kazde 2 hodiny pres GitHub Actions."
};

export default function RootLayout({ children }) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );
}
