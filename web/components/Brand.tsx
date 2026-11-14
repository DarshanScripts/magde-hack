"use client";

import { Logo } from "@/components/Logo";
import { useI18n } from "@/lib/i18n";

// Header lockup: the mark on a raised tile, the name with "Words" in the mark's gradient, a short claim below.
export default function Brand() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-surface shadow-card ring-1 ring-line">
        <Logo size={30} />
      </span>
      <div className="flex flex-col gap-1 leading-none">
        <span className="text-[1.2rem] font-semibold tracking-[-0.03em] text-ink">
          Beyond{" "}
          <span className="bg-linear-to-r from-accent to-call bg-clip-text text-transparent">Words</span>
        </span>
        <span className="text-[0.68rem] font-medium tracking-[0.14em] text-muted uppercase">{t("claim")}</span>
      </div>
    </div>
  );
}
