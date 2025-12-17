// Migration script for System 6 historical data
// Win market only

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const connectDB = require("../config/database");
const System = require("../models/System");
const SystemSelection = require("../models/SystemSelection");

const CSV_FILE_PATH = path.join(
  __dirname,
  "../system-historical-data/FST System 6.xlsx - FST System 6.csv"
);

function parseDate(dateStr) {
  const [day, month, year] = dateStr.split("/");
  const date = new Date(
    Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10))
  );
  const dateISO = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return { date, dateISO };
}

function normalizeResult(result) {
  const upper = String(result || "").toUpperCase();
  if (upper === "WON") return "WON";
  if (upper === "LOST") return "LOST";
  return upper || result;
}

// Win lay PL
// LOST => +0.98
// WON  => (1 - BSP) ; if BSP missing => +1.00 (stake returned / no BSP recorded)
function calculateWinPL(result, bsp) {
  const upper = String(result || "").toUpperCase();
  if (upper === "LOST") return 0.98;
  if (upper === "WON") return bsp === null ? 1.0 : 1 - bsp;
  return 0;
}

async function migrateSystem6() {
  try {
    console.log("🔄 Starting System 6 migration...");
    await connectDB();
    console.log("✅ Connected to database");

    let system6 = await System.findOne({ slug: "system-6" });
    if (!system6) {
      system6 = await System.create({
        name: "System 6",
        slug: "system-6",
        isActive: true,
      });
      console.log("✅ Created System 6");
    } else {
      console.log("✅ Found existing System 6");
    }

    const deleted = await SystemSelection.deleteMany({ systemId: system6._id });
    if (deleted.deletedCount > 0) {
      console.log(`🗑️  Deleted ${deleted.deletedCount} existing selections`);
    }

    console.log(`📖 Reading CSV file: ${CSV_FILE_PATH}`);
    const csvContent = fs.readFileSync(CSV_FILE_PATH, "utf-8");
    const lines = csvContent.split("\n").filter((l) => l.trim());
    if (lines.length < 2)
      throw new Error("CSV file appears to be empty or invalid");

    const header = lines[0].split(",").map((h) => h.trim());
    console.log("📋 CSV Headers:", header);

    const dateIdx = header.indexOf("Date");
    const meetingIdx = header.indexOf("Meeting");
    const timeIdx = header.indexOf("Time");
    const horseIdx = header.indexOf("Horse");
    const resultIdx = header.indexOf("Result");
    const bspIdx = header.indexOf("BSP");

    if (
      [dateIdx, meetingIdx, timeIdx, horseIdx, resultIdx, bspIdx].some(
        (i) => i === -1
      )
    ) {
      throw new Error("Required columns not found in CSV");
    }

    const selections = [];
    let runningWinPL = 0;

    console.log(`📊 Processing ${lines.length - 1} data rows...`);

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim());

      const dateStr = values[dateIdx];
      const meeting = values[meetingIdx];
      const time = values[timeIdx];
      const horse = values[horseIdx];
      const result = values[resultIdx];
      const bspStr = values[bspIdx];

      if (!dateStr || !horse || !result) {
        console.log(`⚠️  Skipping row ${i + 1}: missing required data`);
        continue;
      }

      const { date, dateISO } = parseDate(dateStr);
      const bsp = bspStr ? parseFloat(bspStr) : null;
      if (bspStr && Number.isNaN(bsp)) {
        console.log(`⚠️  Skipping row ${i + 1}: invalid BSP value: ${bspStr}`);
        continue;
      }

      const normalizedResult = normalizeResult(result);
      if (normalizedResult === "WON" && bsp === null) {
        console.log(`⚠️  Row ${i + 1}: WON but BSP missing, using winPL=+1.00`);
      }

      const winPL = calculateWinPL(normalizedResult, bsp);
      runningWinPL += winPL;

      const selection = {
        systemId: system6._id,
        dateISO,
        date,
        meeting: meeting || undefined,
        time: time || undefined,
        horse,
        result: normalizedResult,
        winPL,
        runningWinPL,
        hasResult: true,
        isNewSelection: false,
        rowOrder: i,
      };
      if (bsp !== null) selection.winBsp = bsp;

      selections.push(selection);
    }

    console.log(`✅ Parsed ${selections.length} valid selections`);

    console.log("💾 Inserting selections into database...");
    const inserted = await SystemSelection.insertMany(selections, {
      ordered: false,
    });
    console.log(`✅ Successfully inserted ${inserted.length} selections`);

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

migrateSystem6();
