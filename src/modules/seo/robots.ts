import type { HandlerContext } from '@zanix/server'
import { Get, SsrController, ZanixSsrController } from '@zanix/server'

/** One `User-agent` block. */
export type RobotsRule = {
  /** @default '*' */
  userAgent?: string
  allow?: string[]
  disallow?: string[]
}

/** Structured `defineSpaceApp({ robots })` config — the alternative to passing a raw string (the
 * ultimate escape hatch: passed through byte-for-byte, no processing, no auto-appended `Sitemap:`
 * line — an app that wants full control over the file's exact content should use that form). */
export type RobotsConfig = {
  rules: RobotsRule[]
  /** Whether to auto-append `Sitemap: {origin}/sitemap.xml` — only takes effect when
   * `defineSpaceApp({ sitemap })` is ALSO configured; a no-op otherwise. @default true */
  includeSitemap?: boolean
}

/** `defineSpaceApp({ robots })`'s own accepted shape. Genuinely new, not a port — the legacy
 * component this replaces had no `robots.txt` mechanism at all (confirmed by reading its source,
 * not assumed — grepped the entire repo broadly for "robots", every hit was its unrelated
 * per-page `<meta name="robots">` tag convention, never a `robots.txt` file). */
export type SpaceRobotsConfig = string | RobotsConfig

function buildRuleBlock(rule: RobotsRule): string {
  const lines = [`User-agent: ${rule.userAgent ?? '*'}`]
  for (const path of rule.allow ?? []) lines.push(`Allow: ${path}`)
  for (const path of rule.disallow ?? []) lines.push(`Disallow: ${path}`)
  return lines.join('\n')
}

/**
 * Builds `robots.txt`'s own plain-text content — pure, synchronous, no route involved (see
 * {@linkcode registerRobots} for the HTTP route this backs).
 *
 * A raw `string` config is returned completely unchanged — not even a trailing newline is added —
 * since passing one is an explicit choice to own the file's exact bytes. A {@linkcode RobotsConfig}
 * is rendered as one `User-agent` block per `rules` entry (blank line between blocks), with an
 * auto-appended `Sitemap:` line when `hasSitemap` is true and `includeSitemap` wasn't set to
 * `false`.
 */
export function buildRobotsTxt(
  config: SpaceRobotsConfig,
  options: { origin: string; hasSitemap: boolean },
): string {
  if (typeof config === 'string') return config

  const blocks = config.rules.map(buildRuleBlock)
  if (config.includeSitemap !== false && options.hasSitemap) {
    blocks.push(`Sitemap: ${options.origin}/sitemap.xml`)
  }
  return `${blocks.join('\n\n')}\n`
}

/**
 * Registers `GET /robots.txt`. Called from `defineSpaceApp`'s own `setup()` when `robots` is
 * configured — an app that never declares it never registers this route at all, same "omitted =
 * feature off" convention as `assetsDir`/`messagesDir`/`sitemap`.
 */
export function registerRobots(config: SpaceRobotsConfig, hasSitemap: boolean): void {
  class RobotsRoute extends ZanixSsrController {
    public serve(ctx: HandlerContext): Response {
      const body = buildRobotsTxt(config, { origin: ctx.url.origin, hasSitemap })
      return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
    }
  }
  Get('/robots.txt')(RobotsRoute.prototype.serve)
  SsrController()(RobotsRoute)
}
