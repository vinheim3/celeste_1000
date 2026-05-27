import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Celeste Goaling",
  description: "Route finder for the 1000-player Celeste async",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
