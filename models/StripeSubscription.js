const mongoose = require("mongoose");

const stripeSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    stripeSubscriptionId: {
      type: String,
      required: true,
      unique: true,
    },
    plan: {
      type: String,
      required: true,
    },
    productId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      required: true,
    },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },

    cancelAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    metadata: {
      type: Object,
    },
  },
  {
    timestamps: true,
  }
);

const StripeSubscription = mongoose.model(
  "StripeSubscription",
  stripeSubscriptionSchema
);

module.exports = StripeSubscription;
