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
import { type Me, type Client, type TaskTemplate, type Playbook, type PlaybookTask, type Project } from "@/lib/data";
import { I } from "./cockpit/ui";
import SettingsPanel from "./SettingsPanel";
import TeamPanel from "./TeamPanel";
import TemplatesPanel from "./TemplatesPanel";
import PlaybooksPanel from "./PlaybooksPanel";
import ApiTokensPanel from "./ApiTokensPanel";
import NotificationPrefsPanel from "./NotificationPrefsPanel";
import SignaturePanel from "./SignaturePanel";
import TrashPanel from "./TrashPanel";

export type TabKey = "integrations" | "team" | "templates" | "playbooks" | "tokens" | "notifications" | "signature" | "trash";

export default function SettingsHub({
  initialTab = "integrations",
  me,
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
  playbooks,
  onSavePlaybook,
  onDeletePlaybook,
  onLoadPlaybook,
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
  onSaveTemplate: (id: string | undefined, spec: { name: string; checklistItems: string[] }) => void;
  onDeleteTemplate: (id: string) => void;
  onUseTemplateAsTask: (templateId: string, clientId: string, projectId: string) => void;
  playbooks: Playbook[];
  onSavePlaybook: (id: string | undefined, spec: { name: string; tasks: PlaybookTask[] }) => void;
  onDeletePlaybook: (id: string) => void;
  onLoadPlaybook: (playbookId: string, clientId: string, projectId: string) => void;
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
}) {
  const tabs: { key: TabKey; label: string; icon: keyof typeof I; visible: boolean }[] = [
    { key: "integrations", label: "Integrations", icon: "gear", visible: canAdmin },
    { key: "team", label: "Team", icon: "user", visible: canAdmin },
    { key: "templates", label: "Task templates", icon: "clipboard", visible: canAdmin },
    { key: "playbooks", label: "Playbooks", icon: "bookmark", visible: canAdmin },
    { key: "tokens", label: "API tokens", icon: "key", visible: true },
    { key: "notifications", label: "Notifications", icon: "bell", visible: true },
    // Per-person, not team management — same footing as Notifications.
    { key: "signature", label: "Email signature", icon: "mail", visible: true },
    // Restoring/purging touches other people's clients/projects/tasks, same
    // trust level as the admin-only tabs above.
    { key: "trash", label: "Trash", icon: "trash", visible: canAdmin },
  ];
  const visibleTabs = tabs.filter((t) => t.visible);
  const [tab, setTab] = useState<TabKey>(visibleTabs.some((t) => t.key === initialTab) ? initialTab : visibleTabs[0]?.key ?? "tokens");

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-background/40 p-2">
        {visibleTabs.map((t) => {
          const Icon = I[t.icon];
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium ${tab === t.key ? "bg-accent-soft text-accent" : "text-muted hover:bg-background hover:text-foreground"}`}>
              <Icon className="shrink-0" /> {t.label}
            </button>
          );
        })}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
            {tab === "integrations" && canAdmin && <SettingsPanel clients={subAccounts} onSaveClient={onSaveClient} onSynced={onSynced} />}
            {tab === "team" && canAdmin && <TeamPanel me={me} dmEnabled={dmEnabled} onSetDmEnabled={onSetDmEnabled} />}
            {tab === "templates" && canAdmin && (
              <TemplatesPanel templates={templates} clients={clients} projects={projects}
                onSave={onSaveTemplate} onDelete={onDeleteTemplate} onUseAsTask={onUseTemplateAsTask} />
            )}
            {tab === "playbooks" && canAdmin && (
              <PlaybooksPanel playbooks={playbooks} clients={clients} projects={projects}
                onSave={onSavePlaybook} onDelete={onDeletePlaybook} onLoad={onLoadPlaybook} />
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
  );
}
