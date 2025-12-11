// models/SystemSelection.js
const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const systemSelectionSchema = new Schema(
  {
    systemId: {
      type: Schema.Types.ObjectId,
      ref: "System",
      required: true,
      index: true,
    },

    dateISO: { type: String, required: true, index: true }, // "YYYY-MM-DD"
    date: { type: Date, required: true }, // midnight UTC

    country: String,
    meeting: String,
    time: String,
    horse: { type: String, required: true },

    // Flag to mark new selections for frontend notifications
    isNew: { type: Boolean, default: true, index: true },

    // Track who created this selection (admin user)
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Composite index for fast queries
systemSelectionSchema.index({ systemId: 1, dateISO: 1 });
// Index for querying new selections
systemSelectionSchema.index({ systemId: 1, isNew: 1, dateISO: 1 });
// Index for querying today's selections
systemSelectionSchema.index({ dateISO: 1, systemId: 1 });

module.exports = model("SystemSelection", systemSelectionSchema);
