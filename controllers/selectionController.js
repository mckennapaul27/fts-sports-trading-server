const SystemSelection = require("../models/SystemSelection");
const System = require("../models/System");
const User = require("../models/User");

// Helper function to convert UK date format to ISO
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

// Normalize time string for matching (handles "14:30", "14:30:00", etc.)
function normalizeTime(timeStr) {
  if (!timeStr) return "";
  // Remove leading/trailing whitespace
  let normalized = timeStr.trim();
  // If time has seconds (HH:MM:SS), remove seconds
  if (normalized.match(/^\d{1,2}:\d{2}:\d{2}$/)) {
    normalized = normalized.substring(0, 5); // Keep only HH:MM
  }
  // Ensure format is HH:MM (add leading zero if needed for single digit hour)
  const parts = normalized.split(":");
  if (parts.length === 2) {
    const hour = parts[0].padStart(2, "0");
    const minute = parts[1].padStart(2, "0");
    normalized = `${hour}:${minute}`;
  }
  return normalized;
}

// Helper function to check if user has access to a system
// Admins have access to all systems, regular users only to their activeSystemIds
async function checkSystemAccess(user, systemId) {
  // Admins have access to all systems
  if (user.role === "admin") {
    return true;
  }

  // Ensure user has activeSystemIds
  if (!user.activeSystemIds || user.activeSystemIds.length === 0) {
    return false;
  }

  // Check if systemId is in user's activeSystemIds
  // Convert both to strings for comparison since MongoDB ObjectIds need to be compared properly
  const systemIdStr = systemId.toString();
  const userSystemIds = user.activeSystemIds.map((id) => id.toString());
  return userSystemIds.includes(systemIdStr);
}

// Calculate winPL based on result and BSP
// Formula: 1 - BSP for WON, 0.98 for LOST, 0 for NR/VOID/CANCELLED
function calculateWinPL(result, winBsp) {
  const upperResult = result.toUpperCase();
  if (upperResult === "WON") {
    return 1 - winBsp; // Negative value (loss for lay bet)
  } else if (upperResult === "LOST") {
    return 0.98; // 1pt - 2% commission
  } else if (
    upperResult === "NR" ||
    upperResult === "VOID" ||
    upperResult === "CANCELLED"
  ) {
    return 0; // No profit/loss for these results
  }
  return 0;
}

// Calculate placePL based on result and placeBSP
// If horse WON or PLACED, the place lay loses (negative)
// If horse LOST, the place lay wins (keeps stake minus commission)
// If WON without placeBSP, return 1.0 (stake returned)
function calculatePlacePL(result, placeBsp) {
  const upperResult = result.toUpperCase();
  if (upperResult === "WON") {
    if (placeBsp !== null && placeBsp !== undefined) {
      return 1 - placeBsp; // Negative value (loss for lay bet)
    }
    return 1.0; // Stake returned if no placeBSP
  } else if (upperResult === "PLACED") {
    return 1 - placeBsp; // Negative value (loss for lay bet)
  }
  // For LOST, place bet wins (keeps stake minus commission)
  return 0.98;
}

// @desc    Get all daily selections
// @route   GET /api/selections
// @access  Private (requires subscription to system)
const getSelections = async (req, res) => {
  try {
    const {
      systemId,
      dateISO,
      startDate,
      endDate,
      isNew,
      limit,
      offset,
      sortBy,
      sortOrder,
      country,
      meeting,
      horse,
      result,
    } = req.query;
    const query = {};

    console.log("req.query", req.query);

    // If systemId is provided, verify user has access
    if (systemId) {
      const hasAccess = await checkSystemAccess(req.user, systemId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: "You do not have access to this system",
        });
      }
      query.systemId = systemId;
    } else {
      // If no systemId provided, filter by user's active systems
      // Admins can see all, regular users only their subscribed systems
      if (req.user.role !== "admin") {
        if (
          !req.user.activeSystemIds ||
          req.user.activeSystemIds.length === 0
        ) {
          return res.status(200).json({
            success: true,
            count: 0,
            total: 0,
            data: [],
            hasMore: false,
            nextOffset: null,
          });
        }
        query.systemId = { $in: req.user.activeSystemIds };
      }
    }

    if (dateISO) query.dateISO = dateISO;
    if (isNew !== undefined) query.isNew = isNew === "true";

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) {
        // Set to end of day
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    // Add filter support
    if (country && country !== "all") {
      query.country = country;
    }
    if (meeting && meeting !== "all") {
      query.meeting = meeting;
    }
    if (horse && horse.trim()) {
      // Case-insensitive search for horse name
      query.horse = { $regex: horse.trim(), $options: "i" };
    }
    if (result && result !== "all") {
      query.result = result;
    }

    // Parse pagination parameters
    const limitNum = limit ? parseInt(limit, 10) : null;
    const offsetNum = offset ? parseInt(offset, 10) : 0;

    // Build sort object
    const sortField = sortBy || "rowOrder";
    const order = sortOrder === "asc" ? 1 : -1;
    const sortObj = { [sortField]: order };

    // If sorting by dateISO, add time as secondary sort
    if (sortField === "dateISO" || sortField === "date") {
      sortObj.time = 1;
    }

    console.log("sortObj", sortObj);
    console.log("query", query);

    // Get total count
    const total = await SystemSelection.countDocuments(query);

    // Build query with pagination
    let selectionsQuery = SystemSelection.find(query)
      .populate("systemId", "name slug")
      .populate("createdBy", "firstName lastName email")
      .sort(sortObj);

    // Apply pagination if limit is provided
    if (limitNum !== null) {
      selectionsQuery = selectionsQuery.skip(offsetNum).limit(limitNum);
    }

    const selections = await selectionsQuery;

    // Calculate pagination metadata
    const hasMore = limitNum !== null ? offsetNum + limitNum < total : false;
    const nextOffset = hasMore ? offsetNum + limitNum : null;

    res.status(200).json({
      success: true,
      count: selections.length,
      total,
      data: selections,
      hasMore,
      nextOffset,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Get today's selections
// @route   GET /api/selections/today
// @access  Private (requires subscription to system)
const getTodaySelections = async (req, res) => {
  try {
    const { systemId } = req.query;
    // console.log("systemId", systemId);
    const today = new Date();
    const todayISO = `${today.getUTCFullYear()}-${String(
      today.getUTCMonth() + 1
    ).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;

    const query = { dateISO: todayISO };

    // console.log("req.user", req.user);

    // If systemId is provided, verify user has access
    if (systemId) {
      const hasAccess = await checkSystemAccess(req.user, systemId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: "You do not have access to this system",
        });
      }
      query.systemId = systemId;
    } else {
      // If no systemId provided, filter by user's active systems
      if (req.user.role !== "admin") {
        if (
          !req.user.activeSystemIds ||
          req.user.activeSystemIds.length === 0
        ) {
          return res.status(200).json({
            success: true,
            count: 0,
            dateISO: todayISO,
            data: [],
          });
        }
        query.systemId = { $in: req.user.activeSystemIds };
      }
    }

    // console.log("query", query);

    const selections = await SystemSelection.find(query)
      .populate("systemId", "name slug")
      .sort({ time: 1 });

    res.status(200).json({
      success: true,
      count: selections.length,
      dateISO: todayISO,
      data: selections,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Get single selection
// @route   GET /api/selections/:id
// @access  Private (requires subscription to system)
const getSelection = async (req, res) => {
  try {
    const selection = await SystemSelection.findById(req.params.id)
      .populate("systemId", "name slug")
      .populate("createdBy", "firstName lastName email");

    if (!selection) {
      return res.status(404).json({
        success: false,
        error: "Selection not found",
      });
    }

    // Check if user has access to this selection's system
    const hasAccess = await checkSystemAccess(req.user, selection.systemId._id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: "You do not have access to this selection",
      });
    }

    res.status(200).json({
      success: true,
      data: selection,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Create new selection
// @route   POST /api/selections
// @access  Admin
const createSelection = async (req, res) => {
  try {
    const { systemId, date, country, meeting, time, horse } = req.body;

    // Validate required fields
    if (!systemId || !date || !horse) {
      return res.status(400).json({
        success: false,
        error: "systemId, date, and horse are required",
      });
    }

    // Verify system exists
    const system = await System.findById(systemId);
    if (!system) {
      return res.status(404).json({
        success: false,
        error: "System not found",
      });
    }

    // Convert date to ISO format if needed (handle both UK format and ISO)
    let dateISO;
    if (date.includes("/")) {
      // UK format: "10/12/2025"
      dateISO = ukToIso(date);
    } else {
      // Already ISO format: "2025-12-10"
      dateISO = date;
    }

    if (!dateISO) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD or DD/MM/YYYY",
      });
    }

    // Get the maximum rowOrder for this system and increment by 1
    const lastSelection = await SystemSelection.findOne({ systemId })
      .sort({ rowOrder: -1 })
      .select("rowOrder");
    const rowOrder =
      lastSelection && lastSelection.rowOrder !== null
        ? lastSelection.rowOrder + 1
        : 1;

    // Create selection
    const selection = await SystemSelection.create({
      systemId,
      dateISO,
      date: isoToDate(dateISO),
      country: country || null,
      meeting: meeting || null,
      time: time || null,
      horse,
      isNew: true,
      createdBy: req.user.id,
      rowOrder,
    });

    const populatedSelection = await SystemSelection.findById(selection._id)
      .populate("systemId", "name slug")
      .populate("createdBy", "firstName lastName email");

    res.status(201).json({
      success: true,
      data: populatedSelection,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Upload results from CSV
// @route   POST /api/selections/upload-results-csv
// @access  Admin
const uploadResultsFromCSV = async (req, res) => {
  try {
    // Get CSV file from multer (req.file)
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "CSV file is required",
      });
    }

    // Read CSV file content
    const csvText = req.file.buffer.toString("utf-8");

    // Parse CSV lines
    const lines = csvText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line);
    if (lines.length < 2) {
      return res.status(400).json({
        success: false,
        error: "CSV must contain at least a header row and one data row",
      });
    }

    // Parse header
    const header = lines[0].split(",").map((h) => h.trim());
    const dateOfRaceIdx = header.indexOf("Date of Race");
    const countryIdx = header.indexOf("Country");
    const trackIdx = header.indexOf("Track");
    const timeIdx = header.indexOf("Time");
    const horseIdx = header.indexOf("Horse");
    const betfairSPIdx = header.indexOf("Betfair SP");
    const betfairLayReturnIdx = header.indexOf("Betfair Lay Return");
    const betfairPlaceSPIdx = header.indexOf("Betfair Place SP");
    const placeLayReturnIdx = header.indexOf("Place Lay Return");

    if (
      dateOfRaceIdx === -1 ||
      countryIdx === -1 ||
      trackIdx === -1 ||
      timeIdx === -1 ||
      horseIdx === -1 ||
      betfairSPIdx === -1 ||
      betfairLayReturnIdx === -1 ||
      betfairPlaceSPIdx === -1 ||
      placeLayReturnIdx === -1
    ) {
      return res.status(400).json({
        success: false,
        error:
          "CSV must contain 'Date of Race', 'Country', 'Track', 'Time', 'Horse', 'Betfair SP', 'Betfair Lay Return', 'Betfair Place SP', and 'Place Lay Return' columns",
      });
    }

    const errors = [];

    // PHASE 1: Scan CSV to extract dateISOs (minimal memory - just dates)
    let dateISOs = new Set();
    const dateParseErrors = [];
    for (let i = 1; i < lines.length; i++) {
      try {
        const values = lines[i].split(",").map((v) => v.trim());
        const dateOfRace = values[dateOfRaceIdx];
        if (dateOfRace) {
          const dateISO = ukToIso(dateOfRace);
          if (dateISO) {
            dateISOs.add(dateISO);
          } else {
            dateParseErrors.push({
              row: i + 1,
              dateValue: dateOfRace,
              error: "Could not parse date",
            });
          }
        }
      } catch (error) {
        // Skip invalid rows in this phase - we'll catch them in phase 2
        dateParseErrors.push({
          row: i + 1,
          error: error.message,
        });
      }
    }

    if (dateParseErrors.length > 0 && dateParseErrors.length <= 10) {
      console.log("Date parsing errors (first 10):", dateParseErrors);
    }

    if (dateISOs.size === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid dates found in CSV",
      });
    }

    // Log extracted dateISOs for debugging
    console.log("Extracted dateISOs from CSV:", Array.from(dateISOs).sort());

    // PHASE 2: Query selections for the dateISOs found in CSV
    // Only get selections that don't already have results
    const allSelections = await SystemSelection.find({
      dateISO: { $in: Array.from(dateISOs) },
      hasResult: { $ne: true }, // Only selections without results
    }).lean();

    console.log(
      `Found ${allSelections.length} selections without results for dateISOs:`,
      Array.from(dateISOs).sort()
    );

    // Get system names for unmatched selections reporting
    const systemIds = [
      ...new Set(allSelections.map((s) => s.systemId.toString())),
    ];
    const systems = await System.find({
      _id: { $in: systemIds },
    })
      .select("_id name")
      .lean();
    const systemMap = new Map(systems.map((s) => [s._id.toString(), s.name]));

    // PHASE 3: Build selection lookup Map (key: matchKey, value: { selection, matched: false })
    const selectionMap = new Map();
    const sampleSelectionKeys = [];
    for (const selection of allSelections) {
      const normalizedHorse = (selection.horse || "").toLowerCase().trim();
      const normalizedTime = normalizeTime(selection.time || "");
      const matchKey = `${selection.dateISO}|${normalizedTime}|${normalizedHorse}`;
      selectionMap.set(matchKey, {
        selection,
        matched: false,
      });
      // Collect sample keys for debugging
      if (sampleSelectionKeys.length < 5) {
        sampleSelectionKeys.push({
          matchKey,
          dateISO: selection.dateISO,
          time: selection.time,
          normalizedTime,
          horse: selection.horse,
          normalizedHorse,
        });
      }
    }

    console.log(
      `Built selection map with ${selectionMap.size} selections to match against CSV`
    );

    // PHASE 4: Process CSV line-by-line and match against selections
    // Collect updates in memory (only ~300 selections will match)
    const updates = []; // Array of { selectionId, updateData, winPL }

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = lines[i].split(",").map((v) => v.trim());

        const dateOfRace = values[dateOfRaceIdx];
        const country = values[countryIdx];
        const track = values[trackIdx];
        const time = values[timeIdx];
        const horse = values[horseIdx];
        const betfairSPStr = values[betfairSPIdx];
        const betfairLayReturnStr = values[betfairLayReturnIdx];
        const betfairPlaceSPStr = values[betfairPlaceSPIdx];
        const placeLayReturnStr = values[placeLayReturnIdx];

        if (!dateOfRace || !time || !horse) {
          errors.push({
            row: i + 1,
            error: "Date of Race, Time, and Horse are required",
          });
          continue;
        }

        // Convert date to ISO format
        const dateISO = ukToIso(dateOfRace);
        if (!dateISO) {
          errors.push({
            row: i + 1,
            error: `Invalid date format: ${dateOfRace}. Expected "DD/MM/YYYY"`,
          });
          continue;
        }

        // Create match key (case-insensitive horse name, normalized time)
        const normalizedHorse = horse.toLowerCase().trim();
        const normalizedTime = normalizeTime(time || "");
        const matchKey = `${dateISO}|${normalizedTime}|${normalizedHorse}`;

        const entry = selectionMap.get(matchKey);

        // If no selection matches this CSV row, skip it (we don't care about unmatched CSV rows)
        if (!entry) {
          continue;
        }

        // Double-check: Skip if this selection already has a result (safety check)
        if (entry.selection.hasResult) {
          console.log(
            `Skipping selection ${entry.selection._id} - already has result: ${entry.selection.result}`
          );
          continue;
        }

        // Mark selection as matched
        entry.matched = true;
        const selection = entry.selection;

        // Parse numeric values from CSV row
        const betfairSP =
          betfairSPStr && betfairSPStr.trim() ? parseFloat(betfairSPStr) : null;
        const betfairLayReturn = betfairLayReturnStr
          ? parseFloat(betfairLayReturnStr)
          : null;

        // Check if Betfair SP is valid - if not, race hasn't been settled yet, skip this selection
        const hasValidBetfairSP =
          betfairSP !== null && !isNaN(betfairSP) && betfairSP > 0;

        // If no valid Betfair SP, race hasn't been settled - skip this selection
        if (!hasValidBetfairSP) {
          console.log(
            `Skipping selection ${selection._id} (${selection.dateISO} ${selection.time} ${selection.horse}) - no Betfair SP (race not settled)`
          );
          continue;
        }

        // Determine result based on lay returns (only if we have valid Betfair SP)
        // If Betfair Lay Return < 0: WON (lay bet lost)
        // If Betfair Lay Return >= 0: LOST
        let result;
        if (betfairLayReturn !== null && betfairLayReturn < 0) {
          result = "WON";
        } else {
          result = "LOST";
        }

        // Calculate winPL using the same logic as migration scripts
        const winPL = calculateWinPL(result, betfairSP);

        // Prepare update data
        const updateData = {
          country: country || selection.country,
          meeting: track || selection.meeting,
          result: result.toUpperCase(),
          hasResult: true,
          winBsp: betfairSP, // We know betfairSP is valid here (we skip if not)
          winPL: winPL,
        };

        // Store update with selection info for running total calculation
        updates.push({
          selectionId: selection._id,
          systemId: selection.systemId,
          rowOrder: selection.rowOrder || 0,
          updateData,
          winPL,
        });

        console.log(
          `Matched CSV row ${i + 1} to selection ${selection._id} (${
            selection.dateISO
          } ${selection.time} ${selection.horse})`
        );
      } catch (error) {
        errors.push({
          row: i + 1,
          error: error.message,
        });
      }
    }

    console.log(`Total updates collected: ${updates.length}`);

    // PHASE 5: Find unmatched selections and debug why they don't match
    const unmatchedSelections = [];

    for (const [matchKey, entry] of selectionMap.entries()) {
      if (!entry.matched) {
        const selection = entry.selection;
        unmatchedSelections.push({
          dateISO: selection.dateISO,
          time: selection.time,
          horse: selection.horse,
          systemId: selection.systemId,
          systemName: systemMap.get(selection.systemId.toString()) || null,
          reason: "No matching CSV row found for this selection",
        });
      }
    }

    console.log(`Unmatched selections: ${unmatchedSelections.length}`);

    // Debug: Show unmatched selections with their match keys
    if (unmatchedSelections.length > 0) {
      console.log("\n=== DEBUGGING UNMATCHED SELECTIONS ===");
      const sampleUnmatched = unmatchedSelections.slice(0, 20).map((s) => {
        const normalizedHorse = (s.horse || "").toLowerCase().trim();
        const normalizedTime = normalizeTime(s.time || "");
        const matchKey = `${s.dateISO}|${normalizedTime}|${normalizedHorse}`;
        return {
          matchKey,
          dateISO: s.dateISO,
          time: s.time,
          normalizedTime,
          horse: s.horse,
          normalizedHorse,
          systemName: s.systemName,
        };
      });
      console.log(
        "First 20 unmatched selections:",
        JSON.stringify(sampleUnmatched, null, 2)
      );
    }

    if (updates.length === 0) {
      return res.status(200).json({
        success: true,
        updated: 0,
        unmatched:
          unmatchedSelections.length > 0 ? unmatchedSelections : undefined,
        errors: errors.length > 0 ? errors : undefined,
        data: [],
      });
    }

    // PHASE 6: Efficiently recalculate running totals
    // Group updates by systemId
    const updatesBySystem = new Map();
    for (const update of updates) {
      const systemIdStr = update.systemId.toString();
      if (!updatesBySystem.has(systemIdStr)) {
        updatesBySystem.set(systemIdStr, []);
      }
      updatesBySystem.get(systemIdStr).push(update);
    }

    // For each system with updates, fetch all selections and recalculate running totals
    const bulkOps = [];
    const updatedSelectionIds = new Set(
      updates.map((u) => u.selectionId.toString())
    );

    for (const [systemIdStr, systemUpdates] of updatesBySystem.entries()) {
      // Use the original ObjectId from the first update (Mongoose handles string conversion, but ObjectId is safer)
      const systemId = systemUpdates[0].systemId;

      // Get all selections for this system, sorted by rowOrder
      const allSystemSelections = await SystemSelection.find({
        systemId: systemId,
      })
        .sort({ rowOrder: 1 })
        .select("_id rowOrder winPL")
        .lean();

      // Create a map of updates by selectionId for quick lookup
      const updatesMap = new Map();
      for (const update of systemUpdates) {
        updatesMap.set(update.selectionId.toString(), update);
      }

      // Track if we've encountered any updated selection (to know if subsequent ones need updating)
      let hasEncounteredUpdate = false;

      // Recalculate running totals from scratch for all selections in this system
      // This is correct because:
      // - For selections being updated: we use the new winPL value
      // - For selections with existing results: we use their existing winPL value
      // - For selections without results: we use 0 (winPL is null/undefined)
      // Starting from 0 and accumulating ensures cumulative totals are correct
      let runningWinPL = 0;

      // Calculate running totals in one pass through all selections (sorted by rowOrder)
      for (const systemSelection of allSystemSelections) {
        const selectionIdStr = systemSelection._id.toString();
        const update = updatesMap.get(selectionIdStr);

        // Use updated winPL if this selection was updated in this CSV,
        // otherwise use existing winPL (from previous CSV uploads or null/0 if no result yet)
        const currentWinPL =
          update !== undefined ? update.winPL : systemSelection.winPL || 0;
        runningWinPL += currentWinPL;

        // Track if we've encountered an update
        if (update !== undefined) {
          hasEncounteredUpdate = true;
          // This selection was updated - include all update fields
          bulkOps.push({
            updateOne: {
              filter: { _id: systemSelection._id },
              update: {
                $set: {
                  ...update.updateData,
                  runningWinPL: runningWinPL,
                },
              },
            },
          });
        } else if (hasEncounteredUpdate) {
          // This selection comes after an updated one, so its running total needs updating
          bulkOps.push({
            updateOne: {
              filter: { _id: systemSelection._id },
              update: {
                $set: {
                  runningWinPL: runningWinPL,
                },
              },
            },
          });
        }
      }
    }

    // PHASE 7: Execute bulk updates
    if (bulkOps.length > 0) {
      console.log(`Executing ${bulkOps.length} bulk update operations`);
      const bulkResult = await SystemSelection.bulkWrite(bulkOps, {
        ordered: false,
      });
      console.log(`Bulk update result:`, {
        matched: bulkResult.matchedCount,
        modified: bulkResult.modifiedCount,
      });
    } else {
      console.log("No bulk operations to execute");
    }

    // PHASE 8: Fetch and populate updated selections for response
    const populatedSelections = await SystemSelection.find({
      _id: { $in: Array.from(updatedSelectionIds) },
    })
      .populate("systemId", "name slug")
      .populate("createdBy", "firstName lastName email");

    res.status(200).json({
      success: true,
      updated: populatedSelections.length,
      unmatched:
        unmatchedSelections.length > 0 ? unmatchedSelections : undefined,
      errors: errors.length > 0 ? errors : undefined,
      data: populatedSelections,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Create selections from CSV upload
// @route   POST /api/selections/upload-csv
// @access  Admin
const uploadSelectionsFromCSV = async (req, res) => {
  try {
    // Get systemId from form data (multer adds it to req.body)
    const systemId = req.body.systemId;

    // Validate required fields
    if (!systemId) {
      return res.status(400).json({
        success: false,
        error: "systemId is required",
      });
    }

    // Get CSV file from multer (req.file)
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "CSV file is required",
      });
    }

    // Read CSV file content
    const csvText = req.file.buffer.toString("utf-8");

    // Verify system exists
    const system = await System.findById(systemId);
    if (!system) {
      return res.status(404).json({
        success: false,
        error: "System not found",
      });
    }

    console.log("csvText", csvText);
    console.log("system", system);

    // Parse CSV
    const lines = csvText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line);
    if (lines.length < 2) {
      return res.status(400).json({
        success: false,
        error: "CSV must contain at least a header row and one data row",
      });
    }

    // Parse header
    const header = lines[0].split(",").map((h) => h.trim());
    const timeIdx = header.indexOf("Time");
    const raceIdx = header.indexOf("Race");
    const selectionIdx = header.indexOf("Selection");

    if (timeIdx === -1 || raceIdx === -1 || selectionIdx === -1) {
      return res.status(400).json({
        success: false,
        error: "CSV must contain 'Time', 'Race', and 'Selection' columns",
      });
    }

    // Get the maximum rowOrder for this system
    const lastSelection = await SystemSelection.findOne({ systemId })
      .sort({ rowOrder: -1 })
      .select("rowOrder");
    let currentRowOrder =
      lastSelection && lastSelection.rowOrder !== null
        ? lastSelection.rowOrder
        : 0;

    const createdSelections = [];
    const errors = [];

    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      try {
        const values = lines[i].split(",").map((v) => v.trim());

        const timeValue = values[timeIdx]; // Format: "DD/MM/YYYY HH:MM"
        const raceValue = values[raceIdx]; // Format: "HH:MM MeetingAbbr"
        const horse = values[selectionIdx];

        if (!timeValue || !horse) {
          errors.push({
            row: i + 1,
            error: "Time and Selection are required",
          });
          continue;
        }

        // Parse date and time from "DD/MM/YYYY HH:MM"
        const [datePart, timePart] = timeValue.split(" ");
        if (!datePart || !timePart) {
          errors.push({
            row: i + 1,
            error: `Invalid time format: ${timeValue}. Expected "DD/MM/YYYY HH:MM"`,
          });
          continue;
        }

        // Convert date to ISO format
        const dateISO = ukToIso(datePart);
        if (!dateISO) {
          errors.push({
            row: i + 1,
            error: `Invalid date format: ${datePart}. Expected "DD/MM/YYYY"`,
          });
          continue;
        }

        // Extract meeting from race column (format: "HH:MM MeetingAbbr")
        // Remove the time prefix to get the meeting abbreviation
        const meeting = raceValue
          ? raceValue.replace(/^\d{1,2}:\d{2}\s*/, "").trim()
          : null;

        // Increment rowOrder
        currentRowOrder += 1;

        // Create selection
        const selection = await SystemSelection.create({
          systemId,
          dateISO,
          date: isoToDate(dateISO),
          meeting: meeting || null,
          time: timePart || null,
          horse,
          isNew: true,
          createdBy: req.user.id,
          rowOrder: currentRowOrder,
        });

        createdSelections.push(selection);
      } catch (error) {
        errors.push({
          row: i + 1,
          error: error.message,
        });
      }
    }

    // Populate created selections
    const populatedSelections = await SystemSelection.find({
      _id: { $in: createdSelections.map((s) => s._id) },
    })
      .populate("systemId", "name slug")
      .populate("createdBy", "firstName lastName email");

    res.status(201).json({
      success: true,
      created: populatedSelections.length,
      errors: errors.length > 0 ? errors : undefined,
      data: populatedSelections,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Create multiple selections (bulk)
// @route   POST /api/selections/bulk
// @access  Admin
const createBulkSelections = async (req, res) => {
  try {
    const { selections } = req.body;

    if (!Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({
        success: false,
        error: "selections must be a non-empty array",
      });
    }

    const createdSelections = [];
    const errors = [];

    // Group selections by systemId to calculate rowOrder efficiently
    const systemRowOrders = {};

    for (const [index, selectionData] of selections.entries()) {
      try {
        const { systemId, date, country, meeting, time, horse } = selectionData;

        if (!systemId || !date || !horse) {
          errors.push({
            index,
            error: "systemId, date, and horse are required",
          });
          continue;
        }

        // Verify system exists
        const system = await System.findById(systemId);
        if (!system) {
          errors.push({
            index,
            error: `System ${systemId} not found`,
          });
          continue;
        }

        // Convert date to ISO format if needed
        let dateISO;
        if (date.includes("/")) {
          dateISO = ukToIso(date);
        } else {
          dateISO = date;
        }

        if (!dateISO) {
          errors.push({
            index,
            error: "Invalid date format. Use YYYY-MM-DD or DD/MM/YYYY",
          });
          continue;
        }

        // Get or calculate rowOrder for this system
        if (!systemRowOrders[systemId]) {
          const lastSelection = await SystemSelection.findOne({ systemId })
            .sort({ rowOrder: -1 })
            .select("rowOrder");
          systemRowOrders[systemId] =
            lastSelection && lastSelection.rowOrder !== null
              ? lastSelection.rowOrder
              : 0;
        }
        systemRowOrders[systemId] += 1;
        const rowOrder = systemRowOrders[systemId];

        const selection = await SystemSelection.create({
          systemId,
          dateISO,
          date: isoToDate(dateISO),
          country: country || null,
          meeting: meeting || null,
          time: time || null,
          horse,
          isNew: true,
          createdBy: req.user.id,
          rowOrder,
        });

        createdSelections.push(selection);
      } catch (error) {
        errors.push({
          index,
          error: error.message,
        });
      }
    }

    // Populate created selections
    const populatedSelections = await SystemSelection.find({
      _id: { $in: createdSelections.map((s) => s._id) },
    })
      .populate("systemId", "name slug")
      .populate("createdBy", "firstName lastName email");

    res.status(201).json({
      success: true,
      created: populatedSelections.length,
      errors: errors.length > 0 ? errors : undefined,
      data: populatedSelections,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Update selection
// @route   PUT /api/selections/:id
// @access  Admin
const updateSelection = async (req, res) => {
  try {
    const { date, country, meeting, time, horse, isNew } = req.body;

    const selection = await SystemSelection.findById(req.params.id);

    if (!selection) {
      return res.status(404).json({
        success: false,
        error: "Selection not found",
      });
    }

    // Update fields
    const updateData = {};
    if (date !== undefined) {
      let dateISO;
      if (date.includes("/")) {
        dateISO = ukToIso(date);
      } else {
        dateISO = date;
      }

      if (!dateISO) {
        return res.status(400).json({
          success: false,
          error: "Invalid date format. Use YYYY-MM-DD or DD/MM/YYYY",
        });
      }

      updateData.dateISO = dateISO;
      updateData.date = isoToDate(dateISO);
    }
    if (country !== undefined) updateData.country = country;
    if (meeting !== undefined) updateData.meeting = meeting;
    if (time !== undefined) updateData.time = time;
    if (horse !== undefined) updateData.horse = horse;
    if (isNew !== undefined) updateData.isNew = isNew;

    const updatedSelection = await SystemSelection.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate("systemId", "name slug")
      .populate("createdBy", "firstName lastName email");

    res.status(200).json({
      success: true,
      data: updatedSelection,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Delete selection
// @route   DELETE /api/selections/:id
// @access  Admin
const deleteSelection = async (req, res) => {
  try {
    const selection = await SystemSelection.findById(req.params.id);

    if (!selection) {
      return res.status(404).json({
        success: false,
        error: "Selection not found",
      });
    }

    // If the selection has results, we need to recalculate running totals for subsequent selections
    const currentRowOrder = selection.rowOrder;
    const hadResults = selection.hasResult;
    const deletedWinPL = selection.winPL || 0;
    const deletedPlacePL = selection.placePL;

    // Delete the selection
    await SystemSelection.findByIdAndDelete(req.params.id);

    // If this selection had results, recalculate running totals for subsequent selections
    if (
      hadResults &&
      currentRowOrder !== null &&
      currentRowOrder !== undefined
    ) {
      // Get all subsequent selections (by rowOrder)
      const subsequentSelections = await SystemSelection.find({
        systemId: selection.systemId,
        rowOrder: { $gt: currentRowOrder },
      })
        .sort({ rowOrder: 1 })
        .select("_id winPL placePL");

      // Recalculate running totals for subsequent selections
      // First, get the running totals up to (but not including) the deleted selection
      const previousSelections = await SystemSelection.find({
        systemId: selection.systemId,
        rowOrder: { $lt: currentRowOrder },
      })
        .sort({ rowOrder: 1 })
        .select("winPL placePL");

      // Calculate running totals up to the deleted selection
      let currentRunningWinPL = previousSelections.reduce(
        (sum, s) => sum + (s.winPL || 0),
        0
      );

      let currentRunningPlacePL = null;
      const previousPlacePL = previousSelections
        .filter((s) => s.placePL !== null && s.placePL !== undefined)
        .reduce((sum, s) => sum + (s.placePL || 0), 0);

      if (previousPlacePL > 0 || deletedPlacePL !== null) {
        currentRunningPlacePL = previousPlacePL;
      }

      // Update each subsequent selection's running totals
      for (const subsequent of subsequentSelections) {
        // Add this selection's PL to the running totals
        if (subsequent.winPL !== null && subsequent.winPL !== undefined) {
          currentRunningWinPL += subsequent.winPL;
        }
        if (subsequent.placePL !== null && subsequent.placePL !== undefined) {
          if (currentRunningPlacePL === null) {
            // If this is the first selection with placePL after deletion,
            // calculate runningPlacePL from all previous selections with placePL
            const allPreviousWithPlace = await SystemSelection.find({
              systemId: selection.systemId,
              rowOrder: { $lte: subsequent.rowOrder },
              placePL: { $ne: null },
            })
              .sort({ rowOrder: 1 })
              .select("placePL");
            currentRunningPlacePL = allPreviousWithPlace.reduce(
              (sum, s) => sum + (s.placePL || 0),
              0
            );
          } else {
            currentRunningPlacePL += subsequent.placePL;
          }
        }

        // Update the subsequent selection
        const updateSubsequent = {
          runningWinPL: currentRunningWinPL,
        };
        if (currentRunningPlacePL !== null) {
          updateSubsequent.runningPlacePL = currentRunningPlacePL;
        }

        await SystemSelection.findByIdAndUpdate(
          subsequent._id,
          updateSubsequent
        );
      }
    }

    res.status(200).json({
      success: true,
      data: {},
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Mark selections as viewed (clear isNew flag)
// @route   PUT /api/selections/mark-viewed
// @access  Private (requires subscription to system)
const markSelectionsViewed = async (req, res) => {
  try {
    const { selectionIds, systemId, dateISO } = req.body;

    let query = { isNew: true };

    // If systemId is provided, verify user has access
    if (systemId) {
      const hasAccess = await checkSystemAccess(req.user, systemId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: "You do not have access to this system",
        });
      }
      query.systemId = systemId;
    } else {
      // If no systemId provided, filter by user's active systems
      if (req.user.role !== "admin") {
        if (
          !req.user.activeSystemIds ||
          req.user.activeSystemIds.length === 0
        ) {
          return res.status(200).json({
            success: true,
            updated: 0,
          });
        }
        query.systemId = { $in: req.user.activeSystemIds };
      }
    }

    // If specific selectionIds provided, verify user has access to each
    if (selectionIds && Array.isArray(selectionIds)) {
      // Verify all selections belong to systems user has access to
      const selections = await SystemSelection.find({
        _id: { $in: selectionIds },
      }).populate("systemId");

      const accessibleIds = [];
      for (const selection of selections) {
        const hasAccess = await checkSystemAccess(
          req.user,
          selection.systemId._id
        );
        if (hasAccess) {
          accessibleIds.push(selection._id);
        }
      }

      if (accessibleIds.length === 0) {
        return res.status(403).json({
          success: false,
          error: "You do not have access to any of these selections",
        });
      }

      query._id = { $in: accessibleIds };
    }

    if (dateISO) query.dateISO = dateISO;

    const result = await SystemSelection.updateMany(query, {
      $set: { isNew: false },
    });

    res.status(200).json({
      success: true,
      updated: result.modifiedCount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Update selection results
// @route   PUT /api/selections/:id/results
// @access  Admin
const updateSelectionResults = async (req, res) => {
  try {
    const { id } = req.params;
    const { result, winBsp } = req.body;

    // Find the selection
    const selection = await SystemSelection.findById(id);
    if (!selection) {
      return res.status(404).json({
        success: false,
        error: "Selection not found",
      });
    }

    // Validate required fields
    if (!result || (winBsp !== null && winBsp !== undefined && winBsp !== 0)) {
      return res.status(400).json({
        success: false,
        error: "result and winBsp (if not 0) are required",
      });
    }

    const upperResult = result.toUpperCase();
    const validResults = ["WON", "LOST", "NR", "VOID", "CANCELLED"];
    if (!validResults.includes(upperResult)) {
      return res.status(400).json({
        success: false,
        error: `Invalid result. Must be one of: ${validResults.join(", ")}`,
      });
    }

    // For NR, VOID, or CANCELLED, winBsp must be 0
    if (
      (upperResult === "NR" ||
        upperResult === "VOID" ||
        upperResult === "CANCELLED") &&
      winBsp !== 0 &&
      winBsp !== null &&
      winBsp !== undefined
    ) {
      return res.status(400).json({
        success: false,
        error: "winBsp must be 0 for NR, VOID, or CANCELLED results",
      });
    }

    // Calculate winPL (will be 0 for NR/VOID/CANCELLED)
    const winPL = calculateWinPL(upperResult, winBsp);

    // Get all previous selections for this system (sorted by rowOrder)
    // to calculate running totals
    const previousSelections = await SystemSelection.find({
      systemId: selection.systemId,
      rowOrder: { $lte: selection.rowOrder || 0 },
      _id: { $ne: id }, // Exclude current selection
    })
      .sort({ rowOrder: 1 })
      .select("winPL");

    // Calculate runningWinPL from previous selections
    // Sum all winPL from selections that come before this one (by rowOrder)
    let runningWinPL = previousSelections.reduce(
      (sum, s) => sum + (s.winPL || 0),
      0
    );
    runningWinPL += winPL; // Add current selection's winPL (0 for NR/VOID/CANCELLED)

    // Update the current selection
    const updateData = {
      result: upperResult,
      winBsp,
      winPL,
      runningWinPL,
      hasResult: true,
    };

    const updatedSelection = await SystemSelection.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate("systemId", "name slug")
      .populate("createdBy", "firstName lastName email");

    // Update all subsequent selections' running totals
    // Get all selections after this one (by rowOrder)
    const currentRowOrder = updatedSelection.rowOrder;

    if (currentRowOrder !== null && currentRowOrder !== undefined) {
      // Get all subsequent selections sorted by rowOrder
      const subsequentSelections = await SystemSelection.find({
        systemId: updatedSelection.systemId,
        rowOrder: { $gt: currentRowOrder },
      })
        .sort({ rowOrder: 1 })
        .select("_id winPL");

      // Recalculate running totals for subsequent selections incrementally
      // Start with the current selection's running totals
      let currentRunningWinPL = runningWinPL;

      // Update each subsequent selection's running totals
      for (const subsequent of subsequentSelections) {
        // Add this selection's PL to the running totals
        if (subsequent.winPL !== null && subsequent.winPL !== undefined) {
          currentRunningWinPL += subsequent.winPL;
        }

        // Update the subsequent selection
        await SystemSelection.findByIdAndUpdate(subsequent._id, {
          runningWinPL: currentRunningWinPL,
        });
      }
    }

    res.status(200).json({
      success: true,
      data: updatedSelection,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Delete selections by date range or system
// @route   DELETE /api/selections
// @access  Admin
const deleteSelections = async (req, res) => {
  try {
    const { systemId, dateISO, startDate, endDate } = req.query;
    const query = {};

    if (systemId) query.systemId = systemId;
    if (dateISO) query.dateISO = dateISO;

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    // Prevent deleting all selections without filters
    if (Object.keys(query).length === 0) {
      return res.status(400).json({
        success: false,
        error:
          "Must provide at least one filter (systemId, dateISO, or date range)",
      });
    }

    const result = await SystemSelection.deleteMany(query);

    res.status(200).json({
      success: true,
      deleted: result.deletedCount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Get distinct filter values for selections
// @route   GET /api/selections/filters
// @access  Private (Admin)
const getSelectionFilters = async (req, res) => {
  try {
    const { systemId } = req.query;

    if (!systemId) {
      return res.status(400).json({
        success: false,
        error: "systemId is required",
      });
    }

    // Verify user has access (admin check)
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        error: "Only admins can access filter options",
      });
    }

    // Build base query
    const query = { systemId };

    // Get distinct values
    const [countriesRaw, meetingsRaw, resultsRaw] = await Promise.all([
      SystemSelection.distinct("country", query),
      SystemSelection.distinct("meeting", query),
      SystemSelection.distinct("result", query),
    ]);

    // Filter out null/undefined and sort
    const countries = (countriesRaw || [])
      .filter((v) => v && v.trim())
      .sort((a, b) => a.localeCompare(b));

    const meetings = (meetingsRaw || [])
      .filter((v) => v && v.trim())
      .sort((a, b) => a.localeCompare(b));

    const results = (resultsRaw || [])
      .filter((v) => v && v.trim())
      .sort((a, b) => a.localeCompare(b));

    res.status(200).json({
      success: true,
      data: {
        countries,
        meetings,
        results,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  getSelections,
  getTodaySelections,
  getSelection,
  createSelection,
  createBulkSelections,
  uploadSelectionsFromCSV,
  uploadResultsFromCSV,
  updateSelection,
  updateSelectionResults,
  deleteSelection,
  markSelectionsViewed,
  deleteSelections,
  getSelectionFilters,
};
