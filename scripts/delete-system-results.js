// Script to delete all SystemResult documents
// This is a one-time cleanup as we're moving away from SystemResult model

require("dotenv").config();
const connectDB = require("../config/database");
const SystemResult = require("../models/SystemResult");

async function deleteAllSystemResults() {
  try {
    console.log("🔄 Starting SystemResult deletion...");

    // Connect to database
    await connectDB();
    console.log("✅ Connected to database");

    // Delete all SystemResult documents
    const result = await SystemResult.deleteMany({});
    console.log(`🗑️  Deleted ${result.deletedCount} SystemResult documents`);

    console.log("\n✅ Deletion completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Deletion failed:", error);
    process.exit(1);
  }
}

// Run deletion
deleteAllSystemResults();
