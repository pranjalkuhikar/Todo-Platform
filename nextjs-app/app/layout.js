import "./globals.css";
export const metadata = { title: "Todos · Next.js", description: "Next.js + Postgres todo app" };
export default function RootLayout({ children }) {
  return (<html lang="en"><body>{children}</body></html>);
}
