// deno-coverage-ignore-file

import { createElement } from 'preact'
import type { ComponentType, VNode } from 'preact'
import { Page } from 'modules/router/page-decorator.ts'
import { SpacePageController } from 'modules/router/space-page-controller.ts'

function HomeView(): VNode {
  return createElement('h1', null, 'home')
}

@Page('/not-found-preact-fixture')
export default class HomePage extends SpacePageController<
  Record<string, string>,
  never,
  // deno-lint-ignore no-explicit-any
  ComponentType<any> | null
> {
  public static override head: { title: string } = { title: 'Home' }
  public override component = HomeView
}
