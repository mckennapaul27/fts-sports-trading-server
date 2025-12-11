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

// @desc    Get all daily selections
// @route   GET /api/selections
// @access  Private (requires subscription to system)
const getSelections = async (req, res) => {
  try {
    const { systemId, dateISO, startDate, endDate, isNew } = req.query;
    const query = {};

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
            data: [],
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
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const selections = await SystemSelection.find(query)
      .populate("systemId", "name slug")
      .populate("createdBy", "firstName lastName email")
      .sort({ date: -1, time: 1 });

    res.status(200).json({
      success: true,
      count: selections.length,
      data: selections,
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
    const selection = await SystemSelection.findByIdAndDelete(req.params.id);

    if (!selection) {
      return res.status(404).json({
        success: false,
        error: "Selection not found",
      });
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
  updateSelection,
  deleteSelection,
  markSelectionsViewed,
  deleteSelections,
};
