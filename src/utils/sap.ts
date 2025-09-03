export async function getSAP(url: string) {
  const username = process.env.SAP_API_USERNAME;
  const password = process.env.SAP_API_PASSWORD;

  return fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${btoa(`${username}:${password}`)}`,
      Accept: "application/json",
    },
  });
}
