import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  StandardFonts,
  rgb,
} from "pdf-lib";

/**
 * Extract a page range from a PDF and return as base64.
 * Used to reduce API token usage by only sending relevant pages.
 *
 * @param pdfBase64 - Full PDF as base64 string.
 * @param startPage - First page to include (1-indexed).
 * @param endPage - Last page to include (1-indexed, clamped to total pages).
 * @returns Base64 string of the trimmed PDF, or original if range covers all pages.
 */
export async function extractPageRange(
  pdfBase64: string,
  startPage: number,
  endPage: number,
): Promise<string> {
  const srcBytes = typeof Buffer !== "undefined"
    ? Buffer.from(pdfBase64, "base64")
    : Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
  const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const start = Math.max(startPage - 1, 0); // 0-indexed
  const end = Math.min(endPage, totalPages) - 1; // 0-indexed

  if (start === 0 && end >= totalPages - 1) {
    return pdfBase64; // No point splitting if we want all pages
  }

  const newDoc = await PDFDocument.create();
  const indices = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const pages = await newDoc.copyPages(srcDoc, indices);
  pages.forEach((page) => newDoc.addPage(page));
  const bytes = await newDoc.save();

  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  // Browser fallback
  let binary = "";
  const uint8 = new Uint8Array(bytes);
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

/**
 * Get the page count of a PDF without fully parsing it.
 */
export async function getPdfPageCount(pdfBase64: string): Promise<number> {
  const srcBytes = typeof Buffer !== "undefined"
    ? Buffer.from(pdfBase64, "base64")
    : Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
  const doc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

export interface AcroFormFieldInfo {
  name: string;
  type: "text" | "checkbox" | "dropdown" | "radio";
  options?: string[];
}

/** Enumerate all AcroForm fields from a PDF. Returns empty array if no form. */
export function getAcroFormFields(pdfDoc: PDFDocument): AcroFormFieldInfo[] {
  const form = pdfDoc.getForm();
  const fields = form.getFields();
  if (fields.length === 0) return [];

  return fields.map((field) => {
    const name = field.getName();
    if (field instanceof PDFTextField) {
      return { name, type: "text" as const };
    }
    if (field instanceof PDFCheckBox) {
      return { name, type: "checkbox" as const };
    }
    if (field instanceof PDFDropdown) {
      return { name, type: "dropdown" as const, options: field.getOptions() };
    }
    if (field instanceof PDFRadioGroup) {
      return { name, type: "radio" as const, options: field.getOptions() };
    }
    return { name, type: "text" as const };
  });
}

export interface FieldMapping {
  acroFormName: string;
  value: string;
}

/** Fill AcroForm fields by mapping, flatten, and return bytes. */
export async function fillAcroForm(
  pdfBytes: Uint8Array,
  mappings: FieldMapping[],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();

  for (const { acroFormName, value } of mappings) {
    try {
      const field = form.getField(acroFormName);
      if (field instanceof PDFTextField) {
        field.setText(value);
      } else if (field instanceof PDFCheckBox) {
        const lower = value.toLowerCase();
        if (["yes", "true", "x", "checked", "on"].includes(lower)) {
          field.check();
        } else {
          field.uncheck();
        }
      } else if (field instanceof PDFDropdown) {
        try {
          field.select(value);
        } catch {
          // Value not in options — skip
        }
      } else if (field instanceof PDFRadioGroup) {
        try {
          field.select(value);
        } catch {
          // Value not in options — skip
        }
      }
    } catch {
      // Field not found or other error — skip
    }
  }

  form.flatten();
  return await pdfDoc.save();
}

export interface TextOverlay {
  page: number; // 0-indexed page number
  x: number; // percentage from left edge (0-100)
  y: number; // percentage from top edge (0-100)
  text: string;
  fontSize?: number;
  isCheckmark?: boolean;
}

/** Overlay text on a flat PDF at specified coordinates. */
export async function overlayTextOnPdf(
  pdfBytes: Uint8Array,
  overlays: TextOverlay[],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pageCount = pdfDoc.getPageCount();

  for (const overlay of overlays) {
    if (overlay.page < 0 || overlay.page >= pageCount) continue;
    const page = pdfDoc.getPage(overlay.page);
    const { width, height } = page.getSize();
    const fontSize = overlay.fontSize ?? 10;

    // Convert top-left percentage coordinates to pdf-lib bottom-left point coordinates
    const x = (overlay.x / 100) * width;
    const y = height - (overlay.y / 100) * height - fontSize;

    if (overlay.isCheckmark) {
      // Draw a checkmark or X for checkbox fields
      page.drawText("X", {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    } else {
      page.drawText(overlay.text, {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }

  return await pdfDoc.save();
}

