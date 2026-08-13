import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rehearsal Room",
  description: "Practice the conversation out loud, against a model of the person.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
