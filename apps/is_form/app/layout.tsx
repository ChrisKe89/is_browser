import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "is_form",
  description: "Deterministic profile authoring form",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
