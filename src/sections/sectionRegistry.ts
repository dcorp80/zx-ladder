import { filesSection } from "./files";
import { keyboardSection } from "./keyboard";
import { machineSection } from "./machine";
import { settingsSection } from "./settings";
import { soundSection } from "./sound";
import type { SectionModule } from "./types";
import { videoSection } from "./video";

export const DEFAULT_SECTION_ORDER: SectionModule[] = [
  machineSection,
  videoSection,
  soundSection,
  keyboardSection,
  filesSection,
  settingsSection,
];

const REGISTRY = new Map(
  DEFAULT_SECTION_ORDER.map((section) => [section.id, section]),
);

export function getSectionModule(id: string): SectionModule | undefined {
  return REGISTRY.get(id);
}

export function defaultSectionIds(): string[] {
  return DEFAULT_SECTION_ORDER.map((section) => section.id);
}

export function defaultSectionFolded(id: string): boolean {
  return REGISTRY.get(id)?.defaultFolded === true;
}
