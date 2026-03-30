const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL

function getApiBaseUrl() {
  if (!API_BASE_URL) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured.")
  }

  return API_BASE_URL.replace(/\/$/, "")
}

export async function bootstrapOwnerProfile(token: string) {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/auth/bootstrap`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Bootstrap failed with status ${response.status}`)
  }

  return response.json()
}
