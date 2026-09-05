import type { CommandError } from "../bridge";

export type SlotStatus = "idle" | "saving" | "saved" | "error";
export type SlotAction = "load" | "save" | "clear";

export type SlotState = {
  slot: number;
  length: number;
  savedText: string;
  draftText: string;
  savedLabel: string;
  draftLabel: string;
  loaded: boolean;
  loading: boolean;
  previewLoading: boolean;
  revealed: boolean;
  status: SlotStatus;
  error: CommandError | null;
  lastAction: SlotAction | null;
  savedAt: string | null;
};
