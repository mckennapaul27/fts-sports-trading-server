const System = require("../models/System");
const SystemResult = require("../models/SystemResult");
const { fetchSheetData, mapToSystemResult } = require("./googleSheetsService");

/**
 * Sync Google Sheets results to MongoDB for a specific system
 * Uses a full sync strategy: deletes all existing records for the date range,
 * then inserts fresh data from Google Sheets. This ensures corrections and
 * deletions in Google Sheets are reflected in MongoDB.
 * @param {string} systemId - The system ID to sync
 * @returns {Promise<Object>} Sync result with counts
 */
async function syncSystemResults(systemId) {
  try {
    const system = await System.findById(systemId);
    if (!system) {
      throw new Error(`System with ID ${systemId} not found`);
    }

    if (!system.isActive) {
      console.log(`System ${system.slug} is not active, skipping sync`);
      return { systemId, skipped: true };
    }

    const { spreadsheetId, range } = system.sheets.results;

    console.log(`Syncing results for system: ${system.slug} (${systemId})`);

    // Fetch data from Google Sheets
    const sheetData = await fetchSheetData(spreadsheetId, range);

    if (!sheetData.length) {
      console.log(`No data found for system ${system.slug}`);
      // Optionally delete all existing records if sheet is empty
      // Uncomment if you want to clear DB when sheet is empty:
      // const deleted = await SystemResult.deleteMany({ systemId });
      // return { systemId, synced: 0, deleted: deleted.deletedCount, errors: 0 };
      return { systemId, synced: 0, deleted: 0, errors: 0 };
    }

    // Map all rows to SystemResult format and collect valid dates
    const validResults = [];
    const dateISOs = new Set();

    for (const row of sheetData) {
      try {
        const resultData = mapToSystemResult(row, systemId);

        // Skip if required fields are missing
        if (!resultData.dateISO || !resultData.date) {
          console.warn(
            `Skipping row with missing date for system ${system.slug}:`,
            row
          );
          continue;
        }

        validResults.push(resultData);
        dateISOs.add(resultData.dateISO);
      } catch (error) {
        console.error(
          `Error mapping row for system ${system.slug}:`,
          error.message,
          row
        );
      }
    }

    if (!validResults.length) {
      console.log(`No valid data to sync for system ${system.slug}`);
      return { systemId, synced: 0, deleted: 0, errors: 0 };
    }

    // Get date range from the data
    const minDateISO = Array.from(dateISOs).sort()[0];
    const maxDateISO = Array.from(dateISOs).sort().reverse()[0];

    // Delete all existing records for this system within the date range
    // This ensures deleted/corrected rows in Google Sheets are removed from MongoDB
    const deleteResult = await SystemResult.deleteMany({
      systemId: systemId,
      dateISO: { $gte: minDateISO, $lte: maxDateISO },
    });

    console.log(
      `Deleted ${deleteResult.deletedCount} existing records for system ${system.slug} (date range: ${minDateISO} to ${maxDateISO})`
    );

    // Insert all fresh data from Google Sheets
    let synced = 0;
    let errors = 0;

    try {
      // Use insertMany for better performance
      const insertResult = await SystemResult.insertMany(validResults, {
        ordered: false, // Continue inserting even if some fail
      });
      synced = insertResult.length;
    } catch (error) {
      // Handle partial insert failures
      if (error.writeErrors) {
        errors = error.writeErrors.length;
        synced = error.insertedCount || 0;
        console.error(
          `Partial insert for system ${system.slug}: ${synced} inserted, ${errors} failed`
        );
      } else {
        // If insertMany completely fails, try inserting one by one
        console.warn(
          `Bulk insert failed for system ${system.slug}, trying individual inserts...`
        );
        for (const resultData of validResults) {
          try {
            await SystemResult.create(resultData);
            synced++;
          } catch (err) {
            console.error(
              `Error inserting row for system ${system.slug}:`,
              err.message
            );
            errors++;
          }
        }
      }
    }

    console.log(
      `✅ Synced ${synced} results for system ${system.slug} (${deleteResult.deletedCount} deleted, ${errors} errors)`
    );

    return {
      systemId,
      systemSlug: system.slug,
      synced,
      deleted: deleteResult.deletedCount,
      errors,
      total: sheetData.length,
      dateRange: { min: minDateISO, max: maxDateISO },
    };
  } catch (error) {
    console.error(`Error syncing system ${systemId}:`, error.message);
    throw error;
  }
}

/**
 * Sync all active systems
 * @returns {Promise<Array>} Array of sync results
 */
async function syncAllSystems() {
  try {
    const activeSystems = await System.find({ isActive: true });
    console.log(
      `Starting sync for ${activeSystems.length} active system(s)...`
    );

    const results = [];

    for (const system of activeSystems) {
      try {
        const result = await syncSystemResults(system._id);
        results.push(result);
      } catch (error) {
        console.error(`Failed to sync system ${system.slug}:`, error.message);
        results.push({
          systemId: system._id,
          systemSlug: system.slug,
          error: error.message,
        });
      }
    }

    const totalSynced = results.reduce((sum, r) => sum + (r.synced || 0), 0);
    const totalDeleted = results.reduce((sum, r) => sum + (r.deleted || 0), 0);
    const totalErrors = results.reduce((sum, r) => sum + (r.errors || 0), 0);

    console.log(
      `✅ Sync complete: ${totalSynced} results synced, ${totalDeleted} deleted, ${totalErrors} errors`
    );

    return results;
  } catch (error) {
    console.error("Error in syncAllSystems:", error.message);
    throw error;
  }
}

module.exports = {
  syncSystemResults,
  syncAllSystems,
};
