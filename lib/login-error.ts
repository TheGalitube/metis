export const LOGIN_CREDENTIAL_ERROR = "Wrong username or password";
export const LOGIN_RATE_LIMIT_ERROR = "Too many login attempts. Please try again later.";
export const LOGIN_SERVER_ERROR = "J.A.R.V.I.S. Mk3.1 cannot reach the server or access its storage. Check the server and try again.";

export function loginErrorMessage(status?: number, serverMessage = "") {
  if (status === 401) return LOGIN_CREDENTIAL_ERROR;
  if (status === 429) return LOGIN_RATE_LIMIT_ERROR;
  if (
    status === undefined ||
    status >= 500 ||
    /unable to open database file|database.*(?:read-only|locked)|storage/i.test(serverMessage)
  ) {
    return LOGIN_SERVER_ERROR;
  }
  return "Sign-in failed. Check the server and try again.";
}
