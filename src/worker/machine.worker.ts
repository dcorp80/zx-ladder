import { WorkerEngine } from "./engine";
import type { FromWorker, ToWorker } from "./protocol";

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};
const engine = new WorkerEngine((message, transfer = []) =>
  scope.postMessage(message, transfer),
);
scope.onmessage = (event) => engine.receive(event.data);
