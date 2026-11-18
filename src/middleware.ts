import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = pathname === "/" || pathname === "/sign-in" || pathname === "/sign-up" || pathname === "/admin-setup";
  const hasSession = Boolean(request.cookies.get("vi_session")?.value);
  if (!isPublic && !hasSession) {
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = "/sign-in";
    signInUrl.search = "";
    signInUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(signInUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
