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

    console.log("There are", sheetData.length, "rows in the sheet");
    console.log("mapping rows to SystemResult format");

    // Track skipped rows and errors (limit logging to avoid memory issues)
    let skippedCount = 0;
    let errorCount = 0;

    for (const [indexOfRow, row] of sheetData.entries()) {
      try {
        const resultData = mapToSystemResult(row, systemId);

        // Skip if required fields are missing
        if (!resultData.dateISO || !resultData.date) {
          skippedCount++;
          // Only log first few skipped rows to avoid memory issues
          if (skippedCount <= 5) {
            console.warn(
              `Skipping row ${indexOfRow} with missing date for system ${system.slug}`
            );
          }
          continue;
        }

        // Add rowOrder to preserve Google Sheets order
        // Use indexOfRow to maintain the original Google Sheets row position
        // (sheetData excludes header, so indexOfRow 0 = first data row in Google Sheets)
        resultData.rowOrder = indexOfRow;

        validResults.push(resultData);
        dateISOs.add(resultData.dateISO);
      } catch (error) {
        errorCount++;
        // Only log first few errors to avoid memory issues
        if (errorCount <= 5) {
          console.error(
            `Error mapping row ${indexOfRow} for system ${system.slug}:`,
            error.message
          );
        }
      }
    }

    if (skippedCount > 0) {
      console.log(`Skipped ${skippedCount} rows with missing dates`);
    }
    if (errorCount > 0) {
      console.log(`Encountered ${errorCount} errors while mapping rows`);
    }

    if (!validResults.length) {
      console.log(`No valid data to sync for system ${system.slug}`);
      return { systemId, synced: 0, deleted: 0, errors: 0 };
    }

    // Get date range from the data (more memory efficient)
    const sortedDates = Array.from(dateISOs).sort();
    const minDateISO = sortedDates[0];
    const maxDateISO = sortedDates[sortedDates.length - 1];

    // Delete ALL existing records for this system
    // This ensures a true full sync - any records deleted from Google Sheets
    // (including those outside the current date range) are removed from MongoDB
    const deleteResult = await SystemResult.deleteMany({
      systemId: systemId,
    });

    console.log(
      `Deleted ${deleteResult.deletedCount} existing records for system ${system.slug} (full sync - all records removed)`
    );

    // Insert all fresh data from Google Sheets in batches to reduce memory usage
    let synced = 0;
    let errors = 0;
    const INSERT_BATCH_SIZE = 500; // Process inserts in smaller batches

    // Process inserts in batches to avoid memory issues with large datasets
    for (let i = 0; i < validResults.length; i += INSERT_BATCH_SIZE) {
      const batch = validResults.slice(i, i + INSERT_BATCH_SIZE);

      try {
        // Use insertMany for better performance
        const insertResult = await SystemResult.insertMany(batch, {
          ordered: false, // Continue inserting even if some fail
        });
        synced += insertResult.length;

        // Log progress for large datasets
        if (validResults.length > INSERT_BATCH_SIZE) {
          console.log(
            `Inserted batch ${
              Math.floor(i / INSERT_BATCH_SIZE) + 1
            }/${Math.ceil(
              validResults.length / INSERT_BATCH_SIZE
            )} for system ${system.slug}`
          );
        }
      } catch (error) {
        // Handle partial insert failures
        if (error.writeErrors) {
          const batchErrors = error.writeErrors.length;
          const batchSynced = error.insertedCount || 0;
          errors += batchErrors;
          synced += batchSynced;
          console.error(
            `Partial insert for batch of system ${system.slug}: ${batchSynced} inserted, ${batchErrors} failed`
          );
        } else {
          // If insertMany completely fails, try inserting one by one for this batch
          console.warn(
            `Bulk insert failed for batch of system ${system.slug}, trying individual inserts...`
          );
          for (const resultData of batch) {
            try {
              await SystemResult.create(resultData);
              synced++;
            } catch (err) {
              errors++;
              // Only log first few errors to avoid memory issues
              if (errors <= 5) {
                console.error(
                  `Error inserting row for system ${system.slug}:`,
                  err.message
                );
              }
            }
          }
        }
      }

      // Force garbage collection hint by clearing the batch reference
      // (Node.js will GC when needed, but this helps)
      if (i % (INSERT_BATCH_SIZE * 5) === 0 && global.gc) {
        global.gc();
      }
    }

    console.log(
      `✅ Synced ${synced} results for system ${system.slug} (${deleteResult.deletedCount} deleted, ${errors} errors)`
    );

    // Clean up large arrays to help with memory
    const result = {
      systemId,
      systemSlug: system.slug,
      synced,
      deleted: deleteResult.deletedCount,
      errors,
      total: sheetData.length,
      dateRange: { min: minDateISO, max: maxDateISO },
    };

    // Clear large arrays from memory (they'll be GC'd)
    validResults.length = 0;
    dateISOs.clear();

    return result;
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
