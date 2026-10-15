"use client";

// Notifications on this phone (Derek, 2026-10-15): ClickUpTasks on the iPhone
// home screen instead of an App Store app. On an iPhone in Safari it says how
// to put it on the home screen, since that is the only place an iPhone shows
// them; from the home screen, Turn on asks for permission (iOS only asks from
// a tap), then a switch turns it on and off. Hidden until the keys are set.

import { useEffect, useState } from "react";
import { I, Toggle } from "./cockpit/ui";
import { BTN, SettingsCard } from "./settings/ui";
import { isInstalled, isIos, isPhone, pushEnabled, pushState, turnOffPush, turnOnPush, type PushState } from "@/lib/pushClient";

type View = "loading" | "install" | PushState;

export default function PushNotificationsCard() {
  const [view, setView] = useState<View>("loading");
  const [asked, setAsked] = useState(false); // permission given before, so a switch rather than Turn on
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [where, setWhere] = useState("this phone");

  useEffect(() => {
    let live = true;
    (async () => {
      const next: View = isIos() && !isInstalled() ? "install" : await pushState();
      if (!live) return;
      setWhere(isPhone() ? "this phone" : "this computer");
      setAsked(typeof Notification !== "undefined" && Notification.permission === "granted");
      setView(next);
    })();
    return () => { live = false; };
  }, []);

  if (!pushEnabled() || view === "loading") return null;

  async function run(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      const next = on ? await turnOnPush() : await turnOffPush();
      setView(next);
      if (next !== "denied") setAsked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const title = `Notifications on ${where}`;
  const what = "A notification when a client writes, Claude finishes, a teammate hands you a step, or someone mentions or messages you.";
  return (
    <SettingsCard title={title} icon={<I.mobile className="h-4 w-4" />} tone="rose">
      {view === "install" && (
        <p className="text-[16px] text-foreground">
          Open ClickUpTasks in Safari, tap Share, then Add to Home Screen. Notifications work from the Tasks app on your home screen.
        </p>
      )}
      {view === "unsupported" && <p className="text-[16px] text-muted">This browser cannot show notifications from ClickUpTasks.</p>}
      {view === "denied" && (
        <p className="text-[16px] text-foreground">
          Notifications are blocked for ClickUpTasks. Allow them in {isIos() ? "the iPhone's Settings, Notifications, Tasks" : "this browser's site settings"}, then come back here.
        </p>
      )}
      {(view === "off" || view === "on") && (asked ? (
        <div className="flex items-center gap-3 rounded-[5px] border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-medium">{view === "on" ? "On" : "Off"}</div>
            <div className="text-[16px] text-muted">{what}</div>
          </div>
          <Toggle on={view === "on"} disabled={busy} onClick={() => void run(view !== "on")} />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[16px] text-muted">{what}</p>
          <button type="button" className={BTN} disabled={busy} onClick={() => void run(true)}>{busy ? "Turning on…" : "Turn on"}</button>
        </div>
      ))}
      {error && <div className="mt-3 rounded-[5px] bg-red-50 px-3 py-2 text-[16px] text-red-600">{error}</div>}
    </SettingsCard>
  );
}
