"use client";

// One settings surface instead of five separate icon-triggered popups
// (Settings/Integrations, Team, Territories, Templates, API Tokens each used
// to open their own floating modal). Each panel below still owns its own
// state/logic exactly as before — this just supplies one shared frame/
// header and a tab rail, and each panel's own chrome was stripped down to
// its content only (see each file's return statement).
//
// Docked next to the sidebar (not a centered modal) — reads as an extension
// of the sidebar's own nav rather than a floating dialog interrupting
// whatever's behind it. On mobile, where the sidebar itself is off-canvas,
// this just takes the full screen (same effective footprint a modal would).
import { useState } from "react";
import { type Me, type Client, type Contact, type Territory, type TaskTemplate, type Project } from "@/lib/data";
import { I } from "./cockpit/ui";
import SettingsPanel from "./SettingsPanel";
import TeamPanel from "./TeamPanel";
import TerritoryPanel from "./TerritoryPanel";
import TemplatesPanel from "./TemplatesPanel";
import ApiTokensPanel from "./ApiTokensPanel";

type TabKey = "integrations" | "team" | "territories" | "templates" | "tokens";

export default function SettingsHub({
  onClose,
  initialTab = "integrations",
  me,
  canAdmin,
  hasTerritoryAccess,
  subAccounts,
  onSaveClient,
  onSynced,
  territories,
  contacts,
  clients,
  onAddTerritory,
  onToggleAssignee,
  onDeleteTerritory,
  onAddContact,
  onOpenClient,
  templates,
  projects,
  onSaveTemplate,
  onDeleteTemplate,
  onUseTemplateAsTask,
}: {
  onClose: () => void;
  initialTab?: TabKey;
  me: Me;
  canAdmin: boolean;
  hasTerritoryAccess: boolean;
  subAccounts: Client[];
  onSaveClient: (c: Client) => void;
  onSynced: () => void | Promise<void>;
  territories: Territory[];
  contacts: Contact[];
  clients: Client[];
  onAddTerritory: (t: { name: string; city: string; state: string; assignedTo: string[] }) => void;
  onToggleAssignee: (id: string, memberId: string) => void;
  onDeleteTerritory: (id: string) => void;
  onAddContact: (contact: Contact) => void;
  onOpenClient: (clientId: string) => void;
  templates: TaskTemplate[];
  projects: Project[];
  onSaveTemplate: (id: string | undefined, spec: { name: string; checklistItems: string[] }) => void;
  onDeleteTemplate: (id: string) => void;
  onUseTemplateAsTask: (templateId: string, clientId: string, projectId: string) => void;
}) {
  const tabs: { key: TabKey; label: string; icon: keyof typeof I; visible: boolean }[] = [
    { key: "integrations", label: "Integrations", icon: "gear", visible: canAdmin },
    { key: "team", label: "Team", icon: "user", visible: canAdmin },
    { key: "territories", label: "Territories", icon: "flag", visible: hasTerritoryAccess },
    { key: "templates", label: "Task templates", icon: "clipboard", visible: canAdmin },
    { key: "tokens", label: "API tokens", icon: "key", visible: true },
  ];
  const visibleTabs = tabs.filter((t) => t.visible);
  const [tab, setTab] = useState<TabKey>(visibleTabs.some((t) => t.key === initialTab) ? initialTab : visibleTabs[0]?.key ?? "tokens");

  return (
    <>
      {/* Transparent click-catcher over whatever's to the right of the panel
          — lets clicking away close it, without dimming the sidebar (which
          stays fully interactive) or the panel itself. */}
      <div className="fixed inset-y-0 left-0 z-40 md:left-64" onClick={onClose} />
      <div className="fixed inset-y-0 left-0 z-50 flex w-full max-w-2xl overflow-hidden border-r bg-surface shadow-xl md:left-64">
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r bg-background/40 p-2">
          <div className="px-2 pb-2 pt-1 text-[13px] font-semibold text-muted">Settings</div>
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
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="text-[16px] font-semibold">{visibleTabs.find((t) => t.key === tab)?.label ?? "Settings"}</h2>
            <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-background"><I.close /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "integrations" && canAdmin && <SettingsPanel clients={subAccounts} onSaveClient={onSaveClient} onSynced={onSynced} />}
            {tab === "team" && canAdmin && <TeamPanel me={me} />}
            {tab === "territories" && hasTerritoryAccess && (
              <TerritoryPanel me={me} canAdmin={canAdmin} territories={territories} contacts={contacts} clients={clients}
                onAddTerritory={onAddTerritory} onToggleAssignee={onToggleAssignee} onDeleteTerritory={onDeleteTerritory}
                onAddContact={onAddContact} onOpenClient={onOpenClient} />
            )}
            {tab === "templates" && canAdmin && (
              <TemplatesPanel templates={templates} clients={clients} projects={projects}
                onSave={onSaveTemplate} onDelete={onDeleteTemplate} onUseAsTask={onUseTemplateAsTask} />
            )}
            {tab === "tokens" && <ApiTokensPanel />}
          </div>
        </div>
      </div>
    </>
  );
}
