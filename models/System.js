const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const googleSheetConfigSchema = new Schema(
  {
    spreadsheetId: { type: String, required: true },
    range: { type: String, required: true },
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
      selections: { type: googleSheetConfigSchema, required: true },
      results: { type: googleSheetConfigSchema, required: true },
    },
  },
  { timestamps: true }
);

module.exports = model("System", systemSchema);

