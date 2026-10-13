"use client";

// One settings surface instead of five separate icon-triggered popups
// (Settings/Integrations, Team, Templates, API Tokens each used
// to open their own floating modal). Each panel below still owns its own
// state/logic exactly as before — this just supplies one shared frame/
// header and a tab rail, and each panel's own chrome was stripped down to
// its content only (see each file's return statement).
//
// A real page in the main content area — Derek asked more than once for
// this NOT to be a popup or slide-out. Rendered as the "content" branch of
// Cockpit's main view switch (settingsView), same footing as My Work/
// Personal/Team Chat/a client page. No fixed positioning, no backdrop, no
// close button — you navigate away the same way you leave any other page,
// by clicking somewhere else in the sidebar.
import { useState } from "react";
import { type Me, type Client, type TaskTemplate, type Project } from "@/lib/data";
import { I } from "./cockpit/ui";
import SettingsPanel from "./SettingsPanel";
import TeamPanel from "./TeamPanel";
import TemplatesPanel from "./TemplatesPanel";
import ApiTokensPanel from "./ApiTokensPanel";
import NotificationPrefsPanel from "./NotificationPrefsPanel";
import SignaturePanel from "./SignaturePanel";
import GranolaPanel from "./GranolaPanel";
import { SettingsCard, Tile, BTN, BTN_DANGER, type Tone } from "./settings/ui";
import TrashPanel from "./TrashPanel";
import { TEMPLATES_ON } from "@/lib/data";

export type TabKey = "account" | "integrations" | "team" | "templates" | "tokens" | "notifications" | "signature" | "granola" | "trash";

export default function SettingsHub({
  initialTab = "integrations",
  me,
  theme,
  onSetTheme,
  onSignOut,
  canAdmin,
  subAccounts,
  onSaveClient,
  onSynced,
  clients,
  templates,
  projects,
  onSaveTemplate,
  onDeleteTemplate,
  onUseTemplateAsTask,
  dmEnabled,
  onSetDmEnabled,
  onRestoreClient,
  onRestoreProject,
  onRestoreTask,
  onPurgeClient,
  onPurgeProject,
  onPurgeTask,
}: {
  initialTab?: TabKey;
  me: Me;
  canAdmin: boolean;
  subAccounts: Client[];
  onSaveClient: (c: Client) => void;
  onSynced: () => void | Promise<void>;
  clients: Client[];
  templates: TaskTemplate[];
  projects: Project[];
  onSaveTemplate: (id: string | undefined, spec: { name: string; checklistItems: TaskTemplate["checklistItems"]; clientId?: string | null }) => void;
  onDeleteTemplate: (id: string) => void;
  onUseTemplateAsTask: (templateId: string, clientId: string, projectId: string) => void;
  // Shared, workspace-wide — whether the sidebar's DM list is on. Lives here
  // (the admin-only Team tab) rather than in the sidebar itself, where it
  // used to be a switch right next to the Chat section.
  dmEnabled: boolean;
  onSetDmEnabled: (v: boolean) => void;
  onRestoreClient: (id: string) => Promise<void> | void;
  onRestoreProject: (id: string) => Promise<void> | void;
  onRestoreTask: (id: string) => Promise<void> | void;
  onPurgeClient: (id: string) => Promise<void> | void;
  onPurgeProject: (id: string) => Promise<void> | void;
  onPurgeTask: (id: string) => Promise<void> | void;
  theme: "light" | "dark" | "auto";
  onSetTheme: (t: "light" | "dark" | "auto") => void;
  onSignOut: () => void;
}) {
  // Each tab says what it is for under its name, with the same coloured icon
  // tile the task page's headings use (Derek, 2026-10-12: "match the rest of
  // the site").
  const tabs: { key: TabKey; label: string; icon: keyof typeof I; tone: Tone; about: string; visible: boolean }[] = [
    // Theme and signing out used to be two unlabelled icons wedged beside
    // your name in the sidebar (Derek: "move dark mode to settings").
    { key: "account", label: "Account", icon: "user", tone: "slate", about: "How ClickUpTasks looks for you, and signing out.", visible: true },
    { key: "integrations", label: "Integrations", icon: "gear", tone: "amber", about: "GoHighLevel, Granola and the checks that keep them honest.", visible: canAdmin },
    { key: "team", label: "Team", icon: "user", tone: "indigo", about: "Who is on the team and what each person can do.", visible: canAdmin },
    { key: "templates", label: "Task templates", icon: "clipboard", tone: "sky", about: "Ready made steps to start a task from.", visible: canAdmin && TEMPLATES_ON },
    { key: "tokens", label: "Claude and API tokens", icon: "key", tone: "violet", about: "Connect Claude, and keys for scripts and tools.", visible: true },
    { key: "notifications", label: "Notifications", icon: "bell", tone: "rose", about: "Which emails you get a copy of.", visible: true },
    // Per-person, not team management: same footing as Notifications.
    { key: "signature", label: "Email signature", icon: "mail", tone: "emerald", about: "Added to the bottom of every client email you send.", visible: true },
    // Your own Granola key: your meetings, from any folder (2026-10-12).
    { key: "granola", label: "Granola", icon: "calendar", tone: "sky", about: "Your meetings, into the client's Journal and onto Transcript steps.", visible: true },
    // Restoring/purging touches other people's clients/projects/tasks, same
    // trust level as the admin-only tabs above.
    { key: "trash", label: "Trash", icon: "trash", tone: "slate", about: "Deleted clients, lists and tasks, kept for a while before they go for good.", visible: canAdmin },
  ];
  const visibleTabs = tabs.filter((t) => t.visible);
  const [tab, setTab] = useState<TabKey>(visibleTabs.some((t) => t.key === initialTab) ? initialTab : visibleTabs[0]?.key ?? "tokens");

  const current = visibleTabs.find((t) => t.key === tab);
  return (
    <div className="flex min-h-0 flex-1 bg-background">
      <nav className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-surface p-3">
        {visibleTabs.map((t) => {
          const Icon = I[t.icon];
          const on = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} aria-current={on ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-left text-[16px] font-medium ${on ? "bg-accent-soft text-accent" : "text-muted hover:bg-background hover:text-foreground"}`}>
              <Icon className="h-4 w-4 shrink-0" /> {t.label}
            </button>
          );
        })}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[880px] px-6 pb-16 pt-8">
          {current && (
            <header className="mb-6 flex items-center gap-3">
              <Tile big tone={current.tone} icon={(() => { const Icon = I[current.icon]; return <Icon className="h-5 w-5" />; })()} />
              <div className="min-w-0">
                <h1 className="text-[24px] font-bold leading-tight text-foreground">{current.label}</h1>
                <p className="text-[16px] text-muted">{current.about}</p>
              </div>
            </header>
          )}
            {tab === "granola" && <GranolaPanel />}
            {tab === "integrations" && canAdmin && <SettingsPanel clients={subAccounts} onSaveClient={onSaveClient} onSynced={onSynced} />}
            {tab === "team" && canAdmin && <TeamPanel me={me} dmEnabled={dmEnabled} onSetDmEnabled={onSetDmEnabled} />}
            {tab === "templates" && canAdmin && (
              <TemplatesPanel templates={templates} clients={clients} projects={projects}
                onSave={onSaveTemplate} onDelete={onDeleteTemplate} onUseAsTask={onUseTemplateAsTask} />
            )}
            {tab === "account" && (
              <div className="space-y-4">
                <SettingsCard title="You" icon={<I.user className="h-4 w-4" />} tone="slate"
                  hint={<>Signed in as <b className="text-foreground">{me.name}</b>, {me.role === "admin" ? "an admin" : "a team member"}.</>} />
                <SettingsCard title="Appearance" icon={<I.sun className="h-4 w-4" />} tone="amber">
                  <div className="flex flex-wrap gap-2">
                    {(["light", "dark", "auto"] as const).map((t) => (
                      <button key={t} onClick={() => onSetTheme(t)} aria-pressed={theme === t}
                        className={theme === t ? "rounded-[5px] border border-accent bg-accent px-3 py-1.5 text-[16px] font-semibold text-white" : BTN}>
                        {t === "light" ? "Light" : t === "dark" ? "Dark" : "Match the system"}
                      </button>
                    ))}
                  </div>
                </SettingsCard>
                <SettingsCard title="Session" icon={<I.logout className="h-4 w-4" />} tone="rose">
                  <button onClick={onSignOut} className={BTN_DANGER}>Sign out</button>
                </SettingsCard>
              </div>
            )}
            {tab === "tokens" && <ApiTokensPanel />}
            {tab === "notifications" && <NotificationPrefsPanel />}
            {tab === "signature" && <SignaturePanel />}
            {tab === "trash" && canAdmin && (
              <TrashPanel onRestoreClient={onRestoreClient} onRestoreProject={onRestoreProject} onRestoreTask={onRestoreTask}
                onPurgeClient={onPurgeClient} onPurgeProject={onPurgeProject} onPurgeTask={onPurgeTask} />
            )}
        </div>
      </div>
    </div>
  );
}
