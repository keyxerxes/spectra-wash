import type { DetectedSignature, ForensicReport, MetadataChunk } from '../types/spectra';

const ASCII_DECODER = new TextDecoder('latin1');

interface SignatureRule {
  pattern: RegExp;
  vendor: string;
  tag: string;
  category: DetectedSignature['category'];
  severity: DetectedSignature['severity'];
}

const SIGNATURE_RULES: SignatureRule[] = [
  {
    pattern: /c2pa\.actions|c2pa\.assertions|c2pa\.ai_generated|urn:c2pa|jumbc2pa|c2pa/i,
    vendor: 'C2PA Coalition',
    tag: 'C2PA Content Credentials (JUMBF)',
    category: 'C2PA Content Credentials',
    severity: 'high',
  },
  {
    pattern: /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia/i,
    vendor: 'IPTC / C2PA',
    tag: 'trainedAlgorithmicMedia',
    category: 'AI Provenance Marker',
    severity: 'high',
  },
  {
    pattern: /Made with Google AI|SynthID|Google LLC|Imagen/i,
    vendor: 'Google',
    tag: 'Google AI / SynthID Provenance',
    category: 'AI Provenance Marker',
    severity: 'high',
  },
  {
    pattern: /OpenAI|DALL[- ]?E|ChatGPT|Truepic/i,
    vendor: 'OpenAI',
    tag: 'OpenAI / DALL·E Manifest',
    category: 'AI Provenance Marker',
    severity: 'high',
  },
  {
    pattern: /Adobe Firefly|Firefly|Adobe Content Authenticity/i,
    vendor: 'Adobe',
    tag: 'Adobe Firefly Credentials',
    category: 'AI Provenance Marker',
    severity: 'high',
  },
  {
    pattern: /Midjourney/i,
    vendor: 'Midjourney',
    tag: 'Midjourney Generator Tag',
    category: 'Generator Parameters',
    severity: 'high',
  },
  {
    pattern: /ComfyUI|Automatic1111|Stable Diffusion|Steps:\s*\d+,\s*Sampler:/i,
    vendor: 'Diffusion Pipeline',
    tag: 'Prompt / Sampler Parameters',
    category: 'Generator Parameters',
    severity: 'medium',
  },
  {
    pattern: /Adobe Photoshop|Lightroom|GIMP|Affinity/i,
    vendor: 'Editorial Suite',
    tag: 'Software History Tag',
    category: 'Editing Software',
    severity: 'info',
  },
];

function extractPrintableSnippet(bytes: Uint8Array, maxLen = 140): string {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  const raw = ASCII_DECODER.decode(sample);
  const cleaned = raw.replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned;
}

function scanBytesForSignatures(
  bytes: Uint8Array,
  seenKeys: Set<string>,
  signatures: DetectedSignature[],
): boolean {
  // Limit single chunk text scan to 512 KB for instant UI responsiveness
  const slice = bytes.length > 524288 ? bytes.subarray(0, 524288) : bytes;
  const text = ASCII_DECODER.decode(slice);
  let matchedAny = false;

  for (const rule of SIGNATURE_RULES) {
    const match = rule.pattern.exec(text);
    if (match) {
      matchedAny = true;
      const key = `${rule.vendor}:${rule.tag}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        const start = Math.max(0, match.index - 24);
        const end = Math.min(text.length, match.index + match[0].length + 48);
        const evidence = text
          .slice(start, end)
          .replace(/[^\x20-\x7e]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        signatures.push({
          vendor: rule.vendor,
          tag: rule.tag,
          category: rule.category,
          severity: rule.severity,
          evidence: evidence || match[0],
        });
      }
    }
  }
  return matchedAny;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function parsePng(bytes: Uint8Array): ForensicReport {
  const chunks: MetadataChunk[] = [];
  const signatures: DetectedSignature[] = [];
  const seenKeys = new Set<string>();

  let offset = 8; // After 8-byte PNG signature
  let chunkIndex = 0;
  let idatCount = 0;
  let idatTotalBytes = 0;
  let firstIdatOffset = 0;

  while (offset + 12 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = ASCII_DECODER.decode(bytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = Math.min(bytes.length, dataStart + length);
    const payload = bytes.subarray(dataStart, dataEnd);

    if (type === 'IDAT') {
      if (idatCount === 0) firstIdatOffset = offset;
      idatCount++;
      idatTotalBytes += length;
      offset = dataStart + length + 4;
      continue;
    }

    let category: MetadataChunk['category'] = 'ancillary';
    let summary = 'Ancillary chunk';
    let flagged = false;
    let rawSnippet: string | undefined;

    if (type === 'IHDR' || type === 'PLTE' || type === 'IEND') {
      category = 'critical';
      summary =
        type === 'IHDR'
          ? 'Image header (dimensions, bit depth, color type)'
          : type === 'IEND'
            ? 'Image trailer (end of stream)'
            : 'Indexed color palette';
    } else if (type === 'eXIf') {
      category = 'exif';
      summary = 'Embedded EXIF metadata profile';
      flagged = true;
      rawSnippet = extractPrintableSnippet(payload);
      scanBytesForSignatures(payload, seenKeys, signatures);
    } else if (type === 'caBX' || type === 'jumb') {
      category = 'c2pa';
      summary = 'C2PA / JUMBF Content Credentials box';
      flagged = true;
      rawSnippet = extractPrintableSnippet(payload);
      scanBytesForSignatures(payload, seenKeys, signatures);
    } else if (type === 'iTXt' || type === 'tEXt' || type === 'zTXt') {
      const snippet = extractPrintableSnippet(payload);
      const isXmp = /XML:com\.adobe\.xmp|xmpmeta/i.test(snippet);
      category = isXmp ? 'xmp' : 'text';
      summary = isXmp
        ? 'Embedded XMP XML metadata packet'
        : `PNG text chunk (${type})`;
      rawSnippet = snippet;
      scanBytesForSignatures(payload, seenKeys, signatures);
      flagged = true;
    } else if (type === 'iCCP' || type === 'sRGB' || type === 'gAMA' || type === 'cHRM') {
      category = 'color';
      summary =
        type === 'iCCP'
          ? 'Embedded ICC color profile'
          : `Color space metadata (${type})`;
    } else if (type === 'pHYs') {
      category = 'ancillary';
      summary = 'Physical pixel dimensions (DPI)';
    } else {
      const sigMatch = scanBytesForSignatures(payload, seenKeys, signatures);
      if (sigMatch) flagged = true;
    }

    chunks.push({
      id: `png-${chunkIndex++}-${type}`,
      type,
      category,
      offset,
      size: length,
      summary,
      rawSnippet,
      flagged,
    });

    offset = dataStart + length + 4;
    if (type === 'IEND') break;
  }

  if (idatCount > 0) {
    // Insert aggregated IDAT summary before IEND
    const iendIdx = chunks.findIndex((c) => c.type === 'IEND');
    const idatEntry: MetadataChunk = {
      id: 'png-idat-stream',
      type: `IDAT ×${idatCount}`,
      category: 'critical',
      offset: firstIdatOffset,
      size: idatTotalBytes,
      summary: 'Compressed lossless RGBA pixel stream',
      flagged: false,
    };
    if (iendIdx >= 0) {
      chunks.splice(iendIdx, 0, idatEntry);
    } else {
      chunks.push(idatEntry);
    }
  }

  return buildReport('PNG', bytes.length, chunks, signatures);
}

function parseJpeg(bytes: Uint8Array): ForensicReport {
  const chunks: MetadataChunk[] = [];
  const signatures: DetectedSignature[] = [];
  const seenKeys = new Set<string>();

  let offset = 2; // Skip SOI (FF D8)
  let segIndex = 0;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) break;

    const marker = bytes[offset];
    const segOffset = offset - 1;
    offset++;

    if (marker === 0xd9) {
      // EOI
      break;
    }
    if (marker === 0xda) {
      // SOS (Start of Scan) - compressed image data follows
      chunks.push({
        id: `jpg-sos-${segIndex++}`,
        type: 'SOS',
        category: 'critical',
        offset: segOffset,
        size: Math.max(0, bytes.length - segOffset),
        summary: 'Entropy-coded JPEG scan payload',
        flagged: false,
      });
      break;
    }

    if (offset + 2 > bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    const dataStart = offset + 2;
    const dataEnd = Math.min(bytes.length, offset + length);
    const payload = bytes.subarray(dataStart, dataEnd);

    if (marker >= 0xe0 && marker <= 0xef) {
      const appNum = marker - 0xe0;
      const type = `APP${appNum}`;
      const headerStr = ASCII_DECODER.decode(payload.subarray(0, Math.min(payload.length, 40)));
      const snippet = extractPrintableSnippet(payload);
      const sigMatch = scanBytesForSignatures(payload, seenKeys, signatures);

      let category: MetadataChunk['category'] = 'ancillary';
      let summary = `Application segment ${type}`;
      let flagged = sigMatch;

      if (appNum === 0 && headerStr.startsWith('JFIF')) {
        category = 'critical';
        summary = 'JFIF container header';
      } else if (appNum === 1 && headerStr.startsWith('Exif')) {
        category = 'exif';
        summary = 'EXIF camera / software metadata';
        flagged = true;
      } else if (appNum === 1 && headerStr.includes('ns.adobe.com/xap')) {
        category = 'xmp';
        summary = 'XMP XML provenance & editing packet';
        flagged = true;
      } else if (appNum === 2 && headerStr.startsWith('ICC_PROFILE')) {
        category = 'color';
        summary = 'Embedded ICC color profile';
      } else if (appNum === 11 || /jumb|c2pa/i.test(headerStr) || /c2pa/i.test(snippet)) {
        category = 'c2pa';
        summary = 'JUMBF / C2PA Content Credentials container';
        flagged = true;
      } else if (appNum === 13 && /Photoshop|8BIM/i.test(headerStr)) {
        category = 'iptc';
        summary = 'IPTC / Photoshop Image Resource Block';
        flagged = true;
      } else if (appNum === 14 && headerStr.startsWith('Adobe')) {
        category = 'color';
        summary = 'Adobe color transform header';
      }

      chunks.push({
        id: `jpg-${segIndex++}-${type}`,
        type,
        category,
        offset: segOffset,
        size: length,
        summary,
        rawSnippet: category === 'critical' || category === 'color' ? undefined : snippet,
        flagged,
      });
    } else if (marker === 0xfe) {
      const snippet = extractPrintableSnippet(payload);
      scanBytesForSignatures(payload, seenKeys, signatures);
      chunks.push({
        id: `jpg-${segIndex++}-COM`,
        type: 'COM',
        category: 'text',
        offset: segOffset,
        size: length,
        summary: 'JPEG text comment segment',
        rawSnippet: snippet,
        flagged: true,
      });
    } else if (marker === 0xc0 || marker === 0xc2) {
      chunks.push({
        id: `jpg-${segIndex++}-SOF`,
        type: marker === 0xc0 ? 'SOF0' : 'SOF2',
        category: 'critical',
        offset: segOffset,
        size: length,
        summary: marker === 0xc0 ? 'Baseline DCT frame header' : 'Progressive DCT frame header',
        flagged: false,
      });
    }

    offset += Math.max(2, length);
  }

  return buildReport('JPEG', bytes.length, chunks, signatures);
}

function parseWebp(bytes: Uint8Array): ForensicReport {
  const chunks: MetadataChunk[] = [];
  const signatures: DetectedSignature[] = [];
  const seenKeys = new Set<string>();

  let offset = 12; // Skip RIFF + size + WEBP
  let chunkIndex = 0;

  while (offset + 8 <= bytes.length) {
    const type = ASCII_DECODER.decode(bytes.subarray(offset, offset + 4));
    const size = readUint32LE(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = Math.min(bytes.length, dataStart + size);
    const payload = bytes.subarray(dataStart, dataEnd);

    let category: MetadataChunk['category'] = 'ancillary';
    let summary = `WebP chunk (${type.trim()})`;
    let flagged = false;
    let rawSnippet: string | undefined;

    if (type === 'VP8 ' || type === 'VP8L' || type === 'VP8X' || type === 'ALPH') {
      category = 'critical';
      summary =
        type === 'VP8L'
          ? 'Lossless WebP bitstream'
          : type === 'VP8 '
            ? 'Lossy WebP bitstream'
            : type === 'VP8X'
              ? 'Extended WebP feature header'
              : 'Alpha channel bitstream';
    } else if (type === 'EXIF') {
      category = 'exif';
      summary = 'Embedded EXIF metadata chunk';
      flagged = true;
      rawSnippet = extractPrintableSnippet(payload);
      scanBytesForSignatures(payload, seenKeys, signatures);
    } else if (type === 'XMP ') {
      category = 'xmp';
      summary = 'Embedded XMP XML metadata chunk';
      flagged = true;
      rawSnippet = extractPrintableSnippet(payload);
      scanBytesForSignatures(payload, seenKeys, signatures);
    } else if (type === 'ICCP') {
      category = 'color';
      summary = 'Embedded ICC color profile';
    } else if (type === 'C2PA' || type === 'JUMB') {
      category = 'c2pa';
      summary = 'C2PA Content Credentials chunk';
      flagged = true;
      rawSnippet = extractPrintableSnippet(payload);
      scanBytesForSignatures(payload, seenKeys, signatures);
    } else {
      const sigMatch = scanBytesForSignatures(payload, seenKeys, signatures);
      if (sigMatch) {
        flagged = true;
        rawSnippet = extractPrintableSnippet(payload);
      }
    }

    chunks.push({
      id: `webp-${chunkIndex++}-${type.trim()}`,
      type: type.trim(),
      category,
      offset,
      size,
      summary,
      rawSnippet,
      flagged,
    });

    // RIFF chunks are padded to even byte boundaries
    offset = dataStart + size + (size % 2);
  }

  return buildReport('WEBP', bytes.length, chunks, signatures);
}

function buildReport(
  containerFormat: ForensicReport['containerFormat'],
  fileSizeBytes: number,
  chunks: MetadataChunk[],
  signatures: DetectedSignature[],
): ForensicReport {
  const metadataChunks = chunks.filter(
    (c) =>
      c.category === 'exif' ||
      c.category === 'xmp' ||
      c.category === 'iptc' ||
      c.category === 'c2pa' ||
      c.category === 'text',
  );

  const hasC2PA =
    chunks.some((c) => c.category === 'c2pa') ||
    signatures.some((s) => s.category === 'C2PA Content Credentials');
  const hasExif = chunks.some((c) => c.category === 'exif');
  const hasXmp = chunks.some((c) => c.category === 'xmp');
  const hasIptc = chunks.some((c) => c.category === 'iptc');

  const highRiskSig = signatures.some((s) => s.severity === 'high' || s.severity === 'medium');
  const status: ForensicReport['status'] =
    hasC2PA || highRiskSig
      ? 'ai-signatures-detected'
      : metadataChunks.length > 0
        ? 'metadata-present'
        : 'clean';

  return {
    containerFormat,
    fileSizeBytes,
    totalChunks: chunks.length,
    metadataChunksCount: metadataChunks.length,
    chunks,
    signatures,
    status,
    hasC2PA,
    hasExif,
    hasXmp,
    hasIptc,
  };
}

/**
 * Pure client-side binary container inspector for PNG, JPEG, and WebP files.
 */
export function inspectBinaryMetadata(buffer: ArrayBuffer): ForensicReport {
  const bytes = new Uint8Array(buffer);

  // PNG magic: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return parsePng(bytes);
  }

  // JPEG magic: FF D8
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return parseJpeg(bytes);
  }

  // WEBP magic: RIFF .... WEBP
  if (
    bytes.length >= 12 &&
    ASCII_DECODER.decode(bytes.subarray(0, 4)) === 'RIFF' &&
    ASCII_DECODER.decode(bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return parseWebp(bytes);
  }

  // Fallback raw scan
  const signatures: DetectedSignature[] = [];
  scanBytesForSignatures(bytes, new Set<string>(), signatures);
  return buildReport('UNKNOWN', bytes.length, [], signatures);
}
