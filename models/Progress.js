// models/Progress.js
const mongoose = require("mongoose");

const progressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  step: Number, // e.g., 1, 2, 3...
  feedback: String, // feedback by user or admin
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Progress", progressSchema);
