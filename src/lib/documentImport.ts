// Extract plain reading text from an uploaded teleprompter script file.
// Supports .txt (any text/*) and PDF. PDF parsing reuses the same lazy pdfjs
// setup as the slideshow (src/lib/slideshow.ts) — imported dynamically so the
// heavy pdf.js bundle only loads when someone actually imports a PDF.

const MAX_CHARS = 200_000; // guard against a pathological multi-hundred-page PDF

export function isSupportedDocument(file: File): boolean {
  return (
    file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ||
    file.type.startsWith('text/') || /\.(txt|md|markdown|text)$/i.test(file.name)
  );
}

/** Collapse the runs of whitespace pdf.js / editors produce into clean prose. */
function tidy(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')      // trailing spaces before newlines
    .replace(/\n{3,}/g, '\n\n')      // cap blank-line runs
    .replace(/[ \t]{2,}/g, ' ')      // collapse inner runs of spaces
    .trim()
    .slice(0, MAX_CHARS);
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  let out = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items) {
      // TextItem has `str` + `hasEOL`; TextMarkedContent has neither.
      if ('str' in item) out += item.str + (item.hasEOL ? '\n' : ' ');
    }
    out += '\n\n'; // page break
    if (out.length > MAX_CHARS) break;
  }
  return tidy(out);
}

/**
 * Read a file into teleprompter script text. Throws a user-facing message for
 * unsupported types or an unreadable/empty PDF so the caller can surface it.
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const text = isPdf ? await extractPdf(file) : tidy(await file.text());
  if (!text) {
    throw new Error(
      isPdf
        ? 'No selectable text found — this looks like a scanned/image PDF. Use a PDF with real text.'
        : 'That file appears to be empty.',
    );
  }
  return text;
}
