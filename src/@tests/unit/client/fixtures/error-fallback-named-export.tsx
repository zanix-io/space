import type { ErrorBoundaryProps } from 'typings/page.ts'

/**
 * A real, dynamically-importable React Fallback with ONLY a named export, no `export default` —
 * the exact shape `default-error-view.tsx` itself has (`render-page-react.tsx` imports it as
 * `.DefaultErrorView`, never `.default`). Stands in for that file in
 * `hydrate-error-boundaries.test.ts`'s own regression case: `hydrateBoundary`'s `module.default`
 * used to resolve to `undefined` for this exact shape, silently leaving the postponed `<template>`
 * un-mounted (see `hydrate-error-boundaries.ts`'s own doc on its `module.default ??
 * module.DefaultErrorView` fallback).
 */
export function DefaultErrorView({ error, params }: ErrorBoundaryProps) {
  return (
    <p className='fallback'>
      fallback:{String(error instanceof Error ? error.message : error)}:{JSON.stringify(params)}
    </p>
  )
}
