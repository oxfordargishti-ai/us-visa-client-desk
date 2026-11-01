export const dynamic = "force-static";

export default function Offline() {
  return (
    <main className="grid min-h-dvh place-items-center bg-navy p-8 text-center text-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div>
        <img src="/brand/logo-320.png" alt="US VISA WITH ARGISHTI" className="mx-auto mb-8 w-40 rounded-2xl bg-white p-2" />
        <h1 className="font-display text-3xl font-semibold">You're offline</h1>
        <p className="mx-auto mt-3 max-w-xs text-white/70">
          Your client data is never stored on this device, so the desk needs a connection. Reconnect and it will pick up right where you left off.
        </p>
      </div>
    </main>
  );
}
