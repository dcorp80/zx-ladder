import { type Component, createEffect, createSignal, type JSX } from "solid-js";

export interface SectionFrameProps {
  title: string;
  subtitle?: string;
  defaultFolded?: boolean;
  children: JSX.Element;
  actions?: JSX.Element;
  openRequest?: number;
}

export const SectionFrame: Component<SectionFrameProps> = (props) => {
  const storageKey = `zx-ladder:section:${props.title.toLowerCase()}:folded`;
  const initial = () => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) return saved === "true";
    } catch {}
    return props.defaultFolded === true;
  };
  const [folded, setFolded] = createSignal(initial());
  createEffect(() => {
    const value = folded();
    try {
      localStorage.setItem(storageKey, String(value));
    } catch {}
  });
  createEffect(() => {
    if (props.openRequest) setFolded(false);
  });
  return (
    <section class="section-frame" classList={{ "is-folded": folded() }}>
      <header class="section-header">
        <button
          type="button"
          class="fold-chevron"
          aria-label={
            folded() ? `Expand ${props.title}` : `Collapse ${props.title}`
          }
          aria-expanded={!folded()}
          onClick={() => setFolded((value) => !value)}
        >
          {folded() ? "▸" : "▾"}
        </button>
        <div class="section-heading">
          <h2 class="section-title">{props.title}</h2>
          {props.subtitle && (
            <span class="section-subtitle">{props.subtitle}</span>
          )}
        </div>
        <div class="section-actions">{props.actions}</div>
      </header>
      {!folded() && <div class="section-body">{props.children}</div>}
    </section>
  );
};
