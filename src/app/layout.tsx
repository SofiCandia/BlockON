import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PostMarca | Pagos en Stellar Testnet",
  description: "Prueba del flujo de pagos de PostMarca en Stellar Testnet.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 font-sans text-slate-900">
        {children}
      </body>
    </html>
  );
}
