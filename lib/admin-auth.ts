import { NextResponse } from "next/server";

function readAdminHeader(request: Request) {
  const raw = request.headers.get("x-admin-key") ?? request.headers.get("authorization") ?? "";
  if (!raw) {
    return "";
  }

  if (raw.toLowerCase().startsWith("bearer ")) {
    return raw.slice(7).trim();
  }

  return raw.trim();
}

export function ensureAdminAccess(request: Request): NextResponse | null {
  const adminKey = process.env.ADMIN_PANEL_KEY;
  if (!adminKey) {
    return NextResponse.json(
      { error: "Admin panel is disabled. Configure ADMIN_PANEL_KEY on the server." },
      { status: 503 }
    );
  }

  const provided = readAdminHeader(request);
  if (!provided || provided !== adminKey) {
    return NextResponse.json({ error: "Unauthorized admin access." }, { status: 401 });
  }

  return null;
}

