import { ArrowRightToLine, CornerDownLeft, Delete, Minus } from "lucide-react";
import type { MacroToken } from "../types/macro";

type TokenIconProps = {
  token: Pick<MacroToken, "kind" | "label">;
};

export function TokenIcon({ token }: TokenIconProps) {
  if (token.kind !== "control") return null;
  const props = { className: "h-4 w-4 text-ink-muted", "aria-hidden": true } as const;
  switch (token.label) {
    case "LF":
      return <CornerDownLeft {...props} />;
    case "Tab":
      return <ArrowRightToLine {...props} />;
    case "Backspace":
      return <Delete {...props} />;
    default:
      return <Minus {...props} />;
  }
}
