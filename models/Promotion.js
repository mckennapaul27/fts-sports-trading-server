const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const promotionSchema = new Schema(
  {
    name: { type: String, required: true },
    code: { type: String, index: true },

    discountType: {
      type: String,
      enum: ["percent", "fixed_amount"],
      required: true,
    },
    percentOff: Number,
    amountOffPence: Number,

    appliesTo: {
      type: String,
      enum: ["any", "plans", "systems", "bundle-only"],
      default: "plans",
    },

    planIds: [{ type: Schema.Types.ObjectId, ref: "Plan" }],
    systemIds: [{ type: Schema.Types.ObjectId, ref: "System" }],

    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },

    maxRedemptions: Number,
    redemptionCount: { type: Number, default: 0 },

    stripeCouponId: { type: String },
    stripePromotionCodeId: { type: String },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

promotionSchema.index({ isActive: 1, validFrom: 1, validTo: 1 });

module.exports = model("Promotion", promotionSchema);

