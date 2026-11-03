import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tye Studio",
  description: "An open-source workspace for creating and editing images, video and creative workflows with ComfyUI.",
  icons: {
    icon: "/tye.svg",
    shortcut: "/tye.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
