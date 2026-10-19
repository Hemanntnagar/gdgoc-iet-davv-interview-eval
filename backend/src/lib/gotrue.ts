/**
 * Minimal GoTrue admin helpers (service-role only, server-side).
 * Used to undo a failed registration: the account is deleted so only
 * invited people (valid panel/admin code) can hold an account.
 */
export async function deleteAuthUser(
  baseUrl: string,
  serviceKey: string,
  userId: string,
): Promise<void> {
  if (!baseUrl || !serviceKey) return;
  const res = await fetch(`${baseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteAuthUser: ${res.status}`);
  }
}
