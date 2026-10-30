import type { Component } from "solid-js";

export interface SectionModule {
  id: string;
  title: string;
  Header?: Component;
  Body: Component;
  defaultFolded?: boolean;
}
