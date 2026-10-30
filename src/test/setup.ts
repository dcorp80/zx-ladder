import { beforeEach, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

// Unit tests opt into bundled firmware explicitly; never fetch network assets.
vi.mock("../rom/bundledRom", () => ({
  loadBundledRom: vi.fn(async () => null),
}));
