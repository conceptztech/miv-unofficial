export const isPdfUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (/\.pdf$/i.test(decodeURIComponent(url.pathname))) return true;
    return ['file', 'filename', 'download', 'url'].some((key) => {
      const parameter = url.searchParams.get(key);
      return parameter !== null && /\.pdf(?:$|[?#])/i.test(parameter);
    });
  } catch {
    return false;
  }
};

export const browserDocumentUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.origin === 'https://lms.miva.university' && url.searchParams.has('forcedownload')) {
      url.searchParams.set('forcedownload', '0');
    }
    return url.href;
  } catch { return null; }
};
