const Promotion = require("../models/Promotion");

// @desc    Get all promotions
// @route   GET /api/promotions
// @access  Public
const getPromotions = async (req, res) => {
  try {
    const promotions = await Promotion.find()
      .populate("planIds")
      .populate("systemIds");
    res.status(200).json({
      success: true,
      count: promotions.length,
      data: promotions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Get single promotion
// @route   GET /api/promotions/:id
// @access  Public
const getPromotion = async (req, res) => {
  try {
    const promotion = await Promotion.findById(req.params.id)
      .populate("planIds")
      .populate("systemIds");

    if (!promotion) {
      return res.status(404).json({
        success: false,
        error: "Promotion not found",
      });
    }

    res.status(200).json({
      success: true,
      data: promotion,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Get promotion by code
// @route   GET /api/promotions/code/:code
// @access  Public
const getPromotionByCode = async (req, res) => {
  try {
    const promotion = await Promotion.findOne({
      code: req.params.code,
    })
      .populate("planIds")
      .populate("systemIds");

    if (!promotion) {
      return res.status(404).json({
        success: false,
        error: "Promotion not found",
      });
    }

    res.status(200).json({
      success: true,
      data: promotion,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Create new promotion
// @route   POST /api/promotions
// @access  Public
const createPromotion = async (req, res) => {
  try {
    const promotion = await Promotion.create(req.body);

    res.status(201).json({
      success: true,
      data: promotion,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Update promotion
// @route   PUT /api/promotions/:id
// @access  Public
const updatePromotion = async (req, res) => {
  try {
    const promotion = await Promotion.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    )
      .populate("planIds")
      .populate("systemIds");

    if (!promotion) {
      return res.status(404).json({
        success: false,
        error: "Promotion not found",
      });
    }

    res.status(200).json({
      success: true,
      data: promotion,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Delete promotion
// @route   DELETE /api/promotions/:id
// @access  Public
const deletePromotion = async (req, res) => {
  try {
    const promotion = await Promotion.findByIdAndDelete(req.params.id);

    if (!promotion) {
      return res.status(404).json({
        success: false,
        error: "Promotion not found",
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
  getPromotions,
  getPromotion,
  getPromotionByCode,
  createPromotion,
  updatePromotion,
  deletePromotion,
};

