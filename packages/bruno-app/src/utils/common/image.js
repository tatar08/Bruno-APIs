// Client-side image resize/compression, used to keep uploaded icons (e.g. workspace
// icons) under the backend's data-URI size limit without asking the user to manually
// resize their source image first. Works identically in Browser and Desktop mode since
// everything here runs against the File/Canvas APIs in the renderer, before any IPC call.

const DEFAULT_MAX_BYTES = 480 * 1024; // safety margin under bruno-electron's 512KB MAX_WORKSPACE_ICON_BYTES
const DEFAULT_MAX_DIMENSION = 256;
const JPEG_QUALITY_STEPS = [0.85, 0.7, 0.5, 0.35, 0.2];

const readFileAsDataUri = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
};

const loadImage = (src) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image file'));
    img.src = src;
  });
};

/**
 * Reads an image File, downscales it to fit within maxDimension, and re-encodes it
 * (PNG first, falling back to progressively more compressed JPEG) until the resulting
 * data URI fits under maxBytes.
 *
 * @param {File} file
 * @param {{ maxBytes?: number, maxDimension?: number }} [options]
 * @returns {Promise<string>} the resulting image data URI
 */
export const resizeImageFileToDataUri = async (file, options = {}) => {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;

  const originalDataUri = await readFileAsDataUri(file);
  const img = await loadImage(originalDataUri);

  let { width, height } = img;
  if (width > maxDimension || height > maxDimension) {
    const scale = Math.min(maxDimension / width, maxDimension / height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  let dataUri = canvas.toDataURL('image/png');
  if (dataUri.length > maxBytes) {
    for (const quality of JPEG_QUALITY_STEPS) {
      dataUri = canvas.toDataURL('image/jpeg', quality);
      if (dataUri.length <= maxBytes) break;
    }
  }

  if (dataUri.length > maxBytes) {
    throw new Error(`Could not compress image under ${Math.round(maxBytes / 1024)} KB`);
  }

  return dataUri;
};
