// Migration script for System 1 historical data
// This script reads CSV data and migrates it to SystemSelection documents
// System 1 handles both win and place markets

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const connectDB = require("../config/database");
const System = require("../models/System");
const SystemSelection = require("../models/SystemSelection");

const CSV_FILE_PATH = path.join(
  __dirname,
  "../system-historical-data/System 1 - Sheet1.csv"
);

// Parse date from DD/MM/YYYY to Date object and ISO string
function parseDate(dateStr) {
  const [day, month, year] = dateStr.split("/");
  const date = new Date(
    Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day))
  );
  const dateISO = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return { date, dateISO };
}

// Calculate winPL based on result and BSP
// Formula matches Google Sheet: 1 - BSP for WON, 0.98 for LOST/PLACED
function calculateWinPL(result, winBsp) {
  const upperResult = result.toUpperCase();
  if (upperResult === "WON") {
    return 1 - winBsp; // Negative value (loss for lay bet)
  } else if (upperResult === "LOST" || upperResult === "PLACED") {
    return 0.98; // 1pt - 2% commission
  }
  return 0;
}

// Calculate placePL based on result and placeBSP
// If horse WON or PLACED, the place lay loses (negative)
// If horse LOST, the place lay wins (keeps stake minus commission)
function calculatePlacePL(result, placeBsp) {
  const upperResult = result.toUpperCase();
  if (upperResult === "WON" || upperResult === "PLACED") {
    return 1 - placeBsp; // Negative value (loss for lay bet - horse placed)
  }
  // For LOST, place bet wins (keeps stake minus commission)
  return 0.98;
}

// Normalize result string
function normalizeResult(result) {
  const upper = result.toUpperCase();
  if (upper === "WON") return "WON";
  if (upper === "LOST") return "LOST";
  if (upper === "PLACED") return "PLACED";
  return result;
}

async function migrateSystem1() {
  try {
    console.log("🔄 Starting System 1 migration...");

    // Connect to database
    await connectDB();
    console.log("✅ Connected to database");

    // Create or find System 1
    let system1 = await System.findOne({ slug: "system-1" });
    if (!system1) {
      system1 = await System.create({
        name: "System 1",
        slug: "system-1",
        description: "FST System 1 - Win and Place markets",
        isActive: true,
        // Note: sheets config not required for new approach, but keeping structure for now
        sheets: {
          selections: {
            spreadsheetId: "",
            range: "",
          },
          results: {
            spreadsheetId: "",
            range: "",
          },
        },
      });
      console.log("✅ Created System 1");
    } else {
      console.log("✅ Found existing System 1");
    }

    // Delete existing System 1 selections to avoid duplicates
    const deletedCount = await SystemSelection.deleteMany({
      systemId: system1._id,
    });
    if (deletedCount.deletedCount > 0) {
      console.log(
        `🗑️  Deleted ${deletedCount.deletedCount} existing selections`
      );
    }

    // Read CSV file
    console.log(`📖 Reading CSV file: ${CSV_FILE_PATH}`);
    const csvContent = fs.readFileSync(CSV_FILE_PATH, "utf-8");
    const lines = csvContent.split("\n").filter((line) => line.trim());

    if (lines.length < 2) {
      throw new Error("CSV file appears to be empty or invalid");
    }

    // Parse header
    const header = lines[0].split(",").map((h) => h.trim());
    console.log("📋 CSV Headers:", header);

    // Find column indices
    const dateIdx = header.indexOf("Date");
    const countryIdx = header.indexOf("Country");
    const meetingIdx = header.indexOf("Meeting");
    const timeIdx = header.indexOf("Time");
    const horseIdx = header.indexOf("Horse");
    const winBspIdx = header.indexOf("Win BSP");
    const resultIdx = header.indexOf("Result");
    const placeBspIdx = header.indexOf("Place BSP");
    const placePLIdx = header.indexOf("Place P/L");
    const runningPlacePLIdx = header.indexOf("Running P/L (Place)");

    if (
      dateIdx === -1 ||
      countryIdx === -1 ||
      meetingIdx === -1 ||
      timeIdx === -1 ||
      horseIdx === -1 ||
      winBspIdx === -1 ||
      resultIdx === -1 ||
      placeBspIdx === -1
    ) {
      throw new Error("Required columns not found in CSV");
    }

    // Check if reference columns exist (for comparison)
    const hasReferenceData = placePLIdx !== -1 && runningPlacePLIdx !== -1;
    if (hasReferenceData) {
      console.log("✅ Found reference Place P/L columns for validation");
    }

    // Parse data rows
    const selections = [];
    let runningWinPL = 0;
    let runningPlacePL = 0;
    let placePLCalculatedCount = 0;
    let discrepancies = [];
    let firstDiscrepancyRow = null;

    console.log(`📊 Processing ${lines.length - 1} data rows...`);

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Simple CSV parsing (split by comma)
      // Note: This assumes no commas in field values
      const values = line.split(",").map((v) => v.trim());

      const dateStr = values[dateIdx];
      const country = values[countryIdx];
      const meeting = values[meetingIdx];
      const time = values[timeIdx];
      const horse = values[horseIdx];
      const winBspStr = values[winBspIdx];
      const result = values[resultIdx];
      const placeBspStr = values[placeBspIdx];

      // Read reference values from CSV if available
      const csvPlacePL =
        hasReferenceData && values[placePLIdx]
          ? parseFloat(values[placePLIdx])
          : null;
      const csvRunningPlacePL =
        hasReferenceData && values[runningPlacePLIdx]
          ? parseFloat(values[runningPlacePLIdx])
          : null;

      // Skip rows with missing required data
      if (!dateStr || !horse || !result || !winBspStr) {
        console.log(`⚠️  Skipping row ${i + 1}: missing required data`);
        continue;
      }

      // Parse date
      const { date, dateISO } = parseDate(dateStr);

      // Parse Win BSP
      const winBsp = parseFloat(winBspStr);
      if (isNaN(winBsp)) {
        console.log(
          `⚠️  Skipping row ${i + 1}: invalid Win BSP value: ${winBspStr}`
        );
        continue;
      }

      // Parse Place BSP (optional, but should be present)
      const placeBsp =
        placeBspStr && placeBspStr.trim() !== ""
          ? parseFloat(placeBspStr)
          : null;
      if (placeBspStr && placeBspStr.trim() !== "" && isNaN(placeBsp)) {
        console.log(
          `⚠️  Skipping row ${i + 1}: invalid Place BSP value: ${placeBspStr}`
        );
        continue;
      }

      // Calculate winPL
      const winPL = calculateWinPL(result, winBsp);
      runningWinPL += winPL;

      // Calculate placePL
      // For LOST: always +0.98 (place lay wins, even if placeBSP is missing)
      // For WON: +1.00 if no placeBSP (place lay voided/not placed), or 1 - placeBSP if placeBSP exists
      // For PLACED: 1 - placeBSP (only if placeBSP exists, otherwise null)
      let placePL = null;
      const upperResult = result.toUpperCase();

      if (upperResult === "LOST") {
        // For LOST horses, placePL is always +0.98 (place lay wins)
        placePL = 0.98;
        runningPlacePL += placePL;
        placePLCalculatedCount++;
      } else if (upperResult === "WON") {
        if (placeBsp !== null && !isNaN(placeBsp)) {
          // For WON with placeBSP, calculate loss: 1 - placeBSP
          placePL = calculatePlacePL(result, placeBsp);
        } else {
          // For WON without placeBSP, place lay is voided/not placed, get stake back
          placePL = 1.0;
        }
        runningPlacePL += placePL;
        placePLCalculatedCount++;
      } else if (
        upperResult === "PLACED" &&
        placeBsp !== null &&
        !isNaN(placeBsp)
      ) {
        // For PLACED, need placeBSP to calculate
        placePL = calculatePlacePL(result, placeBsp);
        runningPlacePL += placePL;
        placePLCalculatedCount++;
      }
      // If PLACED but no placeBSP, placePL remains null

      // Compare with CSV reference values if available
      if (hasReferenceData && csvPlacePL !== null && !isNaN(csvPlacePL)) {
        if (placePL === null || Math.abs(placePL - csvPlacePL) > 0.01) {
          if (!firstDiscrepancyRow) firstDiscrepancyRow = i + 1;
          discrepancies.push({
            row: i + 1,
            horse,
            result,
            calculated: placePL,
            csv: csvPlacePL,
            difference: placePL !== null ? placePL - csvPlacePL : null,
          });
        }
      }

      // Compare running totals
      if (
        hasReferenceData &&
        csvRunningPlacePL !== null &&
        !isNaN(csvRunningPlacePL)
      ) {
        if (Math.abs(runningPlacePL - csvRunningPlacePL) > 0.01) {
          if (discrepancies.length < 10) {
            // Only log first few running total discrepancies to avoid spam
            console.log(
              `⚠️  Row ${
                i + 1
              } (${horse}): Running Place PL mismatch - Calculated: ${runningPlacePL.toFixed(
                2
              )}, CSV: ${csvRunningPlacePL.toFixed(2)}, Diff: ${(
                runningPlacePL - csvRunningPlacePL
              ).toFixed(2)}`
            );
          }
        }
      }

      // Create selection document
      const selection = {
        systemId: system1._id,
        dateISO,
        date,
        country: country || undefined,
        meeting: meeting || undefined,
        time: time || undefined,
        horse,
        result: normalizeResult(result),
        winBsp,
        winPL,
        runningWinPL,
        placeBsp: placeBsp || undefined,
        placePL: placePL !== null ? placePL : undefined,
        runningPlacePL: placePL !== null ? runningPlacePL : undefined,
        hasResult: true,
        isNewSelection: false, // Historical data, not new
        rowOrder: i, // Maintain order from CSV
      };

      selections.push(selection);
    }

    console.log(`✅ Parsed ${selections.length} valid selections`);
    console.log(`   Rows with placePL calculated: ${placePLCalculatedCount}`);

    // Report discrepancies
    if (discrepancies.length > 0) {
      console.log(
        `\n⚠️  Found ${discrepancies.length} discrepancies in Place P/L calculation:`
      );
      const firstFew = discrepancies.slice(0, 10);
      firstFew.forEach((d) => {
        console.log(
          `   Row ${d.row} (${d.horse}, ${d.result}): Calculated=${
            d.calculated
          }, CSV=${d.csv}, Diff=${
            d.difference !== null ? d.difference.toFixed(2) : "N/A"
          }`
        );
      });
      if (discrepancies.length > 10) {
        console.log(`   ... and ${discrepancies.length - 10} more`);
      }
      console.log(`   First discrepancy at row ${firstDiscrepancyRow}`);
    } else if (hasReferenceData) {
      console.log(`✅ All Place P/L calculations match CSV reference values!`);
    }

    // Insert selections into database
    console.log("💾 Inserting selections into database...");
    const result = await SystemSelection.insertMany(selections, {
      ordered: false,
    });
    console.log(`✅ Successfully inserted ${result.length} selections`);

    // Display summary
    const wonCount = selections.filter((s) => s.result === "WON").length;
    const lostCount = selections.filter((s) => s.result === "LOST").length;
    const placedCount = selections.filter((s) => s.result === "PLACED").length;
    const finalWinPL = selections[selections.length - 1]?.runningWinPL || 0;
    const finalPlacePL = selections[selections.length - 1]?.runningPlacePL || 0;

    console.log("\n📈 Migration Summary:");
    console.log(`   Total selections: ${selections.length}`);
    console.log(`   Won: ${wonCount}`);
    console.log(`   Lost: ${lostCount}`);
    console.log(`   Placed: ${placedCount}`);
    console.log(`   Final running Win PL: ${finalWinPL.toFixed(2)}`);
    console.log(`   Final running Place PL: ${finalPlacePL.toFixed(2)}`);
    console.log(`   Total PL: ${(finalWinPL + finalPlacePL).toFixed(2)}`);

    console.log("\n✅ Migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run migration
migrateSystem1();
