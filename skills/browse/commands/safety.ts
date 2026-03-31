/**
 * Content safety utilities for gstack browse skill
 * 
 * Provides three core safety functions:
 * 1. truncateOutput - limits text length to prevent context overflow
 * 2. isAllowedDomain - checks URLs against an allowlist
 * 3. sanitizeOutput - removes sensitive patterns (emails, tokens, keys)
 */

/**
 * Truncates any output to a maximum character length.
 * Appends an ellipsis (...) if truncation occurs.
 * 
 * @param text - Input text to truncate
 * @param maxChars - Maximum allowed characters (must be >= 3 for ellipsis)
 * @returns Truncated text with ellipsis if truncated, original otherwise
 */
export function truncateOutput(text: string, maxChars: number): string {
  if (maxChars < 3) {
    throw new Error('maxChars must be at least 3 to accommodate ellipsis');
  }
  if (text.length <= maxChars) {
    return text;
  }
  return text.substring(0, maxChars - 3) + '...';
}

/**
 * Checks if a URL's domain is in a list of allowed domains.
 * Supports exact domain matches and subdomains when parent domain is allowed.
 * 
 * @param url - URL to check (can be full URL, protocol-relative, or just domain)
 * @param allowedDomains - Array of allowed domain strings (e.g., ['example.com', 'api.example.com'])
 * @returns true if domain is allowed, false otherwise
 */
export function isAllowedDomain(url: string, allowedDomains: string[]): boolean {
  if (!url || allowedDomains.length === 0) {
    return false;
  }
  
  // Extract domain from URL
  let domain: string;
  try {
    // If URL doesn't have protocol, add http:// for URL parsing
    const normalizedUrl = url.includes('://') ? url : `http://${url}`;
    const parsed = new URL(normalizedUrl);
    domain = parsed.hostname;
  } catch {
    // If URL parsing fails, treat the whole string as domain
    domain = url.replace(/^https?:\/\//, '').split('/')[0];
  }
  
  // Remove leading 'www.' for matching purposes
  const cleanDomain = domain.replace(/^www\./, '');
  
  // Check against allowed domains
  for (const allowed of allowedDomains) {
    const cleanAllowed = allowed.replace(/^www\./, '');
    // Exact match or subdomain match (e.g., api.example.com matches example.com)
    if (cleanDomain === cleanAllowed || cleanDomain.endsWith(`.${cleanAllowed}`)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Sanitizes output by removing potential sensitive patterns:
 * - Email addresses
 * - API keys / tokens (common patterns like sk_live_, xoxb-, etc.)
 * - Simple credential patterns (key=..., token=..., password=...)
 * 
 * @param text - Input text to sanitize
 * @returns Sanitized text with sensitive patterns replaced with [REDACTED]
 */
export function sanitizeOutput(text: string): string {
  if (!text) return text;
  
  let sanitized = text;
  
  // Email addresses
  sanitized = sanitized.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    '[REDACTED_EMAIL]'
  );
  
  // Common API key patterns
  const keyPatterns = [
    // Stripe
    /(sk_(live|test)_[a-zA-Z0-9]{24,})/g,
    // Slack
    /(xox[baprs]-[a-zA-Z0-9-]+)/g,
    // GitHub
    /(gh[pousr]_[a-zA-Z0-9]{36,})/g,
    // AWS (access key ID + secret key)
    /(AKIA[0-9A-Z]{16})/g,
    // Generic tokens (hex strings 32+ chars)
    /\b([0-9a-f]{32,})\b/gi,
    // Base64-like tokens (alphanumeric + /=, 40+ chars)
    /\b([A-Za-z0-9+/=]{40,})\b/g,
  ];
  
  for (const pattern of keyPatterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED_TOKEN]');
  }
  
  // Key-value pairs in text (key=..., token=..., password=...)
  sanitized = sanitized.replace(
    /\b(api[._-]?key|token|password|secret|auth)[=:]\s*[^\s;,&]+/gi,
    '$1=[REDACTED]'
  );
  
  return sanitized;
}