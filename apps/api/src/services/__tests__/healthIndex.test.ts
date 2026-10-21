import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";

vi.mock("@rentular/db", () => ({
  getDb: vi.fn(),
  healthIndexValues: {},
}));

import { parseStatbelCpiFile, extractStatbelCpiText } from "../healthIndex";

const fixture = readFileSync(
  join(__dirname, "fixtures", "cpi-all-base-years-excerpt.txt"),
  "utf8"
);

const HEADER =
  "NM_YR|NM_MTH|MS_CPI_IDX|MS_CPI_INFL|MS_WT_CPI|MS_HLTH_IDX|_FREQ_|NM_BASE_YR|MS_WTHOUT_ENE_IDX|MS_WITHOUT_PTRL_IDX|MS_SMOOTH_IDX";

describe("parseStatbelCpiFile", () => {
  it("fixture really starts with a BOM and uses CRLF", () => {
    expect(fixture.charCodeAt(0)).toBe(0xfeff);
    expect(fixture).toContain("\r\n");
  });

  it("keeps only base 2013 rows with a published health index", () => {
    const rows = parseStatbelCpiFile(fixture);
    expect(rows).toEqual([
      { year: "2025", month: "12", value: "136.69" },
      { year: "2026", month: "08", value: "140.3" },
      { year: "2026", month: "09", value: "140.67" },
    ]);
  });

  it("strips the BOM so the first column is read as NM_YR", () => {
    const rows = parseStatbelCpiFile(fixture);
    expect(rows[0]!.year).toBe("2025");
  });

  it("skips rows whose health index is '.'", () => {
    const rows = parseStatbelCpiFile(fixture);
    expect(rows.find((r) => r.year === "1990")).toBeUndefined();
  });

  it("zero pads single digit months", () => {
    const rows = parseStatbelCpiFile(
      `${HEADER}\n2026|9|141.28|.|1000|140.67|.|2013|.|.|.\n`
    );
    expect(rows).toEqual([{ year: "2026", month: "09", value: "140.67" }]);
  });

  it("tolerates LF only line endings as well as CRLF", () => {
    const lf = fixture.replace(/\r\n/g, "\n");
    expect(parseStatbelCpiFile(lf)).toEqual(parseStatbelCpiFile(fixture));
  });

  it("locates columns by header name, not position", () => {
    const text =
      "NM_BASE_YR|MS_HLTH_IDX|NM_MTH|NM_YR\r\n2013|136.69|12|2025\r\n2025|100.82|12|2025\r\n";
    expect(parseStatbelCpiFile(text)).toEqual([
      { year: "2025", month: "12", value: "136.69" },
    ]);
  });

  it("throws on an unexpected header", () => {
    expect(() => parseStatbelCpiFile("foo|bar\n1|2\n")).toThrow();
  });
});

describe("extractStatbelCpiText", () => {
  it("reads the CPI text file out of a zip archive", () => {
    const zip = zipSync({
      "readme.md": strToU8("not this one"),
      "CPI All base years.txt": strToU8(fixture),
    });
    const text = extractStatbelCpiText(zip);
    expect(parseStatbelCpiFile(text)).toHaveLength(3);
  });

  it("falls back to the first .txt entry", () => {
    const zip = zipSync({ "other.txt": strToU8(fixture) });
    expect(parseStatbelCpiFile(extractStatbelCpiText(zip))).toHaveLength(3);
  });

  it("throws when the zip has no .txt file", () => {
    const zip = zipSync({ "data.csv": strToU8("x") });
    expect(() => extractStatbelCpiText(zip)).toThrow();
  });
});
