import "./globals.css";

export const metadata = {
  title: "AuthHub: one login for all your apps",
  description: "Centralized sign-in that routes each user to the apps they can access.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
