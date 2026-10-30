import { fireEvent, render } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { SectionFrame } from "./frame";

it("restores collapsed sections and persists explicit reopen requests", () => {
  const first = render(() => (
    <SectionFrame title="Example">Contents</SectionFrame>
  ));
  fireEvent.click(first.getByRole("button", { name: "Collapse Example" }));
  first.unmount();
  const second = render(() => (
    <SectionFrame title="Example">Contents</SectionFrame>
  ));
  expect(second.queryByText("Contents")).toBeNull();
  second.unmount();
  const third = render(() => (
    <SectionFrame title="Example" openRequest={1}>
      Contents
    </SectionFrame>
  ));
  expect(third.getByText("Contents")).toBeInTheDocument();
  expect(localStorage.getItem("zx-ladder:section:example:folded")).toBe(
    "false",
  );
  third.unmount();
});
