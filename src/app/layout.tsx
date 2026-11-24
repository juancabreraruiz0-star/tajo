import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analitica } from "@/components/analitica";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Tajo · Gestión para reformas",
    template: "%s · Tajo",
  },
  description: "Clientes, presupuestos, facturas y almacén para empresas de reformas.",
};

export const viewport: Viewport = {
  themeColor: "#ec931c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="bg-stone-50 font-sans text-stone-900 antialiased">
        {children}
        <Analitica />
      </body>
    </html>
  );
}
