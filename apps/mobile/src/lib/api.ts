import { Platform } from "react-native";
import { authClient } from "./auth-client";
import { config } from "./config";
import { demoRequest } from "./demo";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`);
  }
}

/** Authenticated fetch: SecureStore cookie on native; credentials include on the web. */
export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  // Serverless public demo: a single detour, at the spot everything goes through. No screen knows
  // it is in demo mode; they keep asking the "API". See `src/lib/demo/`.
  if (config.demo) return demoRequest<T>(path, { method: String(init.method ?? "GET") });

  const headers: Record<string, string> = {
    accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.json !== undefined) headers["content-type"] = "application/json";
  if (Platform.OS !== "web") {
    const cookie = (authClient as { getCookie?: () => string }).getCookie?.();
    if (cookie) headers.cookie = cookie;
  }
  const res = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    credentials: Platform.OS === "web" ? "include" : "omit",
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
