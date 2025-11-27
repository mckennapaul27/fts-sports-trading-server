const { google } = require("googleapis");
const path = require("path");

const KEYFILE_PATH = path.join(__dirname, "../service-account-key.json");
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

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
    const auth = new google.auth.GoogleAuth({
      keyFile: KEYFILE_PATH,
      scopes: SCOPES,
    });

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
  //   console.log("mapped", mapped);

  return mapped;
}

module.exports = {
  fetchSheetData,
  mapToSystemResult,
};
