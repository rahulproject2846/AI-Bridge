import { ShareDoc } from "../models/Share";

// Aggressive binary file filter for AI-bridge
export function filterTextFiles(files: { path: string; content: string }[]): { path: string; content: string }[] {
  const binaryExtensions = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.pdf', '.zip', '.rar', '.7z', '.tar', '.gz',
    '.exe', '.dll', '.so', '.dylib', '.bin',
    '.mp4', '.avi', '.mov', '.mp3', '.wav',
    '.psd', '.ai', '.eps', '.sketch'
  ]);

  const textMimeTypes = new Set([
    'text/', 'application/json', 'application/javascript', 'application/xml',
    'application/typescript', 'application/javascript', 'application/markdown'
  ]);

  return files.filter(file => {
    const ext = file.path.toLowerCase().split('.').pop();
    if (!ext) return true; // Files without extension are likely text
    
    // Skip binary extensions
    if (binaryExtensions.has('.' + ext)) {
      console.warn(`Skipping binary file: ${file.path}`);
      return false;
    }
    
    return true;
  });
}
