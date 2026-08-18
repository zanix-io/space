/**
 * PWA — installation artifacts (manifest, service worker), never the document itself.
 *
 * One slice of the rule catalog. Split by category so no single file carries the whole policy and
 * so a change to one concern is visibly a change to that concern — see `../rules.ts`, which composes
 * these and is the only thing anything else imports.
 *
 * @module
 */
import type { RuleDefinition } from '../diagnostic.ts'

/** PWA — installation artifacts (manifest, service worker), never the document itself. */
export const PWA_RULES: Record<string, RuleDefinition> = {
  PWA001: {
    code: 'PWA001',
    category: 'pwa',
    severity: 'error',
    phase: 'static',
    basis: 'installability',
    reference:
      'Web app manifest installability criteria (Chromium): icons must include a 192px and a 512px icon',
    configurable: false,
    optIn: false,
    summary: 'iconSizes omits 192 or 512, so the app cannot be installed.',
  },
  PWA002: {
    code: 'PWA002',
    category: 'pwa',
    severity: 'warning',
    phase: 'static',
    basis: 'framework-invariant',
    configurable: true,
    optIn: false,
    summary:
      'offlineFallback points at no known route; a failing precache aborts service worker install entirely.',
  },
  PWA003: {
    code: 'PWA003',
    category: 'pwa',
    severity: 'info',
    phase: 'static',
    basis: 'ecosystem-recommendation',
    configurable: true,
    optIn: true,
    summary: 'PWA is configured without a themeColor.',
  },
}
