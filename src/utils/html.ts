const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

// Makes text safe to drop into an HTML string (element content or a double-quoted attribute).
export const escapeHtml = (s: unknown): string => String(s).replace(/[&<>"]/g, c => ESCAPES[c]);
