// models/CarePlan.js
const mongoose = require("mongoose");

const carePlanSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  surveyData: Object,
  carePlan: Object,
  createdAt: { type: Date, default: Date.now },

  // New fields for reminder scheduling
  reminderDays: [Number], // E.g., [1, 4] for Monday & Thursday
  lastReminderSent: Date
});

module.exports = mongoose.model("CarePlan", carePlanSchema);
