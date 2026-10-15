import { TauriSettingsDataSource, SettingsDataSource } from "./types";

export * from "./types";

export const defaultSettingsDataSource: SettingsDataSource = new TauriSettingsDataSource();
