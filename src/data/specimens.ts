import archUrl from '../assets/images/specimen_architecture_1795518469051.jpg';
import opticsUrl from '../assets/images/specimen_macro_optics_1795518474246.jpg';

export interface SpecimenAsset {
  id: string;
  name: string;
  filename: string;
  url: string;
  profile: string;
}

export const SPECIMEN_ASSETS: SpecimenAsset[] = [
  {
    id: 'architecture',
    name: 'Horizon Pavilion',
    filename: 'horizon_pavilion_sample.jpg',
    url: archUrl,
    profile: 'Flat twilight sky + fine concrete micro-texture',
  },
  {
    id: 'optics',
    name: 'Anodized Optics',
    filename: 'anodized_optics_sample.jpg',
    url: opticsUrl,
    profile: 'Deep bokeh shadows + knurled metal & carbon weave',
  },
];

/**
 * Injects an explicit, synthetic test carrier (weak periodic 2D sinusoidal watermark
 * in mid-high spatial frequencies) into a pixel buffer ONLY when the user opts into
 * "Test Carrier" mode on a built-in specimen to empirically observe 2D FFT peak suppression.
 */
export function applySyntheticTestCarrier(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  // Dual conjugate spatial frequencies typical of invisible frequency-domain carriers
  const fx1 = (2 * Math.PI * 34) / 256;
  const fy1 = (2 * Math.PI * 22) / 256;
  const fx2 = (2 * Math.PI * -26) / 256;
  const fy2 = (2 * Math.PI * 42) / 256;
  const strength = 2.6; // Subtle ~1% luminance carrier (barely visible, crisp in 2D FFT)

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x * 4;
      const carrier =
        strength *
        (0.55 * Math.sin(fx1 * x + fy1 * y) + 0.45 * Math.cos(fx2 * x + fy2 * y));
      out[idx] = Math.max(0, Math.min(255, Math.round(out[idx] + carrier)));
      out[idx + 1] = Math.max(0, Math.min(255, Math.round(out[idx + 1] + carrier)));
      out[idx + 2] = Math.max(0, Math.min(255, Math.round(out[idx + 2] + carrier)));
    }
  }
  return out;
}

/**
 * Appends synthetic JPEG APP1 (XMP) and APP11 (JUMBF/C2PA) metadata segments into a
 * specimen JPEG byte stream strictly for demonstrating client-side forensic detection
 * and post-wash scrubbing when "Test Carrier" mode is enabled on built-in specimens.
 */
export function injectSyntheticJpegProvenance(originalBytes: Uint8Array): Uint8Array {
  // Verify JPEG SOI marker (0xFF 0xD8)
  if (originalBytes.length < 4 || originalBytes[0] !== 0xff || originalBytes[1] !== 0xd8) {
    return originalBytes;
  }

  const encoder = new TextEncoder();

  const xmpPayload = encoder.encode(
    'http://ns.adobe.com/xap/1.0/\0' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description xmlns:iptcExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" ' +
      'iptcExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Made with Google AI · SynthID Reference Test</dc:creator>' +
      '</rdf:Description></rdf:RDF></x:xmpmeta>',
  );

  const c2paPayload = encoder.encode(
    'JP\0\x01\0\0\0\x01jumbc2pa\0c2pa.assertions\0c2pa.actions\0c2pa.ai_generated\0' +
      'urn:c2pa:synthetic-test-manifest:trainedAlgorithmicMedia:Google LLC',
  );

  const makeSegment = (markerSecondByte: number, payload: Uint8Array): Uint8Array => {
    const length = payload.length + 2;
    const seg = new Uint8Array(2 + length);
    seg[0] = 0xff;
    seg[1] = markerSecondByte;
    seg[2] = (length >> 8) & 0xff;
    seg[3] = length & 0xff;
    seg.set(payload, 4);
    return seg;
  };

  const app1 = makeSegment(0xe1, xmpPayload);
  const app11 = makeSegment(0xeb, c2paPayload);

  const result = new Uint8Array(originalBytes.length + app1.length + app11.length);
  // Copy SOI (2 bytes)
  result.set(originalBytes.subarray(0, 2), 0);
  // Insert APP1 & APP11 right after SOI
  result.set(app1, 2);
  result.set(app11, 2 + app1.length);
  // Copy rest of JPEG
  result.set(originalBytes.subarray(2), 2 + app1.length + app11.length);
  return result;
}
