/**
 * TinyFish Web Agent Helper
 * ===========================
 * Sara's real-time web browsing superpower.
 * Turns any website into structured JSON using TinyFish API.
 * Absorbed from: https://github.com/tinyfish-io/tinyfish-cookbook
 *
 * API: POST https://mino.ai/v1/automation/run-sse
 * Docs: https://docs.mino.ai
 */

const TINYFISH_URL = "https://mino.ai/v1/automation/run-sse";

export interface TinyFishResult {
  url: string;
  goal: string;
  data: string;
  success: boolean;
  error?: string;
}

/**
 * Browse a URL with a natural language goal → structured data
 * Uses SSE streaming and collects the final result event.
 */
export async function browseWeb(
  url: string,
  goal: string,
  apiKey: string,
  timeoutMs = 25000
): Promise<TinyFishResult> {
  if (!apiKey) {
    return { url, goal, data: "", success: false, error: "TINYFISH_API_KEY not set" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(TINYFISH_URL, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, goal }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { url, goal, data: "", success: false, error: `TinyFish HTTP ${response.status}` };
    }

    // Collect SSE stream
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let lastData = "";
    let finalResult = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          lastData = line.slice(6).trim();
          // Try to parse as JSON and capture meaningful result
          try {
            const parsed = JSON.parse(lastData);
            // TinyFish sends status events + final result
            if (parsed.type === "result" || parsed.result || parsed.data) {
              finalResult = JSON.stringify(parsed.result ?? parsed.data ?? parsed, null, 2);
            } else if (parsed.status === "completed") {
              // completed event
            } else if (typeof parsed === "object" && !parsed.type && !parsed.status) {
              // Likely the structured result itself
              finalResult = JSON.stringify(parsed, null, 2);
            }
          } catch {
            // Plain text result
            if (lastData && lastData !== "[DONE]" && lastData.length > 10) {
              finalResult = lastData;
            }
          }
        }
      }
    }

    const data = finalResult || lastData;
    return { url, goal, data, success: data.length > 0 };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { url, goal, data: "", success: false, error: msg };
  }
}

/**
 * Browse multiple URLs in parallel (up to 4)
 */
export async function browseMultiple(
  targets: Array<{ url: string; goal: string }>,
  apiKey: string
): Promise<TinyFishResult[]> {
  const limited = targets.slice(0, 4);
  return Promise.all(limited.map(t => browseWeb(t.url, t.goal, apiKey)));
}

/**
 * Smart URL extractor — finds URLs mentioned in a message
 */
export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
  return [...new Set(text.match(urlRegex) ?? [])].slice(0, 4);
}

/**
 * Decide if a query needs web browsing
 */
export function needsWebBrowsing(message: string): boolean {
  const webKeywords = [
    "prix", "price", "cost", "coût",
    "concurrent", "competitor", "rival",
    "actuellement", "currently", "aujourd'hui", "today", "now",
    "récent", "recent", "latest", "dernier",
    "acheter", "buy", "disponible", "available",
    "scrape", "extraire", "extract",
    "cherche", "search", "trouve", "find",
    "site", "website", "page", "url",
    "http", "www.",
  ];
  const lower = message.toLowerCase();
  return webKeywords.some(k => lower.includes(k)) || extractUrls(message).length > 0;
}

/**
 * Format TinyFish results for injection into LLM context
 */
export function formatWebResults(results: TinyFishResult[]): string {
  const successful = results.filter(r => r.success && r.data);
  if (successful.length === 0) return "";

  return `\n\n<live_web_data>\n${successful
    .map(r => `[${r.url}]\nGoal: ${r.goal}\n${r.data.slice(0, 2000)}`)
    .join("\n\n---\n\n")}\n</live_web_data>`;
}
