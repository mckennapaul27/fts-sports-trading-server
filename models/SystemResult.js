// models/SystemResult.js
const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const systemResultSchema = new Schema(
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
    horse: String,

    winBsp: Number,
    result: String,

    winPL: Number,
    runningWinPL: Number,
    placeBsp: Number,
    placePL: Number,
    runningPlacePL: Number,
  },
  { timestamps: true }
);

// Composite index for fast queries
systemResultSchema.index({ systemId: 1, dateISO: 1 });

module.exports = model("SystemResult", systemResultSchema);
