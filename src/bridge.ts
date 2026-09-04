import { invoke } from "@tauri-apps/api/core";

export type UsageMetadataStatus = "exact" | "missing";

export type DeviceCandidate = {
  id: string;
  vendorId: number;
  productId: number;
  productName: string | null;
  interfaceNumber: number;
  usagePage: number;
  usage: number;
  usageMetadata: UsageMetadataStatus;
};

export type ConnectedDevice = Omit<DeviceCandidate, "id">;

export type ConnectionState = {
  connected: boolean;
  device: ConnectedDevice | null;
};

export type SlotMetadata = {
  slot: number;
  length: number;
};

export type CommandError = {
  code: string;
  message: string;
};

const fallbackError: CommandError = {
  code: "unknown_error",
  message: "The operation failed. Try again.",
};

/** Keep backend error codes while rejecting arbitrary invoke failures. */
export function asCommandError(error: unknown): CommandError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return { code: error.code, message: error.message };
  }
  return fallbackError;
}

export function listDevices(): Promise<DeviceCandidate[]> {
  return invoke<DeviceCandidate[]>("list_devices");
}

export function connectDevice(opaqueId: string): Promise<ConnectionState> {
  return invoke<ConnectionState>("connect_device", { opaqueId });
}

export function disconnectDevice(): Promise<void> {
  return invoke("disconnect_device");
}

export function getConnection(): Promise<ConnectionState> {
  return invoke<ConnectionState>("get_connection");
}

export function listSlots(): Promise<SlotMetadata[]> {
  return invoke<SlotMetadata[]>("list_slots");
}
