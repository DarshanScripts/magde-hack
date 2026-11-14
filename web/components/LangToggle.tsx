"use client";

import { setLang, useI18n, type Lang } from "@/lib/i18n";

const LANGS: Lang[] = ["de", "en"];

export default function LangToggle() {
  const { lang, t } = useI18n();
  return (
    <div role="group" aria-label={t("language")} className="flex rounded-full border border-line bg-surface p-0.5 shadow-card">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
          className={`h-8 cursor-pointer rounded-full px-3 text-sm font-medium uppercase transition-colors duration-200 ${
            lang === l ? "bg-ink text-paper" : "text-muted hover:text-ink"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
