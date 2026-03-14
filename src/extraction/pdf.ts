import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  StandardFonts,
  rgb,
} from "pdf-lib";

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

