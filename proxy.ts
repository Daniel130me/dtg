import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/server/auth/auth';

export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('returnTo', `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/learning/:path*', '/certificates/:path*', '/profile/:path*', '/owner/:path*'],
};
