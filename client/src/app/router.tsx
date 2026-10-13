import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppLayout, RootRedirect } from './app-layout'
import { RouteError } from './route-error'

/**
 * Client routes. Mirrors the former Next.js `src/app` tree one-to-one so every
 * existing URL (bookmarks, links in the daily brief email) keeps working.
 *
 * Each page lives in `src/pages/<route>/index.tsx` with a default export and is
 * code-split. Pages fetch their data from `/api/pages/<route>`; authorisation
 * is enforced there, not here.
 */

type PageModule = { default: React.ComponentType }
const page = (load: () => Promise<PageModule>): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => ({ Component: (await load()).default }),
})

export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect />, errorElement: <RouteError /> },
  { path: '/sign-in', ...page(() => import('@/pages/sign-in')), errorElement: <RouteError /> },
  { path: '/no-access', ...page(() => import('@/pages/system/no-access')) },
  { path: '/offline', ...page(() => import('@/pages/system/offline')) },
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { path: '/overview', ...page(() => import('@/pages/overview')) },
          { path: '/revenue', ...page(() => import('@/pages/revenue')) },
          { path: '/accounts-receivable', ...page(() => import('@/pages/accounts-receivable')) },
          { path: '/sales-pipeline', ...page(() => import('@/pages/sales-pipeline')) },
          { path: '/ecommerce', ...page(() => import('@/pages/ecommerce')) },
          { path: '/gross-margin', ...page(() => import('@/pages/gross-margin')) },
          { path: '/ask', ...page(() => import('@/pages/ask')) },
          { path: '/daily-brief', ...page(() => import('@/pages/daily-brief')) },
          { path: '/data-health', ...page(() => import('@/pages/data-health')) },
          { path: '/users', ...page(() => import('@/pages/users')) },
          { path: '/account', ...page(() => import('@/pages/account')) },
          {
            path: '/settings',
            ...page(() => import('@/pages/settings/layout')),
            children: [
              { index: true, ...page(() => import('@/pages/settings')) },
              { path: 'brief', ...page(() => import('@/pages/settings/brief')) },
              { path: 'divisions', ...page(() => import('@/pages/settings/divisions')) },
              { path: 'integrations', ...page(() => import('@/pages/settings/integrations')) },
              { path: 'metrics', ...page(() => import('@/pages/settings/metrics')) },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', ...page(() => import('@/pages/system/not-found')) },
])
