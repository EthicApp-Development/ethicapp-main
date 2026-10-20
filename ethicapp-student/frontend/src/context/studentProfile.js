export const USER_PLACEHOLDER = Object.freeze({
  id: null,
  firstname: '',
  lastname: '',
  name: '',
  email: '',
  preferredLocale: null
});

/**
 * Student fields the app keeps from the GET /users/profile body.
 * @param {{ data?: object }} [responseBody]
 */
export function toStudentUser(responseBody) {
  const userData = responseBody?.data ?? {};

  return {
    id: userData.id ?? null,
    firstname: userData.firstname ?? '',
    lastname: userData.lastname ?? '',
    name: userData.name ?? '',
    email: userData.email ?? '',
    preferredLocale: userData.preferred_locale ?? null
  };
}
