const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const planSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },

    type: {
      type: String,
      enum: ["single-system", "bundle"],
      required: true,
    },

    systemIds: [{ type: Schema.Types.ObjectId, ref: "System" }],

    billingInterval: {
      type: String,
      enum: ["month", "year"],
      required: true,
    },

    pricePence: { type: Number, required: true },

    stripeProductId: { type: String, required: true, index: true },
    stripePriceId: { type: String, required: true, index: true },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = model("Plan", planSchema);

