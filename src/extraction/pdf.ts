import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  StandardFonts,
  rgb,
} from "pdf-lib";
import type { PdfInput } from "../core/types";

// ============================================================================
// Type Guards for PdfInput
// ============================================================================

/** Check if input is a file ID reference object */
function isFileIdRef(input: PdfInput): input is { fileId: string; mimeType?: string } {
  return typeof input === "object" && input !== null && "fileId" in input;
}

/** Check if input is a URL */
function isUrl(input: PdfInput): input is URL {
  return input instanceof URL;
}

/** Check if input is raw bytes */
function isBytes(input: PdfInput): input is Uint8Array {
  return input instanceof Uint8Array;
}

// ============================================================================
// PdfInput Utilities
// ============================================================================

/**
 * Normalize PdfInput to Uint8Array bytes.
 * For fileId references or remote URLs, this will throw an error since
 * those should be handled by the provider callback directly.
 */
export async function pdfInputToBytes(input: PdfInput): Promise<Uint8Array> {
  if (isFileIdRef(input)) {
    throw new Error(
      "Cannot convert fileId reference to bytes. " +
        "Pass the fileId directly to your provider callback instead."
    );
  }

  if (isUrl(input)) {
    if (input.protocol === "file:") {
      // Node.js environment - use fs
      if (typeof process !== "undefined" && process.versions?.node) {
        const fs = await import("fs/promises");
        const buffer = await fs.readFile(input.pathname);
        return new Uint8Array(buffer);
      }
      throw new Error("File URLs not supported in browser environment");
    }
    // HTTP(S) URL - fetch it
    const response = await fetch(input.toString());
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  if (isBytes(input)) {
    return input;
  }

  // Base64 string
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(input, "base64"));
  }
  // Browser fallback
  return Uint8Array.from(atob(input), (c) => c.charCodeAt(0));
}

/**
 * Convert PdfInput to base64 string.
 * Note: This may negate memory benefits of fileId/URL inputs.
 * Prefer using pdfInputToBytes when possible.
 */
export async function pdfInputToBase64(input: PdfInput): Promise<string> {
  if (isFileIdRef(input)) {
    throw new Error(
      "Cannot convert fileId reference to base64. " +
        "Pass the fileId directly to your provider callback instead."
    );
  }

  if (isUrl(input)) {
    const bytes = await pdfInputToBytes(input);
    return bytesToBase64(bytes);
  }

  if (isBytes(input)) {
    return bytesToBase64(input);
  }

  // Already base64 string
  return input;
}

/** Convert bytes to base64 string */
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  // Browser fallback
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Check if the PdfInput is a file reference that can be passed directly
 * to provider APIs (fileId or URL) without base64 conversion.
 */
export function isFileReference(input: PdfInput): boolean {
  return isFileIdRef(input) || isUrl(input);
}

/**
 * Get a file identifier from PdfInput if available.
 * Returns undefined for base64/bytes that need to be passed as data.
 */
export function getFileIdentifier(input: PdfInput): { fileId?: string; url?: string } | undefined {
  if (isFileIdRef(input)) {
    return { fileId: input.fileId };
  }
  if (isUrl(input)) {
    return { url: input.toString() };
  }
  return undefined;
}

/**
 * Get the page count of a PDF from any PdfInput type.
 */
export async function getPdfPageCount(input: PdfInput): Promise<number> {
  const bytes = await pdfInputToBytes(input);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

/**
 * Extract a page range from a PDF and return as base64.
 * Used to reduce API token usage by only sending relevant pages.
 *
 * @param input - PDF as PdfInput (base64 string, URL, bytes, or fileId).
 * @param startPage - First page to include (1-indexed).
 * @param endPage - Last page to include (1-indexed, clamped to total pages).
 * @returns Base64 string of the trimmed PDF, or original base64 if range covers all pages.
 * @throws Error if input is a fileId reference or non-file URL (cannot extract pages from remote reference).
 */
export async function extractPageRange(
  input: PdfInput,
  startPage: number,
  endPage: number,
): Promise<string> {
  if (isFileIdRef(input)) {
    throw new Error(
      "Cannot extract page range from fileId reference. " +
        "The provider must handle fileId inputs directly or you must pass the full PDF as base64/bytes."
    );
  }

  if (isUrl(input) && (input.protocol === "http:" || input.protocol === "https:")) {
    throw new Error(
      "Cannot extract page range from remote URL. " +
        "Either pass the full PDF as base64/bytes, or download it first."
    );
  }

  const srcBytes = await pdfInputToBytes(input);
  const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const start = Math.max(startPage - 1, 0); // 0-indexed
  const end = Math.min(endPage, totalPages) - 1; // 0-indexed

  if (start === 0 && end >= totalPages - 1) {
    // Return original format if no splitting needed
    if (isBytes(input)) {
      return bytesToBase64(input);
    }
    if (typeof input === "string") {
      return input;
    }
    return bytesToBase64(srcBytes);
  }

  const newDoc = await PDFDocument.create();
  const indices = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const pages = await newDoc.copyPages(srcDoc, indices);
  pages.forEach((page) => newDoc.addPage(page));
  const bytes = await newDoc.save();

  return bytesToBase64(new Uint8Array(bytes));
}

/**
 * Build provider options for passing PDF content to generateObject callbacks.
 * This chooses the most efficient representation based on the input type.
 *
 * @param input - The PdfInput to pass to the provider.
 * @param existingOptions - Existing providerOptions to merge with.
 * @returns Provider options with appropriate pdf* fields set.
 */
export async function buildPdfProviderOptions(
  input: PdfInput,
  existingOptions?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const options: Record<string, unknown> = { ...existingOptions };

  if (isFileIdRef(input)) {
    options.fileId = input.fileId;
    if (input.mimeType) {
      options.fileMimeType = input.mimeType;
    }
    return options;
  }

  if (isUrl(input)) {
    options.pdfUrl = input;
    return options;
  }

  options.pdfBase64 = await pdfInputToBase64(input);
  return options;
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

