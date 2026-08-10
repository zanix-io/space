// deno-coverage-ignore-file

import type { LayoutProps } from 'typings/page.ts'

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang='en'>
      <body data-testid='app-shell'>{children}</body>
    </html>
  )
}
