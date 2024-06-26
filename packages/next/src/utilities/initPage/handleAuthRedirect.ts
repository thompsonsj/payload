import { redirect } from 'next/navigation.js'
import { parse, stringify } from 'picoquery'

import { isAdminAuthRoute, isAdminRoute } from './shared.js'

export const handleAuthRedirect = ({
  config,
  redirectUnauthenticatedUser,
  route,
  searchParams,
}: {
  config
  redirectUnauthenticatedUser: boolean | string
  route: string
  searchParams: { [key: string]: string | string[] }
}) => {
  const {
    admin: {
      routes: { login: loginRouteFromConfig },
    },
    routes: { admin: adminRoute },
  } = config

  if (!isAdminAuthRoute(config, route, adminRoute)) {
    if (searchParams && 'redirect' in searchParams) delete searchParams.redirect

    const redirectRoute = encodeURIComponent(
      route + Object.keys(searchParams ?? {}).length
        ? `?${stringify(searchParams, { nestingSyntax: 'index' })}`
        : undefined,
    )

    const adminLoginRoute = `${adminRoute}${loginRouteFromConfig}`

    const customLoginRoute =
      typeof redirectUnauthenticatedUser === 'string' ? redirectUnauthenticatedUser : undefined

    const loginRoute = isAdminRoute(route, adminRoute)
      ? adminLoginRoute
      : customLoginRoute || loginRouteFromConfig

    const parsedLoginRouteSearchParams = parse(loginRoute.split('?')[1] ?? '', {
      nestingSyntax: 'index',
    })

    const searchParamsWithRedirect = `?${stringify(
      {
        ...parsedLoginRouteSearchParams,
        ...(redirectRoute ? { redirect: redirectRoute } : {}),
      },
      { nestingSyntax: 'index' },
    )}`

    redirect(`${loginRoute.split('?')[0]}${searchParamsWithRedirect}`)
  }
}
