const System = require("../models/System");

// @desc    Get all systems
// @route   GET /api/systems
// @access  Public
const getSystems = async (req, res) => {
  try {
    const systems = await System.find();
    res.status(200).json({
      success: true,
      count: systems.length,
      data: systems,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Get single system
// @route   GET /api/systems/:id
// @access  Public
const getSystem = async (req, res) => {
  try {
    const system = await System.findById(req.params.id);

    if (!system) {
      return res.status(404).json({
        success: false,
        error: "System not found",
      });
    }

    res.status(200).json({
      success: true,
      data: system,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Create new system
// @route   POST /api/systems
// @access  Public
const createSystem = async (req, res) => {
  try {
    const system = await System.create(req.body);

    res.status(201).json({
      success: true,
      data: system,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "Slug already exists",
      });
    }

    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Update system
// @route   PUT /api/systems/:id
// @access  Public
const updateSystem = async (req, res) => {
  try {
    const system = await System.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!system) {
      return res.status(404).json({
        success: false,
        error: "System not found",
      });
    }

    res.status(200).json({
      success: true,
      data: system,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "Slug already exists",
      });
    }

    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Delete system
// @route   DELETE /api/systems/:id
// @access  Public
const deleteSystem = async (req, res) => {
  try {
    const system = await System.findByIdAndDelete(req.params.id);

    if (!system) {
      return res.status(404).json({
        success: false,
        error: "System not found",
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
  getSystems,
  getSystem,
  createSystem,
  updateSystem,
  deleteSystem,
};

