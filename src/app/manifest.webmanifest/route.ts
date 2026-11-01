export const dynamic = "force-static";

export function GET() {
  return Response.json(
    {
      name: "US VISA WITH ARGISHTI — Client Desk",
      short_name: "Visa Desk",
      description: "Your Legal Bridge to the U.S. — private client desk.",
      id: "/dashboard",
      start_url: "/dashboard?source=pwa",
      scope: "/",
      display: "standalone",
      orientation: "portrait-primary",
      background_color: "#0b1426",
      theme_color: "#0b1426",
      categories: ["business", "productivity"],
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
      shortcuts: [
        { name: "Today", short_name: "Today", url: "/tasks?view=today", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
        { name: "Calendar", short_name: "Calendar", url: "/calendar", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
        { name: "Interviews", short_name: "Interviews", url: "/interviews", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } },
  );
}
