import { InonSsoError } from "@inon-ai/inon-sso";
import { NextResponse, type NextRequest } from "next/server";
import {
  checkUserOwnsIdentifier,
  getUserDashboardPath,
} from "@/lib/auth/access";
import { getInonProjectSso } from "@/lib/sso/project-client";
import { inonSsoOrigin } from "@/lib/sso/origin";

function requestReturnTo(request: NextRequest): string {
  return `${request.nextUrl.pathname}${request.nextUrl.search}`;
}

function projectRedirect(
  request: NextRequest,
  path: string,
): NextResponse {
  return NextResponse.redirect(new URL(path, request.url));
}

// These pages belong to the central identity app; /sso/start|end|refresh stay
// on the product origin because they own the project session cookie.
function isSsoUiPath(pathname: string): boolean {
  if (pathname === "/sso") return true;
  return ["/sso/login", "/sso/account", "/sso/consent"].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (process.env.NODE_ENV === "production") {
    const ssoOrigin = new URL(inonSsoOrigin());
    if (request.nextUrl.host === ssoOrigin.host && pathname === "/") {
      return NextResponse.redirect(new URL("/sso/login", request.url));
    }
    if (isSsoUiPath(pathname) && request.nextUrl.host !== ssoOrigin.host) {
      return NextResponse.redirect(
        new URL(`${pathname}${request.nextUrl.search}`, ssoOrigin),
      );
    }
  }

  const isAdminPage = pathname.startsWith("/admin");
  const isOwnerPage =
    pathname === "/i" || pathname.startsWith("/i/");
  const isAdminApi = pathname.startsWith("/api/admin");
  const isAccountApi =
    pathname === "/api/account" ||
    pathname.startsWith("/api/account/");
  const requiresSession =
    isAdminPage || isOwnerPage || isAdminApi || isAccountApi;

  if (!requiresSession) {
    return NextResponse.next({ request });
  }

  const sso = getInonProjectSso();
  const session = await sso.getSession(request);
  if (!session) {
    if (isAdminApi || isAccountApi) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }
    return projectRedirect(
      request,
      sso.loginUrl(requestReturnTo(request)),
    );
  }

  if (isAdminPage || isAdminApi) {
    try {
      await sso.requireProjectAdmin(request);
    } catch (error) {
      if (
        error instanceof InonSsoError &&
        error.code === "REFRESH_REQUIRED"
      ) {
        const refreshUrl = sso.refreshUrl(requestReturnTo(request));
        if (isAdminApi) {
          return NextResponse.json(
            { error: "Session refresh required", refreshUrl },
            { status: 401 },
          );
        }
        return projectRedirect(request, refreshUrl);
      }
      if (isAdminApi) {
        return NextResponse.json(
          { error: "Forbidden" },
          { status: 403 },
        );
      }
      return projectRedirect(
        request,
        (await getUserDashboardPath(session.id)) ?? "/",
      );
    }
  }

  if (pathname.startsWith("/i/")) {
    const identifier = pathname.slice("/i/".length).split("/")[0];
    if (
      identifier &&
      !(await checkUserOwnsIdentifier(session.id, identifier))
    ) {
      return projectRedirect(
        request,
        (await getUserDashboardPath(session.id)) ?? "/i",
      );
    }
  }

  return NextResponse.next({ request });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
