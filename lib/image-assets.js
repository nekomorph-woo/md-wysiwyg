'use babel';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.DS_Store']);

function isImageFile(filePath = '', mimeType = '') {
  if (mimeType && mimeType.startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.has(path.extname(filePath || '').toLowerCase());
}

function isMarkdownFile(filePath = '') {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath || '').toLowerCase());
}

function expandHome(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function defaultPicturesDirectory() {
  const home = os.homedir();
  const pictures = path.join(home, 'Pictures');
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return path.join(pictures, 'md-wysiwyg-assets');
  }
  return fs.existsSync(pictures)
    ? path.join(pictures, 'md-wysiwyg-assets')
    : path.join(home, 'md-wysiwyg-assets');
}

function configuredAssetsDirectory() {
  const configured = typeof atom !== 'undefined' && atom.config
    ? atom.config.get('md-wysiwyg.assetsDirectory')
    : '';
  const expanded = expandHome(configured);
  return path.resolve(expanded || defaultPicturesDirectory());
}

async function ensureAssetsDirectory() {
  const dir = configuredAssetsDirectory();
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

function safeFileName(fileName = 'image.png', fallbackExt = '.png') {
  const parsed = path.parse(fileName || 'image.png');
  const base = (parsed.name || 'image').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const ext = (parsed.ext || fallbackExt || '.png').toLowerCase();
  return (base || 'image') + ext;
}

function uniqueTargetPath(dir, fileName, fallbackExt = '.png') {
  const parsed = path.parse(safeFileName(fileName, fallbackExt));
  let candidate = path.join(dir, parsed.base);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, parsed.name + '-' + index + parsed.ext);
    index++;
  }
  return candidate;
}

function extensionForMime(mimeType = '') {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('jpeg')) return '.jpg';
  if (normalized.includes('png')) return '.png';
  if (normalized.includes('gif')) return '.gif';
  if (normalized.includes('webp')) return '.webp';
  if (normalized.includes('svg')) return '.svg';
  if (normalized.includes('bmp')) return '.bmp';
  return '.png';
}

function sameDrive(fromPath, toPath) {
  if (process.platform !== 'win32') return true;
  return path.parse(path.resolve(fromPath)).root.toLowerCase() ===
    path.parse(path.resolve(toPath)).root.toLowerCase();
}

function pathToMarkdownSrc(filePath, docPath) {
  const absolute = path.resolve(filePath);
  const docDir = docPath ? path.dirname(docPath) : process.cwd();
  if (!sameDrive(docDir, absolute)) return absolute;
  const relative = path.relative(docDir, absolute).split(path.sep).join('/');
  if (!relative) return './' + path.basename(absolute);
  return relative.startsWith('.') ? relative : relative;
}

function localPathFromSrc(src, docPath) {
  const value = String(src || '').trim().replace(/^<|>$/g, '');
  if (!value || /^(https?:|data:|mailto:|#)/i.test(value)) return null;
  if (value.startsWith('file://')) {
    try { return fileURLToPath(value); } catch (_err) { return null; }
  }
  if (path.isAbsolute(value)) return path.normalize(value);
  if (!docPath) return null;
  return path.resolve(path.dirname(docPath), value);
}

function previewUrlForSrc(src, docPath) {
  const value = String(src || '').trim();
  if (!value) return '';
  if (/^(https?:|data:)/i.test(value)) return value;
  const localPath = localPathFromSrc(value, docPath);
  return localPath ? pathToFileURL(localPath).href : value;
}

async function bufferFromFileLike(file) {
  if (!file) return null;
  if (file.path) return fs.promises.readFile(file.path);
  if (typeof file.arrayBuffer === 'function') {
    const arrayBuffer = await file.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
  return null;
}

async function localizeImageFile(file, docPath) {
  if (!file || !docPath) return null;
  const assetsDir = await ensureAssetsDirectory();
  const fallbackExt = extensionForMime(file.type);
  const sourceName = file.path
    ? path.basename(file.path)
    : (file.name || 'clipboard-image' + fallbackExt);
  const target = uniqueTargetPath(assetsDir, sourceName, fallbackExt);

  if (file.path) {
    await fs.promises.copyFile(file.path, target);
  } else {
    const buffer = await bufferFromFileLike(file);
    if (!buffer) return null;
    await fs.promises.writeFile(target, buffer);
  }

  return {
    filePath: target,
    src: pathToMarkdownSrc(target, docPath),
    alt: path.basename(target, path.extname(target)),
    title: '',
  };
}

async function walkMarkdownFiles(rootDir, files = []) {
  let entries = [];
  try {
    entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
  } catch (_err) {
    return files;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.docs') {
      if (SKIP_DIRS.has(entry.name)) continue;
    }
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walkMarkdownFiles(fullPath, files);
    } else if (entry.isFile() && isMarkdownFile(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function projectDirectories() {
  if (typeof atom === 'undefined' || !atom.project) return [];
  const paths = atom.project.getPaths ? atom.project.getPaths() : [];
  return paths.filter(Boolean);
}

function normalizeImageSrc(src) {
  return String(src || '').trim().replace(/^<|>$/g, '').split(/\s+["'][^"']*["']\s*$/)[0];
}

function collectImageReferences(markdown, docPath) {
  const refs = [];
  const pattern = /!\[([^\]]*)\]\(([^)\n]+)\)/g;
  let match;
  while ((match = pattern.exec(markdown))) {
    const src = normalizeImageSrc(match[2]);
    const localPath = localPathFromSrc(src, docPath);
    if (!localPath) continue;
    refs.push({
      docPath,
      src,
      localPath: path.resolve(localPath),
      index: match.index,
    });
  }
  return refs;
}

async function scanMarkdownReferences() {
  const roots = projectDirectories();
  const markdownFiles = [];
  for (const root of roots) await walkMarkdownFiles(root, markdownFiles);

  const references = [];
  for (const docPath of markdownFiles) {
    try {
      const markdown = await fs.promises.readFile(docPath, 'utf8');
      references.push(...collectImageReferences(markdown, docPath));
    } catch (_err) {
      // Ignore unreadable files; the manager can still operate on readable docs.
    }
  }
  return references;
}

async function listImageAssets() {
  const assetsDir = await ensureAssetsDirectory();
  let entries = [];
  try {
    entries = await fs.promises.readdir(assetsDir, { withFileTypes: true });
  } catch (_err) {
    return { assetsDir, assets: [] };
  }

  const assets = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(assetsDir, entry.name);
    if (!isImageFile(filePath)) continue;
    const stat = await fs.promises.stat(filePath);
    assets.push({
      filePath,
      name: entry.name,
      size: stat.size,
      modifiedAt: stat.mtime,
      references: [],
    });
  }
  assets.sort((a, b) => a.name.localeCompare(b.name));
  return { assetsDir, assets };
}

async function buildAssetIndex() {
  const { assetsDir, assets } = await listImageAssets();
  const references = await scanMarkdownReferences();
  const byPath = new Map(assets.map((asset) => [path.resolve(asset.filePath), asset]));
  references.forEach((ref) => {
    const asset = byPath.get(path.resolve(ref.localPath));
    if (asset) asset.references.push(ref);
  });
  return { assetsDir, assets, references };
}

async function replaceImageReferences(oldPath, newPath, references) {
  const refsByDoc = new Map();
  references
    .filter((ref) => path.resolve(ref.localPath) === path.resolve(oldPath))
    .forEach((ref) => {
      if (!refsByDoc.has(ref.docPath)) refsByDoc.set(ref.docPath, []);
      refsByDoc.get(ref.docPath).push(ref);
    });

  for (const [docPath] of refsByDoc) {
    const markdown = await fs.promises.readFile(docPath, 'utf8');
    const updated = markdown.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (full, alt, rawSrc) => {
      const src = normalizeImageSrc(rawSrc);
      const localPath = localPathFromSrc(src, docPath);
      if (!localPath || path.resolve(localPath) !== path.resolve(oldPath)) return full;
      const newSrc = pathToMarkdownSrc(newPath, docPath);
      return '![' + alt + '](' + newSrc + ')';
    });
    if (updated !== markdown) await fs.promises.writeFile(docPath, updated, 'utf8');
  }
}

async function renameAsset(oldPath, newName, references) {
  const dir = path.dirname(oldPath);
  const parsedOld = path.parse(oldPath);
  const safeName = safeFileName(newName, parsedOld.ext);
  const target = uniqueTargetPath(dir, safeName, parsedOld.ext);
  await fs.promises.rename(oldPath, target);
  await replaceImageReferences(oldPath, target, references);
  return target;
}

async function deleteAssets(filePaths) {
  for (const filePath of filePaths) {
    await fs.promises.unlink(filePath);
  }
}

module.exports = {
  IMAGE_EXTENSIONS,
  buildAssetIndex,
  collectImageReferences,
  configuredAssetsDirectory,
  defaultPicturesDirectory,
  deleteAssets,
  ensureAssetsDirectory,
  isImageFile,
  localizeImageFile,
  localPathFromSrc,
  pathToMarkdownSrc,
  previewUrlForSrc,
  renameAsset,
};
