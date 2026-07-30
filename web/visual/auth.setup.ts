import { expect, test as setup } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { STORAGE_STATE } from "./playwright.config";
import { FIXTURE_USER } from "./fixture";

// One login per run; both shot projects reuse the cookie via storageState.
//
// Done through the API rather than the login form because the API issues the
// session cookie with Secure in production, and a browser refuses to store that
// over plain http from a non-localhost host. Re-declaring it with secure:false
// keeps the stack production-configured; the login form itself is still covered
// by the unauthenticated shots.
setup("authenticate", async ({ request, baseURL }) => {
  const response = await request.post("/api/v1/auth/login", {
    data: { email: FIXTURE_USER.email, password: FIXTURE_USER.password },
  });
  expect(response.status()).toBe(200);

  const setCookie = response
    .headersArray()
    .find((header) => header.name.toLowerCase() === "set-cookie");
  const token = setCookie?.value.match(/session=([^;]+)/)?.[1];
  expect(token, "login did not return a session cookie").toBeTruthy();

  const state = {
    cookies: [
      {
        name: "session",
        value: token!,
        domain: new URL(baseURL!).hostname,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  };

  await mkdir(dirname(STORAGE_STATE), { recursive: true });
  await writeFile(STORAGE_STATE, JSON.stringify(state, null, 2));
});
