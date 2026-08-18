/**
 * Social metadata — link previews. Never SEO: no search engine ranks on any of it.
 *
 * One slice of the rule catalog. Split by category so no single file carries the whole policy and
 * so a change to one concern is visibly a change to that concern — see `../rules.ts`, which composes
 * these and is the only thing anything else imports.
 *
 * @module
 */
import type { RuleDefinition } from '../diagnostic.ts'

/** Social metadata — link previews. Never SEO: no search engine ranks on any of it. */
export const SOCIAL_RULES: Record<string, RuleDefinition> = {
  SOC001: {
    code: 'SOC001',
    category: 'social',
    severity: 'warning',
    phase: 'static',
    basis: 'ecosystem-recommendation',
    // Context, NOT authority. The protocol defines its URL type as http/https URLs but says nothing
    // at all about relative-URL handling — verified directly against the spec. Carrying this as
    // `normative` during development was overclaiming; it is a recommendation with its source cited.
    reference:
      "Open Graph protocol: a URL is 'All valid URLs that utilize the http:// or https:// " +
      "protocols' (the spec gives no guidance on relative URLs)",
    configurable: true,
    optIn: true,
    summary: 'og:image or og:url uses a relative URL.',
  },
  SOC002: {
    code: 'SOC002',
    category: 'social',
    severity: 'warning',
    phase: 'static',
    basis: 'spec',
    reference:
      'Open Graph protocol: og:title, og:type, og:image and og:url are required for every page',
    configurable: true,
    optIn: true,
    summary: 'The page declares some Open Graph properties but not all four required ones.',
  },
  SOC003: {
    code: 'SOC003',
    category: 'social',
    severity: 'info',
    phase: 'static',
    basis: 'ecosystem-recommendation',
    // Off by default with no plan to change that: X falls back to Open Graph, so a complete OG set
    // already produces the preview. Only `twitter:card` adds anything of its own.
    configurable: true,
    optIn: true,
    summary: 'The page declares no twitter:card.',
  },
}
