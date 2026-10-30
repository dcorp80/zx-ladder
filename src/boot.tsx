import type { JSX } from "solid-js";
import { App } from "./app";
import {
  type CreateStoreDeps,
  createAppStore,
  type Store,
  StoreProvider,
} from "./store";

export interface BootOptions extends CreateStoreDeps {}

export interface BootedApp {
  store: Store;
  ui: () => JSX.Element;
  dispose: () => void;
}

export async function bootApp(options: BootOptions = {}): Promise<BootedApp> {
  const store = await createAppStore(options);
  const ui = (): JSX.Element => (
    <StoreProvider value={store}>
      <App />
    </StoreProvider>
  );
  return { store, ui, dispose: () => store.dispose() };
}
