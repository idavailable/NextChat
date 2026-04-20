import { getClientConfig } from "../config/client";
import { ApiPath, STORAGE_KEY, StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";
import {
  AppState,
  getLocalAppState,
  GetStoreState,
  mergeAppState,
  setLocalAppState,
} from "../utils/sync";
import { downloadAs, readFromFile } from "../utils";
import { showToast } from "../components/ui-lib";
import Locale from "../locales";
import { createSyncClient, ProviderType } from "../utils/cloud";

export interface WebDavConfig {
  server: string;
  username: string;
  password: string;
}

const isApp = !!getClientConfig()?.isApp;
export type SyncStore = GetStoreState<typeof useSyncStore>;

const DEFAULT_SYNC_STATE = {
  // 1. 默认直接开启 UpStash 模式
  provider: ProviderType.UpStash,
  useProxy: true,
  proxyUrl: ApiPath.Cors as string,

  webdav: { endpoint: "", username: "", password: "" },
  upstash: {
    endpoint: "https://innocent-ewe-79846.upstash.io",
    username: STORAGE_KEY,
    apiKey: "gQAAAAAAATfmAAIncDJjMzE5NjY5ZmFiMDg0YmQ1YmE3YThiYzYwNjVjYzQ4YnAyNzk4NDY",
  },

  lastSyncTime: 0,
  lastProvider: "",
};

export const useSyncStore = createPersistStore(
  DEFAULT_SYNC_STATE,
  (set, get) => ({
    cloudSync() {
      const config = get()[get().provider as keyof typeof DEFAULT_SYNC_STATE] as any;
      if (!config) return false;
      return Object.values(config).every((c) => c !== undefined && c !== null && c.toString().length > 0);
    },

    markSyncTime() {
      set({ lastSyncTime: Date.now(), lastProvider: get().provider });
    },

    export() {
      const state = getLocalAppState();
      const datePart = isApp
        ? `${new Date().toLocaleDateString().replace(/\//g, "_")} ${new Date()
            .toLocaleTimeString()
            .replace(/:/g, "_")}`
        : new Date().toLocaleString().replace(/[\/:]/g, "-");

      const fileName = `Backup-${datePart}.json`;
      downloadAs(JSON.stringify(state), fileName);
    },

    async import() {
      const rawContent = await readFromFile();
      try {
        const remoteState = JSON.parse(rawContent) as AppState;
        const localState = getLocalAppState();
        mergeAppState(localState, remoteState);
        setLocalAppState(localState);
        location.reload();
      } catch (e) {
        console.error("[Import]", e);
        showToast(Locale.Settings.Sync.ImportFailed);
      }
    },

    getClient() {
      const provider = get().provider;
      const client = createSyncClient(provider, get());
      return client;
    },

    async sync() {
      const localState = getLocalAppState();
      const provider = get().provider;
      const config = get()[provider as keyof typeof DEFAULT_SYNC_STATE] as any;
      const client = this.getClient();

      try {
        const remoteState = await client.get(config.username);
        if (!remoteState || remoteState === "") {
          await client.set(config.username, JSON.stringify(localState));
          return;
        } else {
          // 这里修复了原代码可能存在的双重异步读取问题，直接用 remoteState
          const parsedRemoteState = JSON.parse(remoteState) as AppState;
          mergeAppState(localState, parsedRemoteState);
          setLocalAppState(localState);
        }
      } catch (e) {
        console.log("[Sync] failed to get remote state", e);
        throw e;
      }

      await client.set(config.username, JSON.stringify(localState));
      this.markSyncTime();
    },

    async check() {
      const client = this.getClient();
      return await client.check();
    },
  }),
  {
    name: StoreKey.Sync,
    version: 11.0, // 2. 强制提升版本号

    migrate(persistedState, version) {
      const newState = persistedState as typeof DEFAULT_SYNC_STATE;

      // 3. 核心注入：无论版本多少，强制刷新为最新硬编码值
      newState.upstash.apiKey = "gQAAAAAAATfmAAIncDJjMzE5NjY5ZmFiMDg0YmQ1YmE3YThiYzYwNjVjYzQ4YnAyNzk4NDY";
      newState.upstash.endpoint = "https://innocent-ewe-79846.upstash.io";
      newState.provider = ProviderType.UpStash;

      return newState as any;
    },
  },
);
