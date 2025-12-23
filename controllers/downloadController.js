const SystemSelection = require("../models/SystemSelection");
const System = require("../models/System");
const XLSX = require("xlsx");

// Map database fields to user-friendly headers
function mapSelectionToRow(selection) {
  const bsp = selection.winBsp || 0;

  return {
    Date: selection.dateISO || "",
    Country: selection.country || "",
    Course: selection.meeting || "",
    Time: selection.time || "",
    Selection: selection.horse || "",
    BSP: bsp > 0 ? bsp : "",
    Result: selection.result || "",
    "P/L": Math.round((selection.winPL || 0) * 100) / 100,
    "Running P/L": Math.round((selection.runningWinPL || 0) * 100) / 100,
  };
}

// ============================================
// ALL DATA DOWNLOADS (Complete Portfolio)
// ============================================

// @desc    Download all results as CSV (all systems, all dates)
// @route   GET /api/downloads/all/csv
// @access  Public
const downloadAllCSV = async (req, res) => {
  try {
    // Get all active systems - results are publicly available
    const allSystems = await System.find({ isActive: true }).select("_id");
    const systemIds = allSystems.map((s) => s._id);

    if (systemIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No data available",
      });
    }

    // Get all selections with results, sorted by system and rowOrder
    const selections = await SystemSelection.find({
      systemId: { $in: systemIds },
      hasResult: true,
    })
      .populate("systemId", "name slug")
      .sort({ systemId: 1, rowOrder: 1 })
      .lean();

    if (selections.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No results available",
      });
    }

    // Group selections by system
    const selectionsBySystem = {};
    selections.forEach((selection) => {
      const systemName = selection.systemId.name || "Unknown System";
      if (!selectionsBySystem[systemName]) {
        selectionsBySystem[systemName] = [];
      }
      selectionsBySystem[systemName].push(selection);
    });

    // Create CSV content
    const csvLines = [];
    const headers = [
      "Date",
      "Country",
      "Course",
      "Time",
      "Selection",
      "BSP",
      "Result",
      "P/L",
      "Running P/L",
    ];

    // For CSV, we'll combine all systems with a system header
    Object.keys(selectionsBySystem).forEach((systemName) => {
      csvLines.push(`\n=== ${systemName} ===`);
      csvLines.push(headers.join(","));

      selectionsBySystem[systemName].forEach((selection) => {
        const row = mapSelectionToRow(selection);
        csvLines.push(
          [
            row.Date,
            `"${row.Country}"`,
            `"${row.Course}"`,
            row.Time,
            `"${row.Selection}"`,
            row.BSP,
            row.Result,
            row["P/L"],
            row["Running P/L"],
          ].join(",")
        );
      });
    });

    const csvContent = csvLines.join("\n");

    // Set headers for CSV download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="complete-portfolio-${
        new Date().toISOString().split("T")[0]
      }.csv"`
    );

    res.send(csvContent);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Download all results as XLSX (all systems, multiple sheets)
// @route   GET /api/downloads/all/xlsx
// @access  Public
const downloadAllXLSX = async (req, res) => {
  try {
    // Get all active systems - results are publicly available
    const allSystems = await System.find({ isActive: true }).select("_id");
    const systemIds = allSystems.map((s) => s._id);

    if (systemIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No data available",
      });
    }

    // Get all selections with results, sorted by system and rowOrder
    const selections = await SystemSelection.find({
      systemId: { $in: systemIds },
      hasResult: true,
    })
      .populate("systemId", "name slug")
      .sort({ systemId: 1, rowOrder: 1 })
      .lean();

    if (selections.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No results available",
      });
    }

    // Group selections by system
    const selectionsBySystem = {};
    selections.forEach((selection) => {
      const systemName = selection.systemId.name || "Unknown System";
      if (!selectionsBySystem[systemName]) {
        selectionsBySystem[systemName] = [];
      }
      selectionsBySystem[systemName].push(selection);
    });

    // Create a new workbook
    const workbook = XLSX.utils.book_new();

    // Create a sheet for each system
    Object.keys(selectionsBySystem).forEach((systemName) => {
      const systemSelections = selectionsBySystem[systemName];
      const rows = systemSelections.map((selection) =>
        mapSelectionToRow(selection)
      );

      // Add headers as first row
      const headers = [
        "Date",
        "Country",
        "Course",
        "Time",
        "Selection",
        "BSP",
        "Result",
        "P/L",
        "Running P/L",
      ];
      const worksheetData = [headers, ...rows.map((row) => Object.values(row))];

      // Create worksheet
      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

      // Set column widths
      worksheet["!cols"] = [
        { wch: 12 }, // Date
        { wch: 15 }, // Country
        { wch: 20 }, // Course
        { wch: 10 }, // Time
        { wch: 25 }, // Selection
        { wch: 10 }, // BSP
        { wch: 10 }, // Result
        { wch: 10 }, // P/L
        { wch: 12 }, // Running P/L
      ];

      // Add sheet to workbook (sanitize sheet name - Excel has 31 char limit)
      const sheetName =
        systemName.length > 31 ? systemName.substring(0, 31) : systemName;
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    });

    // Generate Excel file buffer
    const excelBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    // Set headers for XLSX download
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="complete-portfolio-${
        new Date().toISOString().split("T")[0]
      }.xlsx"`
    );

    res.send(excelBuffer);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ============================================
// INDIVIDUAL SYSTEM/FILTERED DOWNLOADS
// ============================================

// @desc    Download results by system as CSV
// @route   GET /api/downloads/system/csv
// @access  Public
const downloadSystemCSV = async (req, res) => {
  try {
    const { systemId, startDate, endDate } = req.query;

    // Build query
    const query = {
      hasResult: true, // Only return results
    };

    // Add systemId filter if provided (no access check - results are public)
    if (systemId) {
      // Verify system exists
      const system = await System.findById(systemId);
      if (!system || !system.isActive) {
        return res.status(404).json({
          success: false,
          error: "System not found",
        });
      }
      query.systemId = systemId;
    }

    // Add date range filter if provided
    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        query.date.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    // Get selections with results
    const selections = await SystemSelection.find(query)
      .populate("systemId", "name slug")
      .sort({ rowOrder: 1 })
      .lean();

    if (selections.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No results available for the selected criteria",
      });
    }

    // Create CSV content
    const headers = [
      "Date",
      "Country",
      "Course",
      "Time",
      "Selection",
      "BSP",
      "Result",
      "P/L",
      "Running P/L",
    ];

    const csvLines = [headers.join(",")];

    selections.forEach((selection) => {
      const row = mapSelectionToRow(selection);
      csvLines.push(
        [
          row.Date,
          `"${row.Country}"`,
          `"${row.Course}"`,
          row.Time,
          `"${row.Selection}"`,
          row.BSP,
          row.Result,
          row["P/L"],
          row["Running P/L"],
        ].join(",")
      );
    });

    const csvContent = csvLines.join("\n");

    // Generate filename
    let filename = "results";
    if (systemId) {
      const system = await System.findById(systemId);
      if (system) {
        filename =
          system.slug || system.name.toLowerCase().replace(/\s+/g, "-");
      }
    }
    if (startDate || endDate) {
      const dateStr =
        startDate && endDate
          ? `${startDate}_to_${endDate}`
          : startDate
          ? `from_${startDate}`
          : `until_${endDate}`;
      filename += `-${dateStr}`;
    }

    // Set headers for CSV download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}-${
        new Date().toISOString().split("T")[0]
      }.csv"`
    );

    res.send(csvContent);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Download results by system as XLSX
// @route   GET /api/downloads/system/xlsx
// @access  Public
const downloadSystemXLSX = async (req, res) => {
  try {
    const { systemId, startDate, endDate } = req.query;

    // Build query
    const query = {
      hasResult: true, // Only return results
    };

    // Add systemId filter if provided (no access check - results are public)
    if (systemId) {
      // Verify system exists
      const system = await System.findById(systemId);
      if (!system || !system.isActive) {
        return res.status(404).json({
          success: false,
          error: "System not found",
        });
      }
      query.systemId = systemId;
    }

    // Add date range filter if provided
    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        query.date.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    // Get selections with results
    const selections = await SystemSelection.find(query)
      .populate("systemId", "name slug")
      .sort({ rowOrder: 1 })
      .lean();

    if (selections.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No results available for the selected criteria",
      });
    }

    // Map selections to rows
    const rows = selections.map((selection) => mapSelectionToRow(selection));

    // Create a new workbook
    const workbook = XLSX.utils.book_new();

    // Add headers as first row
    const headers = [
      "Date",
      "Country",
      "Course",
      "Time",
      "Selection",
      "BSP",
      "Result",
      "P/L",
      "Running P/L",
    ];
    const worksheetData = [headers, ...rows.map((row) => Object.values(row))];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // Set column widths
    worksheet["!cols"] = [
      { wch: 12 }, // Date
      { wch: 15 }, // Country
      { wch: 20 }, // Course
      { wch: 10 }, // Time
      { wch: 25 }, // Selection
      { wch: 10 }, // BSP
      { wch: 10 }, // Result
      { wch: 10 }, // P/L
      { wch: 12 }, // Running P/L
    ];

    // Determine sheet name
    let sheetName = "Results";
    if (systemId) {
      const system = await System.findById(systemId);
      if (system) {
        sheetName = system.name || "Results";
      }
    }
    // Excel has 31 character limit for sheet names
    if (sheetName.length > 31) {
      sheetName = sheetName.substring(0, 31);
    }

    // Add sheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    // Generate Excel file buffer
    const excelBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    // Generate filename
    let filename = "results";
    if (systemId) {
      const system = await System.findById(systemId);
      if (system) {
        filename =
          system.slug || system.name.toLowerCase().replace(/\s+/g, "-");
      }
    }
    if (startDate || endDate) {
      const dateStr =
        startDate && endDate
          ? `${startDate}_to_${endDate}`
          : startDate
          ? `from_${startDate}`
          : `until_${endDate}`;
      filename += `-${dateStr}`;
    }

    // Set headers for XLSX download
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}-${
        new Date().toISOString().split("T")[0]
      }.xlsx"`
    );

    res.send(excelBuffer);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  downloadAllCSV,
  downloadAllXLSX,
  downloadSystemCSV,
  downloadSystemXLSX,
};
