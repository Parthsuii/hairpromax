const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const validator = require("validator");
const bcrypt = require("bcrypt");
const { generateCarePlanFetch } = require("./gemini-fetch");

// Suppress Mongoose strictQuery warning
mongoose.set("strictQuery", true);

const app = express();
require("dotenv").config();

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error("MongoDB Connection Error:", err));

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
// Serve PDF files from tmp/pdfs
app.use("/pdfs", express.static(path.join(__dirname, "tmp", "pdfs")));

app.use(
  session({
    secret: "haircare_secret",
    resave: false,
    saveUninitialized: true,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions",
    }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1 day
  })
);

const User = require("./models/User");
const CarePlan = require("./models/CarePlan");

app.get("/", (req, res) => res.redirect("/login"));
app.get("/login", (req, res) =>
  res.render("login", { user: req.session.user, error: null })
);
app.get("/register", (req, res) =>
  res.render("register", { user: req.session.user, error: null })
);
app.get("/survey", (req, res) => {
  if (!req.session.user) {
    console.log("No session found, redirecting to login");
    return res.redirect("/login");
  }
  console.log("Survey session:", req.session.user);
  res.render("survey", {
    user: req.session.user,
    username: req.session.user.username,
    error: null,
  });
});
app.get("/result", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.render("result", { user: req.session.user });
});
app.get("/dashboard", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.render("dashboard", { user: req.session.user });
});
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error("Logout error:", err);
    res.redirect("/login");
  });
});

app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  if (!validator.isEmail(email)) {
    return res.render("register", {
      error: "Invalid email format.",
      user: req.session.user,
    });
  }

  const existing = await User.findOne({ $or: [{ username }, { email }] });
  if (existing) {
    return res.render("register", {
      error: "Username or email already exists.",
      user: req.session.user,
    });
  }

  const user = new User({ username, email, password });
  await user.save();
  res.redirect("/login");
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (user && (await bcrypt.compare(password, user.password))) {
    req.session.user = {
      _id: user._id,
      username: user.username,
      email: user.email,
    };
    console.log("Session set:", req.session.user);
    res.redirect("/survey");
  } else {
    res.render("login", {
      error: "Invalid credentials",
      user: req.session.user,
    });
  }
});

app.post("/survey", async (req, res) => {
  if (!req.session.user) {
    console.log("No session found, redirecting to login");
    return res.redirect("/login");
  }

  const surveyData = req.body;
  console.log("Sending request to Gemini API...");
  const carePlan = await generateCarePlanFetch(
    surveyData,
    process.env.GEMINI_API_KEY
  );
  console.log("Raw Gemini response:", JSON.stringify(carePlan, null, 2));
  const userId = req.session.user._id;

  const carePlanDoc = new CarePlan({ userId, surveyData, carePlan });
  await carePlanDoc.save();

  const fileName = `careplan_${userId}_${Date.now()}.pdf`;
  const filePath = path.join(__dirname, "tmp", "pdfs", fileName);
  const publicPath = `/pdfs/${fileName}`;

  if (!fs.existsSync(path.join(__dirname, "tmp", "pdfs"))) {
    fs.mkdirSync(path.join(__dirname, "tmp", "pdfs"), { recursive: true });
    console.log("Created tmp/pdfs directory");
  }

  const pdf = new PDFDocument();
  const writeStream = fs.createWriteStream(filePath);
  pdf.pipe(writeStream);

  pdf.fontSize(20).text("HairCare Pro Prescription", { align: "center" });
  pdf
    .fontSize(14)
    .text(`For: ${req.session.user.username}`, { align: "center" });
  pdf.moveDown();

  // Handle different ingredient formats
  console.log(
    "Ingredients data before PDF:",
    JSON.stringify(carePlan.ingredients, null, 2)
  );
  if (carePlan.ingredients && Array.isArray(carePlan.ingredients)) {
    if (
      carePlan.ingredients.length > 0 &&
      typeof carePlan.ingredients[0] === "object" &&
      "name" in carePlan.ingredients[0]
    ) {
      // Format 1: Array of objects with name and howToUse
      carePlan.ingredients.forEach((ing) => {
        const name = ing.name || "Unknown Ingredient";
        const howToUse = ing.howToUse || "No instructions available";
        pdf.text(`- ${name}: ${howToUse}`);
      });
    } else {
      // Format 2: Array of strings with instructions object
      carePlan.ingredients.forEach((ing) => {
        const name = ing || "Unknown Ingredient";
        const howToUse =
          carePlan.instructions?.[ing] || "No instructions available";
        pdf.text(`- ${name}: ${howToUse}`);
      });
    }
  } else {
    console.warn(
      "Ingredients is not an array or is undefined:",
      carePlan.ingredients
    );
    pdf.text("- No ingredients available");
  }

  pdf.moveDown();
  pdf.text(`Wash Frequency: ${carePlan.washFrequency || "Not specified"}`);
  pdf.moveDown();
  pdf.text("Tips:");
  carePlan.tips?.forEach((tip) => {
    pdf.text(`- ${tip || "No tip available"}`);
  });
  pdf.end();

  writeStream.on("finish", () => {
    console.log(`PDF generated at: ${filePath}`);
  });

  writeStream.on("error", (err) => {
    console.error(`PDF generation error: ${err.message}`);
  });

  if (!req.session.user.email || !validator.isEmail(req.session.user.email)) {
    console.error("Invalid or missing email in session:", req.session.user);
    return res.render("survey", {
      username: req.session.user.username,
      error: "Invalid or missing email. Please re-login or contact support.",
      user: req.session.user,
    });
  }

  try {
    await sendEmailWithAttachment(
      req.session.user.email,
      req.session.user.username,
      filePath
    );
    console.log("Email sent successfully to:", req.session.user.email);
  } catch (error) {
    console.error("Email sending failed:", error);
    return res.render("survey", {
      username: req.session.user.username,
      error: "Error sending email: " + error.message,
      user: req.session.user,
    });
  }

  res.render("result", {
    username: req.session.user.username,
    email: req.session.user.email,
    ingredients: carePlan.ingredients || [],
    washFrequency: carePlan.washFrequency || "Not specified",
    instructions: carePlan.instructions || {},
    tips: carePlan.tips || [],
    resources: carePlan.resources || [],
    rawResponse: carePlan.rawResponse || {},
    error: carePlan.error,
    pdfPath: publicPath,
    user: req.session.user,
  });
});

const sendEmailWithAttachment = async (email, username, filePath) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: `"HairCare Pro" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Your HairCare Pro Prescription",
    text: `Hi ${username},\n\nAttached is your personalized hair care prescription.\n\nTake care,\nHairCare Pro`,
    attachments: [
      {
        filename: path.basename(filePath),
        path: filePath,
      },
    ],
  };

  await transporter.sendMail(mailOptions);
};

app.listen(3000, () => console.log("Server running on port 3000"));
