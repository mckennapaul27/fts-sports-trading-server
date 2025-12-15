const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const googleSheetConfigSchema = new Schema(
  {
    spreadsheetId: { type: String, required: false },
    range: { type: String, required: false },
  },
  { _id: false }
);

const systemSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    description: String,
    isActive: { type: Boolean, default: true },

    sheets: {
      selections: { type: googleSheetConfigSchema, required: false },
      results: { type: googleSheetConfigSchema, required: false },
    },
  },
  { timestamps: true }
);

module.exports = model("System", systemSchema);
