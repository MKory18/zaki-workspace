"use client";

/**
 * This browser agrees to be rung when the site is closed (src/server/calls/push.ts, public/sw.js). Asked the first
 * time the person starts, answers or opens a call — a tap, which browsers require before they ask — and refreshed
 * quietly on every visit once allowed. On an iPhone this works only for the app added to the home screen.
 */

function supported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function sameKey(a: ArrayBuffer | null | undefined, b: string): boolean {
  if (!a) return false;
  const text = btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return text === b;
}

function keyBytes(base64url: string): ArrayBuffer {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new ArrayBuffer(raw.length);
  const view = new Uint8Array(out);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return out;
}

export type PushState = "unsupported" | "ios_home" | "default" | "granted" | "denied";

/**
 * Where this browser stands: no push at all; an iPhone that needs the site on its home screen first; not asked yet;
 * allowed; refused (only the browser's own settings turn it back on).
 */
export function pushState(): PushState {
  if (typeof window === "undefined") return "unsupported";
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (!supported()) return ios && !standalone ? "ios_home" : "unsupported";
  return Notification.permission as "default" | "granted" | "denied";
}

/** `ask`: may show the browser's question (only from a tap). Never throws: ringing is a convenience. */
export async function ensurePush(ask: boolean): Promise<void> {
  if (!supported()) return;
  try {
    // asked first, before anything is awaited: Safari only asks inside the tap itself
    const permission = Notification.permission === "default" && ask ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") return;
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const res = await fetch("/api/push/key", { cache: "no-store" });
    if (!res.ok) return;
    const { publicKey } = (await res.json()) as { publicKey: string };
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub.options.applicationServerKey, publicKey)) {
      // the server's key changed: subscribe again with the new one
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return;
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }),
    });
  } catch {
    // no push service, a refused permission, a private window: the open app still rings
  }
}
