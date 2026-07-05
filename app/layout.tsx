import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata = {
  title: "find-yourself",
  description: "3D memory fragments game",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}