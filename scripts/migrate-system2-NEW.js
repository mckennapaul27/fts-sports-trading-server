// Migration script for NEW System 2 historical data
// This script reads CSV data and migrates it to SystemSelection documents

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const connectDB = require("../config/database");
const System = require("../models/System");
const SystemSelection = require("../models/SystemSelection");

const CSV_FILE_PATH = path.join(
  __dirname,
  "../system-historical-data/FST New System 2.xlsx - FST New System 2.csv"
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
// Formula matches Google Sheet: F3*-1+1 = 1 - BSP
function calculateWinPL(result, bsp) {
  if (result.toUpperCase() === "LOST") {
    return 0.98; // 1pt - 2% commission
  } else if (result.toUpperCase() === "WON") {
    return 1 - bsp; // Negative value (loss for lay bet) - matches sheet formula
  }
  return 0;
}

// Normalize result string
function normalizeResult(result) {
  const upper = result.toUpperCase();
  if (upper === "WON") return "WON";
  if (upper === "LOST") return "LOST";
  return result;
}

async function migrateSystem2New() {
  try {
    console.log("🔄 Starting NEW System 2 migration...");

    // Connect to database
    await connectDB();
    console.log("✅ Connected to database");

    // Find System 2 (should already exist)
    const system2 = await System.findOne({ slug: "system-2" });
    if (!system2) {
      throw new Error(
        "System 2 not found in database. Please create it first with uniqueName."
      );
    }
    console.log(`✅ Found System 2: ${system2.name} (${system2.uniqueName})`);

    // Delete existing System 2 selections to avoid duplicates
    const deletedCount = await SystemSelection.deleteMany({
      systemId: system2._id,
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
    const meetingIdx = header.indexOf("Meeting");
    const timeIdx = header.indexOf("Time");
    const horseIdx = header.indexOf("Horse");
    const resultIdx = header.indexOf("Result");
    const bspIdx = header.indexOf("BSP");

    if (
      dateIdx === -1 ||
      meetingIdx === -1 ||
      timeIdx === -1 ||
      horseIdx === -1 ||
      resultIdx === -1 ||
      bspIdx === -1
    ) {
      throw new Error("Required columns not found in CSV");
    }

    // Parse data rows
    const selections = [];
    let runningWinPL = 0;

    console.log(`📊 Processing ${lines.length - 1} data rows...`);

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Simple CSV parsing (split by comma)
      // Note: This assumes no commas in field values
      const values = line.split(",").map((v) => v.trim());

      const dateStr = values[dateIdx];
      const meeting = values[meetingIdx];
      const time = values[timeIdx];
      const horse = values[horseIdx];
      const result = values[resultIdx];
      const bspStr = values[bspIdx];

      // Skip rows with missing required data
      if (!dateStr || !horse || !result || !bspStr) {
        console.log(`⚠️  Skipping row ${i + 1}: missing required data`);
        continue;
      }

      // Parse date
      const { date, dateISO } = parseDate(dateStr);

      // Parse BSP
      const bsp = parseFloat(bspStr);
      if (isNaN(bsp)) {
        console.log(`⚠️  Skipping row ${i + 1}: invalid BSP value: ${bspStr}`);
        continue;
      }

      // Calculate winPL
      const winPL = calculateWinPL(result, bsp);
      runningWinPL += winPL;

      // Create selection document
      const selection = {
        systemId: system2._id,
        dateISO,
        date,
        meeting: meeting || undefined,
        time: time || undefined,
        horse,
        result: normalizeResult(result),
        winBsp: bsp,
        winPL,
        runningWinPL,
        hasResult: true,
        isNewSelection: false, // Historical data, not new
        rowOrder: i, // Maintain order from CSV
      };

      selections.push(selection);
    }

    console.log(`✅ Parsed ${selections.length} valid selections`);

    // Insert selections into database
    console.log("💾 Inserting selections into database...");
    const result = await SystemSelection.insertMany(selections, {
      ordered: false,
    });
    console.log(`✅ Successfully inserted ${result.length} selections`);

    // Display summary
    const wonCount = selections.filter((s) => s.result === "WON").length;
    const lostCount = selections.filter((s) => s.result === "LOST").length;
    const finalPL = selections[selections.length - 1]?.runningWinPL || 0;

    console.log("\n📈 Migration Summary:");
    console.log(`   Total selections: ${selections.length}`);
    console.log(`   Won: ${wonCount}`);
    console.log(`   Lost: ${lostCount}`);
    console.log(`   Final running PL: ${finalPL.toFixed(2)}`);

    console.log("\n✅ Migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run migration
migrateSystem2New();
