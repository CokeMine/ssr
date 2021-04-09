import { resolve } from 'path'
import * as Vue from 'vue'
import { findRoute, getManifest, logGreen, getCwd } from 'ssr-server-utils'
import { FeRouteItem, ISSRContext, IConfig } from 'ssr-types'
import { sync } from 'vuex-router-sync'
import * as serialize from 'serialize-javascript'
// @ts-expect-error
import feRoutes from 'ssr-temporary-routes'

import { createRouter } from './router'
import { createStore } from './store'

const serverRender = async (ctx: ISSRContext, config: IConfig): Promise<Vue.Component> => {
  const router = createRouter()
  const store = createStore()
  const ViteMode = process.env.BUILD_TOOL === 'vite'
  sync(store, router)

  const { cssOrder, jsOrder, dynamic, mode, customeHeadScript, chunkName } = config
  const path = ctx.request.path // 这里取 pathname 不能够包含 queyString

  const routeItem = findRoute<FeRouteItem<{}, {
    App: Vue.Component
    layout: Vue.Component
  }>>(feRoutes, path)

  let dynamicCssOrder = cssOrder
  if (dynamic) {
    dynamicCssOrder = cssOrder.concat([`${routeItem.webpackChunkName}.css`])
  }

  const manifest = ViteMode ? {} : await getManifest()

  if (!routeItem) {
    throw new Error(`With request url ${path} Component is Not Found`)
  }

  const isCsr = !!((mode === 'csr' || ctx.request.query?.csr))

  if (isCsr) {
    logGreen(`Current path ${path} use csr render mode`)
  }
  const { fetch, layout, App, layoutFetch } = routeItem
  // 根据 path 匹配 router-view 展示的组件
  router.push(path)

  if (!isCsr && layoutFetch) {
    // csr 下不需要服务端获取数据
    await layoutFetch({ store, router: router.currentRoute }, ctx)
  }
  if (!isCsr && fetch) {
    // csr 下不需要服务端获取数据
    await fetch({ store, router: router.currentRoute }, ctx)
  }

  // @ts-expect-error
  const app = new Vue({
    router,
    store,
    render: function (h: Vue.CreateElement) {
      const injectCss: Vue.VNode[] = []
      dynamicCssOrder.forEach(css => {
        if (manifest[css] || ViteMode) {
          injectCss.push(h('link', {
            attrs: {
              rel: 'stylesheet',
              href: ViteMode ? `/server/static/css/${chunkName}.css` : manifest[css]
            }
          }))
        }
      })

      const injectScript: Vue.VNode[] = ViteMode ? [h('script', {
        attrs: {
          type: 'module',
          src: resolve(getCwd(), '/node_modules/ssr-plugin-vue/esm/entry/client-entry.js')
        }
      })] : jsOrder.map(js => h('script', {
        attrs: {
          src: manifest[js]
        }
      }))
      const viteClient = h('script', {
        attrs: {
          type: 'module',
          src: '/@vite/client'
        }
      })
      return h(
        layout,
        {
          props: {
            ctx,
            config
          }
        },
        [
          h('template', {
            slot: 'remInitial'
          }, [
            h('script', {}, [
              "var w = document.documentElement.clientWidth / 3.75;document.getElementsByTagName('html')[0].style['font-size'] = w + 'px'"
            ])
          ]),
          ViteMode && h('template', {
            slot: 'viteClient'
          }, [viteClient]),

          h('template', {
            slot: 'customeHeadScript'
          }, customeHeadScript?.map(item => h('script', Object.assign({}, item.describe, {
            domProps: {
              innerHTML: item.content
            }
          })))),

          h('template', {
            slot: 'children'
          }, [
            isCsr ? h('div', {
              // csr 只需渲染一个空的 <div id="app"> 不需要渲染具体的组件也就是 router-view
              attrs: {
                id: 'app'
              }
            }) : h(App)
          ]),

          h('template', {
            slot: 'initialData'
          }, [
            isCsr ? h('script', {
              domProps: {
                innerHTML: `window.__USE_VITE__=${ViteMode}`
              }
            }) : h('script', {
              domProps: {
                innerHTML: `window.__USE_SSR__=true; window.__INITIAL_DATA__ =${serialize(store.state)};window.__USE_VITE__=${ViteMode}`
              }
            })
          ]),

          h('template', {
            slot: 'cssInject'
          }, injectCss),

          h('template', {
            slot: 'jsInject'
          }, injectScript)
        ]
      )
    }
  })
  return app
}

export default serverRender
