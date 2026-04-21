import type { ReactNode } from "react";
import { useState } from "react";

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

export function GuideTabs({ tabs }: { tabs: Tab[] }) {
  const first = tabs[0]?.id ?? "";
  const [active, setActive] = useState<string>(first);
  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <section aria-label="Guide details" className="flex flex-col gap-8">
      <div
        role="tablist"
        aria-label="Guide sections"
        className="inline-flex self-start overflow-hidden rounded-md border border-line bg-surface"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              id={`tab-${tab.id}`}
              onClick={() => setActive(tab.id)}
              className={[
                "px-4 py-1.5 text-xs transition",
                selected
                  ? "bg-ink text-paper"
                  : "text-muted hover:bg-line/40 hover:text-ink",
              ].join(" ")}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-${activeTab?.id}`}
        aria-labelledby={`tab-${activeTab?.id}`}
      >
        {activeTab?.content}
      </div>
    </section>
  );
}
