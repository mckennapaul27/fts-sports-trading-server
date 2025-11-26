const SystemResult = require("../models/SystemResult");
const { syncSystemResults, syncAllSystems } = require("../services/syncService");

// @desc    Get all system results
// @route   GET /api/system-results
// @access  Public
const getSystemResults = async (req, res) => {
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

    const results = await SystemResult.find(query)
      .populate("systemId")
      .sort({ date: -1, time: 1 });

    res.status(200).json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Get single system result
// @route   GET /api/system-results/:id
// @access  Public
const getSystemResult = async (req, res) => {
  try {
    const result = await SystemResult.findById(req.params.id).populate(
      "systemId"
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        error: "System result not found",
      });
    }

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Sync system results from Google Sheets
// @route   POST /api/system-results/sync/:systemId
// @access  Public
const syncSystem = async (req, res) => {
  try {
    const result = await syncSystemResults(req.params.systemId);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Sync all systems from Google Sheets
// @route   POST /api/system-results/sync-all
// @access  Public
const syncAll = async (req, res) => {
  try {
    const results = await syncAllSystems();

    res.status(200).json({
      success: true,
      data: results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Delete system result
// @route   DELETE /api/system-results/:id
// @access  Public
const deleteSystemResult = async (req, res) => {
  try {
    const result = await SystemResult.findByIdAndDelete(req.params.id);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: "System result not found",
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

module.exports = {
  getSystemResults,
  getSystemResult,
  syncSystem,
  syncAll,
  deleteSystemResult,
};

