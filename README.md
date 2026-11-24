# SPECTRA-WASH

**100% client-side, zero-API lossless visual watermark disruption and forensic spectral inspection workstation.**

SPECTRA-WASH runs entirely inside your browser using native HTML5 Canvas, TypedArrays, and a dedicated Web Worker. No images, pixels, or metadata ever leave your device.

## Core Processing Pipeline

1. **Sub-Pixel Non-Linear Mesh Warping**
   - Applies a dual-axis sinusoidal spatial displacement field (`0.8–1.5 px` amplitude, `200–350 px` wavelength) sampled through a 4×4 Catmull-Rom / Keys Bicubic interpolation kernel to disrupt pixel-grid alignment and carrier phase synchronization.
2. **Texture-Adaptive JND Luminance Processing**
   - Converts RGB to YCbCr and computes a local 3×3 variance and Sobel edge magnitude mask.
   - Smooth flat regions receive edge-preserving Y-channel Bilateral smoothing; high-texture regions receive Just-Noticeable-Difference (JND) masked Box-Muller Gaussian micro-perturbation (`σ = 0.5–1.5`) strictly in the luminance plane while keeping chrominance untouched.
3. **Fractional Affine & Micro-Contrast Recovery**
   - Performs an optional single-pass fractional rotation (`0.3°` default) with closed-form inscribed auto-crop and Lanczos-3 / Bicubic resampling back to exact original dimensions, followed by a light Unsharp Mask (`radius 0.8 px`, `amount 0.25`) to restore optical acutance.
4. **Deep Metadata & C2PA Scrubber**
   - Re-encodes raw RGBA pixel buffers directly into clean lossless PNG or WebP containers, eliminating EXIF, XMP, IPTC, ICC profiles, PNG text chunks, and C2PA / JUMBF Content Credentials.

## Forensic Inspection Suite

- **Client-Side Binary Container Parser:** Inspects raw JPEG APP segments, PNG ancillary chunks, and WebP RIFF chunks to surface C2PA Content Credentials, Google AI / SynthID markers, OpenAI / DALL·E tags, Adobe Firefly metadata, and Stable Diffusion / ComfyUI generation parameters—and verifies post-wash output contains zero residual metadata chunks.
- **Real-Time 2D FFT Spectral Anomaly Visualizer:** Computes a 256×256 Cooley-Tukey Radix-2 2D FFT over high-pass luminance residuals before and after processing, complete with an azimuthal radial spatial frequency profile and narrowband peak ratio.
- **Interactive Split Comparator & Amplified Diff Heatmap:** Inspect visual fidelity with a draggable before/after split curtain, 5×/10×/20× amplified pixel-difference thermal map, JND texture mask preview, and live PSNR & windowed SSIM metrics.

## Architecture

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Lucide Icons
- **DSP Engine:** Zero-dependency ES Module Web Worker (`src/engine/dspWorker.ts`) executing all spatial warps, YCbCr JND filtering, affine Lanczos resampling, 2D FFT, PSNR, and windowed SSIM off the main UI thread.
- **Metadata Forensics:** Pure binary stream inspector (`src/engine/metadataParser.ts`) operating directly on `ArrayBuffer` bytes.
- **Privacy:** Zero backend, zero external API calls, 100% offline-capable once loaded.

## Local Development

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

## GitHub Pages Deployment

1. Push this repository to GitHub (`main` branch).
2. In your repository settings, open **Settings → Pages** and select **GitHub Actions** as the source.
3. Every push to `main` triggers `.github/workflows/deploy.yml`, which compiles with `base: './'` in `vite.config.ts` and publishes `./dist` directly to GitHub Pages.

## Author

Built for open forensic research — [github.com/keyxerxes](https://github.com/keyxerxes)
