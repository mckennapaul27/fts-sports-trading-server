const Subscription = require("../models/Subscription");

// @desc    Get all subscriptions
// @route   GET /api/subscriptions
// @access  Public
const getSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find()
      .populate("userId")
      .populate("planId");
    res.status(200).json({
      success: true,
      count: subscriptions.length,
      data: subscriptions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Get single subscription
// @route   GET /api/subscriptions/:id
// @access  Public
const getSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findById(req.params.id)
      .populate("userId")
      .populate("planId");

    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: "Subscription not found",
      });
    }

    res.status(200).json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Get subscriptions by user
// @route   GET /api/subscriptions/user/:userId
// @access  Public
const getSubscriptionsByUser = async (req, res) => {
  try {
    const subscriptions = await Subscription.find({
      userId: req.params.userId,
    }).populate("planId");

    res.status(200).json({
      success: true,
      count: subscriptions.length,
      data: subscriptions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Create new subscription
// @route   POST /api/subscriptions
// @access  Public
const createSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.create(req.body);

    res.status(201).json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "Stripe subscription ID already exists",
      });
    }

    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Update subscription
// @route   PUT /api/subscriptions/:id
// @access  Public
const updateSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    )
      .populate("userId")
      .populate("planId");

    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: "Subscription not found",
      });
    }

    res.status(200).json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "Stripe subscription ID already exists",
      });
    }

    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Delete subscription
// @route   DELETE /api/subscriptions/:id
// @access  Public
const deleteSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findByIdAndDelete(
      req.params.id
    );

    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: "Subscription not found",
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
  getSubscriptions,
  getSubscription,
  getSubscriptionsByUser,
  createSubscription,
  updateSubscription,
  deleteSubscription,
};

