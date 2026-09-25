import JSZip from "jszip";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const WORKSHEET_PATH_RE = /^xl\/worksheets\/sheet\d+\.xml$/u;
const XML_DECL_RE = /^<\?xml\s+[^>]*\?>/u;
const HOISTABLE_WORKSHEET_CHILD_RE =
  /^(?:(?:<dimension\b[^>]*\/>|<sheetViews\b[\s\S]*?<\/sheetViews>|<sheetFormatPr\b[^>]*\/>|<cols\b[\s\S]*?<\/cols>)\s*)+/u;

function isExcelWorkbook(params: { filename?: string; contentType?: string }): boolean {
  const filename = params.filename?.toLowerCase();
  const contentType = params.contentType?.toLowerCase();
  return filename?.endsWith(".xlsx") === true || contentType === XLSX_MIME;
}

function moveHoistedWorksheetChildrenInsideRoot(xml: string): { xml: string; changed: boolean } {
  const declaration = XML_DECL_RE.exec(xml)?.[0] ?? "";
  const bodyStart = declaration.length;
  const worksheetStart = xml.indexOf("<worksheet", bodyStart);
  if (worksheetStart < 0) {
    return { xml, changed: false };
  }

  const beforeWorksheet = xml.slice(bodyStart, worksheetStart);
  const hoisted = HOISTABLE_WORKSHEET_CHILD_RE.exec(beforeWorksheet.trimStart())?.[0];
  if (!hoisted) {
    return { xml, changed: false };
  }

  const worksheetOpenEnd = xml.indexOf(">", worksheetStart);
  if (worksheetOpenEnd < 0) {
    return { xml, changed: false };
  }

  const normalizedHoisted = hoisted.trim();
  const nextXml = `${declaration}${xml.slice(worksheetStart, worksheetOpenEnd + 1)}${normalizedHoisted}${xml.slice(
    worksheetOpenEnd + 1,
  )}`;
  return { xml: nextXml, changed: true };
}

export async function normalizeMSTeamsExcelWorkbookBuffer(params: {
  buffer: Buffer;
  filename?: string;
  contentType?: string;
}): Promise<{ buffer: Buffer; repaired: boolean }> {
  if (!isExcelWorkbook(params)) {
    return { buffer: params.buffer, repaired: false };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(params.buffer);
  } catch {
    return { buffer: params.buffer, repaired: false };
  }

  let repaired = false;
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !WORKSHEET_PATH_RE.test(path)) {
      continue;
    }
    const raw = await entry.async("string");
    const normalized = moveHoistedWorksheetChildrenInsideRoot(raw);
    if (normalized.changed) {
      zip.file(path, normalized.xml);
      repaired = true;
    }
  }

  if (!repaired) {
    return { buffer: params.buffer, repaired: false };
  }

  return {
    buffer: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    repaired: true,
  };
}
