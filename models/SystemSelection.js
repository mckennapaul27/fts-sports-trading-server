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
    isNewSelection: { type: Boolean, default: true, index: true },

    // Track who created this selection (admin user)
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    // Result fields (added after race finishes)
    result: String, // "Won", "Lost", "Placed", etc.
    winBsp: Number,
    winPL: Number,
    runningWinPL: Number,
    placeBsp: Number,
    placePL: Number,
    runningPlacePL: Number,
    hasResult: { type: Boolean, default: false, index: true }, // Quick filter for selections with results

    // Row order from Google Sheets to maintain original order (for backward compatibility)
    rowOrder: { type: Number, index: true },
  },
  { timestamps: true }
);

// Composite index for fast queries
systemSelectionSchema.index({ systemId: 1, dateISO: 1 });
// Index for querying new selections
systemSelectionSchema.index({ systemId: 1, isNew: 1, dateISO: 1 });
// Index for querying today's selections
systemSelectionSchema.index({ dateISO: 1, systemId: 1 });
// Index for querying selections with results
systemSelectionSchema.index({ systemId: 1, hasResult: 1, dateISO: 1 });
// Index for maintaining Google Sheets order (for backward compatibility)
systemSelectionSchema.index({ systemId: 1, rowOrder: 1 });

module.exports = model("SystemSelection", systemSelectionSchema);
