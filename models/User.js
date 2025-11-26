const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const userSchema = new Schema(
  {
    email: {
      type: String,
      unique: true,
      index: true,
      required: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    stripeCustomerId: { type: String, index: true },

    activeSystemIds: [{ type: Schema.Types.ObjectId, ref: "System" }],
  },
  { timestamps: true }
);

module.exports = model("User", userSchema);
