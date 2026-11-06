import { expect, it } from "vitest";
import { diskFixture } from "../test/trd";
import { basicTape, trdBasic, trdBoot, trdCatalog, trdGeometry } from "./trd";

it("decodes geometry, boot selection and BASIC trailer separately from lengths", () => {
  const bytes = diskFixture(),
    files = trdCatalog(bytes);
  expect(trdGeometry(bytes)).toEqual({ tracks: 80, sides: 2 });
  expect(trdBoot(files)).toBe(files[0]);
  const basic = trdBasic(bytes, files[0]);
  expect(basic.line).toBe(10);
  expect(basic.data.length).toBe(files[0].parameter);
  expect(basicTape(bytes, files[0]).length).toBeGreaterThan(20);
  bytes[4096 + files[0].parameter + 1] = 0;
  expect(trdBasic(bytes, files[0]).line).toBe(0);
  expect(trdCatalog(bytes)).toHaveLength(1); // Real ROM may still read it.
});
it("uses disk type to distinguish equal-sized one/two sided disks", () => {
  const bytes = new Uint8Array(327680);
  bytes[0x8e3] = 0x17;
  expect(trdGeometry(bytes).sides).toBe(2);
  bytes[0x8e3] = 0x18;
  expect(trdGeometry(bytes).sides).toBe(1);
  bytes[0x8e3] = 0x16;
  expect(trdGeometry(bytes)).toEqual({ tracks: 80, sides: 2 });
  bytes[0x8e3] = 0x19;
  expect(() => trdGeometry(bytes)).toThrow();
});

it("accepts shortened sector-aligned images without rewriting their bytes", () => {
  const bytes = diskFixture().slice(0, 0x1200);
  expect(trdGeometry(bytes)).toEqual({ tracks: 80, sides: 2 });
  expect(trdBasic(bytes, trdCatalog(bytes)[0]).line).toBe(10);
  expect(() => trdGeometry(bytes.slice(0, -1))).toThrow("complete");
  expect(() => trdGeometry(bytes.slice(0, 0x800))).toThrow();
});

it("allows trailer-free BASIC with embedded machine code, retaining only bounds checks", () => {
  const bytes = diskFixture(),
    file = trdCatalog(bytes)[0];
  bytes.fill(0, file.offset + file.parameter, file.offset + file.parameter + 4);
  bytes[file.offset + file.length - 1] = 0; // Loader code is not ordinary BASIC text.
  expect(trdBasic(bytes, file).line).toBe(0);
  expect(() => trdBasic(bytes, { ...file, parameter: 257 })).toThrow("bounds");
});
