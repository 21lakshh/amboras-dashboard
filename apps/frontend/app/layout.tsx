import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Amboras Analytics Dashboard",
  description: "Realtime revenue, conversion, and product analytics for Amboras store owners.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
