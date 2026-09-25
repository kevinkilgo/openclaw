import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { normalizeMSTeamsExcelWorkbookBuffer } from "./xlsx-normalizer.js";

async function makeWorkbook(sheetXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("xl/worksheets/sheet1.xml", sheetXml);
  return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

describe("normalizeMSTeamsExcelWorkbookBuffer", () => {
  it("moves hoisted worksheet metadata inside the worksheet root", async () => {
    const broken = await makeWorkbook(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><dimension ref="A1:C2"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="20" customWidth="1"/></cols><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row></sheetData></worksheet>',
    );

    const result = await normalizeMSTeamsExcelWorkbookBuffer({
      buffer: broken,
      filename: "report.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    expect(result.repaired).toBe(true);
    const zip = await JSZip.loadAsync(result.buffer);
    const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
    expect(sheet).toContain(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C2"/><sheetViews>',
    );
    expect(sheet).toContain(
      '<cols><col min="1" max="1" width="20" customWidth="1"/></cols><sheetData>',
    );
  });

  it("leaves non-workbook buffers unchanged", async () => {
    const buffer = Buffer.from("not a workbook");
    const result = await normalizeMSTeamsExcelWorkbookBuffer({
      buffer,
      filename: "report.txt",
      contentType: "text/plain",
    });

    expect(result.repaired).toBe(false);
    expect(result.buffer).toBe(buffer);
  });
});
