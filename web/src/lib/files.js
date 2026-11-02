// How each attachment reaches the model:
//   image -> input_image (re-encoded to JPEG when too large or not a format the model reads)
//   file  -> input_file (Azure extracts the text: PDF, Office, iWork, code, data...)
//   text  -> uploaded as .txt so Azure accepts it as a document
//   data  -> only available to the Python tool (zip, audio, video, ...)

const NATIVE = new Set(
  'art bat brf c cls css csv diff doc docx dot eml epub es h hs htm html hwp hwpx ics ifb java js json keynote ksh ltx mail markdown md mht mhtml mjs msg nws odp ods odt otp ots pages patch pdf pl pm pot potm potx ppa pps ppsm ppsx ppt pptm pptx pwz py rst rtf scala sh shtml srt sty svg svgz tex text txt tsv vcf vtt wiz xla xlb xlc xlm xls xlsx xlt xlw xml yaml yml'.split(' '),
);
const TEXTLIKE = new Set(
  'ts tsx jsx cjs go rs rb php swift kt kts cpp cc cxx hpp hh cs sql toml ini cfg conf env log lua r dart vue svelte scss sass less gradle properties bash zsh fish ps1 psm1 bib nix tf hcl proto graphql gql ipynb m mm jl ex exs erl clj elm f90 asm s vb fs groovy cmake mk makefile dockerfile gitignore editorconfig lock'.split(' '),
);
const MODEL_IMAGES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const CONVERT_IMAGES = /^(heic|heif|avif|bmp|tiff?|ico|jfif)$/;

export const MAX_FILE = 50 * 1024 * 1024;
export const MAX_FILES = 10;

export function extOf(name) {
  const base = name.toLowerCase();
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1) : base;
}

export function classify(file) {
  const ext = extOf(file.name);
  if ((file.type.startsWith('image/') && file.type !== 'image/svg+xml') || CONVERT_IMAGES.test(ext)) return 'image';
  if (NATIVE.has(ext)) return 'file';
  if (TEXTLIKE.has(ext) || file.type.startsWith('text/')) return 'text';
  return 'data';
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This image format can’t be opened here. Try a JPG or PNG.'));
    };
    img.src = url;
  });
}

function draw(img, max) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const toBlob = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));

// Returns { blob, name, mime, thumb, w, h } ready to upload.
export async function prepareImage(file) {
  const { img, url } = await loadImage(file);
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const thumbCanvas = draw(img, 360);
    const thumb = thumbCanvas.toDataURL('image/jpeg', 0.72);
    const keep = MODEL_IMAGES.has(file.type) && Math.max(w, h) <= 2048 && file.size <= 4 * 1024 * 1024;
    if (keep) return { blob: file, name: file.name, mime: file.type, thumb, w, h };
    const blob = await toBlob(draw(img, 2048), 'image/jpeg', 0.86);
    const name = `${file.name.replace(/\.[^.]+$/, '') || 'image'}.jpg`;
    const scale = Math.min(1, 2048 / Math.max(w, h));
    return { blob, name, mime: 'image/jpeg', thumb, w: Math.round(w * scale), h: Math.round(h * scale) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function fileKindLabel(name, mime) {
  const ext = extOf(name);
  if (ext === 'pdf') return 'PDF';
  if (/^(docx?|odt|rtf|pages)$/.test(ext)) return 'Document';
  if (/^(xlsx?|xl\w|ods|csv|tsv|numbers)$/.test(ext)) return 'Spreadsheet';
  if (/^(pptx?|pp\w+|odp|key|keynote)$/.test(ext)) return 'Presentation';
  if (/^(zip|rar|7z|tar|gz|tgz|bz2|xz)$/.test(ext)) return 'Archive';
  if (/^(mp3|wav|m4a|aac|flac|ogg|opus)$/.test(ext) || mime?.startsWith('audio/')) return 'Audio';
  if (/^(mp4|mov|webm|mkv|avi)$/.test(ext) || mime?.startsWith('video/')) return 'Video';
  if (/^(md|markdown|txt|text|rst)$/.test(ext)) return 'Text';
  if (/^(json|xml|yaml|yml|toml|ini)$/.test(ext)) return ext.toUpperCase();
  if (NATIVE.has(ext) || TEXTLIKE.has(ext)) return 'Code';
  if (mime?.startsWith('image/')) return 'Image';
  return ext.length <= 5 ? ext.toUpperCase() : 'File';
}

export function guessMime(name) {
  const ext = extOf(name);
  return (
    {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', json: 'application/json', html: 'text/html',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4',
    }[ext] || 'application/octet-stream'
  );
}

export const isImageName = (name) => /\.(png|jpe?g|gif|webp)$/i.test(name);
