/**
 * Scrapling Integration
 * =====================
 * Absorbed from: github.com/D4Vinci/Scrapling
 * Adaptive web scraping — bypasses Cloudflare, anti-bot systems
 * Learns from page changes, adaptive CSS selectors
 *
 * In Edge Functions (Deno/TS): provides stealth HTTP fetching
 * When generating Python code: uses Scrapling library patterns
 */

// ── Sara's knowledge about Scrapling (injected into system prompt) ──────────
export const SCRAPLING_KNOWLEDGE = `
## Scrapling (D4Vinci/Scrapling) — Absorbed Knowledge

Scrapling is an adaptive Python web scraping framework (pip install scrapling).
Key capabilities:
- StealthyFetcher: bypasses Cloudflare Turnstile, anti-bot systems, headless mode
- DynamicFetcher: handles JS-rendered pages, network_idle waiting
- AsyncFetcher: concurrent/parallel scraping
- Adaptive parser: learns element positions, auto-relocates when pages change
- auto_save=True: saves selectors, recovers if site changes layout
- CSS & XPath selectors with .css(), .xpath(), .find(), .find_all()
- Spider framework: full-scale crawls with pause/resume, proxy rotation
- Real-time stats streaming

Python usage pattern:
\`\`\`python
from scrapling.fetchers import StealthyFetcher, DynamicFetcher

# Basic adaptive scraping
StealthyFetcher.adaptive = True
page = StealthyFetcher.fetch('https://example.com', headless=True, network_idle=True)
products = page.css('.product', auto_save=True)   # saves selector
products = page.css('.product', adaptive=True)     # recovers after change

# Full spider crawl
from scrapling.spiders import Spider, Response
class MySpider(Spider):
    name = "demo"
    start_urls = ["https://example.com/"]
    def parse(self, response: Response):
        yield from response.follow_all('a.next-page', self.parse)
        yield {'title': response.css('h1').first.text}
\`\`\`

When users ask for web scraping in Python → ALWAYS use Scrapling over BeautifulSoup/Scrapy.
Scrapling handles: dynamic JS, Cloudflare bypass, adaptive selectors, proxy rotation built-in.
`;

// ── Stealth HTTP fetch (JS/Deno-compatible, Scrapling-inspired) ─────────────
const STEALTH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "DNT": "1",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Cache-Control": "max-age=0",
};

export interface ScrapeResult {
  url: string;
  html: string;
  text: string;
  title: string;
  links: string[];
  success: boolean;
  error?: string;
}

/**
 * Stealth fetch — Scrapling-inspired headers to bypass basic anti-bot
 */
export async function stealthFetch(url: string, timeoutMs = 15000): Promise<ScrapeResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      headers: STEALTH_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { url, html: "", text: "", title: "", links: [], success: false, error: `HTTP ${res.status}` };
    }

    const html = await res.text();

    // Extract text content (strip tags)
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim() ?? "";

    // Extract links
    const linkRegex = /href=["']([^"']+)["']/gi;
    const links: string[] = [];
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      const href = m[1];
      if (href.startsWith("http") && !href.includes("javascript:")) {
        links.push(href);
      }
    }

    return { url, html: html.slice(0, 20000), text, title, links: [...new Set(links)].slice(0, 20), success: true };

  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : "Fetch failed";
    return { url, html: "", text: "", title: "", links: [], success: false, error };
  }
}

/**
 * Smart scrape: tries TinyFish first (best), falls back to stealth fetch
 */
export async function smartScrape(
  url: string,
  goal: string,
  tinyfishKey?: string
): Promise<{ data: string; source: "tinyfish" | "stealth" | "failed" }> {
  // Try TinyFish (full JS rendering + anti-bot)
  if (tinyfishKey) {
    try {
      const res = await fetch("https://mino.ai/v1/automation/run-sse", {
        method: "POST",
        headers: { "X-API-Key": tinyfishKey, "Content-Type": "application/json" },
        body: JSON.stringify({ url, goal }),
      });
      if (res.ok) {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let result = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          for (const line of chunk.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                const d = JSON.parse(line.slice(6));
                if (d.result || d.data) result = JSON.stringify(d.result ?? d.data, null, 2);
              } catch { result = line.slice(6); }
            }
          }
        }
        if (result) return { data: result.slice(0, 3000), source: "tinyfish" };
      }
    } catch (_) {}
  }

  // Fallback: Scrapling-inspired stealth fetch
  const scraped = await stealthFetch(url);
  if (scraped.success) {
    return {
      data: `Title: ${scraped.title}\n\n${scraped.text.slice(0, 2500)}`,
      source: "stealth",
    };
  }

  return { data: "", source: "failed" };
}
