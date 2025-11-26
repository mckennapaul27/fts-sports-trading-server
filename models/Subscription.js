const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const subscriptionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: "Plan",
      required: true,
      index: true,
    },

    stripeSubscriptionId: { type: String, required: true, unique: true },
    stripeCustomerId: { type: String, required: true, index: true },

    status: {
      type: String,
      enum: [
        "incomplete",
        "incomplete_expired",
        "trialing",
        "active",
        "past_due",
        "canceled",
        "unpaid",
      ],
      required: true,
    },

    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },

    cancelAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },

    pricePence: { type: Number, required: true },
    billingInterval: {
      type: String,
      enum: ["month", "year"],
      required: true,
    },
  },
  { timestamps: true }
);

subscriptionSchema.index({ userId: 1, status: 1 });

module.exports = model("Subscription", subscriptionSchema);

