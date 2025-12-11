const { google } = require("googleapis");

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

// Get service account credentials from environment variables
function getServiceAccountCredentials() {
  const requiredVars = [
    "GOOGLE_SERVICE_ACCOUNT_TYPE",
    "GOOGLE_SERVICE_ACCOUNT_PROJECT_ID",
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID",
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    "GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_CLIENT_ID",
  ];

  const missing = requiredVars.filter((varName) => !process.env[varName]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  // Build credentials object from individual env vars
  // Private key may have literal \n that need to be converted to actual newlines
  // Also handle cases where the key might be wrapped in quotes
  let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not set");
  }

  // Remove surrounding quotes if present (handles both single and double quotes)
  privateKey = privateKey.trim();
  if (
    (privateKey.startsWith('"') && privateKey.endsWith('"')) ||
    (privateKey.startsWith("'") && privateKey.endsWith("'"))
  ) {
    privateKey = privateKey.slice(1, -1).trim();
  }

  // Replace literal \n with actual newlines
  // Handle both single backslash-n and double backslash-n (in case of double escaping)
  // This handles cases where the key was stored with escaped newlines
  privateKey = privateKey.replace(/\\\\n/g, "\n"); // Handle double-escaped newlines first
  privateKey = privateKey.replace(/\\n/g, "\n"); // Then handle single-escaped newlines

  // Clean up any extra whitespace but preserve the structure
  // Ensure proper line breaks between BEGIN/END markers and key content
  privateKey = privateKey.replace(/\r\n/g, "\n"); // Normalize Windows line endings
  privateKey = privateKey.replace(/\r/g, "\n"); // Normalize Mac line endings

  // Remove any trailing newlines or whitespace after END marker
  privateKey = privateKey.trim();

  // Validate the key format
  if (!privateKey.includes("-----BEGIN PRIVATE KEY-----")) {
    throw new Error(
      "Invalid private key format: missing BEGIN PRIVATE KEY marker. " +
        "The key should start with '-----BEGIN PRIVATE KEY-----'"
    );
  }
  if (!privateKey.includes("-----END PRIVATE KEY-----")) {
    throw new Error(
      "Invalid private key format: missing END PRIVATE KEY marker. " +
        "The key should end with '-----END PRIVATE KEY-----'"
    );
  }

  // Ensure the key starts and ends correctly (after trimming)
  const trimmedKey = privateKey.trim();
  if (!trimmedKey.startsWith("-----BEGIN PRIVATE KEY-----")) {
    throw new Error(
      "Invalid private key format: key does not start with BEGIN marker"
    );
  }
  if (!trimmedKey.endsWith("-----END PRIVATE KEY-----")) {
    throw new Error(
      "Invalid private key format: key does not end with END marker"
    );
  }

  // Final cleanup: ensure proper formatting
  // The key should have a newline after BEGIN and before END markers
  privateKey = trimmedKey;

  return {
    type: process.env.GOOGLE_SERVICE_ACCOUNT_TYPE,
    project_id: process.env.GOOGLE_SERVICE_ACCOUNT_PROJECT_ID,
    private_key_id: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID,
    private_key: privateKey,
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_ID,
    auth_uri:
      process.env.GOOGLE_SERVICE_ACCOUNT_AUTH_URI ||
      "https://accounts.google.com/o/oauth2/auth",
    token_uri:
      process.env.GOOGLE_SERVICE_ACCOUNT_TOKEN_URI ||
      "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url:
      process.env.GOOGLE_SERVICE_ACCOUNT_AUTH_PROVIDER_X509_CERT_URL ||
      "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url:
      process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_X509_CERT_URL,
    universe_domain:
      process.env.GOOGLE_SERVICE_ACCOUNT_UNIVERSE_DOMAIN || "googleapis.com",
  };
}

// Convert "10/7/2021" (UK) → "2021-07-10" (ISO)
function ukToIso(dateStr) {
  if (!dateStr) return null;
  const [d, m, y] = dateStr.split("/").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Convert ISO date string to Date object at midnight UTC
function isoToDate(dateISO) {
  if (!dateISO) return null;
  return new Date(dateISO + "T00:00:00.000Z");
}

// Convert string to number, handling empty strings and null
function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

/**
 * Fetch data from Google Sheets
 * @param {string} spreadsheetId - The Google Sheets spreadsheet ID
 * @param {string} range - The range to fetch (e.g., "Sheet1!A1:L10")
 * @returns {Promise<Array>} Array of objects with sheet data
 */
async function fetchSheetData(spreadsheetId, range) {
  try {
    const credentials = getServiceAccountCredentials();

    // Validate credentials structure
    if (!credentials.private_key || !credentials.client_email) {
      throw new Error(
        "Invalid credentials: missing private_key or client_email"
      );
    }

    // Validate private key format more strictly
    const keyStart = "-----BEGIN PRIVATE KEY-----";
    const keyEnd = "-----END PRIVATE KEY-----";
    if (
      !credentials.private_key.includes(keyStart) ||
      !credentials.private_key.includes(keyEnd)
    ) {
      throw new Error(
        "Invalid private key format: must include BEGIN and END markers"
      );
    }

    let auth;
    try {
      auth = new google.auth.GoogleAuth({
        credentials,
        scopes: SCOPES,
      });
    } catch (authError) {
      // Provide more helpful error message for credential issues
      if (
        authError.message.includes("DECODER") ||
        authError.message.includes("PEM")
      ) {
        throw new Error(
          `Failed to parse private key. This usually means the key format is incorrect. ` +
            `Ensure the key in Heroku config vars has proper newlines (use \\n) and is not corrupted. ` +
            `Original error: ${authError.message}`
        );
      }
      throw authError;
    }

    const sheets = google.sheets({ version: "v4", auth });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const values = res.data.values || [];
    if (!values.length) {
      console.log("No data found in sheet.");
      return [];
    }

    const [header, ...rows] = values;

    const data = rows.map((row) => {
      const obj = {};

      header.forEach((colName, i) => {
        const value = row[i] ?? null;

        if (colName === "Date") {
          obj.dateISO = ukToIso(value);
          obj.Date = value; // Keep original for reference
        } else {
          obj[colName] = value;
        }
      });

      return obj;
    });

    return data;
  } catch (error) {
    console.error("Error fetching Google Sheets data:", error.message);
    throw error;
  }
}

/**
 * Map Google Sheets data format to SystemResult model format
 * @param {Object} sheetRow - Row from Google Sheets
 * @param {string} systemId - The system ID
 * @returns {Object} SystemResult document
 */
function mapToSystemResult(sheetRow, systemId) {
  const dateISO = sheetRow.dateISO || ukToIso(sheetRow.Date);

  const mapped = {
    systemId,
    dateISO,
    date: isoToDate(dateISO),
    country: sheetRow.Country || null,
    meeting: sheetRow.Meeting || null,
    time: sheetRow.Time || null,
    horse: sheetRow.Horse || null,
    winBsp: toNumber(sheetRow["Win BSP"]),
    result: sheetRow.Result || null,
    winPL: toNumber(sheetRow["P/L (1pt Level Stakes Lay)"]),
    runningWinPL: toNumber(sheetRow["Running P/L (Win)"]),
    placeBsp: toNumber(sheetRow["Place BSP"]),
    placePL: toNumber(sheetRow["Place P/L"]),
    runningPlacePL: toNumber(sheetRow["Running P/L (Place)"]),
  };
  // console.log("mapped", mapped);

  return mapped;
}

module.exports = {
  fetchSheetData,
  mapToSystemResult,
};
