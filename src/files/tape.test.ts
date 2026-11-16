import { expect, it } from "vitest";
import { basicTapFixture } from "../test/tape";
import { parseTape, tapeCatalog } from "./tape";

it("decodes only complete Spectrum headers and sanitizes their names", () => {
  const [header, data] = parseTape(basicTapFixture());
  for (const [type, label] of [
    "Program",
    "Number array",
    "Character array",
    "Bytes",
  ].entries()) {
    header.payload[0] = type;
    header.payload[1] = 0x01;
    expect(tapeCatalog([header])[0]).toMatchObject({
      name: "?oot",
      type: `${label} header`,
      bytes: 17,
      header: true,
    });
  }
  header.flag = 255;
  expect(tapeCatalog([header])[0].header).toBe(false);
  header.flag = 0;
  header.payload = header.payload.slice(0, 16);
  expect(tapeCatalog([header])[0].header).toBe(false);
  data.checksumValid = false;
  expect(tapeCatalog([data])[0]).toMatchObject({
    name: null,
    type: "Data",
    checksumValid: false,
  });
});

it("offers Run only for BASIC headers followed by complete matching data", () => {
  const [header, data] = parseTape(basicTapFixture());
  expect(tapeCatalog([header, data]).map((b) => b.runnable)).toEqual([
    true,
    false,
  ]);
  for (const type of [1, 2, 3]) {
    header.payload[0] = type;
    expect(tapeCatalog([header, data])[0].runnable).toBe(false);
  }
  header.payload[0] = 0;
  expect(tapeCatalog([header])[0].runnable).toBe(false);
  header.checksumValid = false;
  expect(tapeCatalog([header, data])[0].runnable).toBe(false);
  header.checksumValid = true;
  data.checksumValid = false;
  expect(tapeCatalog([header, data])[0].runnable).toBe(false);
  data.checksumValid = true;
  data.flag = 0;
  expect(tapeCatalog([header, data])[0].runnable).toBe(false);
  data.flag = 255;
  data.payload = data.payload.slice(1);
  expect(tapeCatalog([header, data])[0].runnable).toBe(false);
});
