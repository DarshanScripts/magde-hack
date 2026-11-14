import { Logo } from "@/components/Logo";

export default function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <Logo />
      <span className="text-[1.15rem] font-semibold tracking-[-0.03em] text-ink">
        Beyond <span className="font-medium text-muted">Words</span>
      </span>
    </div>
  );
}
