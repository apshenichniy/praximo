// PROTOTYPE — shared chrome for wayfinder #15: Telegram Mini App frame,
// floating variant switcher, tiny markdown renderer. Not product UI.
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, EllipsisVertical, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const VARIANTS = [
  { key: "A", name: "Табы" },
  { key: "B", name: "Сегодня" },
  { key: "C", name: "Клиенты-first" },
] as const;

export type VariantKey = (typeof VARIANTS)[number]["key"];

export function ProtoSwitcher({ current }: { current: VariantKey }) {
  const navigate = useNavigate();
  const idx = VARIANTS.findIndex((v) => v.key === current);
  const go = (dir: 1 | -1) => {
    const next = VARIANTS[(idx + dir + VARIANTS.length) % VARIANTS.length];
    void navigate({ to: "/", search: { variant: next.key }, replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900/90 px-2 py-1.5 text-white shadow-xl ring-1 ring-white/20 backdrop-blur">
      <button
        type="button"
        onClick={() => go(-1)}
        className="rounded-full p-1 hover:bg-white/15"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-36 text-center text-xs font-medium">
        {current} — {VARIANTS[idx].name}
      </span>
      <button
        type="button"
        onClick={() => go(1)}
        className="rounded-full p-1 hover:bg-white/15"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

// Telegram Mini App window: dark chrome header + phone-width viewport
export function TgShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col bg-[#0e1621] pb-20">
      <div className="sticky top-0 z-40 flex items-center justify-between bg-[#17212b] px-3 py-2 text-white">
        <ChevronLeft className="size-5 text-[#708499]" />
        <div className="text-center">
          <div className="text-sm font-semibold">Praximo</div>
          <div className="text-[10px] text-[#708499]">mini app</div>
        </div>
        <div className="flex gap-3 text-[#708499]">
          <EllipsisVertical className="size-5" />
          <X className="size-5" />
        </div>
      </div>
      <div className="flex flex-1 flex-col bg-zinc-100">{children}</div>
    </div>
  );
}

// Just enough markdown for the mock artifacts: **bold**, *italic*, - bullets, paragraphs.
export function Md({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/\n\n+/);
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|\*[^*]+\*|„[^“]+“|«[^»]+»)/g).map((part, i) => {
      if (part.startsWith("**"))
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
      return <span key={i}>{part}</span>;
    });
  return (
    <div className={cn("space-y-2.5 text-[13px] leading-relaxed", className)}>
      {blocks.map((b, i) =>
        b.trimStart().startsWith("- ") ? (
          <ul key={i} className="list-disc space-y-1 pl-4">
            {b.split("\n").map((li, j) => (
              <li key={j}>{inline(li.replace(/^- /, ""))}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{inline(b)}</p>
        ),
      )}
    </div>
  );
}

// tiny in-memory navigation stack — each variant owns its own instance
export function useStack<S>(root: S) {
  const [stack, setStack] = useState<Array<S>>([root]);
  return {
    top: stack[stack.length - 1],
    depth: stack.length,
    push: (s: S) => setStack((st) => [...st, s]),
    pop: () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)),
    reset: (s: S) => setStack([s]),
  };
}

export const avatarColors: Record<string, string> = {
  violet: "bg-violet-100 text-violet-700",
  emerald: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  sky: "bg-sky-100 text-sky-700",
};
