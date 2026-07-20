// PROTOTYPE — wayfinder #15. Три варианта Mini App на одном роуте,
// переключение через ?variant= (плавающая панель внизу, стрелки ←/→).
import { createFileRoute } from "@tanstack/react-router";
import { ProtoSwitcher, VARIANTS, type VariantKey } from "@/components/proto";
import { VariantA } from "@/variants/variant-a";
import { VariantB } from "@/variants/variant-b";
import { VariantC } from "@/variants/variant-c";

export const Route = createFileRoute("/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { variant: VariantKey } => {
    const v = String(search.variant ?? "A").toUpperCase();
    return {
      variant: VARIANTS.some((x) => x.key === v) ? (v as VariantKey) : "A",
    };
  },
  component: Page,
});

function Page() {
  const { variant } = Route.useSearch();
  return (
    <>
      {variant === "A" && <VariantA key="A" />}
      {variant === "B" && <VariantB key="B" />}
      {variant === "C" && <VariantC key="C" />}
      <ProtoSwitcher current={variant} />
    </>
  );
}
