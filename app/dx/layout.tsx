import "../dx.css";
import { DX_FONTS_URL } from "@/lib/dx/config/themes";

/** Deduction game screens (TV + phones). The game's own theme takes over inside `.dx`. */
export default function DxLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={DX_FONTS_URL} />
      {children}
    </>
  );
}
