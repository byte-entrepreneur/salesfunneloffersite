import fetch from "node-fetch";

let cachedEnvToken = null;

export async function getValidZohoToken(databases) {
  // If a refresh token is present in environment, use it first (avoids Appwrite dependency)
  if (process.env.ZOHO_REFRESH_TOKEN) {
    if (cachedEnvToken && cachedEnvToken.expiresAt > Date.now() + 60000) {
      return cachedEnvToken.accessToken;
    }

    const accountsDomain = process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com";
    const response = await fetch(`${accountsDomain}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: "refresh_token",
      }),
    });

    const result = await response.json();
    if (!result.access_token) {
      throw new Error(`Failed to refresh Zoho token using ZOHO_REFRESH_TOKEN from env: ${JSON.stringify(result)}`);
    }

    cachedEnvToken = {
      accessToken: result.access_token,
      expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000,
    };
    return cachedEnvToken.accessToken;
  }
  // Try to read token from Appwrite if available (fallback)
  try {
    const tokenDoc = await databases.listDocuments("ordersDB", "zohoTokens");
    const tokenData = tokenDoc.documents && tokenDoc.documents[0];

    if (tokenData) {
      const expiry = Number(tokenData.expiry_time || 0);
      const isExpired = !expiry || Date.now() >= expiry;

      if (!isExpired && tokenData.access_token) return tokenData.access_token;

      // Refresh using stored refresh_token if present
      if (tokenData.refresh_token) {
        const accountsDomain = process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com";
        const response = await fetch(`${accountsDomain}/oauth/v2/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            refresh_token: tokenData.refresh_token,
            client_id: process.env.ZOHO_CLIENT_ID,
            client_secret: process.env.ZOHO_CLIENT_SECRET,
            grant_type: "refresh_token",
          }),
        });

        const result = await response.json();
        if (!result.access_token) {
          throw new Error(`Failed to refresh Zoho token from Appwrite-stored refresh_token: ${JSON.stringify(result)}`);
        }

        // Save new token back to Appwrite if we have an id
        try {
          await databases.updateDocument("ordersDB", "zohoTokens", tokenData.$id, {
            access_token: result.access_token,
            expiry_time: Date.now() + (result.expires_in || 3600) * 1000,
          });
        } catch (e) {
          console.warn('Unable to persist refreshed Zoho token to Appwrite:', e.message || e);
        }

        return result.access_token;
      }
    }
  } catch (err) {
    console.warn('Unable to read Zoho token from Appwrite:', err.message || err);
  }

  throw new Error('No Zoho token available: missing Appwrite token doc and ZOHO_REFRESH_TOKEN env var');
}
