import { create } from "zustand";
import { M3DataSource, MockM3DataSource, TauriM3DataSource } from "./dataSource";
import { isMock } from "@/env";
import {
  NormalizedOperationState,
  normalizeOperationState,
} from "./types";

export interface M3State {
  dataSource: M3DataSource;
  operationState: NormalizedOperationState;
  isLoading: boolean;
  setDataSource: (dataSource: M3DataSource) => void;
  refreshOperationState: () => Promise<void>;
  opContinue: () => Promise<void>;
  opSkip: () => Promise<void>;
  opAbort: () => Promise<void>;
}

const defaultM3DataSource: M3DataSource = isMock()
  ? new MockM3DataSource()
  : new TauriM3DataSource();

export const useM3Store = create<M3State>((set, get) => {
  defaultM3DataSource.onOperationChanged(() => {
    void get().refreshOperationState();
  });

  return {
    dataSource: defaultM3DataSource,
    operationState: { kind: "None", isActive: false },
    isLoading: false,

    setDataSource: (dataSource) => {
      set({ dataSource });
      void get().refreshOperationState();
    },

    refreshOperationState: async () => {
      try {
        const raw = await get().dataSource.getOperationState();
        set({ operationState: normalizeOperationState(raw) });
      } catch {
        set({ operationState: { kind: "None", isActive: false } });
      }
    },

    opContinue: async () => {
      set({ isLoading: true });
      try {
        await get().dataSource.opContinue();
        await get().refreshOperationState();
      } finally {
        set({ isLoading: false });
      }
    },

    opSkip: async () => {
      set({ isLoading: true });
      try {
        await get().dataSource.opSkip();
        await get().refreshOperationState();
      } finally {
        set({ isLoading: false });
      }
    },

    opAbort: async () => {
      set({ isLoading: true });
      try {
        await get().dataSource.opAbort();
        await get().refreshOperationState();
      } finally {
        set({ isLoading: false });
      }
    },
  };
});
