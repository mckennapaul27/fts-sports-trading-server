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
// Formula: 1 - BSP for WON, 0.98 for LOST/PLACED
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

    // Parse pagination parameters
    const limitNum = limit ? parseInt(limit, 10) : null;
    const offsetNum = offset ? parseInt(offset, 10) : 0;

    // Build sort object
    const sortField = sortBy || "date";
    const order = sortOrder === "asc" ? 1 : -1;
    const sortObj = { [sortField]: order };

    // If sorting by date, add time as secondary sort
    if (sortField === "date") {
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

    const updatedSelections = [];
    const unmatchedSelections = [];
    const errors = [];

    // First pass: Parse CSV and build a map of CSV data by dateISO+time+horse
    // Also collect all unique dateISO values
    const csvDataMap = new Map(); // key: `${dateISO}|${time}|${horse}`, value: CSV row data
    const dateISOs = new Set();

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

        dateISOs.add(dateISO);

        // Create a unique key for matching
        const matchKey = `${dateISO}|${time}|${horse}`;
        csvDataMap.set(matchKey, {
          row: i + 1,
          dateOfRace,
          country,
          track,
          time,
          horse,
          betfairSPStr,
          betfairLayReturnStr,
          betfairPlaceSPStr,
          placeLayReturnStr,
        });
      } catch (error) {
        errors.push({
          row: i + 1,
          error: error.message,
        });
      }
    }

    // Find all SystemSelections for the dateISO(s) in the CSV
    const allSelections = await SystemSelection.find({
      dateISO: { $in: Array.from(dateISOs) },
    }).lean();

    // Get all unique systemIds from selections and fetch system names
    const systemIds = [
      ...new Set(allSelections.map((s) => s.systemId.toString())),
    ];
    const systems = await System.find({
      _id: { $in: systemIds },
    })
      .select("_id name")
      .lean();
    const systemMap = new Map(systems.map((s) => [s._id.toString(), s.name]));

    // Second pass: Process each SystemSelection
    for (const selection of allSelections) {
      try {
        // Create match key for this selection
        const matchKey = `${selection.dateISO}|${selection.time}|${selection.horse}`;
        const csvRow = csvDataMap.get(matchKey);

        // If no CSV match found, this selection is unmatched
        if (!csvRow) {
          unmatchedSelections.push({
            dateISO: selection.dateISO,
            time: selection.time,
            horse: selection.horse,
            systemId: selection.systemId,
            systemName: systemMap.get(selection.systemId.toString()) || null,
            reason: "No matching CSV row found for this selection",
          });
          continue;
        }

        // Get system name to check if it's System 1 (only System 1 has place data)
        const systemName = systemMap.get(selection.systemId.toString());
        const isSystem1 = systemName === "System 1";

        // Parse numeric values from CSV row
        const betfairSP =
          csvRow.betfairSPStr && csvRow.betfairSPStr.trim()
            ? parseFloat(csvRow.betfairSPStr)
            : null;
        const betfairLayReturn = csvRow.betfairLayReturnStr
          ? parseFloat(csvRow.betfairLayReturnStr)
          : null;
        const betfairPlaceSP =
          csvRow.betfairPlaceSPStr && csvRow.betfairPlaceSPStr.trim()
            ? parseFloat(csvRow.betfairPlaceSPStr)
            : null;
        const placeLayReturn = csvRow.placeLayReturnStr
          ? parseFloat(csvRow.placeLayReturnStr)
          : null;

        // Check if Betfair SP is empty/invalid - if so, result is VOID
        const hasValidBetfairSP =
          betfairSP !== null && !isNaN(betfairSP) && betfairSP > 0;
        const hasValidBetfairPlaceSP =
          betfairPlaceSP !== null &&
          !isNaN(betfairPlaceSP) &&
          betfairPlaceSP > 0;

        let result;
        let winPL = null;
        let placePL = null;

        // Edge case 1: If Betfair SP is empty, result is VOID
        // Note: If Betfair SP is empty, Betfair Place SP will ALWAYS be empty too
        // For VOID, both winPL and placePL are 0
        if (!hasValidBetfairSP) {
          result = "VOID";
          winPL = 0;
          // Only set placePL to 0 for System 1 (VOID case)
          if (isSystem1) {
            placePL = 0;
          }
        } else {
          // Determine result based on lay returns (only if we have valid Betfair SP)
          // If Betfair Lay Return < 0: WON (lay bet lost)
          // If Place Lay Return < 0 (but win lay return >= 0): PLACED (only for System 1)
          // If both >= 0: LOST
          if (betfairLayReturn !== null && betfairLayReturn < 0) {
            result = "WON";
          } else if (
            isSystem1 &&
            placeLayReturn !== null &&
            placeLayReturn < 0
          ) {
            // Only System 1 can have PLACED result
            result = "PLACED";
          } else {
            // For non-System 1, if horse was placed, treat as LOST
            result = "LOST";
          }

          // Calculate winPL using the same logic as migration scripts
          winPL = calculateWinPL(result, betfairSP);

          // Edge case 2: Only process place market if Betfair Place SP exists AND it's System 1
          // If no Betfair Place SP, placePL remains null (place market not processed)
          if (isSystem1 && hasValidBetfairPlaceSP) {
            placePL = calculatePlacePL(result, betfairPlaceSP);
          }
          // Otherwise placePL remains null (place market not processed)
        }

        // Get all previous selections to calculate running totals
        const previousSelections = await SystemSelection.find({
          systemId: selection.systemId,
          rowOrder: { $lt: selection.rowOrder || 0 },
        })
          .sort({ rowOrder: 1 })
          .select("winPL placePL");

        // Calculate runningWinPL
        let runningWinPL = previousSelections.reduce(
          (sum, s) => sum + (s.winPL || 0),
          0
        );
        // winPL is always set (0 for VOID, or calculated value)
        runningWinPL += winPL;

        // Calculate runningPlacePL (only for System 1)
        // For VOID cases, placePL is 0, so we still calculate runningPlacePL
        // For cases without place SP, placePL is null, so we don't update runningPlacePL
        let runningPlacePL = null;
        if (isSystem1 && placePL !== null) {
          runningPlacePL = previousSelections.reduce(
            (sum, s) => sum + (s.placePL || 0),
            0
          );
          runningPlacePL += placePL;
        }

        // Update the selection
        const updateData = {
          country: csvRow.country || selection.country,
          meeting: csvRow.track || selection.meeting,
          result: result.toUpperCase(),
          hasResult: true,
        };

        // Only set winBsp if Betfair SP is valid (not VOID case)
        if (hasValidBetfairSP) {
          updateData.winBsp = betfairSP;
        }
        // Always set winPL (will be 0 for VOID, or calculated value otherwise)
        updateData.winPL = winPL;
        updateData.runningWinPL = runningWinPL;

        // Only set placeBsp, placePL, and runningPlacePL if it's System 1 and Betfair Place SP exists
        if (isSystem1 && hasValidBetfairPlaceSP) {
          updateData.placeBsp = betfairPlaceSP;
        }
        if (isSystem1 && placePL !== null) {
          updateData.placePL = placePL;
          updateData.runningPlacePL = runningPlacePL;
        }

        console.log("updateData", updateData);

        const updatedSelection = await SystemSelection.findByIdAndUpdate(
          selection._id.toString(),
          updateData,
          { new: true, runValidators: true }
        );

        updatedSelections.push(updatedSelection);

        // Recalculate running totals for subsequent selections
        const currentRowOrder = updatedSelection.rowOrder;
        if (currentRowOrder !== null && currentRowOrder !== undefined) {
          const subsequentSelections = await SystemSelection.find({
            systemId: updatedSelection.systemId,
            rowOrder: { $gt: currentRowOrder },
          })
            .sort({ rowOrder: 1 })
            .select("_id winPL placePL");

          let currentRunningWinPL = runningWinPL;
          let currentRunningPlacePL = runningPlacePL;

          for (const subsequent of subsequentSelections) {
            if (subsequent.winPL !== null && subsequent.winPL !== undefined) {
              currentRunningWinPL += subsequent.winPL;
            }
            // Only update place running totals for System 1
            if (
              isSystem1 &&
              subsequent.placePL !== null &&
              subsequent.placePL !== undefined
            ) {
              if (currentRunningPlacePL === null) {
                const allPreviousWithPlace = await SystemSelection.find({
                  systemId: updatedSelection.systemId,
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

            const updateSubsequent = {
              runningWinPL: currentRunningWinPL,
            };
            // Only update runningPlacePL for System 1
            if (isSystem1 && currentRunningPlacePL !== null) {
              updateSubsequent.runningPlacePL = currentRunningPlacePL;
            }

            await SystemSelection.findByIdAndUpdate(
              subsequent._id,
              updateSubsequent
            );
          }
        }
      } catch (error) {
        errors.push({
          selection: {
            dateISO: selection.dateISO,
            time: selection.time,
            horse: selection.horse,
          },
          error: error.message,
        });
      }
    }

    console.log("unmatchedSelections", unmatchedSelections);

    // Populate updated selections
    const populatedSelections = await SystemSelection.find({
      _id: { $in: updatedSelections.map((s) => s._id) },
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
    const { result, winBsp, placeBsp } = req.body;

    // Find the selection
    const selection = await SystemSelection.findById(id);
    if (!selection) {
      return res.status(404).json({
        success: false,
        error: "Selection not found",
      });
    }

    // Validate required fields
    if (!result || winBsp === undefined) {
      return res.status(400).json({
        success: false,
        error: "result and winBsp are required",
      });
    }

    // Calculate winPL
    const winPL = calculateWinPL(result, winBsp);

    // Calculate placePL if placeBsp is provided
    let placePL = null;
    if (placeBsp !== undefined && placeBsp !== null) {
      placePL = calculatePlacePL(result, placeBsp);
    } else if (result.toUpperCase() === "LOST") {
      // For LOST without placeBsp, still calculate placePL as 0.98
      placePL = 0.98;
    }

    // Get all previous selections for this system (sorted by rowOrder)
    // to calculate running totals
    const previousSelections = await SystemSelection.find({
      systemId: selection.systemId,
      rowOrder: { $lte: selection.rowOrder || 0 },
      _id: { $ne: id }, // Exclude current selection
    })
      .sort({ rowOrder: 1 })
      .select("winPL placePL");

    // Calculate runningWinPL from previous selections
    // Sum all winPL from selections that come before this one (by rowOrder)
    let runningWinPL = previousSelections.reduce(
      (sum, s) => sum + (s.winPL || 0),
      0
    );
    runningWinPL += winPL; // Add current selection's winPL

    // Calculate runningPlacePL from previous selections
    let runningPlacePL = null;
    if (placePL !== null) {
      runningPlacePL = previousSelections.reduce(
        (sum, s) => sum + (s.placePL || 0),
        0
      );
      runningPlacePL += placePL; // Add current selection's placePL
    }

    // Update the current selection first (so subsequent recalculations use updated values)
    const updateData = {
      result: result.toUpperCase(),
      winBsp,
      winPL,
      runningWinPL,
      hasResult: true,
    };

    if (placeBsp !== undefined) {
      updateData.placeBsp = placeBsp;
    }
    if (placePL !== null) {
      updateData.placePL = placePL;
    }
    if (runningPlacePL !== null) {
      updateData.runningPlacePL = runningPlacePL;
    }

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
        .select("_id winPL placePL");

      // Recalculate running totals for subsequent selections incrementally
      // Start with the current selection's running totals
      let currentRunningWinPL = runningWinPL;
      let currentRunningPlacePL = runningPlacePL;

      // Update each subsequent selection's running totals
      for (const subsequent of subsequentSelections) {
        // Add this selection's PL to the running totals
        if (subsequent.winPL !== null && subsequent.winPL !== undefined) {
          currentRunningWinPL += subsequent.winPL;
        }
        if (subsequent.placePL !== null && subsequent.placePL !== undefined) {
          if (currentRunningPlacePL === null) {
            // If this is the first selection with placePL after our update,
            // calculate runningPlacePL from all previous selections with placePL
            // (this will include the current selection we just updated)
            const allPreviousWithPlace = await SystemSelection.find({
              systemId: updatedSelection.systemId,
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
};
