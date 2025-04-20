const mongoose = require("mongoose");
const CarePlan = require("../models/CarePlan");
const nodemailer = require("nodemailer");

module.exports = async (req, res) => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const today = new Date().getDay(); // 0 (Sunday) to 6 (Saturday)
    const carePlans = await CarePlan.find({
      reminderDays: today,
      $or: [
        { lastReminderSent: { $exists: false } },
        { lastReminderSent: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, // Last sent more than 24 hours ago
      ],
    });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    for (const plan of carePlans) {
      const user = await require("../models/User").findById(plan.userId);
      if (user && user.email && validator.isEmail(user.email)) {
        await transporter.sendMail({
          from: `"HairCare Pro" <${process.env.EMAIL_USER}>`,
          to: user.email,
          subject: "HairCare Pro Reminder",
          text: `Hi ${user.email},\n\nThis is a reminder to follow your hair care plan!\n\nTake care,\nHairCare Pro`,
        });
        plan.lastReminderSent = new Date();
        await plan.save();
        console.log(`Reminder sent to ${user.email} for plan ${plan._id}`);
      } else {
        console.warn(`Invalid or missing email for user ${plan.userId}`);
      }
    }

    res.status(200).json({ message: "Cron job executed successfully", count: carePlans.length });
  } catch (error) {
    console.error("Cron job error:", error);
    res.status(500).json({ error: "Cron job failed", details: error.message });
  }
};