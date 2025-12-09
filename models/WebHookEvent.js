const mongoose = require("mongoose");

const webHookEventSchema = new mongoose.Schema({
  stripeEventId: {
    type: String,
    required: true,
    unique: true,
  },
  type: {
    type: String,
    required: true,
  },
  payload: {
    type: Object,
    required: true,
  },
  processedAt: {
    type: Date,
  },
});

const WebHookEvent = mongoose.model("WebHookEvent", webHookEventSchema);

module.exports = WebHookEvent;
