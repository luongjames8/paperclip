/**
 * Discovery Module v2 - Fuzzy String Matching
 *
 * Uses Levenshtein distance for 95% threshold quote verification.
 * Implements sliding window search to find quotes anywhere in page content.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface MatchResult {
  found: boolean;
  score: number; // 0.0 - 1.0
  matched_text: string;
  start: number;
  end: number;
}

export interface FuzzyMatchOptions {
  threshold?: number; // Default 0.95
  caseSensitive?: boolean;
}

// =============================================================================
// PREPROCESSING
// =============================================================================

/**
 * Normalize text for comparison:
 * - Lowercase (unless case-sensitive)
 * - Collapse multiple whitespace to single space
 * - Normalize quotes (curly → straight)
 * - NFD unicode normalization
 */
export function normalizeText(text: string, caseSensitive: boolean = false): string {
  let normalized = text;

  // NFD unicode normalization
  normalized = normalized.normalize('NFD');

  // Lowercase unless case-sensitive
  if (!caseSensitive) {
    normalized = normalized.toLowerCase();
  }

  // Normalize quotes (curly → straight)
  normalized = normalized
    .replace(/[\u2018\u2019]/g, "'") // Single curly quotes
    .replace(/[\u201C\u201D]/g, '"') // Double curly quotes
    .replace(/[\u2013\u2014]/g, '-'); // En/em dashes

  // Collapse whitespace (multiple spaces, tabs, newlines → single space)
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

// =============================================================================
// LEVENSHTEIN DISTANCE
// =============================================================================

/**
 * Calculate Levenshtein distance between two strings.
 * Uses Wagner-Fischer algorithm with O(min(m,n)) space.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure a is the shorter string for space optimization
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const m = a.length;
  const n = b.length;

  // Use two rows instead of full matrix
  let prev = new Array(m + 1);
  let curr = new Array(m + 1);

  // Initialize first row
  for (let i = 0; i <= m; i++) {
    prev[i] = i;
  }

  // Fill matrix row by row
  for (let j = 1; j <= n; j++) {
    curr[0] = j;

    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1, // Deletion
        curr[i - 1] + 1, // Insertion
        prev[i - 1] + cost // Substitution
      );
    }

    // Swap rows
    [prev, curr] = [curr, prev];
  }

  return prev[m];
}

/**
 * Calculate similarity ratio (0.0 - 1.0) between two strings.
 * 1.0 = identical, 0.0 = completely different
 */
export function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

// =============================================================================
// SLIDING WINDOW FUZZY MATCH
// =============================================================================

/**
 * Search for a quote anywhere in page text using sliding window.
 *
 * @param text - Full page text to search
 * @param query - The quote to find
 * @param options - Match options (threshold, case sensitivity)
 * @returns Best match result
 */
export function fuzzyMatch(
  text: string,
  query: string,
  options: FuzzyMatchOptions = {}
): MatchResult {
  const threshold = options.threshold ?? 0.95;
  const caseSensitive = options.caseSensitive ?? false;

  // Normalize both texts
  const normalizedText = normalizeText(text, caseSensitive);
  const normalizedQuery = normalizeText(query, caseSensitive);

  // Calculate window size: quote length * 1.5, min 500 chars
  const windowSize = Math.max(Math.ceil(normalizedQuery.length * 1.5), 500);
  const windowOverlap = 0.5;
  const stepSize = Math.floor(windowSize * (1 - windowOverlap));

  let bestMatch: MatchResult = {
    found: false,
    score: 0,
    matched_text: '',
    start: 0,
    end: 0,
  };

  // Slide window across text
  for (let start = 0; start < normalizedText.length; start += stepSize) {
    const end = Math.min(start + windowSize, normalizedText.length);
    const window = normalizedText.slice(start, end);

    // For each window, find the best substring match
    const windowMatch = findBestSubstringMatch(window, normalizedQuery, threshold);

    if (windowMatch.score > bestMatch.score) {
      bestMatch = {
        found: windowMatch.score >= threshold,
        score: windowMatch.score,
        matched_text: text.slice(
          start + windowMatch.start,
          start + windowMatch.end
        ),
        start: start + windowMatch.start,
        end: start + windowMatch.end,
      };
    }

    // Early exit if perfect match found
    if (bestMatch.score >= 0.99) {
      break;
    }

    // Stop if window extends to end of text
    if (end >= normalizedText.length) {
      break;
    }
  }

  return bestMatch;
}

/**
 * Find the best matching substring within a window.
 * Tries different substring lengths around query length.
 */
function findBestSubstringMatch(
  window: string,
  query: string,
  threshold: number
): { score: number; start: number; end: number } {
  const queryLen = query.length;

  // Try substrings from 80% to 120% of query length
  const minLen = Math.floor(queryLen * 0.8);
  const maxLen = Math.ceil(queryLen * 1.2);

  let best = { score: 0, start: 0, end: 0 };

  // Optimization: do quick check first
  // If the query has unique words, look for them
  const quickCheck = window.includes(query.slice(0, Math.min(20, query.length)));
  if (!quickCheck && threshold > 0.9) {
    // Early exit if first 20 chars not found and we need high match
    return best;
  }

  for (let len = minLen; len <= maxLen && len <= window.length; len++) {
    for (let start = 0; start <= window.length - len; start++) {
      const substring = window.slice(start, start + len);
      const score = levenshteinRatio(substring, query);

      if (score > best.score) {
        best = { score, start, end: start + len };

        // Early exit if good enough
        if (score >= threshold) {
          return best;
        }
      }
    }
  }

  return best;
}

// =============================================================================
// MULTI-MATCH (TOP 3)
// =============================================================================

/**
 * Find top N matches for a quote in text.
 *
 * @param text - Full page text to search
 * @param query - The quote to find
 * @param options - Match options
 * @param maxMatches - Maximum matches to return (default 3)
 * @returns Array of match results, sorted by score descending
 */
export function fuzzyMatchMultiple(
  text: string,
  query: string,
  options: FuzzyMatchOptions = {},
  maxMatches: number = 3
): MatchResult[] {
  const threshold = options.threshold ?? 0.90; // Lower for multiple matches
  const caseSensitive = options.caseSensitive ?? false;

  const normalizedText = normalizeText(text, caseSensitive);
  const normalizedQuery = normalizeText(query, caseSensitive);

  const windowSize = Math.max(Math.ceil(normalizedQuery.length * 1.5), 500);
  const windowOverlap = 0.5;
  const stepSize = Math.floor(windowSize * (1 - windowOverlap));

  const matches: MatchResult[] = [];
  const coveredRanges: Array<{ start: number; end: number }> = [];

  // Slide window across text
  for (let start = 0; start < normalizedText.length; start += stepSize) {
    const end = Math.min(start + windowSize, normalizedText.length);
    const window = normalizedText.slice(start, end);

    const windowMatch = findBestSubstringMatch(window, normalizedQuery, threshold);

    if (windowMatch.score >= threshold) {
      const globalStart = start + windowMatch.start;
      const globalEnd = start + windowMatch.end;

      // Check if this overlaps with existing match
      const overlaps = coveredRanges.some(
        (range) =>
          (globalStart >= range.start && globalStart < range.end) ||
          (globalEnd > range.start && globalEnd <= range.end)
      );

      if (!overlaps) {
        matches.push({
          found: true,
          score: windowMatch.score,
          matched_text: text.slice(globalStart, globalEnd),
          start: globalStart,
          end: globalEnd,
        });

        coveredRanges.push({ start: globalStart, end: globalEnd });

        if (matches.length >= maxMatches) {
          break;
        }
      }
    }

    if (end >= normalizedText.length) {
      break;
    }
  }

  // Sort by score descending
  return matches.sort((a, b) => b.score - a.score);
}

// =============================================================================
// CONTEXT EXTRACTION
// =============================================================================

/**
 * Extract surrounding context around a match.
 *
 * @param text - Full text
 * @param start - Match start position
 * @param end - Match end position
 * @param contextChars - Characters of context to extract (default 200)
 * @returns Context string with match highlighted
 */
export function extractContext(
  text: string,
  start: number,
  end: number,
  contextChars: number = 200
): string {
  const contextStart = Math.max(0, start - contextChars);
  const contextEnd = Math.min(text.length, end + contextChars);

  let context = '';

  if (contextStart > 0) {
    context += '...';
  }

  context += text.slice(contextStart, contextEnd);

  if (contextEnd < text.length) {
    context += '...';
  }

  return context;
}
