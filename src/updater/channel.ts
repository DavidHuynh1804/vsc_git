import type { AppSettings } from "@/settings/types";

export type UpdateChannel = "stable" | "beta";

export function getUpdaterEndpoint(channel: UpdateChannel = "stable"): string {
  if (channel === "beta") {
    return "https://github.com/DavidHuynh1804/vsc_git/releases/download/beta/latest.json";
  }
  return "https://github.com/DavidHuynh1804/vsc_git/releases/latest/download/latest.json";
}

export function resolveUpdateChannel(settings?: Partial<AppSettings> | null): UpdateChannel {
  const val = settings?.["update_channel"] ?? settings?.["update.channel"];
  return val === "beta" ? "beta" : "stable";
}
