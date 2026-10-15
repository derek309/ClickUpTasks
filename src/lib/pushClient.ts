"use client";

// The phone side of notifications (Derek, 2026-10-15): the service worker
// (public/sw.js), this device's push subscription, and the server's copy of
// it (/api/push/subscribe). Every function is a quiet no without the public
// VAPID key, so nothing happens until Derek adds the keys in Vercel.

import { authedFetch } from "./supabase";

export const VAPID_PUBLIC_KEY = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
export const pushEnabled = (): boolean => !!VAPID_PUBLIC_KEY;

/** The browser can do Web Push at all here (an iPhone only from the home screen). */
export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** An iPhone or iPad, where notifications need ClickUpTasks on the home screen. */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Opened from the home screen rather than in a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

/** A phone, for the card's wording. */
export function isPhone(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPod|Android.*Mobile/.test(navigator.userAgent);
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

let registering: Promise<ServiceWorkerRegistration | null> | null = null;
/** Registers /sw.js once per page load. */
export function registerPushWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushEnabled() || !pushSupported()) return Promise.resolve(null);
  registering ??= navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
  return registering;
}

async function existingSubscription(): Promise<PushSubscription | null> {
  const reg = await registerPushWorker();
  return reg ? reg.pushManager.getSubscription().catch(() => null) : null;
}

async function saveOnServer(sub: PushSubscription): Promise<boolean> {
  const res = await authedFetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  return res.ok;
}

/** On every app open: the worker is registered, and a phone that already said
 *  yes tells the server its subscription again (the push service can change
 *  it, and a row dropped after a failed send comes back). */
export async function startPushWorker(): Promise<void> {
  try {
    const sub = await existingSubscription();
    if (sub && Notification.permission === "granted") await saveOnServer(sub);
  } catch { /* best effort */ }
}

export type PushState = "off" | "on" | "denied" | "unsupported";

export async function pushState(): Promise<PushState> {
  if (!pushEnabled() || !pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return (await existingSubscription()) ? "on" : "off";
}

/** Turn on, from the tap itself: iOS only asks for permission from a tap. */
export async function turnOnPush(): Promise<PushState> {
  if (!pushEnabled() || !pushSupported()) return "unsupported";
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await registerPushWorker();
  if (!reg) throw new Error("The notification helper could not start. Reload and try again.");
  const ready = await navigator.serviceWorker.ready;
  const sub = (await ready.pushManager.getSubscription()) ?? await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  if (!(await saveOnServer(sub))) throw new Error("Could not save this phone. Try again.");
  return "on";
}

/** Turn off on this device: the server forgets it and the browser drops it. */
export async function turnOffPush(): Promise<PushState> {
  const sub = await existingSubscription();
  if (sub) {
    await authedFetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => null);
    await sub.unsubscribe().catch(() => false);
  }
  return pushSupported() && Notification.permission === "denied" ? "denied" : "off";
}

/** Signing out: this device stops getting this person's notifications. */
export async function forgetPushOnSignOut(): Promise<void> {
  try { if (pushEnabled() && pushSupported()) await turnOffPush(); } catch { /* best effort */ }
}

/** After a teammate's notification is saved: the server decides whether it is
 *  worth a push (lib/pushPayload teammatePushReason) and sends it. */
export function askServerToPush(notificationId: string): void {
  if (!pushEnabled()) return;
  authedFetch("/api/push/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: notificationId }) }).catch(() => {});
}
