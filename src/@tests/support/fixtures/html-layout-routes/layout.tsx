// deno-coverage-ignore-file

import type { LayoutProps } from 'typings/page.ts'

export default function RootHtmlLayout({ children }: LayoutProps) {
  return (
    <html lang='es'>
      <head>
        <title>Fixture app</title>
      </head>
      <body data-testid='root-html-layout-body'>{children}</body>
    </html>
  )
}
